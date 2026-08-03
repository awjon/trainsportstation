// Full scenario verification — static rules plus V6 (docs/40 §5). HEADLESS.
//
// V6 is the spine of the whole content pipeline: every scenario carries a reference solution,
// and replaying it headlessly must earn 3 stars. That single check proves the level is
// solvable AND that both star targets are actually achievable — which is why the CI gate and
// the editor's publish button can both trust it (docs/50 §5).

import { runReferenceSolution } from '../simulation/sim';
import { validateScenario, type VError } from './validate';
import type { Scenario } from './types';

/** Campaign fairness margin (docs/20 §6): a time target must not be a photo finish. */
export const FAIRNESS_MARGIN = 1.15;

export interface VerifyOptions {
  /** also require the campaign fairness margin on the time target */
  requireFairness?: boolean;
  maxTicks?: number;
}

export interface VerifyReport {
  ok: boolean;
  errors: VError[];
  /** present when the scenario was structurally valid enough to run */
  run?: { stars: 0 | 1 | 2 | 3; connections: number; ticks: number; lastDeliveryTick: number | null };
}

export function verifyScenario(doc: unknown, opts: VerifyOptions = {}): VerifyReport {
  const statik = validateScenario(doc);
  if (!statik.ok) return { ok: false, errors: statik.errors };

  const scenario: Scenario = statik.scenario;
  const errors: VError[] = [];

  let outcome;
  try {
    outcome = runReferenceSolution(scenario, opts.maxTicks);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          rule: 'V6',
          path: 'referenceSolution',
          message: `the reference run could not be simulated: ${(e as Error).message}`,
        },
      ],
    };
  }

  if (outcome.result.outcome !== 'complete') {
    errors.push({
      rule: 'V6',
      path: 'referenceSolution',
      message: 'the reference run never delivered every required passenger — this level may be unsolvable',
    });
  } else if (outcome.stars !== 3) {
    errors.push({
      rule: 'V6',
      path: 'stars',
      message: `the reference run earns ${outcome.stars}★, so a 3★ run is not provably possible`,
    });
  }

  const last = outcome.result.lastRequiredDeliveryTick;
  if (opts.requireFairness && last !== null) {
    const minimum = Math.ceil(last * FAIRNESS_MARGIN);
    if (scenario.stars.timeTargetTicks < minimum) {
      errors.push({
        rule: 'V6',
        path: 'stars.timeTargetTicks',
        message: `time target ${scenario.stars.timeTargetTicks} is tighter than the ${FAIRNESS_MARGIN}× fairness margin (needs ≥ ${minimum})`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    run: {
      stars: outcome.stars,
      connections: outcome.connections,
      ticks: outcome.ticks,
      lastDeliveryTick: last,
    },
  };
}
