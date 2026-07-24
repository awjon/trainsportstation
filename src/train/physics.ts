// Arcade physics: jumps, derails, collisions (docs/30 §7.2-7.4, docs/70 M4.3). HEADLESS — zero
// three.js/render/camera/ui/effects/audio/DOM imports (docs/30 §2.1). Builds on train/movement.ts
// (M4.2, kinematics only) and requires real WORLD-space geometry for the first time in this
// project (see "world space" note below) — that's why track/graph.ts's `placements` map and
// track/placement.ts's `pieceLocalToWorld`/`pieceLocalDirToWorld` were added alongside this file.
//
// --- why world space, now ---
// `compilePath`/`pathCurve` (M4.1) only ever return piece-LOCAL coordinates, and `TrackEdge` only
// carries `placementIndex`/`pathIndex`, never a placement's cell/rotation — train/movement.ts's
// M4.2 report flagged this exact gap for `locoPose`/`carriagePose`. It stayed a non-issue there
// because kinematics only ever needs the CURRENT edge's own local frame. Landing (§7.2) breaks
// that: it has to search every placed piece for a nearby track point, INCLUDING pieces the
// jumping train isn't graph-connected to — crossing a disconnected gap is the entire point of a
// jump — so "nearby" has to mean world-space distance, not graph topology.
//
// --- scope ---
// This file only ever constructs `Crashed`/`Airtime` events (simulation/events.ts). Carriages are
// out of scope: `TrainState.airborne` models the locomotive only — `carriagePose` (M4.2) still
// requires `edgeId !== null` and correctly throws otherwise; deciding how trailing carriages
// render/behave during a jump is a future milestone's call, not this one's.

import { dist, dot, normalize, scale, vec, type Vec3 } from '../core/math';
import type { Tick } from '../core/types';
import { CELL, PIECE_DEFS, type CellCoord, type CurveClass, type PieceType } from '../track/pieces';
import { pieceLocalDirToWorld, pieceLocalToWorld } from '../track/placement';
import { compilePath } from '../track/splines';
import type { TrackEdge, TrackGraph } from '../track/graph';
import type { SimEvent } from '../simulation/events';
import type { TrainState } from './types';
import { PHYSICS, type SpeedBet } from './physics-constants';
import { advanceTrain, locoPose, updateVelocity } from './movement';

export interface PhysicsStepResult {
  /** New state — stepTrainPhysics is a pure function; the input TrainState is never mutated. */
  state: TrainState;
  /** Events emitted this tick by THIS train's own step (Crashed/Airtime only — see module doc).
   * Empty in the common case (a normal on-rails step, or continuing to fall with no landing). */
  events: SimEvent[];
}

// --- small local helpers (not exported — trivial, deliberately not re-exported from movement.ts
// to keep that file's public surface exactly as M4.2 left it plus the one requested extraction) ---

function maxCarriageOffset(train: TrainState): number {
  return train.carriages.reduce((max, c) => Math.max(max, c.offset), 0);
}

function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const cos = Math.min(1, Math.max(-1, dot(normalize(a), normalize(b))));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** A minimal-but-type-complete stub TrainState for feeding `locoPose` when all we have is a
 * `TrackEdge` + a local `s` (e.g. an edge's own exit point) — locoPose only reads edgeId/s. */
function edgeLocalPose(edge: TrackEdge, s: number, graph: TrackGraph, pieceTypeOf: (i: number) => PieceType) {
  return locoPose(
    {
      id: '',
      edgeId: edge.id,
      s,
      facing: 1,
      v: 0,
      airborne: null,
      crashed: false,
      carriages: [],
      history: [],
      overspeedTicks: 0,
      airborneTicks: 0,
      dwellTicksRemaining: 0,
    },
    graph,
    pieceTypeOf,
  );
}

/** World-space exit pose (position + unit tangent) at the far end (`s = edge.length`) of `edge`,
 * via the placement transform recorded in `graph.placements`. Returns null only on a
 * graph/pieceTypeOf mismatch (a caller bug — defensive, not expected in practice). */
function edgeExitWorldPose(
  edge: TrackEdge,
  graph: TrackGraph,
  pieceTypeOf: (i: number) => PieceType,
): { pos: Vec3; tangent: Vec3 } | null {
  const entry = graph.placements.get(edge.placementIndex);
  if (!entry) return null;
  const local = edgeLocalPose(edge, edge.length, graph, pieceTypeOf);
  return {
    pos: pieceLocalToWorld(local.pos, entry.placement, entry.base),
    tangent: normalize(pieceLocalDirToWorld(local.tangent, entry.placement)),
  };
}

/** Launch the train airborne from `edge`'s exit point (docs/30 §7.2). Shared by both jump
 * triggers (A: jumpCapable crest: B: dead-end overrun at height >= 1) — same construction either
 * way, since both are "leave the track at this edge's far end at this speed." Per docs/70 M4.3's
 * authorized simplification: no sub-tick precision — `train` is expected to already have
 * `s = edge.length` (both triggers clamp there before calling this), and airborne integration
 * starts fresh next tick. */
function launch(
  train: TrainState,
  graph: TrackGraph,
  pieceTypeOf: (i: number) => PieceType,
  edge: TrackEdge,
  launchSpeed: number,
): PhysicsStepResult {
  const exit = edgeExitWorldPose(edge, graph, pieceTypeOf);
  if (!exit) return { state: train, events: [] }; // defensive: graph/pieceTypeOf mismatch
  const vel = scale(exit.tangent, launchSpeed);
  return {
    state: {
      ...train,
      edgeId: null,
      s: 0,
      v: launchSpeed, // not authoritative while airborne, kept for continuity/debugging
      airborne: { pos: [exit.pos.x, exit.pos.y, exit.pos.z], vel: [vel.x, vel.y, vel.z] },
      airborneTicks: 1,
    },
    events: [],
  };
}

// --- landing search (docs/30 §7.2) ---

const LANDING_SAMPLES = 32; // matches splines.ts's LUT_SAMPLES convention for the non-"sampled" case

interface LandingMatch {
  edgeId: string;
  s: number;
  distance: number;
}

/** Search every placed piece's every path, sampled and transformed to world space, for a point
 * within `landingRadius` of `pos` whose tangent (checked against BOTH directions, since a path's
 * own parameterization direction is arbitrary relative to flight direction) is within
 * `landingAngleDeg` of `vel`'s direction, and whose height matches within
 * `landingHeightTolerance`. Returns the nearest match (by distance), or null. */
function findLanding(
  graph: TrackGraph,
  pieceTypeOf: (i: number) => PieceType,
  pos: Vec3,
  vel: Vec3,
): LandingMatch | null {
  const flightDir = normalize(vel);
  let best: LandingMatch | null = null;

  for (const [placementIndex, entry] of graph.placements) {
    const type = pieceTypeOf(placementIndex);
    const def = PIECE_DEFS[type];
    def.paths.forEach((_, pathIndex) => {
      const compiled = compilePath(type, pathIndex);
      for (let i = 0; i <= LANDING_SAMPLES; i++) {
        const s = (compiled.length * i) / LANDING_SAMPLES;
        const worldPoint = pieceLocalToWorld(compiled.pointAt(s), entry.placement, entry.base);

        const distance = dist(worldPoint, pos);
        if (distance > PHYSICS.landingRadius) continue;
        if (Math.abs(worldPoint.y - pos.y) > PHYSICS.landingHeightTolerance) continue;

        const worldTangent = normalize(pieceLocalDirToWorld(compiled.tangentAt(s), entry.placement));
        const angleFwd = angleBetweenDeg(flightDir, worldTangent);
        const angleRev = angleBetweenDeg(flightDir, scale(worldTangent, -1));
        const angle = Math.min(angleFwd, angleRev);
        if (angle > PHYSICS.landingAngleDeg) continue;

        // 'f' edges read the compiled path forwards (s === the edge's own s); 'r' edges read it
        // backwards (edge's own s === compiled.length - s) — see movement.ts's facing doc. Snap
        // onto whichever direction's tangent agreed with flight direction.
        const dir: 'f' | 'r' = angleFwd <= angleRev ? 'f' : 'r';
        const edgeId = `${placementIndex}:${pathIndex}:${dir}`;
        const edgeS = dir === 'f' ? s : compiled.length - s;

        if (!best || distance < best.distance) best = { edgeId, s: edgeS, distance };
      }
    });
  }

  return best;
}

/** Ground cell approximation for a bad-landing crash's event `cell` — there's no current edge to
 * reference (the train never landed), so this rounds world x/z to the nearest cell index. An
 * approximation, not exact (documented per docs/70 M4.3's own allowance for this). */
function groundCellApprox(pos: Vec3): CellCoord {
  return { x: Math.round(pos.x / CELL), z: Math.round(pos.z / CELL) };
}

/** One tick of ballistic integration + landing test for an airborne train (docs/30 §7.2). */
function stepAirborne(
  train: TrainState,
  graph: TrackGraph,
  pieceTypeOf: (i: number) => PieceType,
  dt: number,
  tick: Tick,
): PhysicsStepResult {
  const airborne = train.airborne;
  if (!airborne) return { state: train, events: [] }; // defensive, shouldn't happen

  // ballistic integration first, then the landing test (docs/30 §7.2 order)
  const vel: [number, number, number] = [
    airborne.vel[0],
    airborne.vel[1] - PHYSICS.gAir * dt,
    airborne.vel[2],
  ];
  const pos: [number, number, number] = [
    airborne.pos[0] + vel[0] * dt,
    airborne.pos[1] + vel[1] * dt,
    airborne.pos[2] + vel[2] * dt,
  ];
  const nextAirborneTicks = train.airborneTicks + 1;

  const match = findLanding(graph, pieceTypeOf, vec(pos[0], pos[1], pos[2]), vec(vel[0], vel[1], vel[2]));
  if (match) {
    // Retained speed on landing is `0.85 * |vel|` — HORIZONTAL magnitude only (x/z), not full 3D.
    // Reasoning: once snapped onto rails, `v` means "arc-length speed along track" (movement.ts's
    // convention); a wheeled vehicle landing doesn't carry its vertical fall speed forward as
    // track speed, only its along-track (horizontal) component. Using full 3D magnitude would
    // over-count the descent, especially for a landing near the apex-to-descent transition.
    const horizontalSpeed = Math.hypot(vel[0], vel[2]);
    const landedState: TrainState = {
      ...train,
      edgeId: match.edgeId,
      s: match.s,
      facing: match.edgeId.endsWith(':f') ? 1 : -1,
      v: 0.85 * horizontalSpeed,
      airborne: null,
      airborneTicks: 0,
    };
    const events: SimEvent[] = [
      { tick, type: 'Airtime', trainId: train.id, durationTicks: nextAirborneTicks },
    ];
    return applyDerailCheck(landedState, graph, tick, events);
  }

  if (pos[1] <= 0) {
    const crashedState: TrainState = { ...train, airborne: null, airborneTicks: 0, crashed: true };
    const cell = groundCellApprox(vec(pos[0], pos[1], pos[2]));
    return {
      state: crashedState,
      events: [{ tick, type: 'Crashed', trainId: train.id, cause: 'bad-landing', cell }],
    };
  }

  // still airborne, no event this tick
  return { state: { ...train, airborne: { pos, vel }, airborneTicks: nextAirborneTicks }, events: [] };
}

/** §7.3 derail-on-curves check, applied to whatever on-rails state a tick settles on (a normal
 * step, or a landing that happened this same tick). `priorEvents` lets a same-tick landing's
 * Airtime event and a same-tick derail crash both appear in one result. */
function applyDerailCheck(
  state: TrainState,
  graph: TrackGraph,
  tick: Tick,
  priorEvents: SimEvent[] = [],
): PhysicsStepResult {
  if (state.edgeId === null) return { state, events: priorEvents }; // not on rails, nothing to check
  const edge = graph.edges.get(state.edgeId);
  if (!edge) return { state, events: priorEvents }; // defensive: stale edgeId

  const maxSpeed = maxSpeedFor(edge.curveClass);
  const overspeedTicks = maxSpeed !== null && state.v > maxSpeed ? state.overspeedTicks + 1 : 0;

  // "Exceeding it for MORE than derailGraceTicks consecutive ticks" (docs/30 §7.3) — strictly
  // greater, so the crash fires on tick 13 of sustained overspeed (12 survives, 13 doesn't).
  if (overspeedTicks > PHYSICS.derailGraceTicks) {
    const cell = graph.nodes.get(edge.to)?.cell ?? { x: 0, z: 0 };
    return {
      state: { ...state, overspeedTicks, crashed: true, edgeId: null },
      events: [...priorEvents, { tick, type: 'Crashed', trainId: state.id, cause: 'speeding-curve', cell }],
    };
  }

  return { state: { ...state, overspeedTicks }, events: priorEvents };
}

function maxSpeedFor(curveClass: CurveClass): number | null {
  if (curveClass === 'gentle') return PHYSICS.maxSpeedByCurveClass.gentle;
  if (curveClass === 'tight') return PHYSICS.maxSpeedByCurveClass.tight;
  return null; // 'straight': no max (docs/30 §7.3)
}

/**
 * One tick of arcade physics for a single train (docs/30 §7.2-7.3; collisions, §7.4, are handled
 * separately by `detectCollisions` below since they're inherently cross-train). Order per tick:
 * crashed -> no-op. Airborne -> ballistic + landing test. On-rails -> check jump Trigger A first
 * (predicting this tick's v via `updateVelocity`, before ever calling `advanceTrain`), else call
 * `movement.advanceTrain` and check its `deadEndOverrun` for jump Trigger B, else accept its
 * result as a normal step — then the derail check runs on whatever on-rails state results
 * (including a same-tick landing; not a same-tick launch or crash, which aren't on-rails).
 *
 * `edgeId`/`s` on a crashed train: docs/30 §4's own comment on `TrainState.edgeId` is
 * "null while airborne OR CRASHED" — so every crash transition here also nulls `edgeId` (see each
 * crash site). `s` is left as whatever it was (harmless once `edgeId` is null and therefore
 * meaningless); the `Crashed` event's own `cell` field is what a renderer should use to know
 * WHERE the crash happened, not the train's own position fields.
 */
export function stepTrainPhysics(
  train: TrainState,
  graph: TrackGraph,
  pieceTypeOf: (placementIndex: number) => PieceType,
  switchStates: ReadonlyMap<number, 0 | 1>,
  speedBet: SpeedBet,
  dt: number,
  tick: Tick,
): PhysicsStepResult {
  if (train.crashed) return { state: train, events: [] };

  if (train.airborne !== null) {
    return stepAirborne(train, graph, pieceTypeOf, dt, tick);
  }

  if (train.edgeId === null) {
    // Not crashed, not airborne, yet no edge — an invalid/uninitialized state; no-op defensively
    // rather than throwing mid-tick (same posture as movement.ts's stale-edgeId guard).
    return { state: train, events: [] };
  }

  const edge = graph.edges.get(train.edgeId);
  if (!edge) return { state: train, events: [] }; // defensive: stale edgeId for this graph

  // --- Trigger A: launching off a jumpCapable crest (hill/bump), track continuing or not ---
  const type = pieceTypeOf(edge.placementIndex);
  if (PIECE_DEFS[type].tags.includes('jumpCapable')) {
    const predictedV = updateVelocity(train.v, edge.grade, speedBet, dt);
    const predictedS = train.s + predictedV * dt;
    if (predictedS >= edge.length && predictedV >= PHYSICS.vJump) {
      return launch({ ...train, s: edge.length }, graph, pieceTypeOf, edge, predictedV);
    }
  }

  // --- Otherwise: a normal kinematic step, then Trigger B / gap on any dead-end overrun ---
  const result = advanceTrain(train, graph, switchStates, speedBet, dt);

  if (result.deadEndOverrun !== null) {
    const stoppedEdge = graph.edges.get(result.state.edgeId!);
    if (!stoppedEdge) return { state: result.state, events: [] }; // defensive
    const nodeHeight = graph.nodes.get(stoppedEdge.to)?.height ?? 0;

    if (nodeHeight >= 1 && result.state.v >= PHYSICS.vJump) {
      return launch(result.state, graph, pieceTypeOf, stoppedEdge, result.state.v);
    }

    // Below vJump at height >= 1, OR any overrun at height 0 (w2-s5's "Steady teeters into the
    // gorge" case + the height-0 sibling docs/30 §7.2 names in the same sentence) -> gap.
    const cell = graph.nodes.get(stoppedEdge.to)?.cell ?? { x: 0, z: 0 };
    return {
      state: { ...result.state, crashed: true, edgeId: null },
      events: [{ tick, type: 'Crashed', trainId: train.id, cause: 'gap', cell }],
    };
  }

  return applyDerailCheck(result.state, graph, tick);
}

// --- collisions (docs/30 §7.4) ---

/**
 * Cross-train collision detection: same-edge swept-interval overlap, or two trains on independent
 * paths of the same `crossing` placement. Read-only — does NOT mutate any TrainState or set
 * `crashed` itself; it only reports which trains collided this tick (as `Crashed` events keyed by
 * `trainId`). The caller (a future M5 sim orchestrator) is expected to apply `crashed = true`
 * (and, per the same `edgeId`-null convention as `stepTrainPhysics`, `edgeId: null`) to every
 * trainId named in the returned events. Call this once per tick, AFTER every train has
 * individually gone through `stepTrainPhysics` — it's a pass over the post-step states.
 */
export function detectCollisions(trains: TrainState[], graph: TrackGraph, tick: Tick): SimEvent[] {
  const onRails = trains.filter((t) => !t.crashed && t.edgeId !== null);
  const events: SimEvent[] = [];
  const flagged = new Set<string>(); // avoid a train getting more than one Crashed event this tick

  const crashCell = (edge: TrackEdge): CellCoord =>
    graph.nodes.get(edge.to)?.cell ?? graph.nodes.get(edge.from)?.cell ?? { x: 0, z: 0 };

  const flag = (a: TrainState, b: TrainState, cell: CellCoord): void => {
    for (const t of [a, b]) {
      if (flagged.has(t.id)) continue;
      flagged.add(t.id);
      events.push({ tick, type: 'Crashed', trainId: t.id, cause: 'collision', cell });
    }
  };

  for (let i = 0; i < onRails.length; i++) {
    for (let j = i + 1; j < onRails.length; j++) {
      const a = onRails[i];
      const b = onRails[j];
      const edgeA = graph.edges.get(a.edgeId!);
      const edgeB = graph.edges.get(b.edgeId!);
      if (!edgeA || !edgeB) continue;

      // same-edge swept-interval overlap: front = s, tail = s - farthest carriage offset
      if (a.edgeId === b.edgeId) {
        const ia: [number, number] = [a.s - maxCarriageOffset(a), a.s];
        const ib: [number, number] = [b.s - maxCarriageOffset(b), b.s];
        if (ia[0] <= ib[1] && ib[0] <= ia[1]) {
          flag(a, b, crashCell(edgeA));
          continue;
        }
      }

      // same crossing cell: both edges' placementIndex is the same 'crossing' piece, regardless
      // of which of its two independent paths (N-S vs E-W) each train is on (docs/30 §5/§7.4:
      // a crossing shares its cell "for collision purposes but not connectivity").
      if (edgeA.placementIndex === edgeB.placementIndex) {
        const entry = graph.placements.get(edgeA.placementIndex);
        if (entry?.placement.piece === 'crossing') {
          flag(a, b, crashCell(edgeA));
        }
      }
    }
  }

  return events;
}
