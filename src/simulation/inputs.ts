// Player inputs + replay format (docs/40 §6). HEADLESS.
//
// A replay stores *inputs only* — scenario id, seed, and what the player did on which tick.
// Everything else is recomputed, which is what makes a replay tiny and a run verifiable.

import type { ScenarioPlacement, ReferenceSolution } from '../scenarios/types';
import type { SpeedBet } from '../train/types';

export type InputEvent =
  | { tick: number; type: 'placePiece'; placement: ScenarioPlacement }
  | { tick: number; type: 'removePiece'; placementIndex: number }
  | { tick: number; type: 'setSpeedBet'; bet: SpeedBet }
  | { tick: number; type: 'dispatch' }
  | { tick: number; type: 'flipSwitch'; placementIndex: number; state: 0 | 1 };

export interface Replay {
  formatVersion: '1.0';
  scenarioId: string;
  schemaVersion: string;
  seed: number;
  inputs: InputEvent[];
}

/**
 * A `referenceSolution` is sugar for a replay: lay every piece during the countdown, then set
 * the bet and dispatch. Expanding it here means the CI gate replays a level exactly the way a
 * player's run would be replayed — one code path, not two.
 */
export function referenceToReplay(scenarioId: string, schemaVersion: string, ref: ReferenceSolution): Replay {
  const inputs: InputEvent[] = ref.placements.map((placement) => ({
    tick: 0,
    type: 'placePiece' as const,
    placement,
  }));

  inputs.push({ tick: ref.dispatchTick, type: 'setSpeedBet', bet: ref.speedBet });
  inputs.push({ tick: ref.dispatchTick, type: 'dispatch' });

  for (const s of ref.switchInputs ?? []) {
    inputs.push({ tick: s.tick, type: 'flipSwitch', placementIndex: s.placementIndex, state: s.state });
  }

  inputs.sort((a, b) => a.tick - b.tick);
  return { formatVersion: '1.0', scenarioId, schemaVersion, seed: ref.seed, inputs };
}

/** Inputs due on a given tick, in recorded order. */
export function inputsAt(replay: Replay, tick: number): InputEvent[] {
  return replay.inputs.filter((i) => i.tick === tick);
}
