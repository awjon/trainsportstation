// The UI's view models are pure functions, so the parts that decide *what* the player sees are
// tested headlessly — the DOM classes underneath only paint what these return.

import { describe, expect, it } from 'vitest';
import { countdownModel, ringOffset, URGENT_SECONDS } from './countdown';
import { hasStock, nextUsableSlot, remainingTotal, trayModel } from './tray';
import { manifestModel, personaGlyph, starGoals } from './hud';
import { previewModel } from './preview';
import { betOptions } from './speedbet';
import { watchModel } from './watch';
import type { Scenario, ScenarioPassenger } from '../scenarios/types';
import scenarioDoc from '../scenarios/w1-s1.json';

const scenario = scenarioDoc as unknown as Scenario;

describe('countdownModel', () => {
  it('is full at the start and empty when time is up', () => {
    expect(countdownModel(900, 900).fraction).toBe(1);
    expect(countdownModel(0, 900).fraction).toBe(0);
    expect(countdownModel(0, 900).expired).toBe(true);
  });

  it('clamps out-of-range ticks instead of drawing a broken ring', () => {
    expect(countdownModel(-40, 900).fraction).toBe(0);
    expect(countdownModel(9999, 900).fraction).toBe(1);
  });

  it('converts ticks to seconds at 60Hz', () => {
    expect(countdownModel(900, 900).secondsLeft).toBeCloseTo(15, 6);
  });

  it('escalates calm → warn → urgent', () => {
    expect(countdownModel(900, 900).urgency).toBe('calm');
    expect(countdownModel(400, 900).urgency).toBe('warn');
    expect(countdownModel(URGENT_SECONDS * 60, 900).urgency).toBe('urgent');
  });

  it('shows whole seconds while calm and tenths once it matters', () => {
    expect(countdownModel(900, 900).label).toBe('15');
    expect(countdownModel(150, 900).label).toBe('2.5');
  });

  it('the ring is fully drawn at full and fully retracted at zero', () => {
    expect(ringOffset(1, 34)).toBeCloseTo(0, 9);
    expect(ringOffset(0, 34)).toBeCloseTo(2 * Math.PI * 34, 9);
  });
});

describe('trayModel', () => {
  const tray = [
    { piece: 'straight' as const, count: 4 },
    { piece: 'curve-small' as const, count: 2 },
    { piece: 'straight' as const, count: 1 }, // duplicate entries merge
  ];

  it('merges duplicate entries and keeps first-appearance order', () => {
    const slots = trayModel(tray, []);
    expect(slots.map((s) => s.piece)).toEqual(['straight', 'curve-small']);
    expect(slots[0].total).toBe(5);
  });

  it('subtracts what has been placed', () => {
    const slots = trayModel(tray, [{ piece: 'straight' }, { piece: 'straight' }]);
    expect(slots[0].remaining).toBe(3);
    expect(slots[0].used).toBe(2);
    expect(slots[1].remaining).toBe(2);
  });

  it('never goes negative and marks an emptied slot exhausted', () => {
    const placed = Array.from({ length: 9 }, () => ({ piece: 'straight' as const }));
    const slots = trayModel(tray, placed);
    expect(slots[0].remaining).toBe(0);
    expect(slots[0].exhausted).toBe(true);
    expect(hasStock(slots, 'straight')).toBe(false);
  });

  it('remainingTotal feeds the unused-pieces bonus preview', () => {
    expect(remainingTotal(trayModel(tray, [{ piece: 'curve-small' }]))).toBe(6);
  });

  it('nextUsableSlot skips exhausted slots and wraps', () => {
    const slots = trayModel(tray, [{ piece: 'straight' }, { piece: 'straight' }, { piece: 'straight' }, { piece: 'straight' }, { piece: 'straight' }]);
    expect(nextUsableSlot(slots, 0)).toBe(1);
    expect(nextUsableSlot(slots, 1)).toBe(1);
  });

  it('returns -1 when nothing is left at all', () => {
    expect(nextUsableSlot(trayModel([], []), 0)).toBe(-1);
  });
});

describe('manifestModel', () => {
  const passengers: ScenarioPassenger[] = [
    { id: 'p1', persona: 'commuter', from: 'a', to: 'b' },
    { id: 'p2', persona: 'kid', from: 'a', to: 'b', required: false },
  ];

  it('tracks waiting → aboard → delivered', () => {
    const waiting = manifestModel(passengers, { boarded: new Set(), delivered: new Set() });
    expect(waiting.map((c) => c.status)).toEqual(['waiting', 'waiting']);

    const aboard = manifestModel(passengers, { boarded: new Set(['p1']), delivered: new Set() });
    expect(aboard[0].status).toBe('aboard');

    const done = manifestModel(passengers, { boarded: new Set(['p1']), delivered: new Set(['p1']) });
    expect(done[0].status).toBe('delivered');
  });

  it('marks optional passengers and carries a shape-coded glyph', () => {
    const chips = manifestModel(passengers, { boarded: new Set(), delivered: new Set() });
    expect(chips[0].required).toBe(true);
    expect(chips[1].required).toBe(false);
    expect(chips[0].glyph).not.toBe(chips[1].glyph); // identity is never color-only
  });

  it('falls back gracefully for an unknown persona', () => {
    expect(personaGlyph('bigfoot')).toBe('◇');
  });
});

describe('starGoals', () => {
  const targets = { pieceBudget: 4, timeTargetTicks: 1500 };

  it('prints the targets before a run, with nothing earned yet', () => {
    const goals = starGoals(targets);
    expect(goals.map((g) => g.met)).toEqual([false, false, false]);
    expect(goals[1].detail).toContain('4 pieces');
  });

  it('judges the budget live during the build phase', () => {
    const live = { piecesPlaced: 4, delivered: 0, requiredTotal: 1, crashed: false, lastRequiredDeliveryTick: null };
    expect(starGoals(targets, live)[1].met).toBe(true);
    expect(starGoals(targets, { ...live, piecesPlaced: 5 })[1].met).toBe(false);
  });

  it('a crash forfeits Complete even with everyone delivered', () => {
    const live = { piecesPlaced: 2, delivered: 1, requiredTotal: 1, crashed: true, lastRequiredDeliveryTick: 500 };
    expect(starGoals(targets, live)[0].met).toBe(false);
  });

  it('Swift needs the last required delivery inside the target', () => {
    const base = { piecesPlaced: 2, delivered: 1, requiredTotal: 1, crashed: false };
    expect(starGoals(targets, { ...base, lastRequiredDeliveryTick: 1500 })[2].met).toBe(true);
    expect(starGoals(targets, { ...base, lastRequiredDeliveryTick: 1501 })[2].met).toBe(false);
  });
});

describe('previewModel', () => {
  it('summarises the shipped tutorial stage', () => {
    const m = previewModel(scenario);
    expect(m.name).toBe(scenario.meta.name);
    expect(m.buildSeconds).toBe(Math.round(scenario.countdownTicks / 60));
    expect(m.briefing).toContain('to deliver');
    expect(m.briefing).toContain('no speed bet'); // w1-s1 sets speedBetAllowed: false
    expect(m.lines).toHaveLength(scenario.passengers.length);
  });
});

describe('betOptions', () => {
  it('matches the docs/10 §8 table', () => {
    const opts = betOptions();
    expect(opts.map((o) => o.bet)).toEqual(['steady', 'swift', 'ludicrous']);
    expect(opts.map((o) => o.connectionMultiplier)).toEqual([1.0, 1.25, 1.5]);
    expect(opts.map((o) => o.speedMultiplier)).toEqual([1.0, 1.4, 1.9]);
  });
});

describe('watchModel', () => {
  it('counts required deliveries and reports elapsed time', () => {
    const m = watchModel({
      tick: 600,
      dispatchTick: 300,
      speedBet: 'swift',
      delivered: new Set(['p1']),
      requiredIds: ['p1', 'p2'],
      crashed: 0,
      trains: 1,
    });
    expect(m.deliveredRequired).toBe(1);
    expect(m.requiredTotal).toBe(2);
    expect(m.elapsedSeconds).toBeCloseTo(5, 6);
    expect(m.status).toBe('rolling');
  });

  it('reports a wreck once every train is out of action', () => {
    const m = watchModel({
      tick: 400,
      dispatchTick: 300,
      speedBet: 'steady',
      delivered: new Set(),
      requiredIds: ['p1'],
      crashed: 2,
      trains: 2,
    });
    expect(m.status).toBe('wrecked');
  });

  it('reports success once every required passenger is home', () => {
    const m = watchModel({
      tick: 900,
      dispatchTick: 300,
      speedBet: 'steady',
      delivered: new Set(['p1']),
      requiredIds: ['p1'],
      crashed: 0,
      trains: 1,
    });
    expect(m.status).toBe('delivered');
  });
});
