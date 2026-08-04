// The results receipt is built from a real run of the shipped tutorial stage, so the itemized
// rows are checked against the same number the CI content gate produces — a receipt that does
// not add up to the score is a bug the player would find first.

import { describe, expect, it } from 'vitest';
import { runReferenceSolution } from '../simulation/sim';
import { hasCrashed, type SimResult } from '../simulation/scoring';
import { gagFor, GAGS, retryLabel, RETRY_ON_CRASH, RETRY_ON_SUCCESS } from '../effects/crashes';
import { headlineFor, resultsModel } from './results';
import type { Scenario } from '../scenarios/types';
import type { CrashCause } from '../train/types';
import scenarioDoc from '../scenarios/w1-s1.json';

const scenario = scenarioDoc as unknown as Scenario;
const run = runReferenceSolution(scenario);
const model = resultsModel(run.result, run.quirks, scenario.stars, run.stars, run.connections);

describe('resultsModel', () => {
  it('reports the reference solution as a clean three-star run', () => {
    expect(run.stars).toBe(3);
    expect(model.stars).toBe(3);
    expect(model.goals.map((g) => g.met)).toEqual([true, true, true]);
    expect(model.crashed).toBe(false);
  });

  it('the receipt totals exactly what the scorer awarded', () => {
    const total = model.rows.find((r) => r.kind === 'total');
    expect(total?.amount).toBe(run.connections);
    expect(model.connections).toBe(run.connections);
  });

  it('lists one delivery row per delivered passenger', () => {
    const delivered = run.result.events.filter((e) => e.type === 'Delivered').length;
    expect(model.rows.filter((r) => r.kind === 'delivery')).toHaveLength(delivered);
  });

  it('shows the no-crash multiplier on a clean run and hides the bet on a steady one', () => {
    const labels = model.rows.map((r) => r.label);
    expect(labels).toContain('No crash bonus');
    expect(labels.some((l) => l.startsWith('Speed bet'))).toBe(false); // w1-s1 forbids betting
  });

  it('itemizes leftover tray pieces when there are any', () => {
    const row = model.rows.find((r) => r.label.startsWith('Pieces left in the tray'));
    if (run.result.unusedTrayPieces > 0) {
      expect(row?.amount).toBe(run.result.unusedTrayPieces);
    } else {
      expect(row).toBeUndefined();
    }
  });

  it('offers the eager retry copy after a win', () => {
    expect(model.retryLabel).toBe(RETRY_ON_SUCCESS);
  });

  it('switches to the gentle retry copy after a crash', () => {
    const wrecked: SimResult = {
      ...run.result,
      outcome: 'failed',
      lastRequiredDeliveryTick: null,
      events: [
        ...run.result.events,
        { tick: 400, type: 'Crashed', trainId: 't1', cause: 'gap', cell: { x: 0, z: 0 } },
      ],
    };
    const m = resultsModel(wrecked, run.quirks, scenario.stars, 0, 0);
    expect(hasCrashed(wrecked.events)).toBe(true);
    expect(m.crashed).toBe(true);
    expect(m.retryLabel).toBe(RETRY_ON_CRASH);
    expect(m.rows.some((r) => r.label === 'No crash bonus')).toBe(false);
    expect(m.goals.every((g) => !g.met)).toBe(true);
  });
});

describe('headlineFor', () => {
  it('never blames the player', () => {
    expect(headlineFor(0, true, false)).toBe('Well. That’s one way to arrive.');
    expect(headlineFor(0, false, false)).toContain('waiting');
    expect(headlineFor(1, false, true)).toContain('Everybody home');
    expect(headlineFor(3, false, true)).toContain('Flawless');
  });
});

describe('crash gags', () => {
  const causes: CrashCause[] = ['gap', 'speeding-curve', 'collision', 'bad-landing', 'hazard'];

  it('every crash cause the sim can emit has at least one gag', () => {
    for (const cause of causes) {
      expect(GAGS[cause].length).toBeGreaterThan(0);
      expect(gagFor(cause).cause).toBe(cause);
    }
  });

  it('the gag chooser is injectable, so a capture can be made reproducible', () => {
    expect(gagFor('gap', () => 1)).toBe(GAGS.gap[1]);
    expect(gagFor('gap', () => 0)).toBe(GAGS.gap[0]);
  });

  it('an out-of-range choice is clamped rather than returning undefined', () => {
    expect(gagFor('collision', () => 99).cause).toBe('collision');
    expect(gagFor('collision', () => -5).cause).toBe('collision');
  });

  it('maps the docs/30 §7.6 causes to their signature slapstick', () => {
    expect(gagFor('speeding-curve').animation).toBe('cartwheel');
    expect(gagFor('collision').animation).toBe('accordion');
    expect(gagFor('gap').animation).toBe('teeter');
  });

  it('retryLabel follows the docs/20 §8 copy rule', () => {
    expect(retryLabel(true)).toBe(RETRY_ON_CRASH);
    expect(retryLabel(false)).toBe(RETRY_ON_SUCCESS);
  });
});
