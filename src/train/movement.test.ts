// M4.2 tests (docs/70; docs/30 §6): P-1 constant-v convergence, edge-handoff leftover-distance
// conservation (property test), carriage trailing around a curve + junction, and the dead-end
// soft-stop / overrun-signal split.

import { describe, expect, it } from 'vitest';
import type { PieceType } from '../track/pieces';
import { TrackGraph, type TrackEdge } from '../track/graph';
import type { Placement } from '../track/placement';
import type { TrainState } from './types';
import { PHYSICS } from './physics-constants';
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
    ...overrides,
  };
}

describe('advanceTrain: P-1 constant-v convergence', () => {
  it('s and edgeId update exactly as hand-computed, tick by tick, along a line of straights', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));
    graph.addPlacement(1, straight(0, 1));
    graph.addPlacement(2, straight(0, 2));

    const v = 0.97; // deliberately not a divisor of the edge length, to avoid exact-boundary ties
    const dt = 1 / 60;
    const edgeLength = 2.0; // CELL

    let train = makeTrain({ edgeId: '0:0:f', v });

    // Independent hand computation, mirroring docs/30 §6's rule (s += v*facing*TICK_DT, handoff
    // on crossing edge.length) with the exact same floating-point operations so there is no
    // spurious drift between "expected" and "actual" at tick boundaries.
    let expectedEdgeIndex = 0;
    let expectedS = 0;

    for (let tick = 0; tick < 250; tick++) {
      const result = advanceTrain(train, graph, noSwitches, dt);
      train = result.state;

      expectedS += v * dt;
      while (expectedS > edgeLength) {
        expectedS -= edgeLength;
        expectedEdgeIndex += 1;
      }

      expect(train.edgeId).toBe(`${expectedEdgeIndex}:0:f`);
      expect(train.s).toBeCloseTo(expectedS, 9);
      expect(train.facing).toBe(1);
      expect(result.deadEndOverrun).toBeNull();
    }

    // sanity: we actually exercised at least one handoff (total distance ~4.04 > one edge length)
    expect(expectedEdgeIndex).toBeGreaterThan(0);
  });

  it('is a pure function: does not mutate the input TrainState', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));
    graph.addPlacement(1, straight(0, 1));
    const train = makeTrain({ edgeId: '0:0:f', v: 1, s: 0.5 });
    const historyBefore = [...train.history];

    const result = advanceTrain(train, graph, noSwitches, 1 / 60);

    expect(train.s).toBe(0.5); // untouched
    expect(train.history).toEqual(historyBefore); // untouched (result.state.history is a new array)
    expect(result.state).not.toBe(train);
  });

  it('crashed/airborne trains are a no-op passthrough', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, straight(0, 0));

    const crashedTrain = makeTrain({ edgeId: '0:0:f', v: 5, crashed: true });
    const crashedResult = advanceTrain(crashedTrain, graph, noSwitches, 1 / 60);
    expect(crashedResult).toEqual({ state: crashedTrain, deadEndOverrun: null });

    const airborneTrain = makeTrain({
      edgeId: '0:0:f',
      v: 5,
      airborne: { pos: [0, 1, 0], vel: [1, 0, 0] },
    });
    const airborneResult = advanceTrain(airborneTrain, graph, noSwitches, 1 / 60);
    expect(airborneResult).toEqual({ state: airborneTrain, deadEndOverrun: null });
  });
});

describe('advanceTrain: edge handoff conserves leftover distance (property test)', () => {
  it('total distance traveled equals Σ(v·dt) over 1000 random tick sequences', () => {
    const graph = new TrackGraph();
    const N = 60; // long enough that ~1000 small-v ticks never reach the dead end at the far end
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

    let train = makeTrain({ edgeId: '0:0:f', v: 0 });
    let totalExpected = 0;

    for (let i = 0; i < 1000; i++) {
      const v = rand() * 2; // random small speed, 0..2 units/s
      const dt = (0.5 + rand()) / 60; // dt jittered around 1/60, in [0.5, 1.5]/60
      train = { ...train, v };

      const result = advanceTrain(train, graph, noSwitches, dt);
      train = result.state;
      totalExpected += v * dt;

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

  it('soft-stops (v -> 0) when v <= vCrawl at a dead end', () => {
    const graph = singleStraightGraph();
    const train = makeTrain({ edgeId: '0:0:f', s: edgeLength - 0.001, v: PHYSICS.vCrawl });

    const result = advanceTrain(train, graph, noSwitches, 1 / 60);

    expect(result.state.s).toBeCloseTo(edgeLength, 9);
    expect(result.state.v).toBe(0);
    expect(result.deadEndOverrun).toBeNull();
  });

  it('signals deadEndOverrun (v left unchanged) when v > vCrawl at a dead end', () => {
    const graph = singleStraightGraph();
    const v = 1.0;
    const s0 = edgeLength - 0.001;
    const dt = 1 / 60;
    const train = makeTrain({ edgeId: '0:0:f', s: s0, v });

    const result = advanceTrain(train, graph, noSwitches, dt);

    const expectedOverrun = s0 + v * dt - edgeLength;
    expect(result.state.s).toBeCloseTo(edgeLength, 9);
    expect(result.state.v).toBe(v); // unchanged — not this file's decision to make
    expect(result.deadEndOverrun).not.toBeNull();
    expect(result.deadEndOverrun!).toBeCloseTo(expectedOverrun, 9);
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
    const train = makeTrain({ edgeId: '0:0:f', s: edgeLength - 0.001, v: 1.0 });

    const result = advanceTrain(train, graph, gatedShut, 1 / 60);

    expect(result.state.s).toBeCloseTo(edgeLength, 9);
    expect(result.deadEndOverrun).not.toBeNull();
  });
});

describe('handoff loop cap', () => {
  it('stops after MAX_HANDOFF_ITERATIONS on an oversized single-tick advance, leaving distance undelivered', () => {
    // A real topological zero-length-edge cycle is hard to construct through graph.ts (it always
    // builds physically consistent geometry from real pieces), so instead this exercises the cap
    // the realistic way it would ever fire: an absurdly large v*dt in a single tick that would
    // need far more than 64 handoffs to fully resolve. N=70 pieces gives headroom past the cap
    // (64) so this exercises the safety valve, not the fixture's own dead end at piece 69.
    const graph = new TrackGraph();
    const N = 70;
    for (let i = 0; i < N; i++) graph.addPlacement(i, straight(0, i));

    const dt = 1; // deliberately not a "real" tick — isolating the cap behavior, not realism
    const v = 200; // v*dt = 200 needs 100 handoffs (edge length 2.0) to fully resolve
    const train = makeTrain({ edgeId: '0:0:f', v, s: 0 });

    const result = advanceTrain(train, graph, noSwitches, dt);

    // Hand-traced: 64 handoffs land on placement index 64 with 2.0 (=edge.length) remaining
    // clamped — see the M4.2 report for the full derivation.
    expect(result.state.edgeId).toBe('64:0:f');
    expect(result.state.s).toBeCloseTo(2.0, 9);
    expect(result.deadEndOverrun).toBeNull(); // cap-abort is not a dead end
  });
});

// --- carriage trailing around a curve and a junction ---

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
