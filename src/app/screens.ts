// The screen state machine (docs/10 §3, docs/30 §10). HEADLESS — no DOM, no Three.js, so the
// whole core loop is unit-testable.
//
// The loop is *data*: TRANSITIONS below is the complete, exhaustive list of legal moves. If a
// (screen, action) pair is not in the table the machine refuses it, which is what makes
// "nothing else is reachable" a testable claim rather than a code-review promise.
//
// The one conditional edge is Countdown → SpeedBet: a scenario with `speedBetAllowed: false`
// (every tutorial stage) skips the bet screen and dispatches straight away.

import { EventBus } from '../core/events';

export type ScreenId =
  'title' | 'worldMap' | 'preview' | 'countdown' | 'speedBet' | 'dispatch' | 'watch' | 'resolve' | 'results';

export const SCREENS: ScreenId[] = [
  'title',
  'worldMap',
  'preview',
  'countdown',
  'speedBet',
  'dispatch',
  'watch',
  'resolve',
  'results',
];

export type ScreenAction =
  | 'begin' // title → world map
  | 'selectStage' // world map → preview
  | 'start' // preview → countdown (build phase begins)
  | 'dispatch' // countdown → speed bet, or straight to dispatch
  | 'confirmBet' // speed bet → dispatch
  | 'depart' // dispatch → watch (trains are rolling)
  | 'resolved' // watch → resolve (sim finished or every train wrecked)
  | 'showResults' // resolve → results (payoff/gag finished or skipped)
  | 'retry' // resolve/results → countdown, same puzzle
  | 'next' // results → world map
  | 'quit'; // escape hatch back to the world map

/** Guards are named, not inline functions, so the table stays declarative data. */
export type ScreenGuard = 'speedBetAllowed' | 'speedBetSkipped';

export interface Transition {
  from: ScreenId;
  action: ScreenAction;
  to: ScreenId;
  guard?: ScreenGuard;
}

/**
 * The complete core loop (docs/10 §3):
 * `Preview → Countdown → SpeedBet → Dispatch → Watch → Resolve → Results → (Retry | Next)`
 * wrapped in the shell states from docs/30 §10 (`Title → WorldMap → …`), plus a `quit` escape
 * hatch from each in-stage screen. Nothing else exists.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'title', action: 'begin', to: 'worldMap' },
  { from: 'worldMap', action: 'selectStage', to: 'preview' },
  { from: 'preview', action: 'start', to: 'countdown' },
  { from: 'preview', action: 'quit', to: 'worldMap' },
  // the countdown is a *maximum*: the same action fires whether it expired or the player
  // pressed Dispatch Early, and the bet screen is skipped when the scenario forbids betting
  { from: 'countdown', action: 'dispatch', to: 'speedBet', guard: 'speedBetAllowed' },
  { from: 'countdown', action: 'dispatch', to: 'dispatch', guard: 'speedBetSkipped' },
  { from: 'countdown', action: 'quit', to: 'worldMap' },
  { from: 'speedBet', action: 'confirmBet', to: 'dispatch' },
  { from: 'dispatch', action: 'depart', to: 'watch' },
  { from: 'watch', action: 'resolved', to: 'resolve' },
  { from: 'watch', action: 'quit', to: 'worldMap' },
  // a crash puts the big friendly RETRY button on the resolve screen — no detour via results
  { from: 'resolve', action: 'retry', to: 'countdown' },
  { from: 'resolve', action: 'showResults', to: 'results' },
  { from: 'results', action: 'retry', to: 'countdown' },
  { from: 'results', action: 'next', to: 'worldMap' },
  { from: 'results', action: 'quit', to: 'worldMap' },
];

export interface ScreenContext {
  /** mirrors `scenario.speedBetAllowed`; flipped when a different stage is selected */
  speedBetAllowed: boolean;
}

export interface ScreenChange {
  from: ScreenId;
  to: ScreenId;
  action: ScreenAction;
}

export type ScreenEvents = {
  change: ScreenChange;
  /** an action that no transition accepted — useful for "why did my button do nothing" */
  rejected: { screen: ScreenId; action: ScreenAction };
};

function guardHolds(guard: ScreenGuard | undefined, ctx: ScreenContext): boolean {
  if (!guard) return true;
  return guard === 'speedBetAllowed' ? ctx.speedBetAllowed : !ctx.speedBetAllowed;
}

export class ScreenMachine {
  readonly bus = new EventBus<ScreenEvents>();
  private screen: ScreenId;
  private ctx: ScreenContext;

  constructor(start: ScreenId = 'title', ctx: ScreenContext = { speedBetAllowed: true }) {
    this.screen = start;
    this.ctx = { ...ctx };
  }

  get current(): ScreenId {
    return this.screen;
  }

  get context(): Readonly<ScreenContext> {
    return this.ctx;
  }

  /** Update the guard inputs — called when a stage is selected. */
  setContext(patch: Partial<ScreenContext>): void {
    this.ctx = { ...this.ctx, ...patch };
  }

  /** The screen `action` would lead to, or null if it is not legal from here. */
  peek(action: ScreenAction): ScreenId | null {
    const t = TRANSITIONS.find(
      (x) => x.from === this.screen && x.action === action && guardHolds(x.guard, this.ctx),
    );
    return t ? t.to : null;
  }

  can(action: ScreenAction): boolean {
    return this.peek(action) !== null;
  }

  /** Every action legal from the current screen — what the UI enables. */
  available(): ScreenAction[] {
    const seen = new Set<ScreenAction>();
    for (const t of TRANSITIONS) {
      if (t.from === this.screen && guardHolds(t.guard, this.ctx)) seen.add(t.action);
    }
    return [...seen];
  }

  /** Apply an action. Returns the new screen, or null if the action was refused. */
  dispatch(action: ScreenAction): ScreenId | null {
    const to = this.peek(action);
    if (to === null) {
      this.bus.emit('rejected', { screen: this.screen, action });
      return null;
    }
    const from = this.screen;
    this.screen = to;
    this.bus.emit('change', { from, to, action });
    return to;
  }
}
