// A stage session (docs/70 M6.2/M6.4): everything that happens between selecting a stage and
// reading its receipt, with no DOM and no Three.js — so the whole play loop is testable.
//
// Two rules shape this file:
//
//  1. **Every player action becomes an InputEvent first.** Placing a piece, betting, dispatching
//     and flipping a junction all go through `input()`, which appends to a Replay and then feeds
//     the sim. A played run is therefore literally its own replay — `runHeadless` on the
//     recorded replay reproduces it tick for tick, which is what makes ghost replays, the
//     editor's publish gate and CI one code path instead of four.
//  2. **The countdown is sim time, not wall time.** It ticks with the sim, so assist-mode pause
//     pauses both and a replay's dispatch tick means the same thing on any machine.

import { TICK_DT } from '../core/loop';
import {
  applyInput,
  createSim,
  quirkContextFor,
  resultOf,
  tick as simTick,
  type SimState,
} from '../simulation/sim';
import { computeConnections, computeStars, type SimResult } from '../simulation/scoring';
import type { QuirkContext } from '../simulation/personas';
import type { InputEvent, Replay } from '../simulation/inputs';
import type { Scenario, ScenarioPlacement } from '../scenarios/types';
import type { PieceType, Rotation } from '../track/pieces';
import { validatePlacement, type PlacementResult } from '../track/placement';
import type { SpeedBet } from '../train/types';
import { ScreenMachine, type ScreenId } from './screens';

export type Phase = 'building' | 'betting' | 'running' | 'over';

export interface SessionOutcome {
  result: SimResult;
  quirks: QuirkContext;
  stars: 0 | 1 | 2 | 3;
  connections: number;
  crashed: boolean;
}

export class StageSession {
  readonly screens: ScreenMachine;
  sim: SimState;
  replay: Replay;
  private outcome: SessionOutcome | null = null;

  constructor(
    readonly scenario: Scenario,
    readonly seed = 1,
  ) {
    this.screens = new ScreenMachine('preview', { speedBetAllowed: scenario.speedBetAllowed });
    this.sim = createSim(scenario, seed);
    this.replay = this.freshReplay();
  }

  private freshReplay(): Replay {
    return {
      formatVersion: '1.0',
      scenarioId: this.scenario.id,
      schemaVersion: this.scenario.schemaVersion,
      seed: this.seed,
      inputs: [],
    };
  }

  get screen(): ScreenId {
    return this.screens.current;
  }

  get tick(): number {
    return this.sim.tick;
  }

  /** Ticks of build time left. Negative time is clamped — the countdown is a maximum. */
  get ticksLeft(): number {
    if (this.sim.dispatched) return 0;
    return Math.max(0, this.scenario.countdownTicks - this.sim.tick);
  }

  get phase(): Phase {
    if (this.outcome) return 'over';
    if (this.sim.dispatched) return 'running';
    return this.screens.current === 'speedBet' ? 'betting' : 'building';
  }

  /** The pieces the player has laid (station/pre-placed pieces are not theirs to count). */
  get playerPlacements(): Array<{ piece: PieceType; cell: { x: number; z: number }; rotation: Rotation }> {
    return this.sim.placements.slice(this.sim.fixedCount);
  }

  /** Record an input into the replay and apply it. The single door into the sim. */
  input(event: InputEvent): void {
    this.replay.inputs.push(event);
    applyInput(this.sim, event);
  }

  /** Would this placement be accepted? The UI asks before committing, so the ghost can go red. */
  check(piece: PieceType, cell: { x: number; z: number }, rotation: Rotation): PlacementResult {
    return validatePlacement(this.sim.grid, this.sim.placements, { piece, cell, rotation });
  }

  /**
   * Try to place a piece. Returns the validation result; only an accepted placement is recorded,
   * so the replay never carries inputs the sim refused.
   */
  place(piece: PieceType, cell: { x: number; z: number }, rotation: Rotation): PlacementResult {
    const check = this.check(piece, cell, rotation);
    if (!check.ok) return check;
    const placement: ScenarioPlacement = { piece, cell: { ...cell }, rotation };
    this.input({ tick: this.sim.tick, type: 'placePiece', placement });
    return check;
  }

  /** Remove the topmost player piece covering a cell. Returns true if something was removed. */
  removeAt(cell: { x: number; z: number }): boolean {
    const placements = this.playerPlacements;
    for (let i = placements.length - 1; i >= 0; i--) {
      if (placements[i].cell.x === cell.x && placements[i].cell.z === cell.z) {
        this.input({ tick: this.sim.tick, type: 'removePiece', placementIndex: i });
        return true;
      }
    }
    return false;
  }

  setSpeedBet(bet: SpeedBet): void {
    this.input({ tick: this.sim.tick, type: 'setSpeedBet', bet });
  }

  dispatch(): void {
    if (this.sim.dispatched) return;
    this.input({ tick: this.sim.tick, type: 'dispatch' });
  }

  flipSwitch(placementIndex: number, state: 0 | 1): void {
    this.input({ tick: this.sim.tick, type: 'flipSwitch', placementIndex, state });
  }

  /** Which junction placements exist, and what state each is in — the render layer mirrors this. */
  switchState(placementIndex: number): 0 | 1 {
    return this.sim.switchStates.get(placementIndex) ?? 0;
  }

  /** Advance one sim tick. Returns the events it produced (empty once the run is over). */
  step(): ReturnType<typeof simTick> {
    if (this.outcome) return [];
    const events = simTick(this.sim);
    if (this.sim.finished && !this.outcome) this.finish();
    return events;
  }

  /** Advance by a frame delta, in whole ticks, with the same spiral-of-death clamp as the loop. */
  advance(seconds: number, accumulator: number, maxTicks = 5): number {
    let acc = accumulator + seconds;
    let n = 0;
    while (acc >= TICK_DT && n < maxTicks) {
      this.step();
      acc -= TICK_DT;
      n++;
    }
    return acc;
  }

  /** Score the run with the same pure functions CI uses. Idempotent. */
  finish(): SessionOutcome {
    if (this.outcome) return this.outcome;
    const result = resultOf(this.sim);
    const quirks = quirkContextFor(this.sim, result);
    this.outcome = {
      result,
      quirks,
      stars: computeStars(result, this.scenario.stars),
      connections: computeConnections(result, quirks),
      crashed: this.sim.trains.some((t) => t.crashed !== null),
    };
    return this.outcome;
  }

  get finished(): SessionOutcome | null {
    return this.outcome;
  }

  /** Same puzzle, blank board, fresh recording — a retry costs nothing but the attempt. */
  retry(): void {
    this.sim = createSim(this.scenario, this.seed);
    this.replay = this.freshReplay();
    this.outcome = null;
  }
}
