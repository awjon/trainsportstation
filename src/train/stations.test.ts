// M4.4 tests (docs/70; docs/30 §7.5): golden trace (arrival + exchange -> 90-tick dwell ->
// departure) hand-computed tick by tick, capacity respected, and the boarding eligibility filter
// (not already boarded/delivered elsewhere).

import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../track/graph';
import type { PieceType } from '../track/pieces';
import type { Passenger } from '../scenarios/types';
import type { SimEvent } from '../simulation/events';
import type { TrainState, CarriageState } from './types';
import { PHYSICS } from './physics-constants';
import { stepTrainAtStations } from './stations';

const noSwitches = new Map<number, 0 | 1>();
const pieceTypeOf = (): PieceType => 'straight';

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

/** graph: straight(0,0) -> straight(0,1) [the station edge, '1:0:f'] -> straight(0,2). */
function stationFixture(): { graph: TrackGraph; stationOf: (edgeId: string) => string | null } {
  const graph = new TrackGraph();
  graph.addPlacement(0, { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });
  graph.addPlacement(1, { piece: 'straight', cell: { x: 0, z: 1 }, rotation: 0 });
  graph.addPlacement(2, { piece: 'straight', cell: { x: 0, z: 2 }, rotation: 0 });
  const stationOf = (edgeId: string): string | null => (edgeId === '1:0:f' ? 'stationA' : null);
  return { graph, stationOf };
}

function crashless(events: SimEvent[]): void {
  expect(events.every((e) => e.type !== 'Crashed')).toBe(true);
}

describe('stepTrainAtStations: golden trace (arrival -> exchange -> 90-tick dwell -> departure)', () => {
  it('matches hand computation for the full sequence', () => {
    const { graph, stationOf } = stationFixture();
    const edge = graph.edges.get('1:0:f')!;
    const midpoint = edge.length / 2; // L_STRAIGHT/2 = 1.0

    const passengers: Passenger[] = [
      { id: 'p_old', persona: 'commuter', from: 'depot', to: 'stationA' }, // delivered here
      { id: 'p_new', persona: 'commuter', from: 'stationA', to: 'depot' }, // boards here
    ];
    const boarded = new Set(['p_old']); // already riding
    const delivered = new Set<string>(); // nobody finished yet

    const carriages: CarriageState[] = [
      { personaId: 'p_old', offset: 0.55 },
      { personaId: null, offset: 1.1 },
    ];

    // --- arrival tick: s just below the midpoint, v high enough that this tick's predicted
    // motion crosses it (hand-verified: updateVelocity(2.0, grade=0, 'steady', 1/60) ~= 2.0307;
    // predictedS = (midpoint-0.01) + 2.0307/60 ~= 1.0238 >= midpoint).
    const dt = 1 / 60;
    const arrivalTick = 100;
    const preArrival = makeTrain({
      edgeId: '1:0:f',
      s: midpoint - 0.01,
      v: 2.0,
      carriages,
    });

    const arrival = stepTrainAtStations(
      preArrival,
      graph,
      pieceTypeOf,
      stationOf,
      passengers,
      boarded,
      delivered,
      noSwitches,
      'steady',
      dt,
      arrivalTick,
    );

    expect(arrival.state.s).toBeCloseTo(midpoint, 9);
    expect(arrival.state.v).toBe(0);
    expect(arrival.state.dwellTicksRemaining).toBe(PHYSICS.dwellTicks);
    // delivery frees carriage 0; boarding then fills the first empty carriage in index order —
    // that's the just-freed carriage 0, not carriage 1 (which was already empty and stays so,
    // since there's only one waiting passenger).
    expect(arrival.state.carriages[0].personaId).toBe('p_new');
    expect(arrival.state.carriages[1].personaId).toBeNull();
    expect(arrival.events).toEqual([
      { tick: arrivalTick, type: 'Delivered', passengerId: 'p_old', trainId: 't1', stationId: 'stationA' },
      {
        tick: arrivalTick,
        type: 'PassengerBoarded',
        passengerId: 'p_new',
        trainId: 't1',
        stationId: 'stationA',
      },
    ]);

    // --- 90 dwell ticks: hold position, decrement, no events, every single tick ---
    let train = arrival.state;
    for (let i = 1; i <= PHYSICS.dwellTicks; i++) {
      const tick = arrivalTick + i;
      const result = stepTrainAtStations(
        train,
        graph,
        pieceTypeOf,
        stationOf,
        passengers,
        boarded,
        delivered,
        noSwitches,
        'steady',
        dt,
        tick,
      );
      train = result.state;
      expect(train.v).toBe(0);
      expect(train.s).toBeCloseTo(midpoint, 9);
      expect(train.dwellTicksRemaining).toBe(PHYSICS.dwellTicks - i);
      expect(result.events).toHaveLength(0);
    }
    expect(train.dwellTicksRemaining).toBe(0);

    // --- departure tick: dwellTicksRemaining is now 0, so this call resumes real motion ---
    const departureTick = arrivalTick + PHYSICS.dwellTicks + 1;
    const departure = stepTrainAtStations(
      train,
      graph,
      pieceTypeOf,
      stationOf,
      passengers,
      boarded,
      delivered,
      noSwitches,
      'steady',
      dt,
      departureTick,
    );

    expect(departure.state.dwellTicksRemaining).toBe(0);
    expect(departure.state.v).toBeGreaterThan(0); // accelerating away from a stop
    expect(departure.state.s).toBeGreaterThan(midpoint); // has moved forward from the stop
    expect(departure.events).toHaveLength(0); // no boarding/delivery/crash on departure
    crashless(departure.events);
  });
});

describe('stepTrainAtStations: capacity is respected', () => {
  it('boards only as many as there are empty carriage slots, in passenger-array order', () => {
    const { graph, stationOf } = stationFixture();
    const edge = graph.edges.get('1:0:f')!;
    const midpoint = edge.length / 2;

    const passengers: Passenger[] = [
      { id: 'p1', persona: 'commuter', from: 'stationA', to: 'depot' },
      { id: 'p2', persona: 'commuter', from: 'stationA', to: 'depot' },
      { id: 'p3', persona: 'commuter', from: 'stationA', to: 'depot' },
    ];
    const boarded = new Set<string>();
    const delivered = new Set<string>();

    const train = makeTrain({
      edgeId: '1:0:f',
      s: midpoint - 0.01,
      v: 2.0,
      carriages: [{ personaId: null, offset: 0.55 }], // exactly ONE empty seat
    });

    const result = stepTrainAtStations(
      train,
      graph,
      pieceTypeOf,
      stationOf,
      passengers,
      boarded,
      delivered,
      noSwitches,
      'steady',
      1 / 60,
      50,
    );

    // exactly one boarding event, for the FIRST passenger in array order — not silently dropped,
    // not double-boarded, and p2/p3 are simply left waiting (the caller's ledger, not this file's
    // job, still shows them as not-boarded).
    const boardEvents = result.events.filter((e) => e.type === 'PassengerBoarded');
    expect(boardEvents).toHaveLength(1);
    expect(boardEvents[0]).toMatchObject({ type: 'PassengerBoarded', passengerId: 'p1' });
    expect(result.state.carriages).toHaveLength(1);
    expect(result.state.carriages[0].personaId).toBe('p1');
  });

  it('skips waiting passengers already boarded elsewhere or already delivered', () => {
    const { graph, stationOf } = stationFixture();
    const edge = graph.edges.get('1:0:f')!;
    const midpoint = edge.length / 2;

    const passengers: Passenger[] = [
      { id: 'already-riding', persona: 'commuter', from: 'stationA', to: 'depot' },
      { id: 'already-delivered', persona: 'commuter', from: 'stationA', to: 'depot' },
      { id: 'eligible', persona: 'commuter', from: 'stationA', to: 'depot' },
    ];
    const boarded = new Set(['already-riding']); // riding some other train right now
    const delivered = new Set(['already-delivered']); // finished their trip already

    const train = makeTrain({
      edgeId: '1:0:f',
      s: midpoint - 0.01,
      v: 2.0,
      carriages: [
        { personaId: null, offset: 0.55 },
        { personaId: null, offset: 1.1 },
      ],
    });

    const result = stepTrainAtStations(
      train,
      graph,
      pieceTypeOf,
      stationOf,
      passengers,
      boarded,
      delivered,
      noSwitches,
      'steady',
      1 / 60,
      50,
    );

    const boardEvents = result.events.filter((e) => e.type === 'PassengerBoarded');
    expect(boardEvents).toHaveLength(1);
    expect(boardEvents[0]).toMatchObject({ type: 'PassengerBoarded', passengerId: 'eligible' });
  });
});

describe('stepTrainAtStations: non-station edges and non-crossing ticks are ordinary steps', () => {
  it('a train nowhere near a station edge just runs stepTrainPhysics normally', () => {
    const { graph, stationOf } = stationFixture();
    const train = makeTrain({ edgeId: '0:0:f', s: 0.5, v: 1.0 }); // placement 0, not the station edge

    const result = stepTrainAtStations(
      train,
      graph,
      pieceTypeOf,
      stationOf,
      [],
      new Set(),
      new Set(),
      noSwitches,
      'steady',
      1 / 60,
      1,
    );

    expect(result.state.dwellTicksRemaining).toBe(0);
    expect(result.state.v).toBeGreaterThan(0);
    crashless(result.events);
  });

  it('crashed trains are a no-op passthrough, even mid-dwell', () => {
    const { graph, stationOf } = stationFixture();
    const train = makeTrain({ edgeId: null, crashed: true, dwellTicksRemaining: 5 });

    const result = stepTrainAtStations(
      train,
      graph,
      pieceTypeOf,
      stationOf,
      [],
      new Set(),
      new Set(),
      noSwitches,
      'steady',
      1 / 60,
      1,
    );

    expect(result).toEqual({ state: train, events: [] });
  });
});
