// Train kinematics (docs/30 §6, §7.1; docs/70 M4.2). HEADLESS — zero three.js/render/DOM imports
// (docs/30 §2.1). This file moves an on-rails train along the TrackGraph one tick at a time and
// resolves piece-local poses (see the `Pose` doc comment below — NOT world-space, a deliberate
// scope call, flagged as a known risk in the M4.2 report) for the locomotive and its trailing
// carriages. It DOES implement the §7.1 longitudinal/acceleration model (vTarget/a/v' below) —
// that was originally miscontracted to M4.3, but docs/70's M4.3 "Reuse" line starts at §7.2,
// meaning §7.1 (the only thing that makes v actually converge rather than being a fixed input)
// was always this file's job; corrected in a same-branch follow-up to the initial M4.2 delivery.
// It does NOT do jumps, derails, or collisions (§7.2-7.4) — that is M4.3 (train/physics.ts) and
// M4.4 (train/stations.ts). The one exception within the dead-end handling is the "soft stop"
// (v -> 0 at v <= vCrawl) which docs/30 §6 describes as a kinematic boundary condition, applied
// as an override *after* the §7.1 update, not part of the §7.1 formula itself.
//
// --- facing (read docs/70's M4.2 task contract before changing this) ---
// `compilePath` always parameterizes a path in its own fromPort->toPort direction and has no
// notion of graph edge direction. graph.ts pre-builds BOTH directions of every path as separate
// TrackEdge objects, with ids `${placementIndex}:${pathIndex}:f` (fromPort->toPort, matching the
// compiled path as-is) and `...:r` (toPort->fromPort, the same compiled path read backwards).
// `facing` is derived from that suffix: 1 for ':f' (read the compiled path forwards), -1 for
// ':r' (read it backwards: position at `length - s`, tangent negated). It is a derived cache, not
// an independently settable field — recomputed here (`facingOf`) every time an edge changes, so
// it can never disagree with `edgeId`.
//
// Separately, and NOT to be confused with the above: the arc-length `s` *along whichever edge the
// train currently occupies* always runs 0 -> edge.length as the train moves forward, regardless
// of facing. `facing` only controls how that edge's `s` is translated into a sample point on the
// underlying compiled path; it does not change which direction `s` counts up.

import { scale, type Vec3 } from '../core/math';
import type { PieceType } from '../track/pieces';
import { compilePath } from '../track/splines';
import type { TrackEdge, TrackGraph } from '../track/graph';
import type { TrainState } from './types';
import { PHYSICS, type SpeedBet } from './physics-constants';

export interface AdvanceResult {
  /** New state — advanceTrain is a pure function; the input TrainState is never mutated. */
  state: TrainState;
  /**
   * Set only when the train ran past a dead end at v > vCrawl: the arc-length that could not be
   * delivered this tick. M4.3 (physics.ts) reads this to decide jump vs. crash; this file never
   * crashes or launches a train itself. `null` in every other case (including the dead-end
   * "soft stop" at v <= vCrawl, which this file resolves on its own — see module doc above).
   */
  deadEndOverrun: number | null;
}

// Safety cap on the handoff loop below, guarding against a degenerate zero-length-edge cycle (or
// a single tick's v*dt spanning an implausible number of very short edges). If hit, the loop
// stops and the remaining distance for that tick is left undelivered rather than looping forever
// — a known limitation, not a physics decision; see docs/70 M4.2 task contract.
const MAX_HANDOFF_ITERATIONS = 64;

/** `1` for a graph edge id ending ':f' (compiled path read forwards), `-1` for ':r' (backwards). */
function facingOf(edge: TrackEdge): 1 | -1 {
  return edge.id.endsWith(':f') ? 1 : -1;
}

/**
 * The id of the edge that is the exact reverse of `edge` (same placementIndex/pathIndex, opposite
 * ':f'/':r' suffix). graph.ts pre-builds both directions of every path as separate edge objects,
 * so this reverse edge always exists and is always one of `edgesFrom(edge.to, ...)`'s options —
 * discovered the hard way while testing this file: without excluding it, "pick the first array
 * element" (the tie-break docs/70 M4.2 specifies) can select "go back the way we just came" at a
 * plain node between two pieces (a real dead end then becomes topologically undetectable too,
 * since a lone piece's far node always has this same reverse edge, so `edgesFrom` there is never
 * actually empty). Excluding it is a necessary refinement of "onward edge" (docs/30 §6) beyond
 * what the task text spelled out — flagged as a known contract gap in the M4.2 report, not a
 * silent deviation.
 */
function reverseEdgeId(edge: TrackEdge): string {
  const suffix = edge.id.endsWith(':f') ? 'r' : 'f';
  return `${edge.placementIndex}:${edge.pathIndex}:${suffix}`;
}

function maxCarriageOffset(train: TrainState): number {
  return train.carriages.reduce((max, c) => Math.max(max, c.offset), 0);
}

/**
 * Trim `history` from the front once the summed length of its most recent entries safely covers
 * `maxOffset` (the longest carriage's arc-length distance behind the loco). Always keeps at least
 * the last (current) entry, even when `maxOffset` is 0 (empty carriages). Uses whole edge
 * lengths as a conservative (over-)estimate of "distance available", so this only ever trims
 * edges that are provably no longer reachable by any carriage — never too aggressively.
 */
function trimHistory(history: string[], graph: TrackGraph, maxOffset: number): string[] {
  let acc = 0;
  let keepFrom = history.length - 1;
  for (let i = history.length - 1; i >= 0 && acc < maxOffset; i--) {
    keepFrom = i;
    const edge = graph.edges.get(history[i]);
    acc += edge ? edge.length : 0;
  }
  return history.slice(Math.max(keepFrom, 0));
}

/**
 * The §7.1 longitudinal/acceleration model in isolation: `vTarget = vBase * betMult(bet)`,
 * `a = aThrottle*sign(vTarget-v) - gSlope*grade - cDrag*v`, `v' = clamp(v + a*dt, 0, vHardMax)`.
 * Extracted (docs/70 M4.3) so `advanceTrain` below and `train/physics.ts` share one
 * implementation — physics.ts needs to predict this tick's `v` (to decide whether a jump
 * triggers) before it knows whether it'll even call `advanceTrain` this tick. Pure, no behavior
 * change from the inline version this replaces.
 */
export function updateVelocity(v: number, grade: -1 | 0 | 1, speedBet: SpeedBet, dt: number): number {
  const vTarget = PHYSICS.vBase * PHYSICS.betMult[speedBet];
  const a = PHYSICS.aThrottle * Math.sign(vTarget - v) - PHYSICS.gSlope * grade - PHYSICS.cDrag * v;
  return Math.min(Math.max(v + a * dt, 0), PHYSICS.vHardMax);
}

/**
 * Advance a single on-rails train by `dt` seconds: first the §7.1 longitudinal/acceleration
 * update to `v` (using the CURRENT edge's grade, i.e. the edge occupied at the START of this
 * tick, before any handoff processing below — docs/70's correction is explicit that grade does
 * NOT get re-read mid-tick even if the train hands off to a different-grade edge this same tick),
 * then arc-length position integration using that updated `v`, handing off across edge boundaries
 * (`graph.edgesFrom`) and carrying leftover distance forward — never losing partial-tick distance
 * except at a genuine dead end or the iteration cap (see AdvanceResult/module doc).
 *
 * `pieceTypeOf` is intentionally NOT a parameter here: this function only ever reads
 * `edge.length`/`edge.to`/`edge.grade` from the graph (pure topology + arc-length + the §7.1
 * grade term), never a compiled path, so it never needs to resolve a placement's PieceType.
 * `locoPose`/`carriagePose` below DO need it (to call `compilePath`), which is why they take it —
 * see docs/70 M4.2 task contract for the `pieceTypeOf` pattern this is built against.
 */
export function advanceTrain(
  train: TrainState,
  graph: TrackGraph,
  switchStates: ReadonlyMap<number, 0 | 1>,
  speedBet: SpeedBet,
  dt: number,
): AdvanceResult {
  // Airborne/crashed trains are M4.3's (physics.ts) responsibility to resume on-rails motion for
  // (by not calling this function, or calling it once back on rails) — not this file's to guess.
  if (train.crashed || train.airborne !== null || train.edgeId === null) {
    return { state: train, deadEndOverrun: null };
  }

  const startEdge = graph.edges.get(train.edgeId);
  if (!startEdge) {
    // A stale edgeId for this graph (mismatched graph vs. state) is a caller bug — no-op rather
    // than throwing mid-tick.
    return { state: train, deadEndOverrun: null };
  }
  // Explicit `TrackEdge` annotation (rather than relying on narrowing `graph.edges.get(...)`'s
  // `TrackEdge | undefined` across the loop below, where `edge` is reassigned) keeps this
  // unambiguously non-undefined for the rest of the function.
  let edge: TrackEdge = startEdge;

  // §7.1 update, applied to `v` BEFORE position integration (docs/30 §6: "with the physics
  // update of §7 applied to v first"), using `startEdge.grade` (this tick's starting edge only,
  // per the function doc above).
  let v = updateVelocity(train.v, startEdge.grade, speedBet, dt);

  let s = train.s + v * dt;
  const history = train.history.slice();
  let deadEndOverrun: number | null = null;
  let iterations = 0;

  while (s > edge.length) {
    iterations += 1;
    if (iterations > MAX_HANDOFF_ITERATIONS) {
      s = edge.length;
      break;
    }

    const overrun = s - edge.length;
    // Gated by switch state already (docs/30 §5): a junction with no settable branch open counts
    // as a dead end here too, exactly like a piece with no further connection. Also exclude the
    // exact reverse of the edge we're currently on (see `reverseEdgeId` doc) — otherwise a plain
    // node between two pieces always looks like a branch (forward option + "go back") and a real
    // dead end never looks like one (a lone piece's far node always has its own reverse edge).
    const reverseId = reverseEdgeId(edge);
    const options = graph.edgesFrom(edge.to, switchStates).filter((e) => e.id !== reverseId);

    if (options.length === 0) {
      s = edge.length;
      // Soft stop (docs/30 §6) applies ONLY at height 0 — the doc's exact wording is "Dead end
      // ... at height 0 and v <= vCrawl: train stops (soft)"; at height >= 1 it's explicit that
      // "at speed: see jump/crash rules §7.2" instead, REGARDLESS of v vs vCrawl (a slow-rolling
      // train off a height>=1 ledge doesn't get a free soft stop — it's w2-s5's "Steady teeters
      // into the gorge" case, docs/70 M4.3: below vJump at height>=1 is a `gap` crash, not a
      // stop). This height check was missing from the original M4.2 delivery (a real bug caught
      // while building M4.3's jump/gap logic, which depends on it) — fixed here rather than
      // silently worked around in physics.ts, since the soft-stop boundary condition belongs to
      // this file's dead-end handling either way.
      const nodeHeight = graph.nodes.get(edge.to)?.height ?? 0;
      if (nodeHeight === 0 && v <= PHYSICS.vCrawl) {
        // A kinematic boundary condition that overrides the §7.1 acceleration result computed
        // above, not a rule the formula itself expresses — this is the only place this file
        // hard-sets `v` outside that formula.
        v = 0;
        deadEndOverrun = null;
      } else {
        deadEndOverrun = overrun;
      }
      break;
    }

    // Deterministic tie-break: first array element. Real routing / multi-train dispatch choice
    // is out of scope for M4.2 (kinematics only) — a future sim decides that.
    edge = options[0];
    s = overrun;
    history.push(edge.id);
  }

  const trimmed = trimHistory(history, graph, maxCarriageOffset(train));

  return {
    state: {
      ...train,
      edgeId: edge.id,
      s,
      facing: facingOf(edge),
      v,
      history: trimmed,
    },
    deadEndOverrun,
  };
}

/**
 * `pos`/`tangent` are in the traversed edge's PIECE-LOCAL frame — i.e. exactly what
 * `compilePath(...).pointAt/tangentAt` returns (docs/70 M4.1: "piece-local, cell (0,0) centered
 * at origin"), never transformed by that placement's cell/rotation/base-height.
 *
 * KNOWN GAP (flagged for the record, not silently papered over): `TrackEdge` only carries
 * `placementIndex`/`pathIndex` — `TrackGraph` has no accessor for a placement's cell/rotation/
 * base-height (only `portNode`, which returns a node id, not a transform), and this task's
 * constraints forbid adding one (`graph.ts`'s public surface is frozen here). So there is no way
 * for this module to produce a true WORLD-space position on its own. The caller (M5 sim / M6
 * renderer) already tracks each placementIndex's `Placement` (cell + rotation) — the same data it
 * needs to position that piece's own rendered mesh (`render/instances.ts`'s `place()`) — and is
 * expected to apply that identical transform to `pos`/`tangent` here, exactly as it already does
 * for the piece geometry itself. See the M4.2 report's "known risks" for the full explanation.
 */
export interface Pose {
  pos: Vec3;
  tangent: Vec3;
}

/** Piece-local pose (see `Pose` doc above) at arc-length `s` along `edge`, honoring `facing`. */
function poseOnEdge(edge: TrackEdge, s: number, pieceTypeOf: (placementIndex: number) => PieceType): Pose {
  const compiled = compilePath(pieceTypeOf(edge.placementIndex), edge.pathIndex);
  if (facingOf(edge) === 1) {
    return { pos: compiled.pointAt(s), tangent: compiled.tangentAt(s) };
  }
  const sBack = compiled.length - s;
  return { pos: compiled.pointAt(sBack), tangent: scale(compiled.tangentAt(sBack), -1) };
}

/** The locomotive's current pose (piece-local frame of its current edge — see `Pose` doc). */
export function locoPose(
  train: TrainState,
  graph: TrackGraph,
  pieceTypeOf: (placementIndex: number) => PieceType,
): Pose {
  if (train.edgeId === null) {
    throw new Error('locoPose: train has no edgeId (airborne/crashed) — read train.airborne instead');
  }
  const edge = graph.edges.get(train.edgeId);
  if (!edge) throw new Error(`locoPose: unknown edgeId "${train.edgeId}"`);
  return poseOnEdge(edge, train.s, pieceTypeOf);
}

/**
 * A trailing carriage's pose (piece-local frame of whichever historical edge it resolves onto —
 * see `Pose` doc): walk backward from the loco's current (edgeId, s) by
 * `carriages[index].offset` arc-length units using `train.history` — the edges the loco actually
 * traversed, NOT graph-inferred predecessors (a junction/converging track can have more than one
 * graph-valid predecessor for the same node; only history says which one the loco really came
 * from). If the offset exceeds what history covers (a scenario/spawn-setup concern out of scope
 * here — see docs/70 M4.2 task contract), clamps to the start of the oldest history entry
 * instead of throwing.
 */
export function carriagePose(
  train: TrainState,
  index: number,
  graph: TrackGraph,
  pieceTypeOf: (placementIndex: number) => PieceType,
): Pose {
  const offset = train.carriages[index]?.offset ?? 0;
  if (train.edgeId === null) {
    throw new Error('carriagePose: train has no edgeId (airborne/crashed)');
  }
  const currentEdge = graph.edges.get(train.edgeId);
  if (!currentEdge) throw new Error(`carriagePose: unknown edgeId "${train.edgeId}"`);

  // history is only usable for walking further back if its last entry really is the current edge
  // (a malformed/absent history just means "no history beyond the current edge" — degrade
  // gracefully rather than throw).
  const historyUsable = train.history.length > 0 && train.history[train.history.length - 1] === train.edgeId;

  let edge = currentEdge;
  let sOnEdge = train.s; // distance available walking backward from the reference point on `edge`
  let histIndex = historyUsable ? train.history.length - 1 : -1;
  let remaining = offset;

  while (remaining > sOnEdge) {
    remaining -= sOnEdge;
    histIndex -= 1;
    if (histIndex < 0) {
      // offset exceeds what history covers — clamp to the start of the oldest known edge.
      return poseOnEdge(edge, 0, pieceTypeOf);
    }
    const prevEdge = graph.edges.get(train.history[histIndex]);
    if (!prevEdge) {
      return poseOnEdge(edge, 0, pieceTypeOf);
    }
    edge = prevEdge;
    sOnEdge = edge.length;
  }

  return poseOnEdge(edge, sOnEdge - remaining, pieceTypeOf);
}
