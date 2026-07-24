// Stations, dwell, boarding (docs/30 §7.5, docs/40 §1, docs/70 M4.4). HEADLESS — zero
// three.js/render/camera/ui/effects/audio/DOM imports (docs/30 §2.1). Layers on top of
// train/physics.ts exactly the way physics.ts layers on top of movement.ts: this file calls
// `stepTrainPhysics` for every tick it isn't itself intercepting for a station stop.
//
// --- a station is a graph fact this file doesn't build ---
// A station (docs/40 §1) is `{id, cell, orientation, optional?, name?}` — structurally just a
// straight-through 2-port piece at a fixed cell (docs/30 §5). Wiring that into the TrackGraph as
// a real edge is a future milestone's job (M5's scenario-to-TrackGraph builder); this file only
// needs to know WHICH edge (if any) is a given station, which it takes as a resolver — the same
// `pieceTypeOf`-style callback pattern used throughout M4.2/M4.3, not a capability this file
// builds itself:
//   stationOf: (edgeId: string) => string | null
//
// --- dwell trigger: the same threshold-crossing shape as M4.3's jump/dead-end triggers ---
// "Decelerates to a stop at its midpoint" (docs/30 §7.5) is deliberately NOT modeled as gradual
// braking (docs/70 M4.4 authorizes the same simplification precedent as M4.3's jump-launch
// clamp): the tick this train's predicted motion would cross the edge's midpoint for the first
// time (`train.s < mid && predictedS >= mid`), snap to a stop there instead. Like the jump/dead-
// end triggers, this can only fire once per edge occupancy (`s` only increases while on an edge),
// so no extra "have I already stopped here" flag is needed beyond the crossing condition itself.
//
// --- personaId interpretation (docs/70 M4.4's call, flagged here per that task's own request) ---
// `CarriageState.personaId: string | null` — docs/30 §4's own comment says "who (if anyone) rides
// it." Nothing before this file populated or read it. This file treats it as the specific
// `Passenger.id` (not `Passenger.persona`, despite the field's name) — the only reading under
// which boarding/delivery can match a carriage's occupant against `Passenger.from`/`to` at all.
// No friction found while writing the matching logic below; if a future milestone wants a genuine
// "persona type" on a carriage too, that's a distinct, new field, not a reinterpretation of this
// one (docs/30 §4: renames aren't allowed, only additions).

import type { Tick } from '../core/types';
import type { PieceType } from '../track/pieces';
import type { TrackGraph } from '../track/graph';
import type { Passenger } from '../scenarios/types';
import type { SimEvent } from '../simulation/events';
import type { CarriageState, TrainState } from './types';
import { PHYSICS, type SpeedBet } from './physics-constants';
import { updateVelocity } from './movement';
import { stepTrainPhysics } from './physics';

export interface StationStepResult {
  /** New state — stepTrainAtStations is a pure function; the input TrainState is never mutated. */
  state: TrainState;
  events: SimEvent[];
}

/**
 * Passenger exchange at dwell start (docs/30 §7.5), capacity = `train.carriages.length` (one
 * passenger per carriage slot): deliver first (frees carriages), then board into whatever's now
 * empty, in `passengers` array order, filling carriages in index order. `boarded`/`delivered` are
 * caller-owned ledgers (same pattern as `detectCollisions`'s crashed-flagging in physics.ts) — a
 * real sim needs to track these across ALL trains/stations at once, not just one train's own
 * state, so they can't live on `TrainState`. This function only READS them; the caller updates
 * them from the returned events (see module report / `StationStepResult` doc).
 */
function exchangePassengers(
  carriages: CarriageState[],
  stationId: string,
  trainId: string,
  passengers: Passenger[],
  boarded: ReadonlySet<string>,
  delivered: ReadonlySet<string>,
  tick: Tick,
): { carriages: CarriageState[]; events: SimEvent[] } {
  const next = carriages.map((c) => ({ ...c })); // never mutate the caller's carriages
  const events: SimEvent[] = [];

  // 1. delivery — any carriage whose passenger's `to` is this station gets off.
  for (const carriage of next) {
    if (carriage.personaId === null) continue;
    const passenger = passengers.find((p) => p.id === carriage.personaId);
    if (passenger && passenger.to === stationId) {
      events.push({ tick, type: 'Delivered', passengerId: passenger.id, trainId, stationId });
      carriage.personaId = null;
    }
  }

  // 2. boarding — waiting passengers whose `from` is this station, not already riding (`boarded`)
  // or already finished (`delivered`) anywhere, fill empty carriages (INCLUDING ones step 1 just
  // freed) in passenger-array order, one per carriage, in carriage-index order.
  const waiting = passengers.filter(
    (p) => p.from === stationId && !boarded.has(p.id) && !delivered.has(p.id),
  );
  let nextWaiting = 0;
  for (const carriage of next) {
    if (carriage.personaId !== null) continue;
    if (nextWaiting >= waiting.length) break; // no more waiting passengers — empty seats stay empty
    const passenger = waiting[nextWaiting];
    nextWaiting += 1;
    carriage.personaId = passenger.id;
    events.push({ tick, type: 'PassengerBoarded', passengerId: passenger.id, trainId, stationId });
  }

  return { carriages: next, events };
}

/**
 * One tick of station dwell/board/deliver logic for a single train, layered on top of
 * `stepTrainPhysics` (docs/30 §7.5). Order per tick:
 *  1. Crashed -> no-op (same posture as `stepTrainPhysics`).
 *  2. Already dwelling (`dwellTicksRemaining > 0`) -> hold (`v=0`, `s` unchanged), decrement,
 *     no events, no call into `stepTrainPhysics` at all this tick.
 *  3. Not dwelling, on rails, and this tick's predicted motion would cross a station edge's
 *     midpoint for the first time -> snap to a stop there, exchange passengers, start the dwell
 *     timer (`dwellTicksRemaining = PHYSICS.dwellTicks`).
 *  4. Otherwise -> a normal tick, delegated entirely to `stepTrainPhysics`.
 *
 * Tick accounting (spelled out since "dwells 90 ticks" has more than one plausible reading): the
 * arrival tick (step 3) is the instantaneous "dwell start" — snap + exchange happen there, but
 * `dwellTicksRemaining` is only SET that tick, not yet decremented. Each of the 90 SUBSEQUENT
 * ticks (step 2) decrements it once (90 -> 89 -> ... -> 0); the first tick this function sees
 * `dwellTicksRemaining === 0` again, it falls through to step 4 and resumes real motion. So the
 * train is held stationary for 91 total ticks (the arrival tick + 90 dwell ticks), with exactly
 * `PHYSICS.dwellTicks` (90) of those being the "hold and decrement" kind step 2 describes.
 */
export function stepTrainAtStations(
  train: TrainState,
  graph: TrackGraph,
  pieceTypeOf: (placementIndex: number) => PieceType,
  stationOf: (edgeId: string) => string | null,
  passengers: Passenger[],
  boarded: ReadonlySet<string>,
  delivered: ReadonlySet<string>,
  switchStates: ReadonlyMap<number, 0 | 1>,
  speedBet: SpeedBet,
  dt: number,
  tick: Tick,
): StationStepResult {
  if (train.crashed) return { state: train, events: [] };

  // Step 2: already dwelling — hold, decrement, nothing else happens this tick.
  if (train.dwellTicksRemaining > 0) {
    return {
      state: { ...train, v: 0, dwellTicksRemaining: train.dwellTicksRemaining - 1 },
      events: [],
    };
  }

  // Step 3: not dwelling — check whether this tick's motion would cross a station edge's
  // midpoint for the first time (airborne/edgeless trains can't be "at" a station edge at all).
  if (train.edgeId !== null && train.airborne === null) {
    const edge = graph.edges.get(train.edgeId);
    const stationId = edge ? stationOf(edge.id) : null;

    if (edge && stationId !== null) {
      const midpoint = edge.length / 2;
      const predictedV = updateVelocity(train.v, edge.grade, speedBet, dt);
      const predictedS = train.s + predictedV * dt;

      if (train.s < midpoint && predictedS >= midpoint) {
        const { carriages, events } = exchangePassengers(
          train.carriages,
          stationId,
          train.id,
          passengers,
          boarded,
          delivered,
          tick,
        );
        return {
          state: {
            ...train,
            s: midpoint,
            v: 0,
            carriages,
            dwellTicksRemaining: PHYSICS.dwellTicks,
          },
          events,
        };
      }
    }
  }

  // Step 4: a normal tick — entirely delegated to stepTrainPhysics (jumps/derails/dead-ends all
  // still apply to a train that isn't currently intercepted for a station stop).
  const result = stepTrainPhysics(train, graph, pieceTypeOf, switchStates, speedBet, dt, tick);
  return { state: result.state, events: result.events };
}
