// M5.4 — the content gate (docs/70 G4). Every scenario shipped in this directory must validate
// and its reference solution must replay headlessly to 3 stars with a fair time target.
//
// This test discovers scenarios automatically, so adding a stage to the campaign automatically
// puts it under the gate — content can never ship unsolvable.

import { describe, expect, it } from 'vitest';
import { FAIRNESS_MARGIN, verifyScenario } from './verify';
import { validateScenario } from './validate';
import type { Scenario } from './types';

const modules = import.meta.glob('./*.json', { eager: true }) as Record<string, { default: unknown }>;
const scenarios = Object.entries(modules).map(([path, mod]) => ({
  path,
  doc: mod.default ?? mod,
}));

describe('shipped scenarios', () => {
  it('there is at least one scenario to check', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const { path, doc } of scenarios) {
    describe(path, () => {
      it('validates (V1–V5, V7)', () => {
        const r = validateScenario(structuredClone(doc));
        if (!r.ok) console.error(path, r.errors);
        expect(r.ok).toBe(true);
      });

      it('V6: the reference solution replays to 3 stars with a fair time target', () => {
        const report = verifyScenario(structuredClone(doc), { requireFairness: true });
        if (!report.ok) console.error(path, report.errors);
        expect(report.ok).toBe(true);
        expect(report.run?.stars).toBe(3);
      });

      it('the time target leaves the fairness margin over the reference run', () => {
        const report = verifyScenario(structuredClone(doc));
        const scenario = structuredClone(doc) as Scenario;
        const last = report.run?.lastDeliveryTick;
        expect(last).not.toBeNull();
        expect(scenario.stars.timeTargetTicks).toBeGreaterThanOrEqual(Math.ceil(last! * FAIRNESS_MARGIN));
      });

      it('the tray and budget cover the reference solution', () => {
        const scenario = structuredClone(doc) as Scenario;
        const used = new Map<string, number>();
        for (const p of scenario.referenceSolution.placements) {
          used.set(p.piece, (used.get(p.piece) ?? 0) + 1);
        }
        for (const [piece, count] of used) {
          const available = scenario.pieceTray
            .filter((t) => t.piece === piece)
            .reduce((sum, t) => sum + t.count, 0);
          expect(available, `${piece} in ${path}`).toBeGreaterThanOrEqual(count);
        }
        expect(scenario.stars.pieceBudget).toBeGreaterThanOrEqual(
          scenario.referenceSolution.placements.length,
        );
      });
    });
  }
});

describe('verifyScenario', () => {
  const good = () => structuredClone(scenarios[0].doc) as Scenario;

  it('rejects a scenario whose reference solution cannot finish', () => {
    const broken = good();
    broken.referenceSolution.placements = [broken.referenceSolution.placements[0]]; // a gap in the line
    const report = verifyScenario(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.rule === 'V6')).toBe(true);
  });

  it('rejects a time target tighter than the fairness margin', () => {
    const tight = good();
    tight.stars.timeTargetTicks = 60; // the reference run takes far longer than this
    const report = verifyScenario(tight, { requireFairness: true });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.path === 'stars.timeTargetTicks' || e.rule === 'V6')).toBe(true);
  });

  it('surfaces static errors without attempting to run', () => {
    const invalid = good();
    invalid.stations[1].cell = { x: 99, z: 99 };
    const report = verifyScenario(invalid);
    expect(report.ok).toBe(false);
    expect(report.run).toBeUndefined();
  });

  it('reports the run details for a healthy scenario', () => {
    const report = verifyScenario(good(), { requireFairness: true });
    expect(report.ok).toBe(true);
    expect(report.run?.ticks).toBeGreaterThan(0);
    expect(report.run?.connections).toBeGreaterThan(0);
  });
});
