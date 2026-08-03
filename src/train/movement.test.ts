// M4.2 tests (docs/70): speed convergence (P-1), edge handoff conserving leftover distance
// (property test over random tick sequences), and carriage trailing around curves.

import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../track/graph';
import type { Placement } from '../track/placement';
import { TICK_DT } from '../core/loop';
import { Rng } from '../core/rng';
import { dist } from '../core/math';
import { TrackRuntime } from './runtime';
import { consistPositions, integrateSpeed, stepTrain, trailingPosition } from './movement';
import { PHYSICS, makeTrain } from './types';

/** A straight line of N pieces running south, plus its runtime. */
function line(n: number) {
  const placements: Placement[] = Array.from({ length: n }, (_, i) => ({
    piece: 'straight' as const,
    cell: { x: 0, z: i },
    rotation: 0 as const,
  }));
  const graph = new TrackGraph();
  const ports = placements.map((p, i) => graph.addPlacement(i, p));
  const runtime = new TrackRuntime(graph, placements);
  // the forward edge of the first piece: from its N node to its S node
  const firstEdge = graph.edgesFrom(ports[0][0]).find((e) => e.placementIndex === 0)!;
  return { graph, runtime, placements, firstEdge };
}

describe('longitudinal dynamics', () => {
  it('P-1: speed converges to the bet target on flat track', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = integrateSpeed(v, 0, 'steady');
    const target = PHYSICS.vBase * PHYSICS.speedBet.steady;
    // drag holds the steady state a little under the nominal target
    expect(v).toBeGreaterThan(target * 0.85);
    expect(v).toBeLessThanOrEqual(PHYSICS.vHardMax);
  });

  it('a faster bet converges higher', () => {
    let steady = 0;
    let ludicrous = 0;
    for (let i = 0; i < 600; i++) {
      steady = integrateSpeed(steady, 0, 'steady');
      ludicrous = integrateSpeed(ludicrous, 0, 'ludicrous');
    }
    expect(ludicrous).toBeGreaterThan(steady);
  });

  it('uphill is slower than downhill', () => {
    let up = 2;
    let down = 2;
    for (let i = 0; i < 60; i++) {
      up = integrateSpeed(up, 1, 'steady');
      down = integrateSpeed(down, -1, 'steady');
    }
    expect(down).toBeGreaterThan(up);
  });

  it('never goes negative or past the hard cap', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = integrateSpeed(v, 1, 'steady', 0); // uphill, no throttle
    expect(v).toBe(0);
    let fast = PHYSICS.vHardMax;
    for (let i = 0; i < 200; i++) fast = integrateSpeed(fast, -1, 'ludicrous');
    expect(fast).toBeLessThanOrEqual(PHYSICS.vHardMax);
  });
});

describe('edge handoff', () => {
  it('crosses into the next edge carrying the leftover distance', () => {
    const { runtime, firstEdge } = line(3);
    const train = makeTrain('t1', firstEdge.id);
    train.v = 3;
    const first = stepTrain(train, runtime, { speedBet: 'steady' });
    expect(first.kind).toBe('moved');
    // keep stepping until it crosses at least one boundary
    let crossed = false;
    for (let i = 0; i < 60 && !crossed; i++) {
      const out = stepTrain(train, runtime, { speedBet: 'steady' });
      if (out.kind === 'moved' && out.crossings.length > 0) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(train.s).toBeGreaterThanOrEqual(0);
    expect(train.s).toBeLessThanOrEqual(runtime.length(train.edgeId!));
  });

  it('property: odometer equals the sum of v·dt over random tick sequences', () => {
    const rng = new Rng(1234);
    for (let trial = 0; trial < 20; trial++) {
      const { runtime, firstEdge } = line(40);
      const train = makeTrain('t', firstEdge.id);
      let expected = 0;
      for (let i = 0; i < 50; i++) {
        const bet = rng.pick(['steady', 'swift', 'ludicrous'] as const);
        const before = train.v;
        const out = stepTrain(train, runtime, { speedBet: bet });
        if (out.kind !== 'moved') break;
        expect(train.v).not.toBe(Number.NaN);
        expected += out.distance;
        expect(out.distance).toBeGreaterThanOrEqual(0);
        expect(before).toBeGreaterThanOrEqual(0);
      }
      expect(train.odometer).toBeCloseTo(expected, 9);
    }
  });

  it('travelled distance matches position advanced along a long line', () => {
    const { runtime, firstEdge } = line(20);
    const train = makeTrain('t', firstEdge.id);
    train.v = 2;
    const start = runtime.positionAt(train.edgeId!, train.s);
    for (let i = 0; i < 120; i++) stepTrain(train, runtime, { speedBet: 'steady' });
    const end = runtime.positionAt(train.edgeId!, train.s);
    // a straight line, so odometer ≈ euclidean displacement
    expect(dist(start, end)).toBeCloseTo(train.odometer, 3);
  });

  it('reports dead-end with the overrun when the track runs out', () => {
    const { runtime, firstEdge } = line(1);
    const train = makeTrain('t', firstEdge.id);
    train.v = 5;
    let outcome = stepTrain(train, runtime, { speedBet: 'ludicrous' });
    for (let i = 0; i < 60 && outcome.kind === 'moved'; i++) {
      outcome = stepTrain(train, runtime, { speedBet: 'ludicrous' });
    }
    expect(outcome.kind).toBe('dead-end');
    if (outcome.kind === 'dead-end') expect(outcome.overrun).toBeGreaterThanOrEqual(0);
  });

  it('a crashed train does not move', () => {
    const { runtime, firstEdge } = line(3);
    const train = makeTrain('t', firstEdge.id);
    train.crashed = 'collision';
    expect(stepTrain(train, runtime, { speedBet: 'steady' })).toEqual({ kind: 'blocked' });
    expect(train.odometer).toBe(0);
  });
});

describe('carriage trailing', () => {
  it('carriages sit behind the locomotive at their offsets', () => {
    const { runtime, firstEdge } = line(6);
    const train = makeTrain('t', firstEdge.id, 3);
    train.v = 2;
    for (let i = 0; i < 90; i++) stepTrain(train, runtime, { speedBet: 'steady' });
    const positions = consistPositions(train, runtime);
    expect(positions).toHaveLength(4); // loco + 3 carriages
    // on a straight line, spacing is exactly the arc-length offset
    for (let i = 1; i < positions.length; i++) {
      expect(dist(positions[0], positions[i])).toBeCloseTo(train.carriages[i - 1].offset, 2);
    }
  });

  it('trailing walks back across an edge boundary', () => {
    const { runtime, firstEdge } = line(4);
    const train = makeTrain('t', firstEdge.id, 1);
    train.v = 2;
    // advance just past the first boundary
    while (train.trail.length === 0) stepTrain(train, runtime, { speedBet: 'steady' });
    const behind = trailingPosition(train, runtime, PHYSICS.carriageSpacing);
    const head = runtime.positionAt(train.edgeId!, train.s);
    expect(dist(head, behind)).toBeCloseTo(PHYSICS.carriageSpacing, 2);
  });

  it('trailing stays close to the rail around a curve', () => {
    // straight then a curve: the carriage should follow the arc, not cut across it
    const placements: Placement[] = [
      { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 },
      { piece: 'curve-small', cell: { x: 0, z: 1 }, rotation: 0 },
    ];
    const graph = new TrackGraph();
    const ports = placements.map((p, i) => graph.addPlacement(i, p));
    const runtime = new TrackRuntime(graph, placements);
    const first = graph.edgesFrom(ports[0][0]).find((e) => e.placementIndex === 0)!;
    const train = makeTrain('t', first.id, 1);
    train.v = 1.5;
    while (train.trail.length === 0) stepTrain(train, runtime, { speedBet: 'steady' });
    stepTrain(train, runtime, { speedBet: 'steady' });
    const head = runtime.positionAt(train.edgeId!, train.s);
    const carriage = trailingPosition(train, runtime, PHYSICS.carriageSpacing);
    // straight-line gap is shorter than the arc length travelled between them
    expect(dist(head, carriage)).toBeLessThanOrEqual(PHYSICS.carriageSpacing + 1e-6);
    expect(dist(head, carriage)).toBeGreaterThan(PHYSICS.carriageSpacing * 0.9);
  });
});

describe('tick rate', () => {
  it('one tick advances v·TICK_DT', () => {
    const { runtime, firstEdge } = line(10);
    const train = makeTrain('t', firstEdge.id);
    train.v = 1;
    const out = stepTrain(train, runtime, { speedBet: 'steady' });
    expect(out.kind).toBe('moved');
    if (out.kind === 'moved') expect(out.distance).toBeCloseTo(train.v * TICK_DT, 9);
  });
});
