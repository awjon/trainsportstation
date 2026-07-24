// M4.4 tests (docs/70; docs/40 §1.1): all three hazard kinds fixture-tested — rockfall window
// (both edges), crossingTraffic cycle, brokenPiece + repair.

import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../track/graph';
import type { Passenger, Hazard } from '../scenarios/types';
import type { SimEvent } from './events';
import type { TrainState } from '../train/types';
import { detectHazardCrashes, detectRepairs, isHazardActive } from './hazards';

function makeTrain(overrides: Partial<TrainState> & { edgeId: string | null }): TrainState {
  return {
    id: 't1',
    s: 0.5,
    facing: 1,
    v: 1,
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

describe('isHazardActive / detectHazardCrashes: rockfall window', () => {
  it('blocks in [fromTick, toTick), safe on both sides of the window', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 3, z: 3 }, rotation: 0 });
    const hazard: Hazard = { kind: 'rockfall', cell: { x: 3, z: 3 }, fromTick: 10, toTick: 20 };
    const train = makeTrain({ edgeId: '0:0:f' });

    expect(isHazardActive(hazard, 9, new Set())).toBe(false); // just before
    expect(isHazardActive(hazard, 10, new Set())).toBe(true); // fromTick itself, inclusive
    expect(isHazardActive(hazard, 19, new Set())).toBe(true); // last active tick
    expect(isHazardActive(hazard, 20, new Set())).toBe(false); // toTick itself, exclusive

    expect(detectHazardCrashes([train], graph, [hazard], new Set(), 9)).toHaveLength(0);
    const inside = detectHazardCrashes([train], graph, [hazard], new Set(), 10);
    expect(crashEvents(inside)).toHaveLength(1);
    expect(crashEvents(inside)[0]).toMatchObject({ type: 'Crashed', trainId: 't1', cause: 'hazard' });
    expect(detectHazardCrashes([train], graph, [hazard], new Set(), 20)).toHaveLength(0);
  });

  it('a train on a different cell entirely is never crashed by the rockfall', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 3, z: 3 }, rotation: 0 });
    graph.addPlacement(1, { piece: 'straight', cell: { x: 9, z: 9 }, rotation: 0 });
    const hazard: Hazard = { kind: 'rockfall', cell: { x: 3, z: 3 }, fromTick: 0, toTick: 1000 };
    const train = makeTrain({ edgeId: '1:0:f' }); // placement 1, far from the hazard's cell

    expect(detectHazardCrashes([train], graph, [hazard], new Set(), 5)).toHaveLength(0);
  });
});

describe('isHazardActive / detectHazardCrashes: crossingTraffic cycle', () => {
  it('open for the first openTicks of each periodTicks-long cycle, blocked for the rest', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });
    const hazard: Hazard = { kind: 'crossingTraffic', cell: { x: 0, z: 0 }, periodTicks: 10, openTicks: 4 };
    const train = makeTrain({ edgeId: '0:0:f' });

    // ticks 0-3 of each 10-tick period: open (safe); ticks 4-9: blocked (crash)
    expect(isHazardActive(hazard, 0, new Set())).toBe(false);
    expect(isHazardActive(hazard, 3, new Set())).toBe(false);
    expect(isHazardActive(hazard, 4, new Set())).toBe(true);
    expect(isHazardActive(hazard, 9, new Set())).toBe(true);
    // cycles: tick 10 behaves like tick 0 again
    expect(isHazardActive(hazard, 10, new Set())).toBe(false);
    expect(isHazardActive(hazard, 13, new Set())).toBe(false);
    expect(isHazardActive(hazard, 14, new Set())).toBe(true);

    expect(detectHazardCrashes([train], graph, [hazard], new Set(), 2)).toHaveLength(0); // open
    const blocked = detectHazardCrashes([train], graph, [hazard], new Set(), 7);
    expect(crashEvents(blocked)).toHaveLength(1);
    expect(detectHazardCrashes([train], graph, [hazard], new Set(), 12)).toHaveLength(0); // open again
  });
});

describe('isHazardActive / detectHazardCrashes / detectRepairs: brokenPiece + repair', () => {
  it('crashes while broken, safe once repaired', () => {
    const graph = new TrackGraph();
    graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 }); // the broken piece
    const hazard: Hazard = { kind: 'brokenPiece', placementIndex: 0, repairStationId: 'repairStation' };
    const train = makeTrain({ edgeId: '0:0:f' });

    expect(isHazardActive(hazard, 5, new Set())).toBe(true); // not repaired yet
    const beforeRepair = detectHazardCrashes([train], graph, [hazard], new Set(), 5);
    expect(crashEvents(beforeRepair)).toHaveLength(1);

    expect(isHazardActive(hazard, 5, new Set([0]))).toBe(false); // placementIndex 0 repaired
    expect(detectHazardCrashes([train], graph, [hazard], new Set([0]), 5)).toHaveLength(0);
  });

  it('emits PieceRepaired on the correct Delivered event (engineer, matching repairStationId)', () => {
    const hazard: Hazard = { kind: 'brokenPiece', placementIndex: 3, repairStationId: 'repairStation' };
    const passengers: Passenger[] = [
      { id: 'eng1', persona: 'engineer', from: 'depot', to: 'repairStation' },
      { id: 'kid1', persona: 'kid', from: 'depot', to: 'repairStation' }, // wrong persona
    ];

    const correctDelivery: SimEvent = {
      tick: 42,
      type: 'Delivered',
      passengerId: 'eng1',
      trainId: 't1',
      stationId: 'repairStation',
    };
    const repairs = detectRepairs([correctDelivery], [hazard], passengers, new Set(), 42);
    expect(repairs).toEqual([{ tick: 42, type: 'PieceRepaired', placementIndex: 3, byPassengerId: 'eng1' }]);
  });

  it('does NOT repair on a non-engineer delivery, a delivery to the wrong station, or if already repaired', () => {
    const hazard: Hazard = { kind: 'brokenPiece', placementIndex: 3, repairStationId: 'repairStation' };
    const passengers: Passenger[] = [
      { id: 'eng1', persona: 'engineer', from: 'depot', to: 'repairStation' },
      { id: 'kid1', persona: 'kid', from: 'depot', to: 'repairStation' },
    ];

    const wrongPersona: SimEvent = {
      tick: 10,
      type: 'Delivered',
      passengerId: 'kid1',
      trainId: 't1',
      stationId: 'repairStation',
    };
    expect(detectRepairs([wrongPersona], [hazard], passengers, new Set(), 10)).toHaveLength(0);

    const wrongStation: SimEvent = {
      tick: 11,
      type: 'Delivered',
      passengerId: 'eng1',
      trainId: 't1',
      stationId: 'some-other-station',
    };
    expect(detectRepairs([wrongStation], [hazard], passengers, new Set(), 11)).toHaveLength(0);

    const correctDelivery: SimEvent = {
      tick: 12,
      type: 'Delivered',
      passengerId: 'eng1',
      trainId: 't1',
      stationId: 'repairStation',
    };
    // already repaired — no duplicate PieceRepaired
    expect(detectRepairs([correctDelivery], [hazard], passengers, new Set([3]), 12)).toHaveLength(0);
  });

  it('detectRepairs only looks at the tick events it is given, not a whole log', () => {
    const hazard: Hazard = { kind: 'brokenPiece', placementIndex: 3, repairStationId: 'repairStation' };
    const passengers: Passenger[] = [{ id: 'eng1', persona: 'engineer', from: 'depot', to: 'repairStation' }];
    const nonDeliveryEvent: SimEvent = { tick: 5, type: 'ArrivedDepot', trainId: 't1' };
    expect(detectRepairs([nonDeliveryEvent], [hazard], passengers, new Set(), 5)).toHaveLength(0);
  });
});
