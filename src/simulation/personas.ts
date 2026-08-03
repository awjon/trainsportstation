// Persona quirks (docs/20 §3). HEADLESS.
//
// Every quirk is a predicate over the SimEvent log — no vibes-based scoring. That is what makes
// them unit-testable from synthetic traces, and what lets the editor and the game agree on a
// score without re-running anything.

import personaData from '../../data/personas.json';
import type { SimEvent } from './events';
import type { SpeedBet } from '../train/types';

export interface PersonaDef {
  name: string;
  icon: string;
  carriage: string;
  baseValue: number;
}

export const PERSONAS: Record<string, PersonaDef> = personaData.personas as Record<string, PersonaDef>;
export const QUIRK_BONUS: number = personaData.quirkBonus;
export const KID_WINDOW_TICKS: number = personaData.kidArrivalWindowTicks;
export const MUSICIAN_RATIO: number = personaData.musicianScenicRatio;

/** Everything a quirk predicate is allowed to look at. */
export interface QuirkContext {
  events: readonly SimEvent[];
  speedBet: SpeedBet;
  /** persona id per passenger */
  personaOf: ReadonlyMap<string, string>;
  /** arc length actually travelled by each delivered passenger */
  travelledBy?: ReadonlyMap<string, number>;
  /** shortest possible route length between each passenger's stations */
  shortestBy?: ReadonlyMap<string, number>;
  /** doctor deadlines */
  timeLimitBy?: ReadonlyMap<string, number>;
}

const deliveryOf = (events: readonly SimEvent[], passengerId: string) =>
  events.find((e) => e.type === 'Delivered' && e.passengerId === passengerId) as
    Extract<SimEvent, { type: 'Delivered' }> | undefined;

const boardingOf = (events: readonly SimEvent[], passengerId: string) =>
  events.find((e) => e.type === 'PassengerBoarded' && e.passengerId === passengerId) as
    Extract<SimEvent, { type: 'PassengerBoarded' }> | undefined;

/**
 * Was this passenger's quirk satisfied? Unknown personas (and undelivered passengers) simply
 * score their base value.
 */
export function quirkSatisfied(passengerId: string, ctx: QuirkContext): boolean {
  const persona = ctx.personaOf.get(passengerId);
  const delivery = deliveryOf(ctx.events, passengerId);
  if (!persona || !delivery) return false;

  switch (persona) {
    case 'commuter':
      return false; // the baseline — no quirk to satisfy

    case 'kid': {
      // every kid must arrive within the same window (a lone kid trivially qualifies)
      const kidTicks = [...ctx.personaOf.entries()]
        .filter(([, p]) => p === 'kid')
        .map(([id]) => deliveryOf(ctx.events, id)?.tick)
        .filter((t): t is number => t !== undefined);
      if (kidTicks.length === 0) return false;
      return Math.max(...kidTicks) - Math.min(...kidTicks) <= KID_WINDOW_TICKS;
    }

    case 'elder': {
      // a smooth ride: no airtime while aboard, and never at Ludicrous
      if (ctx.speedBet === 'ludicrous') return false;
      const boarded = boardingOf(ctx.events, passengerId);
      if (!boarded) return false;
      const airborneWhileAboard = ctx.events.some(
        (e) =>
          e.type === 'Airtime' &&
          e.trainId === boarded.trainId &&
          e.tick >= boarded.tick &&
          e.tick <= delivery.tick,
      );
      return !airborneWhileAboard;
    }

    case 'musician': {
      // enjoys the scenic route
      const travelled = ctx.travelledBy?.get(passengerId);
      const shortest = ctx.shortestBy?.get(passengerId);
      if (travelled === undefined || shortest === undefined || shortest <= 0) return false;
      return travelled >= MUSICIAN_RATIO * shortest;
    }

    case 'doctor': {
      const limit = ctx.timeLimitBy?.get(passengerId);
      if (limit === undefined) return false;
      return delivery.tick <= limit;
    }

    case 'engineer': {
      // delivering them repaired something
      return ctx.events.some((e) => e.type === 'PieceRepaired' && e.byPassengerId === passengerId);
    }

    default:
      return false;
  }
}

/** Connections a single delivery is worth, before run-wide multipliers. */
export function deliveryValue(passengerId: string, ctx: QuirkContext): number {
  const persona = ctx.personaOf.get(passengerId);
  const def = persona ? PERSONAS[persona] : undefined;
  if (!def) return 0;
  return def.baseValue * (quirkSatisfied(passengerId, ctx) ? QUIRK_BONUS : 1);
}
