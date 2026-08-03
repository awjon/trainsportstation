// The SimEvent log (docs/30 §4). Scoring, persona quirks, and the crash gags all read from
// this log — it is the complete record of what happened in a run, and nothing else is needed
// to compute a result.

import type { CrashCause, SpeedBet } from '../train/types';
import type { CellCoord } from '../track/pieces';

export type Tick = number;

export type SimEvent =
  | { tick: Tick; type: 'Dispatched'; trainId: string; speedBet: SpeedBet }
  | { tick: Tick; type: 'PassengerBoarded'; passengerId: string; trainId: string; stationId: string }
  | { tick: Tick; type: 'Delivered'; passengerId: string; trainId: string; stationId: string }
  | { tick: Tick; type: 'Airtime'; trainId: string; durationTicks: number }
  | { tick: Tick; type: 'SwitchFlipped'; placementIndex: number; state: 0 | 1 }
  | { tick: Tick; type: 'PieceRepaired'; placementIndex: number; byPassengerId: string }
  | { tick: Tick; type: 'Crashed'; trainId: string; cause: CrashCause; cell: CellCoord }
  | { tick: Tick; type: 'ArrivedDepot'; trainId: string };

export type SimEventType = SimEvent['type'];

/** Narrow a log to one event type — the shape every scoring/quirk predicate starts from. */
export function eventsOfType<T extends SimEventType>(
  log: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return log.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
}
