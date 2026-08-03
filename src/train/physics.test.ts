// M4.3 tests (docs/70): P-2 derail threshold ±ε, P-3 exact-tick collision, and the jump
// launch / land / bad-landing / gap cases — including w2-s5's "Steady teeters into the gorge".

import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../track/graph';
import type { Placement } from '../track/placement';
import { TrackRuntime } from './runtime';
import { stepTrain } from './movement';
import {
  apexHeight,
  checkDerail,
  consistLength,
  crash,
  detectCollisions,
  landingSites,
  occupancyOf,
  resolveDeadEnd,
  stepAirborne,
} from './physics';
import { PHYSICS, makeTrain } from './types';

function build(placements: Placement[]) {
  const graph = new TrackGraph();
  const ports = placements.map((p, i) => graph.addPlacement(i, p));
  const runtime = new TrackRuntime(graph, placements);
  return { graph, runtime, ports };
}

const straightLine = (n: number): Placement[] =>
  Array.from({ length: n }, (_, i) => ({
    piece: 'straight' as const,
    cell: { x: 0, z: i },
    rotation: 0 as const,
  }));

function firstEdge(graph: TrackGraph, ports: string[][], index = 0) {
  return graph.edgesFrom(ports[index][0]).find((e) => e.placementIndex === index)!;
}

describe('derailment (P-2)', () => {
  const tightLimit = PHYSICS.derail.maxSpeed.tight!;

  it('survives just under the threshold indefinitely', () => {
    const placements: Placement[] = [{ piece: 'curve-small', cell: { x: 0, z: 0 }, rotation: 0 }];
    const { graph, runtime, ports } = build(placements);
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = tightLimit - 0.01;
    for (let i = 0; i < 200; i++) expect(checkDerail(train, runtime)).toBeNull();
    expect(train.crashed).toBeNull();
  });

  it('derails just over the threshold once the grace window passes', () => {
    const placements: Placement[] = [{ piece: 'curve-small', cell: { x: 0, z: 0 }, rotation: 0 }];
    const { graph, runtime, ports } = build(placements);
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = tightLimit + 0.01;
    for (let i = 0; i < PHYSICS.derail.graceTicks; i++) {
      expect(checkDerail(train, runtime)).toBeNull(); // still inside the grace window
    }
    expect(checkDerail(train, runtime)).toBe('speeding-curve');
    expect(train.crashed).toBe('speeding-curve');
  });

  it('a brief overspeed blip is forgiven (the grace window is the bet)', () => {
    const placements: Placement[] = [{ piece: 'curve-small', cell: { x: 0, z: 0 }, rotation: 0 }];
    const { graph, runtime, ports } = build(placements);
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = tightLimit + 1;
    for (let i = 0; i < 5; i++) checkDerail(train, runtime);
    train.v = tightLimit - 0.5; // slowed in time
    expect(checkDerail(train, runtime)).toBeNull();
    expect(train.overspeedTicks).toBe(0);
    expect(train.crashed).toBeNull();
  });

  it('straights have no speed limit', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = PHYSICS.vHardMax;
    for (let i = 0; i < 100; i++) expect(checkDerail(train, runtime)).toBeNull();
  });

  it('a gentle curve tolerates more speed than a tight one', () => {
    expect(PHYSICS.derail.maxSpeed.gentle!).toBeGreaterThan(PHYSICS.derail.maxSpeed.tight!);
  });
});

describe('dead ends and jumps', () => {
  it('rolls to a gentle stop below crawl speed', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = PHYSICS.vCrawl - 0.05;
    expect(resolveDeadEnd(train, runtime, 0.01)).toEqual({ kind: 'stopped' });
    expect(train.crashed).toBeNull();
    expect(train.v).toBe(0);
  });

  it('launches into the air at or above the jump speed', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = PHYSICS.jump.vJump + 0.5;
    expect(resolveDeadEnd(train, runtime, 0.02)).toEqual({ kind: 'launched' });
    expect(train.airborne).not.toBeNull();
    expect(train.edgeId).toBeNull();
  });

  it('w2-s5: too slow to jump but too fast to stop → teeters into the gap', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = (PHYSICS.vCrawl + PHYSICS.jump.vJump) / 2; // between the two thresholds
    expect(resolveDeadEnd(train, runtime, 0.02)).toEqual({ kind: 'crashed', cause: 'gap' });
    expect(train.crashed).toBe('gap');
  });

  it('an airborne train falls under gravity and crashes on bad ground', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = PHYSICS.jump.vJump + 1;
    resolveDeadEnd(train, runtime, 0);
    train.airborne!.pos[1] = 1; // lift it so there's air beneath
    let result = stepAirborne(train, []); // no landing sites anywhere
    let ticks = 0;
    while (result.kind === 'flying' && ticks++ < 600) result = stepAirborne(train, []);
    expect(result.kind).toBe('crashed');
    expect(train.crashed).toBe('bad-landing');
  });

  it('lands cleanly on an aligned site and keeps most of its speed', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = PHYSICS.jump.vJump + 1;
    resolveDeadEnd(train, runtime, 0);
    const speedBefore = Math.hypot(...train.airborne!.vel);

    // a landing site right where it is, aligned with the flight direction
    const sites = [
      {
        edgeId: firstEdge(graph, ports).id,
        s: 0.5,
        position: {
          x: train.airborne!.pos[0],
          y: train.airborne!.pos[1],
          z: train.airborne!.pos[2],
        },
        tangent: {
          x: train.airborne!.vel[0] / speedBefore,
          y: train.airborne!.vel[1] / speedBefore,
          z: train.airborne!.vel[2] / speedBefore,
        },
      },
    ];
    const result = stepAirborne(train, sites);
    expect(result.kind).toBe('landed');
    expect(train.airborne).toBeNull();
    expect(train.edgeId).toBe(sites[0].edgeId);
    expect(train.v).toBeCloseTo(speedBefore * PHYSICS.jump.landingSpeedRetained, 1);
  });

  it('ignores a landing site facing the wrong way', () => {
    const { graph, runtime, ports } = build(straightLine(1));
    const train = makeTrain('t', firstEdge(graph, ports).id);
    train.v = PHYSICS.jump.vJump + 1;
    resolveDeadEnd(train, runtime, 0);
    train.airborne!.pos[1] = 2;
    const speed = Math.hypot(...train.airborne!.vel);
    const sites = [
      {
        edgeId: firstEdge(graph, ports).id,
        s: 0,
        position: { x: train.airborne!.pos[0], y: train.airborne!.pos[1], z: train.airborne!.pos[2] },
        tangent: {
          x: -train.airborne!.vel[0] / speed,
          y: -train.airborne!.vel[1] / speed,
          z: -train.airborne!.vel[2] / speed,
        }, // head-on
      },
    ];
    expect(stepAirborne(train, sites).kind).toBe('flying');
  });

  it('landingSites covers every forward edge', () => {
    const { runtime } = build(straightLine(3));
    const sites = landingSites(runtime, 4);
    expect(sites.length).toBe(3 * 5); // 3 forward edges × (4+1) samples
  });

  it('apex height grows with the square of vertical speed', () => {
    expect(apexHeight(4)).toBeCloseTo(apexHeight(2) * 4, 6);
  });
});

describe('collisions (P-3)', () => {
  it('two trains on the same edge collide only when their spans overlap', () => {
    const { graph, runtime, ports } = build(straightLine(4));
    const edge = firstEdge(graph, ports);
    const a = makeTrain('a', edge.id, 1);
    const b = makeTrain('b', edge.id, 1);
    const span = consistLength(a);
    a.s = 0;
    b.s = span + 0.2; // b's tail is clear of a's head
    expect(detectCollisions([a, b], runtime)).toHaveLength(0);

    b.s = span - 0.1; // now b's tail reaches back over a
    expect(detectCollisions([a, b], runtime)).toEqual([['a', 'b']]);
  });

  it('P-3: collides on the exact tick the swept intervals first overlap', () => {
    const { graph, runtime, ports } = build(straightLine(6));
    const chaser = makeTrain('chaser', firstEdge(graph, ports).id);
    const parked = makeTrain('parked', firstEdge(graph, ports).id);
    const span = consistLength(chaser);
    parked.s = runtime.length(parked.edgeId!); // parked at the far end of the first edge
    chaser.v = 2;

    let collidedAt = -1;
    let gapAtImpact = Infinity;
    for (let tick = 0; tick < 60; tick++) {
      const before = parked.s - chaser.s;
      stepTrain(chaser, runtime, { speedBet: 'steady' });
      if (chaser.edgeId !== parked.edgeId) break; // ran past onto the next piece
      if (detectCollisions([chaser, parked], runtime).length > 0) {
        collidedAt = tick;
        gapAtImpact = parked.s - chaser.s;
        // the tick before, they were still clear
        expect(before).toBeGreaterThan(span);
        break;
      }
    }
    expect(collidedAt).toBeGreaterThanOrEqual(0);
    expect(gapAtImpact).toBeLessThanOrEqual(span);
  });

  it('trains on unrelated edges do not collide', () => {
    const placements: Placement[] = [
      { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 },
      { piece: 'straight', cell: { x: 5, z: 5 }, rotation: 0 },
    ];
    const { graph, runtime, ports } = build(placements);
    const a = makeTrain('a', firstEdge(graph, ports, 0).id);
    const b = makeTrain('b', firstEdge(graph, ports, 1).id);
    expect(detectCollisions([a, b], runtime)).toHaveLength(0);
  });

  it('two lanes of a crossing collide in the shared cell', () => {
    const placements: Placement[] = [{ piece: 'crossing', cell: { x: 0, z: 0 }, rotation: 0 }];
    const { graph, runtime } = build(placements);
    const edges = [...graph.edges.values()].filter((e) => !e.reversed);
    const ns = edges.find((e) => e.pathIndex === 0)!;
    const we = edges.find((e) => e.pathIndex === 1)!;
    const a = makeTrain('a', ns.id);
    const b = makeTrain('b', we.id);
    a.s = runtime.length(ns.id) / 2; // both at the centre of the crossing
    b.s = runtime.length(we.id) / 2;
    expect(detectCollisions([a, b], runtime)).toEqual([['a', 'b']]);
  });

  it('a crashed train is no longer a collision target', () => {
    const { graph, runtime, ports } = build(straightLine(2));
    const edge = firstEdge(graph, ports);
    const a = makeTrain('a', edge.id);
    const b = makeTrain('b', edge.id);
    crash(b, 'gap');
    expect(occupancyOf(b)).toBeNull();
    expect(detectCollisions([a, b], runtime)).toHaveLength(0);
  });

  it('crash() is idempotent — the first cause sticks', () => {
    const train = makeTrain('t', null);
    crash(train, 'gap');
    crash(train, 'collision');
    expect(train.crashed).toBe('gap');
  });
});
