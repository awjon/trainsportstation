// M4.2 tests (docs/70; docs/30 §6, §7.1): the real P-1 convergence invariant (v -> vTarget on a
// flat straight), grade/drag sanity checks for the §7.1 acceleration model, edge-handoff
// leftover-distance conservation (property test), the dead-end soft-stop/overrun-signal split,
// the handoff loop cap, and carriage trailing around a curve + junction.
//
// Scope-history note: §7.1 was originally mis-contracted to M4.3 in this task's first pass —
// docs/70's M4.3 "Reuse" line starts at §7.2, so §7.1 (the only thing that makes v actually
// converge, rather than being a fixed input) was always M4.2's. This file's P-1 test was
// rewritten accordingly as a same-branch follow-up; see movement.ts's module doc for the
// corresponding implementation note.

import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../core/types';
import type { PieceType } from '../track/pieces';
import { TrackGraph, type TrackEdge } from '../track/graph';
import type { Placement } from '../track/placement';
import type { TrainState } from './types';
import { PHYSICS, type SpeedBet } from './physics-constants';
import { advanceTrain, carriagePose, locoPose } from './movement';

const straight = (x: number, z: number): Placement => ({ piece: 'straight', cell: { x, z }, rotation: 0 });

const noSwitches = new Map<number, 0 | 1>();

function makeTrain(overrides: Partial<TrainState> & Pick<TrainState, 'edgeId'>): TrainState {
  return {
    id: 't1',
    s: 0,
    facing: 1,
    v: 0,
    airborne: null,
    crashed: false,
    carriages: [],
    history: overrides.edgeId ? [overrides.edgeId] : [],
    overspeedTicks: 0,
    airborneTicks: 0,
    dwellTicksRemaining: 0,
    ...overrides,
  };
}

/**
 * Independent hand-computation mirror of docs/30 §7.1's formula (vTarget/a/v'), used to build and
 * verify test expectations below. Never imported by movement.ts itself.
 */
function accelerate(v: number, grade: -1 | 0 | 1, bet: SpeedBet, dt: number): number {
  const vTarget = PHYSICS.vBase * PHYSICS.betMult[bet];
  const a = PHYSICS.aThrottle * Math.sign(vTarget - v) - PHYSICS.gSlope * grade - PHYSICS.cDrag * v;
  return Math.min(Math.max(v + a * dt, 0), PHYSICS.vHardMax);
}

describe('advanceTrain: P-1 v converges to vTarget on a flat straight (docs/30 §7.1, §7.6)', () => {
  it.each<SpeedBet>(['steady', 'swift', 'ludicrous'])(
    'starting from v=0, v converges to vTarget within 3 simulated seconds and stays there (%s)',
    (bet) => {
      const graph = new TrackGraph();
      const N = 20; // long enough that no bet's vTarget*3s (+ overshoot) reaches the dead end
      for (let i = 0; i < N; i++) graph.addPlacement(i, straight(0, i));

      const vTarget = PHYSICS.vBase * PHYSICS.betMult[bet];

      let train = makeTrain({ edgeId: '0:0:f', v: 0 });
      for (let tick = 0; tick < 180; tick++) {
        const result = advanceTrain(train, graph, noSwitches, bet, TICK_DT);
        train = result.state;
      }

      // Converged within a band around vTarget. The band is wider than it might look at first —
      // measured empirically, not guessed: `aThrottle` (2.0) is fixed regardless of bet while
      // vTarget scales up to vBase*1.9=5.7 for ludicrous, so while v < vTarget the ODE
      // dv/dt = aThrottle - cDrag*v (constant push, linear drag) is driving toward an equilibrium
      // of aThrottle/cDrag = 25.0 — vTarget is just a point it passes through on that ramp. Its
      // linear approach v(t) = 25*(1-e^(-cDrag*t)) reaches ludicrous's vTarget=5.7 at t≈3.23s —
      // just past the 3s/180-tick mark docs/30 §7.6 names, so ludicrous (the tightest case) is
      // still a bit short of vTarget exactly at tick 180, confirmed empirically (~0.36 short).
      // 0.5 covers that with margin without being vacuous (vTarget itself is 3.0-5.7).
      expect(Math.abs(train.v - vTarget)).toBeLessThan(0.5);

      // Stays there for subsequent ticks — a sane band, not exact-precision. aThrottle*sign(...)
      // is a bang-bang control that can wobble around vTarget by design (docs/70's own note on
      // this); this just guards against runaway drift/oscillation, not zero oscillation.
      //
      // IMPORTANT: ludicrous doesn't finish crossing vTarget for the first time until ~tick 194
      // (confirmed by direct trace) — 14 ticks INTO this window, not before it — so a tight
      // per-tick tolerance can't start at tick 181. This loop uses a loose guard throughout (large
      // enough to allow the tail of the initial ramp-up, but still catching genuine runaway/
      // divergence) and only demands the tight, converged band at the window's end, by which
      // point every bet has crossed and settled (confirmed by trace: ludicrous's oscillation
      // amplitude is under 0.05 well before tick 240).
      let finalV = train.v;
      for (let tick = 0; tick < 120; tick++) {
        const result = advanceTrain(train, graph, noSwitches, bet, TICK_DT);
        train = result.state;
        finalV = train.v;
        expect(Math.abs(train.v - vTarget)).toBeLessThan(0.6); // loose: no runaway/divergence
      }
      expect(Math.abs(finalV - vTarget)).toBeLessThan(0.1); // tight: settled by the window's end
    },
  );
});

describe('advanceTrain: grade and drag bias the §7.1 acceleration as the formula implies', () => {
  it('uphill (grade +1) accelerates less than downhill (grade -1) from the same v', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'ramp', cell: { x: 0, z: 0 }, rotation: 0 }); // 'f' grade=+1, 'r' grade=-1
    const uphill = graph.edges.get('0:0:f')!;
    const downhill = graph.edges.get('0:0:r')!;
    expect(uphill.grade).toBe(1);
    expect(downhill.grade).toBe(-1);

    const bet: SpeedBet = 'steady';
    const v0 = 1.0;
    const dt = 1 / 60;

    const uphillResult = advanceTrain(
      makeTrain({ edgeId: uphill.id, v: v0, s: 0 }),
      graph,
      noSwitches,
      bet,
      dt,
    );
    const downhillResult = advanceTrain(
      makeTrain({ edgeId: downhill.id, v: v0, s: 0 }),
      graph,
      noSwitches,
      bet,
      dt,
    );

    expect(downhillResult.state.v).toBeGreaterThan(uphillResult.state.v);

    // exact cross-check against §7.1
    expect(uphillResult.state.v).toBeCloseTo(accelerate(v0, 1, bet, dt), 9);
    expect(downhillResult.state.v).toBeCloseTo(accelerate(v0, -1, bet, dt), 9);
  });

  it('drag (cDrag * v) makes deceleration measurably stronger at higher v (both above vTarget)', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));
    const edge = graph.edges.get('0:0:f')!;
    expect(edge.grade).toBe(0);

    const bet: SpeedBet = 'steady'; // vTarget = 3.0
    const dt = 1 / 60;
    const lowV = 3.5; // just above vTarget: decelerating, but drag's contribution is small
    const highV = 7.0; // well above vTarget: decelerating, drag's contribution is much larger

    const lowResult = advanceTrain(makeTrain({ edgeId: edge.id, v: lowV, s: 0 }), graph, noSwitches, bet, dt);
    const highResult = advanceTrain(
      makeTrain({ edgeId: edge.id, v: highV, s: 0 }),
      graph,
      noSwitches,
      bet,
      dt,
    );

    const lowDelta = lowResult.state.v - lowV;
    const highDelta = highResult.state.v - highV;

    // both decelerate (sign=-1 in both cases, so aThrottle's contribution is identical); drag
    // being proportional to v is the only thing that can make the high-v case decelerate harder.
    expect(highDelta).toBeLessThan(lowDelta);
    expect(lowResult.state.v).toBeCloseTo(accelerate(lowV, 0, bet, dt), 9);
    expect(highResult.state.v).toBeCloseTo(accelerate(highV, 0, bet, dt), 9);
  });
});

describe('advanceTrain: misc invariants', () => {
  it('is a pure function: does not mutate the input TrainState', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));
    graph.addPlacement(1, straight(0, 1));
    const train = makeTrain({ edgeId: '0:0:f', v: 1, s: 0.5 });
    const historyBefore = [...train.history];

    const result = advanceTrain(train, graph, noSwitches, 'steady', 1 / 60);

    expect(train.s).toBe(0.5); // untouched
    expect(train.history).toEqual(historyBefore); // untouched (result.state.history is a new array)
    expect(result.state).not.toBe(train);
  });

  it('crashed/airborne trains are a no-op passthrough', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));

    const crashedTrain = makeTrain({ edgeId: '0:0:f', v: 5, crashed: true });
    const crashedResult = advanceTrain(crashedTrain, graph, noSwitches, 'steady', 1 / 60);
    expect(crashedResult).toEqual({ state: crashedTrain, deadEndOverrun: null });

    const airborneTrain = makeTrain({
      edgeId: '0:0:f',
      v: 5,
      airborne: { pos: [0, 1, 0], vel: [1, 0, 0] },
    });
    const airborneResult = advanceTrain(airborneTrain, graph, noSwitches, 'steady', 1 / 60);
    expect(airborneResult).toEqual({ state: airborneTrain, deadEndOverrun: null });
  });
});

describe('advanceTrain: edge handoff conserves leftover distance (property test)', () => {
  it('total distance traveled equals Σ(v·dt) over 1000 random tick sequences', () => {
    const graph = new TrackGraph();
    // Generous margin: worst case is every tick clamping to vHardMax(8.0) at the widest dt
    // jitter (~0.2 units/tick); 150 pieces (300 world units) comfortably exceeds any plausible
    // 1000-tick total, so this fixture never reaches a dead end (verified via the assertion
    // below, not just assumed).
    const N = 150;
    for (let i = 0; i < N; i++) {
      if (i === 10) {
        // a junction dropped into the line: same footprint/N-S ports as straight, default switch
        // state 0 selects its "through" path — a drop-in replacement that still exercises real
        // junction routing/switch-gating via edgesFrom, per the task's "at least one junction" ask.
        graph.addPlacement(i, { piece: 'junction', cell: { x: 0, z: i }, rotation: 0 });
      } else {
        graph.addPlacement(i, straight(0, i));
      }
    }
    const edgeLength = 2.0; // every edge here is L_STRAIGHT (junction's through path too)

    // small deterministic PRNG (test-only — no need for core/rng.ts's mulberry32 here, this
    // isn't sim code) so a failure is reproducible.
    let seed = 987654321;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const BETS: SpeedBet[] = ['steady', 'swift', 'ludicrous'];

    let train = makeTrain({ edgeId: '0:0:f', v: 0 });
    let totalExpected = 0;

    for (let i = 0; i < 1000; i++) {
      // `v` is no longer a free per-tick dial now that advanceTrain runs the §7.1 acceleration
      // model internally (injecting an arbitrary v would just fight the formula). Instead, bet is
      // randomized per tick — unrealistic for real gameplay, but here it's purely a way to inject
      // varied vTarget-driving conditions into v's naturally-evolving trajectory, which is exactly
      // what this property test needs: real variety in the v actually used for integration.
      const bet = BETS[Math.floor(rand() * BETS.length) % BETS.length];
      const dt = (0.5 + rand()) / 60; // dt jittered around 1/60, in [0.5, 1.5]/60

      const result = advanceTrain(train, graph, noSwitches, bet, dt);
      train = result.state;
      // `train.v` is the §7.1-accelerated speed actually used to integrate position THIS tick
      // (computed before the handoff loop, left unchanged by it here since this fixture never
      // reaches a dead end — verified below) — so Σ(v·dt) using it is exactly the distance
      // advanceTrain delivered this tick.
      totalExpected += train.v * dt;

      expect(result.deadEndOverrun).toBeNull();
    }

    // Recover total distance traveled from the final state without relying on `history` (which
    // may have been trimmed — carriages is empty here, so history is trimmed to just the current
    // edge every tick). The edge id itself encodes the placementIndex, and every edge in this
    // line has equal length, so index*length + s is the total distance from the start.
    const placementIndex = Number(train.edgeId!.split(':')[0]);
    const traveled = placementIndex * edgeLength + train.s;

    expect(traveled).toBeCloseTo(totalExpected, 9);
  });
});

describe('dead end handling', () => {
  const edgeLength = 2.0;

  function singleStraightGraph(): TrackGraph {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));
    return graph;
  }

  it('soft-stops (v -> 0) when the §7.1-accelerated v is <= vCrawl at a dead end', () => {
    const graph = singleStraightGraph();
    const bet: SpeedBet = 'steady';
    const dt = 1 / 60;
    const v0 = 0; // train barely creeping toward the dead end

    // precondition: confirm this tick's accelerated v is still <= vCrawl (i.e. this really
    // exercises the soft-stop branch, not the overrun branch) — vTarget is always >= vBase(3.0),
    // so v only ever increases from 0 here, bounded by aThrottle*dt.
    const vAccel = accelerate(v0, 0, bet, dt);
    expect(vAccel).toBeLessThanOrEqual(PHYSICS.vCrawl);

    const train = makeTrain({ edgeId: '0:0:f', s: edgeLength - 1e-6, v: v0 });
    const result = advanceTrain(train, graph, noSwitches, bet, dt);

    expect(result.state.s).toBeCloseTo(edgeLength, 9);
    expect(result.state.v).toBe(0);
    expect(result.deadEndOverrun).toBeNull();
  });

  it('signals deadEndOverrun (accelerated v left unchanged) when v > vCrawl at a dead end', () => {
    const graph = singleStraightGraph();
    const bet: SpeedBet = 'steady';
    const dt = 1 / 60;
    const v0 = 1.0;
    const s0 = edgeLength - 1e-6;

    const vAccel = accelerate(v0, 0, bet, dt);
    expect(vAccel).toBeGreaterThan(PHYSICS.vCrawl);

    const train = makeTrain({ edgeId: '0:0:f', s: s0, v: v0 });
    const result = advanceTrain(train, graph, noSwitches, bet, dt);

    const expectedOverrun = s0 + vAccel * dt - edgeLength;
    expect(result.state.s).toBeCloseTo(edgeLength, 9);
    expect(result.state.v).toBeCloseTo(vAccel, 9); // the accelerated v, unchanged by the overrun branch
    expect(result.deadEndOverrun).not.toBeNull();
    expect(result.deadEndOverrun!).toBeCloseTo(expectedOverrun, 9);
  });

  it('does NOT soft-stop at height >= 1 even when v <= vCrawl — height 0 is required (docs/30 §6)', () => {
    // Regression test for a bug found while building M4.3 (jump/gap logic): docs/30 §6's exact
    // wording is "Dead end ... AT HEIGHT 0 and v <= vCrawl: train stops (soft) ... at speed: see
    // jump/crash rules". The original M4.2 delivery omitted the height check, so a slow-rolling
    // train at ANY height would soft-stop — silently swallowing w2-s5's "Steady teeters into the
    // gorge" case (a low-speed dead end at height >= 1 must signal an overrun so M4.3 can turn it
    // into `Crashed{cause:'gap'}`, not quietly stop the train as if nothing happened).
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'ramp', cell: { x: 0, z: 0 }, rotation: 0 }); // climbs to height 1, dead end
    const edge = graph.edges.get('0:0:f')!;
    expect(graph.nodes.get(edge.to)?.height).toBe(1);

    const bet: SpeedBet = 'steady';
    const dt = 1 / 60;
    const v0 = 0;

    const vAccel = accelerate(v0, edge.grade, bet, dt);
    expect(vAccel).toBeLessThanOrEqual(PHYSICS.vCrawl); // still "slow" by the vCrawl definition

    const train = makeTrain({ edgeId: '0:0:f', s: edge.length - 1e-6, v: v0 });
    const result = advanceTrain(train, graph, noSwitches, bet, dt);

    expect(result.state.v).toBeCloseTo(vAccel, 9); // NOT hard-zeroed, unlike the height-0 case
    expect(result.deadEndOverrun).not.toBeNull();
  });

  it('a junction with no settable branch open counts as a dead end too', () => {
    const graph = new TrackGraph();
    // junction with only the branch path (switch state 1) reachable; default switchStates map
    // (all 0) selects the through path (port S), so from the branch's own perspective there is
    // no state that opens BOTH — but for THIS test we ask for the one edge that IS gated shut:
    // set switchStates so neither this train's edge nor any other paths lead further. Simplest
    // reliable construction: a junction whose "through" edge is the one under test, but we pass a
    // switchStates map that gates it to the OTHER state, so edgesFrom(edge.to, ...) returns [].
    const [nNode] = graph.addPlacement(0, { piece: 'junction', cell: { x: 0, z: 0 }, rotation: 0 });
    const throughEdge = [...graph.edges.values()].find((e) => e.id === '0:0:f')!;
    expect(throughEdge.from).toBe(nNode);

    const gatedShut = new Map<number, 0 | 1>([[0, 1]]); // forces switch to 1; through path needs 0
    const train = makeTrain({ edgeId: '0:0:f', s: edgeLength - 1e-6, v: 1.0 });

    const result = advanceTrain(train, graph, gatedShut, 'steady', 1 / 60);

    expect(result.state.s).toBeCloseTo(edgeLength, 9);
    expect(result.deadEndOverrun).not.toBeNull();
  });
});

describe('handoff loop cap', () => {
  it('stops after MAX_HANDOFF_ITERATIONS on an oversized single-tick advance, leaving distance undelivered', () => {
    // A real topological zero-length-edge cycle is hard to construct through graph.ts (it always
    // builds physically consistent geometry from real pieces), so instead this exercises the cap
    // the realistic way it would ever fire: an absurdly large dt (so the §7.1-accelerated v
    // saturates at vHardMax and the resulting v*dt needs far more than 64 handoffs to resolve).
    // N=70 pieces gives headroom past the cap (64) so this exercises the safety valve, not the
    // fixture's own dead end at piece 69.
    const graph = new TrackGraph();
    const N = 70;
    for (let i = 0; i < N; i++) graph.addPlacement(i, straight(0, i));

    const bet: SpeedBet = 'steady';
    const dt = 20; // deliberately not a "real" tick — isolating the cap behavior, not realism
    const v0 = 0;

    // sanity: confirm the accelerated v actually saturates at vHardMax for this dt, so this test
    // exercises the handoff cap deterministically rather than depending on a fragile v0/bet combo.
    const vAccel = accelerate(v0, 0, bet, dt);
    expect(vAccel).toBe(PHYSICS.vHardMax);

    const train = makeTrain({ edgeId: '0:0:f', v: v0, s: 0 });
    const result = advanceTrain(train, graph, noSwitches, bet, dt);

    // Hand-traced: s_initial = vHardMax*dt = 160; 64 handoffs land on placement index 64 with 2.0
    // (=edge.length) remaining clamped — this result is the same for any s_initial that needs
    // more than 64 handoffs to resolve (160 needs 80), not sensitive to the exact value.
    expect(result.state.edgeId).toBe('64:0:f');
    expect(result.state.s).toBeCloseTo(2.0, 9);
    expect(result.deadEndOverrun).toBeNull(); // cap-abort is not a dead end
  });
});

// --- carriage trailing around a curve and a junction ---
// (unaffected by the §7.1 acceleration model — locoPose/carriagePose only resolve positions from
// an already-given (edgeId, s, history), they never call advanceTrain or take a speedBet.)

/** Piece types for a small fixture chain: straight -> curve-small -> straight -> junction -> straight. */
const CHAIN_PIECES: PieceType[] = ['straight', 'curve-small', 'straight', 'junction', 'straight'];

function buildChainFixture(): { graph: TrackGraph; pieceTypeOf: (i: number) => PieceType } {
  const graph = new TrackGraph();
  graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });
  graph.addPlacement(1, { piece: 'curve-small', cell: { x: 0, z: 1 }, rotation: 0 });
  graph.addPlacement(2, { piece: 'straight', cell: { x: 1, z: 1 }, rotation: 1 });
  graph.addPlacement(3, { piece: 'junction', cell: { x: 2, z: 1 }, rotation: 1 });
  graph.addPlacement(4, { piece: 'straight', cell: { x: 3, z: 1 }, rotation: 1 });
  return { graph, pieceTypeOf: (i) => CHAIN_PIECES[i] };
}

/** Walk forward from `startNode`, at each step picking the outgoing edge that isn't the one we
 * just arrived by — i.e. the actual chain a loco moving forward through this fixture would take,
 * discovered via the same `edgesFrom` the sim itself uses (no hand-derived 'f'/'r' edge ids). */
function walkChain(
  graph: TrackGraph,
  switchStates: ReadonlyMap<number, 0 | 1>,
  startNode: string,
  steps: number,
): TrackEdge[] {
  const edges: TrackEdge[] = [];
  let current = startNode;
  let prevNode: string | null = null;
  for (let i = 0; i < steps; i++) {
    const options = graph.edgesFrom(current, switchStates).filter((e) => e.to !== prevNode);
    expect(options.length).toBeGreaterThan(0);
    const edge = options[0];
    edges.push(edge);
    prevNode = current;
    current = edge.to;
  }
  return edges;
}

// NOTE on what "geometrically expected" means below: `compilePath` (and therefore `poseOnEdge`/
// `locoPose`/`carriagePose`) returns PIECE-LOCAL coordinates, not world-space (see the `Pose` doc
// comment in movement.ts — TrackEdge/TrackGraph carry no placement cell/rotation/base-height to
// transform by, a known gap flagged in the M4.2 report). So two DIFFERENT pieces' local points are
// never comparable to each other directly. What IS fully verifiable without that transform is
// that carriagePose's backward walk resolves to the mathematically correct (edge, local-s) pair —
// checked here by independently hand-deriving that pair from the offset/history and comparing via
// locoPose called with that exact (edgeId, s), i.e. the same piece-local frame on both sides.
describe('carriagePose: walks the edge chain correctly around a curve and a junction', () => {
  it('a carriage offset by exactly one edge length sits at the tail end of the previous edge', () => {
    const { graph, pieceTypeOf } = buildChainFixture();
    const startNode = graph.portNode(0, 0)!; // piece 0's N port: the far start of the chain
    const chain = walkChain(graph, noSwitches, startNode, 4); // straight, curve, straight, junction

    const history = chain.map((e) => e.id);
    const current = chain[chain.length - 1]; // junction-through edge
    const prev = chain[chain.length - 2]; // straight edge just before it

    const train = makeTrain({
      edgeId: current.id,
      s: 0, // loco sits exactly at the start of `current`
      history,
      carriages: [{ personaId: null, offset: prev.length }], // exactly one edge's length behind
    });

    const pose = carriagePose(train, 0, graph, pieceTypeOf);
    // hand-derivation: consuming `current`'s 0 available units, then all of prev's length lands
    // exactly at prev's own start (s=0) — "the tail end of the previous edge".
    const expected = locoPose(makeTrain({ edgeId: prev.id, s: 0 }), graph, pieceTypeOf);

    expect(pose.pos).toEqual(expected.pos);
    expect(pose.tangent).toEqual(expected.tangent);
  });

  it('a carriage offset spanning back through the curve lands mid-curve at the expected local s', () => {
    const { graph, pieceTypeOf } = buildChainFixture();
    const startNode = graph.portNode(0, 0)!;
    const chain = walkChain(graph, noSwitches, startNode, 4);

    const history = chain.map((e) => e.id);
    const current = chain[chain.length - 1]; // junction-through
    const prev = chain[chain.length - 2]; // straight
    const curveEdge = chain[chain.length - 3]; // curve-small — the piece under test here

    // hand-derivation: consume all of `current` (0, since s=0) then all of `prev` (prev.length),
    // then half of curveEdge's length — landing mid-curve at local s = curveEdge.length/2.
    const offset = prev.length + curveEdge.length / 2;
    const train = makeTrain({
      edgeId: current.id,
      s: 0,
      history,
      carriages: [{ personaId: null, offset }],
    });

    const pose = carriagePose(train, 0, graph, pieceTypeOf);
    const expected = locoPose(
      makeTrain({ edgeId: curveEdge.id, s: curveEdge.length / 2 }),
      graph,
      pieceTypeOf,
    );

    expect(pose.pos.x).toBeCloseTo(expected.pos.x, 9);
    expect(pose.pos.y).toBeCloseTo(expected.pos.y, 9);
    expect(pose.pos.z).toBeCloseTo(expected.pos.z, 9);
  });

  it('an offset exceeding what history covers clamps to the oldest entry instead of throwing', () => {
    const { graph, pieceTypeOf } = buildChainFixture();
    const startNode = graph.portNode(0, 0)!;
    const chain = walkChain(graph, noSwitches, startNode, 4);

    const history = chain.map((e) => e.id);
    const current = chain[chain.length - 1];
    const train = makeTrain({
      edgeId: current.id,
      s: 0,
      history,
      carriages: [{ personaId: null, offset: 10_000 }], // absurdly large, well beyond history
    });

    expect(() => carriagePose(train, 0, graph, pieceTypeOf)).not.toThrow();
    const pose = carriagePose(train, 0, graph, pieceTypeOf);
    const oldest = chain[0];
    const expected = locoPose(makeTrain({ edgeId: oldest.id, s: 0 }), graph, pieceTypeOf);
    expect(pose.pos).toEqual(expected.pos);
    expect(pose.tangent).toEqual(expected.tangent);
  });

  it('locoPose matches carriagePose(0-offset-equivalent) at the loco itself', () => {
    const { graph, pieceTypeOf } = buildChainFixture();
    const startNode = graph.portNode(0, 0)!;
    const chain = walkChain(graph, noSwitches, startNode, 3);
    const current = chain[chain.length - 1];
    const train = makeTrain({
      edgeId: current.id,
      s: current.length / 2,
      history: chain.map((e) => e.id),
      carriages: [{ personaId: null, offset: 0 }],
    });

    const loco = locoPose(train, graph, pieceTypeOf);
    const carriage0 = carriagePose(train, 0, graph, pieceTypeOf);
    expect(carriage0).toEqual(loco);
  });
});
