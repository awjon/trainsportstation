// Stations, boarding and delivery (docs/30 §7.5, docs/70 M4.4). HEADLESS.
//
// A train entering a station edge brakes to a stop at its midpoint, dwells, exchanges
// passengers at the moment the dwell begins, then re-accelerates. Capacity is the number of
// carriages, so a two-carriage train carries two people.

import type { SimEvent, Tick } from '../simulation/events';
import type { TrainState } from './types';
import { PHYSICS } from './types';

export interface Station {
  id: string;
  /** the graph edge the platform sits on */
  edgeId: string;
  optional?: boolean;
}

export interface Passenger {
  id: string;
  persona: string;
  from: string; // station id
  to: string; // station id
  required?: boolean;
  timeLimitTicks?: number;
}

export interface StationState {
  /** passengers still waiting on each platform, by station id */
  waiting: Map<string, string[]>;
  /** passengers already delivered */
  delivered: Set<string>;
  /** which train each in-transit passenger is riding */
  riding: Map<string, string>;
}

export function initStations(passengers: Passenger[]): StationState {
  const waiting = new Map<string, string[]>();
  for (const p of passengers) {
    const list = waiting.get(p.from) ?? [];
    list.push(p.id);
    waiting.set(p.from, list);
  }
  return { waiting, delivered: new Set(), riding: new Map() };
}

/** Free carriage seats on a train. */
export function freeSeats(train: TrainState): number {
  return train.carriages.filter((c) => c.personaId === null).length;
}

/**
 * Run one tick of station logic for a train. Returns the events it produced.
 *
 * Ordering is fixed and deterministic: deliveries happen before boardings (so a passenger
 * getting off frees a seat for someone getting on), and passengers board in the order they
 * were listed in the scenario.
 */
export function stepStation(
  train: TrainState,
  station: Station | null,
  state: StationState,
  passengers: Passenger[],
  tick: Tick,
): SimEvent[] {
  const events: SimEvent[] = [];

  // already dwelling: count down, stay stopped
  if (train.dwellTicks > 0) {
    train.dwellTicks--;
    train.v = 0;
    return events;
  }
  if (!station || train.crashed || train.edgeId === null) return events;
  if (train.edgeId !== station.edgeId) return events;

  // only trigger once the train reaches the platform midpoint
  const midpointReached = train.s >= PHYSICS.station.stopTolerance;
  if (!midpointReached) return events;

  const byId = new Map(passengers.map((p) => [p.id, p]));

  // 1. deliveries — anyone aboard whose destination is this station
  for (const carriage of train.carriages) {
    const id = carriage.personaId;
    if (!id) continue;
    const p = byId.get(id);
    if (!p || p.to !== station.id) continue;
    carriage.personaId = null;
    state.riding.delete(id);
    state.delivered.add(id);
    events.push({ tick, type: 'Delivered', passengerId: id, trainId: train.id, stationId: station.id });
  }

  // 2. boardings — waiting passengers fill free seats in scenario order
  const queue = state.waiting.get(station.id) ?? [];
  while (queue.length > 0 && freeSeats(train) > 0) {
    const id = queue.shift()!;
    const seat = train.carriages.find((c) => c.personaId === null)!;
    seat.personaId = id;
    state.riding.set(id, train.id);
    events.push({
      tick,
      type: 'PassengerBoarded',
      passengerId: id,
      trainId: train.id,
      stationId: station.id,
    });
  }
  state.waiting.set(station.id, queue);

  // 3. dwell — but only if something actually happened here
  if (events.length > 0) {
    train.dwellTicks = PHYSICS.station.dwellTicks;
    train.v = 0;
  }
  return events;
}

/** Every required passenger delivered? (star 1's first half — docs/30 §8) */
export function allRequiredDelivered(passengers: Passenger[], state: StationState): boolean {
  return passengers.filter((p) => p.required !== false).every((p) => state.delivered.has(p.id));
}
