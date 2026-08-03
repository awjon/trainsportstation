// Scoring (docs/30 §8). HEADLESS and pure — the same functions score a live run, a replay, the
// editor's playtest, and the CI content gate, so all four can never disagree.
//
//   ★1 Complete  — every required passenger delivered AND no train destroyed
//   ★2 Efficient — ★1 and piecesPlaced ≤ pieceBudget
//   ★3 Swift     — ★1 and the last required delivery ≤ timeTargetTicks
//
// ★2 and ★3 are independently earnable (Nintendo-style: you can hold 1 and 3 without 2), and
// the speed bet moves Connections only — never stars.

import type { SimEvent } from './events';
import { deliveryValue, type QuirkContext } from './personas';
import type { SpeedBet } from '../train/types';

export const BET_CONNECTION_MULTIPLIER: Record<SpeedBet, number> = {
  steady: 1.0,
  swift: 1.25,
  ludicrous: 1.5,
};

export const NO_CRASH_BONUS = 1.1;
export const OPTIONAL_STATION_BONUS = 5;
export const UNUSED_PIECE_BONUS = 1;

export interface SimResult {
  outcome: 'complete' | 'failed';
  finalTick: number;
  /** tick of the last *required* delivery, or null if some are still outstanding */
  lastRequiredDeliveryTick: number | null;
  events: SimEvent[];
  piecesPlaced: number;
  unusedTrayPieces: number;
  optionalStationsServed: number;
  speedBet: SpeedBet;
  /** passenger ids that had to be delivered */
  requiredPassengerIds: string[];
}

export interface StarTargets {
  pieceBudget: number;
  timeTargetTicks: number;
}

export function hasCrashed(events: readonly SimEvent[]): boolean {
  return events.some((e) => e.type === 'Crashed');
}

export function allRequiredDelivered(result: SimResult): boolean {
  const delivered = new Set(
    result.events
      .filter((e) => e.type === 'Delivered')
      .map((e) => (e as { passengerId: string }).passengerId),
  );
  return result.requiredPassengerIds.every((id) => delivered.has(id));
}

/** Which of the three stars were earned, independently. */
export function starBreakdown(
  result: SimResult,
  targets: StarTargets,
): { complete: boolean; efficient: boolean; swift: boolean } {
  const complete = allRequiredDelivered(result) && !hasCrashed(result.events);
  return {
    complete,
    efficient: complete && result.piecesPlaced <= targets.pieceBudget,
    swift:
      complete &&
      result.lastRequiredDeliveryTick !== null &&
      result.lastRequiredDeliveryTick <= targets.timeTargetTicks,
  };
}

export function computeStars(result: SimResult, targets: StarTargets): 0 | 1 | 2 | 3 {
  const { complete, efficient, swift } = starBreakdown(result, targets);
  if (!complete) return 0;
  return (1 + (efficient ? 1 : 0) + (swift ? 1 : 0)) as 1 | 2 | 3;
}

/**
 * Connections earned (docs/30 §8). Persona values are summed, multiplied by the speed bet and
 * the no-crash bonus, then the flat bonuses are added — the ordering matters and is pinned by
 * the worked examples in docs/20 §3.1.
 */
export function computeConnections(result: SimResult, ctx: QuirkContext): number {
  const delivered = result.events.filter((e) => e.type === 'Delivered') as Array<
    Extract<SimEvent, { type: 'Delivered' }>
  >;

  const personaTotal = delivered.reduce((sum, d) => sum + deliveryValue(d.passengerId, ctx), 0);
  const multiplied =
    personaTotal *
    BET_CONNECTION_MULTIPLIER[result.speedBet] *
    (hasCrashed(result.events) ? 1 : NO_CRASH_BONUS);

  return Math.floor(
    multiplied +
      OPTIONAL_STATION_BONUS * result.optionalStationsServed +
      UNUSED_PIECE_BONUS * result.unusedTrayPieces,
  );
}
