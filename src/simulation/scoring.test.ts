// M5.3 tests (docs/70): SC-1 — computeStars/computeConnections must reproduce the six worked
// examples in docs/20 §3.1 exactly — plus each persona quirk from a synthetic trace, and the
// bet-sweep invariant (the speed bet never changes stars).

import { describe, expect, it } from 'vitest';
import type { SimEvent } from './events';
import { computeConnections, computeStars, starBreakdown, type SimResult, type StarTargets } from './scoring';
import { quirkSatisfied, type QuirkContext } from './personas';
import type { SpeedBet } from '../train/types';

const targets: StarTargets = { pieceBudget: 4, timeTargetTicks: 1500 };

function delivered(passengerId: string, tick: number, trainId = 't1'): SimEvent {
  return { tick, type: 'Delivered', passengerId, trainId, stationId: 'end' };
}
function boarded(passengerId: string, tick: number, trainId = 't1'): SimEvent {
  return { tick, type: 'PassengerBoarded', passengerId, trainId, stationId: 'start' };
}

function result(over: Partial<SimResult> = {}): SimResult {
  return {
    outcome: 'complete',
    finalTick: 1200,
    lastRequiredDeliveryTick: 1210,
    events: [],
    piecesPlaced: 4,
    unusedTrayPieces: 0,
    optionalStationsServed: 0,
    speedBet: 'steady',
    requiredPassengerIds: [],
    ...over,
  };
}

function ctx(personaOf: Record<string, string>, over: Partial<QuirkContext> = {}): QuirkContext {
  return {
    events: [],
    speedBet: 'steady',
    personaOf: new Map(Object.entries(personaOf)),
    ...over,
  };
}

describe('SC-1: worked examples from docs/20 §3.1', () => {
  it('E1 — commuter delivered on time, steady, no crash, 4/4 pieces, 2 unused → 3★, 13', () => {
    const events = [delivered('p1', 1210)];
    const r = result({
      events,
      lastRequiredDeliveryTick: 1210,
      unusedTrayPieces: 2,
      requiredPassengerIds: ['p1'],
    });
    expect(computeStars(r, targets)).toBe(3);
    expect(computeConnections(r, ctx({ p1: 'commuter' }, { events }))).toBe(13);
  });

  it('E2 — same run but delivered late → 2★ (complete + efficient), still 13', () => {
    const events = [delivered('p1', 1610)];
    const r = result({
      events,
      lastRequiredDeliveryTick: 1610,
      unusedTrayPieces: 2,
      requiredPassengerIds: ['p1'],
    });
    expect(computeStars(r, targets)).toBe(2);
    expect(starBreakdown(r, targets)).toEqual({ complete: true, efficient: true, swift: false });
    expect(computeConnections(r, ctx({ p1: 'commuter' }, { events }))).toBe(13);
  });

  it('E3 — elder, swift, smooth ride, no crash, 0 unused → 3★, 24', () => {
    const events = [boarded('e1', 100), delivered('e1', 1200)];
    const r = result({
      events,
      speedBet: 'swift',
      lastRequiredDeliveryTick: 1200,
      requiredPassengerIds: ['e1'],
    });
    expect(computeStars(r, targets)).toBe(3);
    expect(computeConnections(r, ctx({ e1: 'elder' }, { events, speedBet: 'swift' }))).toBe(24);
  });

  it('E4 — the same clean run at Ludicrous voids the elder quirk → still 3★, but only 19', () => {
    const events = [boarded('e1', 100), delivered('e1', 1200)];
    const r = result({
      events,
      speedBet: 'ludicrous',
      lastRequiredDeliveryTick: 1200,
      requiredPassengerIds: ['e1'],
    });
    expect(computeStars(r, targets)).toBe(3);
    expect(computeConnections(r, ctx({ e1: 'elder' }, { events, speedBet: 'ludicrous' }))).toBe(19);
    // greed costs more than it earns here — the point of the example
    expect(computeConnections(r, ctx({ e1: 'elder' }, { events, speedBet: 'ludicrous' }))).toBeLessThan(24);
  });

  it('E5 — a lone kid delivered but a train crashes → 0★, 15', () => {
    const events: SimEvent[] = [
      delivered('k1', 900),
      { tick: 1000, type: 'Crashed', trainId: 't2', cause: 'collision', cell: { x: 2, z: 2 } },
    ];
    const r = result({
      events,
      lastRequiredDeliveryTick: 900,
      unusedTrayPieces: 3,
      requiredPassengerIds: ['k1'],
    });
    expect(computeStars(r, targets)).toBe(0); // a crash voids ★1, and so everything
    expect(computeConnections(r, ctx({ k1: 'kid' }, { events }))).toBe(15);
  });

  it('E6 — commuter + scenic musician, one optional station → 3★, 32', () => {
    const events = [delivered('c1', 1100), delivered('m1', 1200)];
    const r = result({
      events,
      lastRequiredDeliveryTick: 1200,
      optionalStationsServed: 1,
      requiredPassengerIds: ['c1', 'm1'],
    });
    expect(computeStars(r, targets)).toBe(3);
    const c = ctx(
      { c1: 'commuter', m1: 'musician' },
      {
        events,
        travelledBy: new Map([['m1', 14]]),
        shortestBy: new Map([['m1', 10]]), // 1.4× the shortest route
      },
    );
    expect(computeConnections(r, c)).toBe(32);
  });
});

describe('stars', () => {
  it('★2 and ★3 are independently earnable', () => {
    const events = [delivered('p1', 100)];
    const overBudget = result({
      events,
      piecesPlaced: 99,
      lastRequiredDeliveryTick: 100,
      requiredPassengerIds: ['p1'],
    });
    expect(starBreakdown(overBudget, targets)).toEqual({ complete: true, efficient: false, swift: true });
    expect(computeStars(overBudget, targets)).toBe(2); // ★1 + ★3, no ★2
  });

  it('an undelivered required passenger means no stars at all', () => {
    const r = result({ events: [], lastRequiredDeliveryTick: null, requiredPassengerIds: ['p1'] });
    expect(computeStars(r, targets)).toBe(0);
  });

  it('optional passengers do not block completion', () => {
    const events = [delivered('req', 100)];
    const r = result({ events, lastRequiredDeliveryTick: 100, requiredPassengerIds: ['req'] });
    expect(computeStars(r, targets)).toBe(3); // 'opt' never delivered, but was never required
  });

  it('bet sweep: the same run scores identical stars under every speed bet', () => {
    const events = [delivered('p1', 800)];
    const bets: SpeedBet[] = ['steady', 'swift', 'ludicrous'];
    const stars = bets.map((speedBet) =>
      computeStars(
        result({ events, lastRequiredDeliveryTick: 800, requiredPassengerIds: ['p1'], speedBet }),
        targets,
      ),
    );
    expect(new Set(stars).size).toBe(1);
    // ...while Connections do move with the bet
    const conns = bets.map((speedBet) =>
      computeConnections(
        result({ events, lastRequiredDeliveryTick: 800, requiredPassengerIds: ['p1'], speedBet }),
        ctx({ p1: 'commuter' }, { events }),
      ),
    );
    expect(conns[0]).toBeLessThan(conns[1]);
    expect(conns[1]).toBeLessThan(conns[2]);
  });
});

describe('persona quirks', () => {
  it('commuter has no quirk to satisfy', () => {
    const events = [delivered('c', 10)];
    expect(quirkSatisfied('c', ctx({ c: 'commuter' }, { events }))).toBe(false);
  });

  it('kids must arrive within the window — together yes, strung out no', () => {
    const together = [delivered('k1', 100), delivered('k2', 400)];
    expect(quirkSatisfied('k1', ctx({ k1: 'kid', k2: 'kid' }, { events: together }))).toBe(true);

    const strungOut = [delivered('k1', 100), delivered('k2', 900)];
    expect(quirkSatisfied('k1', ctx({ k1: 'kid', k2: 'kid' }, { events: strungOut }))).toBe(false);
  });

  it('a lone kid trivially satisfies the window', () => {
    const events = [delivered('k1', 100)];
    expect(quirkSatisfied('k1', ctx({ k1: 'kid' }, { events }))).toBe(true);
  });

  it('elder: airtime while aboard voids it, airtime after delivery does not', () => {
    const base: SimEvent[] = [boarded('e', 100), delivered('e', 500)];
    expect(quirkSatisfied('e', ctx({ e: 'elder' }, { events: base }))).toBe(true);

    const bumped: SimEvent[] = [...base, { tick: 300, type: 'Airtime', trainId: 't1', durationTicks: 20 }];
    expect(quirkSatisfied('e', ctx({ e: 'elder' }, { events: bumped }))).toBe(false);

    const laterHop: SimEvent[] = [...base, { tick: 900, type: 'Airtime', trainId: 't1', durationTicks: 20 }];
    expect(quirkSatisfied('e', ctx({ e: 'elder' }, { events: laterHop }))).toBe(true);
  });

  it('elder: Ludicrous voids it even on a perfectly smooth ride', () => {
    const events = [boarded('e', 100), delivered('e', 500)];
    expect(quirkSatisfied('e', ctx({ e: 'elder' }, { events, speedBet: 'ludicrous' }))).toBe(false);
  });

  it('musician needs a route at least 1.3× the shortest', () => {
    const events = [delivered('m', 500)];
    const scenic = ctx(
      { m: 'musician' },
      { events, travelledBy: new Map([['m', 13]]), shortestBy: new Map([['m', 10]]) },
    );
    expect(quirkSatisfied('m', scenic)).toBe(true);

    const direct = ctx(
      { m: 'musician' },
      { events, travelledBy: new Map([['m', 11]]), shortestBy: new Map([['m', 10]]) },
    );
    expect(quirkSatisfied('m', direct)).toBe(false);
  });

  it('doctor must beat the deadline', () => {
    const onTime = [delivered('d', 900)];
    expect(
      quirkSatisfied('d', ctx({ d: 'doctor' }, { events: onTime, timeLimitBy: new Map([['d', 1000]]) })),
    ).toBe(true);

    const late = [delivered('d', 1100)];
    expect(
      quirkSatisfied('d', ctx({ d: 'doctor' }, { events: late, timeLimitBy: new Map([['d', 1000]]) })),
    ).toBe(false);
  });

  it('engineer must actually have repaired something', () => {
    const repaired: SimEvent[] = [
      delivered('eng', 500),
      { tick: 500, type: 'PieceRepaired', placementIndex: 2, byPassengerId: 'eng' },
    ];
    expect(quirkSatisfied('eng', ctx({ eng: 'engineer' }, { events: repaired }))).toBe(true);
    expect(quirkSatisfied('eng', ctx({ eng: 'engineer' }, { events: [delivered('eng', 500)] }))).toBe(false);
  });

  it('an undelivered passenger never satisfies a quirk', () => {
    expect(quirkSatisfied('ghost', ctx({ ghost: 'kid' }, { events: [] }))).toBe(false);
  });
});
