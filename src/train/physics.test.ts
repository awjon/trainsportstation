// M4.3 tests (docs/70; docs/30 §7.2-7.4): P-2 derail threshold (+ recovery), P-3 exact-tick
// collision, jump launch/landing/bad-landing, and w2-s5's named gap cases.

import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../track/graph';
import type { PieceType } from '../track/pieces';
import type { TrainState, CarriageState } from './types';
import { PHYSICS, type SpeedBet } from './physics-constants';
import { detectCollisions, stepTrainPhysics } from './physics';
import type { SimEvent } from '../simulation/events';

const noSwitches = new Map<number, 0 | 1>();

function makeTrain(overrides: Partial<TrainState> & { edgeId: string | null }): TrainState {
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

function crashEvents(events: SimEvent[]): Extract<SimEvent, { type: 'Crashed' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'Crashed' }> => e.type === 'Crashed');
}

// --- P-2: derail on curves (docs/30 §7.3) ---

describe('stepTrainPhysics: P-2 derail threshold', () => {
  function tightCurveGraph(): { graph: TrackGraph; pieceTypeOf: (i: number) => PieceType } {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'curve-small', cell: { x: 0, z: 0 }, rotation: 0 });
    return { graph, pieceTypeOf: () => 'curve-small' };
  }

  it('derails on the 13th consecutive tick over threshold (threshold + ε), survives 12', () => {
    const { graph, pieceTypeOf } = tightCurveGraph();
    const v = PHYSICS.maxSpeedByCurveClass.tight + 0.1; // threshold + ε
    let train = makeTrain({ edgeId: '0:0:f', v, s: 0 });

    // dt=0 holds v and s exactly fixed tick to tick (updateVelocity/advanceTrain both no-op at
    // dt=0: a*0=0, v*0=0) — isolates the overspeedTicks bookkeeping from the §7.1 acceleration
    // model entirely, so this test is about the derail COUNTER, not about sustaining a precise v
    // through the accelerating dynamics.
    for (let tick = 1; tick <= 12; tick++) {
      const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, tick);
      train = result.state;
      expect(train.crashed).toBe(false);
      expect(train.overspeedTicks).toBe(tick);
      expect(crashEvents(result.events)).toHaveLength(0);
    }

    const result13 = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, 13);
    expect(result13.state.crashed).toBe(true);
    expect(result13.state.edgeId).toBeNull(); // docs/30 §4: edgeId null while crashed
    const crashes = crashEvents(result13.events);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({ type: 'Crashed', trainId: 't1', cause: 'speeding-curve' });
  });

  it('never derails when sustained at threshold - ε', () => {
    const { graph, pieceTypeOf } = tightCurveGraph();
    const v = PHYSICS.maxSpeedByCurveClass.tight - 0.1; // threshold - ε
    let train = makeTrain({ edgeId: '0:0:f', v, s: 0 });

    for (let tick = 1; tick <= 30; tick++) {
      const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, tick);
      train = result.state;
      expect(train.crashed).toBe(false);
      expect(train.overspeedTicks).toBe(0);
    }
  });

  it('recovering below threshold resets the counter — 12 overspeed, 1 recovery, 12 more never crashes', () => {
    const { graph, pieceTypeOf } = tightCurveGraph();
    const overV = PHYSICS.maxSpeedByCurveClass.tight + 0.1;
    const underV = PHYSICS.maxSpeedByCurveClass.tight - 0.1;

    let train = makeTrain({ edgeId: '0:0:f', v: overV, s: 0 });
    for (let tick = 1; tick <= 12; tick++) {
      train = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, tick).state;
    }
    expect(train.overspeedTicks).toBe(12);
    expect(train.crashed).toBe(false);

    // one recovery tick — force v back under threshold before the call (dt=0 wouldn't change it
    // on its own; this simulates "the train briefly slowed")
    train = { ...train, v: underV };
    const recovered = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, 13);
    train = recovered.state;
    expect(train.overspeedTicks).toBe(0); // reset, not just held

    // 12 more overspeed ticks — if the counter were cumulative (not reset), this would have
    // exceeded derailGraceTicks(12) long ago; since it's reset, this must NOT crash.
    train = { ...train, v: overV };
    for (let tick = 14; tick <= 25; tick++) {
      const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, tick);
      train = result.state;
      expect(train.crashed).toBe(false);
    }
    expect(train.overspeedTicks).toBe(12);

    // the 13th consecutive tick since the reset finally derails
    train = { ...train, v: overV };
    const crashResult = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 0, 26);
    expect(crashResult.state.crashed).toBe(true);
  });
});

// --- P-3: collisions (docs/30 §7.4) ---

describe('detectCollisions: P-3 exact-tick collision', () => {
  it('two trains on the same edge crash on the exact tick their swept intervals first overlap', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });

    // Train B: stationary at s=1.2, no carriages (a single point at 1.2).
    // Train A: starts at s=0, front advances 0.2/tick, one carriage 0.3 behind (interval width
    // 0.3). Overlap iff (sA - 0.3) <= 1.2 && 1.2 <= sA, i.e. sA in [1.2, 1.5] — a WINDOW, not a
    // one-sided "from here on" threshold: at sA=0.2*tick, that's tick in [6, 7.5], so ticks 6-7
    // overlap and tick 8 (sA=1.6, past the window — A has driven fully past B's point in this
    // snapshot-only check) does not. The exact FIRST overlapping tick (this test's actual P-3
    // claim) is 6; tick 7 and the tick-8 "exited the window" case are extra coverage confirming
    // the interval math on both edges of the window, not just its start.
    const trainB = makeTrain({ id: 'B', edgeId: '0:0:f', s: 1.2, carriages: [] });
    const carriage: CarriageState = { personaId: null, offset: 0.3 };

    for (let tick = 0; tick <= 8; tick++) {
      const sA = 0.2 * tick;
      const trainA = makeTrain({ id: 'A', edgeId: '0:0:f', s: sA, carriages: [carriage] });
      const events = detectCollisions([trainA, trainB], graph, tick);

      const overlapping = sA - 0.3 <= 1.2 && 1.2 <= sA; // same predicate detectCollisions applies
      if (!overlapping) {
        expect(events).toHaveLength(0);
      } else {
        expect(crashEvents(events)).toHaveLength(2);
        const ids = crashEvents(events)
          .map((e) => e.trainId)
          .sort();
        expect(ids).toEqual(['A', 'B']);
        expect(events.every((e) => e.type === 'Crashed' && e.cause === 'collision')).toBe(true);
      }
    }

    // The exact first overlapping tick is 6 (P-3's actual claim) — pin it explicitly, not just
    // via the generic per-tick loop above.
    const firstOverlapTick = 6;
    expect(0.2 * (firstOverlapTick - 1) - 0.3 <= 1.2 && 1.2 <= 0.2 * (firstOverlapTick - 1)).toBe(false);
    expect(0.2 * firstOverlapTick - 0.3 <= 1.2 && 1.2 <= 0.2 * firstOverlapTick).toBe(true);
  });

  it('trains on different edges (not sharing an edge or a crossing placement) never collide', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });
    graph.addPlacement(1, { piece: 'straight', cell: { x: 5, z: 5 }, rotation: 0 });
    const trainA = makeTrain({ id: 'A', edgeId: '0:0:f', s: 1.0 });
    const trainB = makeTrain({ id: 'B', edgeId: '1:0:f', s: 1.0 });
    expect(detectCollisions([trainA, trainB], graph, 0)).toHaveLength(0);
  });

  it('two trains on independent paths of the same crossing placement both crash, regardless of s', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'crossing', cell: { x: 0, z: 0 }, rotation: 0 });
    // path 0 = N-S, path 1 = E-W (docs/30 §5) — independent paths, same cell.
    const trainA = makeTrain({ id: 'A', edgeId: '0:0:f', s: 0.1 });
    const trainB = makeTrain({ id: 'B', edgeId: '0:1:f', s: 1.9 });

    const events = detectCollisions([trainA, trainB], graph, 3);
    expect(crashEvents(events)).toHaveLength(2);
    expect(events.every((e) => e.type === 'Crashed' && e.cause === 'collision')).toBe(true);
  });

  it('two trains on DIFFERENT crossing placements do not collide', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'crossing', cell: { x: 0, z: 0 }, rotation: 0 });
    graph.addPlacement(1, { piece: 'crossing', cell: { x: 10, z: 10 }, rotation: 0 });
    const trainA = makeTrain({ id: 'A', edgeId: '0:0:f', s: 0.1 });
    const trainB = makeTrain({ id: 'B', edgeId: '1:1:f', s: 0.1 });
    expect(detectCollisions([trainA, trainB], graph, 0)).toHaveLength(0);
  });
});

// --- Jumps (docs/30 §7.2) ---

describe('stepTrainPhysics: jump Trigger A (jumpCapable crest)', () => {
  it('launches airborne off a hill even with good track continuing beyond it', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'hill', cell: { x: 0, z: 0 }, rotation: 0 });
    graph.addPlacement(1, { piece: 'straight', cell: { x: 0, z: 2 }, rotation: 0 }); // track continues
    const pieceTypeOf = (i: number): PieceType => (i === 0 ? 'hill' : 'straight');

    const edge = graph.edges.get('0:0:f')!;
    const v0 = 5.0;
    const bet: SpeedBet = 'steady';
    const dt = 1 / 60;
    const train = makeTrain({ edgeId: '0:0:f', s: edge.length - 0.01, v: v0 });

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, bet, dt, 1);

    expect(result.state.crashed).toBe(false);
    expect(result.state.edgeId).toBeNull();
    expect(result.state.airborne).not.toBeNull();
    expect(result.state.airborneTicks).toBe(1);
    expect(result.state.v).toBeGreaterThanOrEqual(PHYSICS.vJump);
    expect(result.events).toHaveLength(0); // launch itself emits nothing; Airtime is on landing

    const vel = result.state.airborne!.vel;
    expect(Math.hypot(vel[0], vel[1], vel[2])).toBeCloseTo(result.state.v, 6);
  });

  it('does NOT launch below vJump — continues on rails normally instead', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'hill', cell: { x: 0, z: 0 }, rotation: 0 });
    graph.addPlacement(1, { piece: 'straight', cell: { x: 0, z: 2 }, rotation: 0 });
    const pieceTypeOf = (i: number): PieceType => (i === 0 ? 'hill' : 'straight');

    const edge = graph.edges.get('0:0:f')!;
    const train = makeTrain({ edgeId: '0:0:f', s: edge.length - 0.01, v: 1.0 }); // well below vJump

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 1 / 60, 1);

    expect(result.state.airborne).toBeNull();
    expect(result.state.crashed).toBe(false);
    // handed off onto the continuing straight normally
    expect(result.state.edgeId).toBe('1:0:f');
  });
});

describe('stepTrainPhysics: landing', () => {
  it('snaps onto a nearby, correctly-oriented track point, keeps 0.85x horizontal speed, emits Airtime', () => {
    const graph = new TrackGraph();
    // a single straight at cell (5,5): its 'f' path's s=0 world point/tangent (rotation 0, base 0)
    // is (10,0,9) / (0,0,1) — CELL=2.0, HALF=1 (see track/pieces.ts).
    graph.addPlacement(0, { piece: 'straight', cell: { x: 5, z: 5 }, rotation: 0 });
    const pieceTypeOf = (): PieceType => 'straight';

    const dt = 1 / 60;
    const speed = 5.0;
    const exitWorld = { x: 10, y: 0, z: 9 };
    const vel0: [number, number, number] = [0, 0, speed];
    // Back-extrapolate the pre-tick position so that after this tick's ballistic integration
    // (which nudges y down by gAir*dt^2 and leaves x/z exact, since vel.x/z don't change under
    // gravity), the post-tick position lands almost exactly on the exitWorld sample point —
    // this makes the "nearest sample" landing match deterministic rather than approximate.
    const pos0: [number, number, number] = [
      exitWorld.x - vel0[0] * dt,
      exitWorld.y - vel0[1] * dt,
      exitWorld.z - vel0[2] * dt,
    ];

    const train = makeTrain({
      edgeId: null,
      airborne: { pos: pos0, vel: vel0 },
      airborneTicks: 3,
    });

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', dt, 20);

    expect(result.state.airborne).toBeNull();
    expect(result.state.edgeId).toBe('0:0:f');
    expect(result.state.s).toBeCloseTo(0, 2);
    expect(result.state.facing).toBe(1);
    expect(result.state.v).toBeCloseTo(0.85 * speed, 2);
    expect(result.state.airborneTicks).toBe(0);
    expect(result.events).toEqual([{ tick: 20, type: 'Airtime', trainId: train.id, durationTicks: 4 }]);
  });

  it('misses (too far / wrong angle) and stays airborne with no event', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 5, z: 5 }, rotation: 0 });
    const pieceTypeOf = (): PieceType => 'straight';

    // far from the only placed piece, falling in open air
    const train = makeTrain({
      edgeId: null,
      airborne: { pos: [100, 5, 100], vel: [1, 0, 1] },
      airborneTicks: 2,
    });

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 1 / 60, 5);

    expect(result.state.crashed).toBe(false);
    expect(result.state.airborne).not.toBeNull();
    expect(result.state.airborneTicks).toBe(3);
    expect(result.events).toHaveLength(0);
  });

  it('bad landing: touches ground with no nearby match -> Crashed{cause: bad-landing}', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 50, z: 50 }, rotation: 0 }); // far away
    const pieceTypeOf = (): PieceType => 'straight';

    const train = makeTrain({
      edgeId: null,
      airborne: { pos: [0, 0.02, 0], vel: [0, -2, 0] }, // already falling fast, near ground
      airborneTicks: 10,
    });

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 1 / 60, 7);

    expect(result.state.crashed).toBe(true);
    expect(result.state.airborne).toBeNull();
    expect(result.state.edgeId).toBeNull();
    const crashes = crashEvents(result.events);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({ type: 'Crashed', trainId: 't1', cause: 'bad-landing' });
    expect(crashes[0].cell).toEqual({ x: 0, z: 0 });
  });
});

// --- w2-s5: "Steady teeters into the gorge" + its height-0 sibling (docs/30 §7.2) ---

describe('stepTrainPhysics: dead-end gap crashes (w2-s5)', () => {
  it('a dead end at height >= 1, arriving below vJump, crashes with cause "gap" (not airborne)', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'ramp', cell: { x: 0, z: 0 }, rotation: 0 }); // climbs to height 1, dead end
    const pieceTypeOf = (): PieceType => 'ramp';
    const edge = graph.edges.get('0:0:f')!;
    expect(graph.nodes.get(edge.to)?.height).toBe(1);

    const train = makeTrain({ edgeId: '0:0:f', s: edge.length - 0.001, v: 1.0 }); // below vJump

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 1 / 60, 9);

    expect(result.state.airborne).toBeNull();
    expect(result.state.crashed).toBe(true);
    expect(result.state.edgeId).toBeNull();
    const crashes = crashEvents(result.events);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({ type: 'Crashed', cause: 'gap' });
  });

  it('any dead-end overrun at speed at height 0 crashes with cause "gap", even above vJump', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 }); // height 0, dead end
    const pieceTypeOf = (): PieceType => 'straight';
    const edge = graph.edges.get('0:0:f')!;
    expect(graph.nodes.get(edge.to)?.height).toBe(0);

    const train = makeTrain({ edgeId: '0:0:f', s: edge.length - 0.001, v: 5.0 }); // above vJump

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'ludicrous', 1 / 60, 9);

    expect(result.state.airborne).toBeNull(); // height 0 disqualifies the jump regardless of speed
    expect(result.state.crashed).toBe(true);
    const crashes = crashEvents(result.events);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({ type: 'Crashed', cause: 'gap' });
  });

  it('(contrast) a dead end at height >= 1, arriving AT or above vJump, launches instead of crashing', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'ramp', cell: { x: 0, z: 0 }, rotation: 0 });
    const pieceTypeOf = (): PieceType => 'ramp';
    const edge = graph.edges.get('0:0:f')!;

    const train = makeTrain({ edgeId: '0:0:f', s: edge.length - 0.001, v: 5.0 }); // above vJump

    const result = stepTrainPhysics(train, graph, pieceTypeOf, noSwitches, 'steady', 1 / 60, 9);

    expect(result.state.crashed).toBe(false);
    expect(result.state.airborne).not.toBeNull();
    expect(result.state.airborneTicks).toBe(1);
  });
});
