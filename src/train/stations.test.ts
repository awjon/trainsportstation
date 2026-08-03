// M4.4 tests (docs/70): the board/deliver event sequence against a golden trace, seat
// capacity, and all three hazard kinds.

import { describe, expect, it } from 'vitest';
import {
  allRequiredDelivered,
  freeSeats,
  initStations,
  stepStation,
  type Passenger,
  type Station,
} from './stations';
import { PHYSICS, makeTrain } from './types';
import {
  initHazards,
  isCellBlocked,
  isPieceBroken,
  repairOnDelivery,
  ticksUntilOpen,
  type Hazard,
} from '../simulation/hazards';

const depot: Station = { id: 'depot', edgeId: 'e0' };
const town: Station = { id: 'town', edgeId: 'e1' };

describe('boarding and delivery', () => {
  it('golden trace: board at the origin, deliver at the destination', () => {
    const passengers: Passenger[] = [{ id: 'p1', persona: 'commuter', from: 'depot', to: 'town' }];
    const state = initStations(passengers);
    const train = makeTrain('t1', 'e0', 1);
    train.s = 0.5;

    // tick 0 — at the depot: p1 boards, dwell starts
    const boarding = stepStation(train, depot, state, passengers, 0);
    expect(boarding).toEqual([
      { tick: 0, type: 'PassengerBoarded', passengerId: 'p1', trainId: 't1', stationId: 'depot' },
    ]);
    expect(train.dwellTicks).toBe(PHYSICS.station.dwellTicks);
    expect(train.v).toBe(0);
    expect(freeSeats(train)).toBe(0);

    // dwelling — no further events, train held at a stop
    for (let t = 1; t <= PHYSICS.station.dwellTicks; t++) {
      expect(stepStation(train, depot, state, passengers, t)).toEqual([]);
    }
    expect(train.dwellTicks).toBe(0);

    // arrives at the town: p1 is delivered
    train.edgeId = 'e1';
    const arriving = stepStation(train, town, state, passengers, 200);
    expect(arriving).toEqual([
      { tick: 200, type: 'Delivered', passengerId: 'p1', trainId: 't1', stationId: 'town' },
    ]);
    expect(state.delivered.has('p1')).toBe(true);
    expect(freeSeats(train)).toBe(1);
    expect(allRequiredDelivered(passengers, state)).toBe(true);
  });

  it('capacity is the carriage count — extra passengers wait for the next trip', () => {
    const passengers: Passenger[] = [
      { id: 'a', persona: 'commuter', from: 'depot', to: 'town' },
      { id: 'b', persona: 'kid', from: 'depot', to: 'town' },
      { id: 'c', persona: 'kid', from: 'depot', to: 'town' },
    ];
    const state = initStations(passengers);
    const train = makeTrain('t1', 'e0', 2); // only two seats
    train.s = 0.5;
    const events = stepStation(train, depot, state, passengers, 0);
    expect(events.map((e) => 'passengerId' in e && e.passengerId)).toEqual(['a', 'b']);
    expect(state.waiting.get('depot')).toEqual(['c']); // c is left on the platform
  });

  it('a delivery frees a seat for a boarding in the same stop', () => {
    const passengers: Passenger[] = [
      { id: 'incoming', persona: 'commuter', from: 'depot', to: 'town' },
      { id: 'outgoing', persona: 'elder', from: 'town', to: 'depot' },
    ];
    const state = initStations(passengers);
    const train = makeTrain('t1', 'e1', 1); // single seat, occupied
    train.s = 0.5;
    train.carriages[0].personaId = 'incoming';
    state.riding.set('incoming', 't1');
    state.waiting.set('depot', []);

    const events = stepStation(train, town, state, passengers, 50);
    expect(events.map((e) => e.type)).toEqual(['Delivered', 'PassengerBoarded']);
    expect(train.carriages[0].personaId).toBe('outgoing');
  });

  it('does nothing at a station with no business there', () => {
    const passengers: Passenger[] = [{ id: 'p1', persona: 'commuter', from: 'depot', to: 'town' }];
    const state = initStations(passengers);
    const train = makeTrain('t1', 'e1', 1);
    train.s = 0.5;
    expect(stepStation(train, town, state, passengers, 5)).toEqual([]);
    expect(train.dwellTicks).toBe(0); // no pointless stop
  });

  it('a crashed train neither boards nor delivers', () => {
    const passengers: Passenger[] = [{ id: 'p1', persona: 'commuter', from: 'depot', to: 'town' }];
    const state = initStations(passengers);
    const train = makeTrain('t1', 'e0', 1);
    train.s = 0.5;
    train.crashed = 'collision';
    expect(stepStation(train, depot, state, passengers, 0)).toEqual([]);
  });

  it('optional passengers do not gate completion', () => {
    const passengers: Passenger[] = [
      { id: 'req', persona: 'commuter', from: 'depot', to: 'town' },
      { id: 'opt', persona: 'musician', from: 'depot', to: 'town', required: false },
    ];
    const state = initStations(passengers);
    state.delivered.add('req');
    expect(allRequiredDelivered(passengers, state)).toBe(true);
  });
});

describe('hazards', () => {
  it('rockfall blocks its cell only inside the window', () => {
    const hazards: Hazard[] = [{ kind: 'rockfall', cell: { x: 2, z: 3 }, fromTick: 100, toTick: 200 }];
    expect(isCellBlocked(hazards, { x: 2, z: 3 }, 99)).toBe(false);
    expect(isCellBlocked(hazards, { x: 2, z: 3 }, 100)).toBe(true);
    expect(isCellBlocked(hazards, { x: 2, z: 3 }, 200)).toBe(true);
    expect(isCellBlocked(hazards, { x: 2, z: 3 }, 201)).toBe(false);
    expect(isCellBlocked(hazards, { x: 0, z: 0 }, 150)).toBe(false); // different cell
  });

  it('crossingTraffic cycles open then blocked, forever', () => {
    const hazards: Hazard[] = [
      { kind: 'crossingTraffic', cell: { x: 4, z: 5 }, periodTicks: 480, openTicks: 300 },
    ];
    const at = (t: number) => isCellBlocked(hazards, { x: 4, z: 5 }, t);
    expect(at(0)).toBe(false); // open
    expect(at(299)).toBe(false);
    expect(at(300)).toBe(true); // gates down
    expect(at(479)).toBe(true);
    expect(at(480)).toBe(false); // next cycle opens
    expect(at(480 * 3 + 350)).toBe(true); // still cycling much later
  });

  it('ticksUntilOpen counts down to the next opening', () => {
    const hazards: Hazard[] = [
      { kind: 'crossingTraffic', cell: { x: 1, z: 1 }, periodTicks: 100, openTicks: 60 },
    ];
    expect(ticksUntilOpen(hazards, { x: 1, z: 1 }, 10)).toBe(0); // already open
    expect(ticksUntilOpen(hazards, { x: 1, z: 1 }, 60)).toBe(40);
    expect(ticksUntilOpen(hazards, { x: 1, z: 1 }, 99)).toBe(1);
    expect(ticksUntilOpen(hazards, { x: 9, z: 9 }, 0)).toBeNull(); // no such hazard
  });

  it('brokenPiece stays broken until an Engineer is delivered to its station', () => {
    const hazards: Hazard[] = [{ kind: 'brokenPiece', placementIndex: 3, repairStationId: 'harrowgate' }];
    const state = initHazards();
    expect(isPieceBroken(hazards, state, 3)).toBe(true);

    // a commuter arriving changes nothing
    expect(repairOnDelivery(hazards, state, 'harrowgate', 'p1', 'commuter', 10)).toEqual([]);
    expect(isPieceBroken(hazards, state, 3)).toBe(true);

    // an engineer at the wrong station changes nothing
    expect(repairOnDelivery(hazards, state, 'eastbank', 'eng1', 'engineer', 20)).toEqual([]);
    expect(isPieceBroken(hazards, state, 3)).toBe(true);

    // the engineer arrives where they're needed
    expect(repairOnDelivery(hazards, state, 'harrowgate', 'eng1', 'engineer', 30)).toEqual([
      { tick: 30, type: 'PieceRepaired', placementIndex: 3, byPassengerId: 'eng1' },
    ]);
    expect(isPieceBroken(hazards, state, 3)).toBe(false);
  });

  it('repairing twice does not emit a second event', () => {
    const hazards: Hazard[] = [{ kind: 'brokenPiece', placementIndex: 0, repairStationId: 's' }];
    const state = initHazards();
    expect(repairOnDelivery(hazards, state, 's', 'e1', 'engineer', 1)).toHaveLength(1);
    expect(repairOnDelivery(hazards, state, 's', 'e2', 'engineer', 2)).toHaveLength(0);
  });

  it('an unrelated placement is never broken', () => {
    const hazards: Hazard[] = [{ kind: 'brokenPiece', placementIndex: 3, repairStationId: 's' }];
    expect(isPieceBroken(hazards, initHazards(), 4)).toBe(false);
  });
});
