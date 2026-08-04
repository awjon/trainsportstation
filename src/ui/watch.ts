// The Watch phase (docs/10 §3): hands off the keyboard, the plan either works or it is funny.
// The only live input is flipping junctions (docs/30 §5), which the session records as a
// `flipSwitch` replay event — so a watched run and its replay are the same run.
//
// `watchModel` is pure so the phase's read-out (and when the phase is over) is testable without
// a browser.

import { TICK_DT } from '../core/loop';
import type { SpeedBet } from '../train/types';
import { el } from './dom';

export interface WatchInput {
  tick: number;
  dispatchTick: number | null;
  speedBet: SpeedBet;
  delivered: ReadonlySet<string>;
  requiredIds: readonly string[];
  /** how many trains are wrecked, and how many exist */
  crashed: number;
  trains: number;
}

export type WatchStatus = 'waiting' | 'rolling' | 'delivered' | 'wrecked';

export interface WatchModel {
  elapsedSeconds: number;
  deliveredRequired: number;
  requiredTotal: number;
  speedBet: SpeedBet;
  status: WatchStatus;
  /** the phase is over — the session advances to Resolve */
  resolved: boolean;
}

export function watchModel(input: WatchInput): WatchModel {
  const deliveredRequired = input.requiredIds.filter((id) => input.delivered.has(id)).length;
  const allHome = input.requiredIds.length > 0 && deliveredRequired === input.requiredIds.length;
  const allWrecked = input.trains > 0 && input.crashed >= input.trains;

  const status: WatchStatus = allHome
    ? 'delivered'
    : allWrecked
      ? 'wrecked'
      : input.dispatchTick === null
        ? 'waiting'
        : 'rolling';

  return {
    elapsedSeconds: input.dispatchTick === null ? 0 : Math.max(0, input.tick - input.dispatchTick) * TICK_DT,
    deliveredRequired,
    requiredTotal: input.requiredIds.length,
    speedBet: input.speedBet,
    status,
    resolved: allHome || allWrecked,
  };
}

export class WatchBar {
  readonly root: HTMLElement;
  private readonly time: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly bet: HTMLElement;
  private readonly hint: HTMLElement;

  constructor() {
    this.time = el('span', { class: 'watch-time', text: '0.0s' });
    this.progress = el('span', { class: 'watch-progress', text: '0/0' });
    this.bet = el('span', { class: 'watch-bet', text: 'steady' });
    this.hint = el('span', { class: 'watch-hint', text: '' });
    this.root = el('div', { class: 'watch-bar' }, [
      this.time,
      el('span', { text: '·' }),
      this.progress,
      el('span', { text: '·' }),
      this.bet,
      this.hint,
    ]);
  }

  update(m: WatchModel, hasJunctions: boolean): void {
    this.time.textContent = `${m.elapsedSeconds.toFixed(1)}s`;
    this.progress.textContent = `${m.deliveredRequired}/${m.requiredTotal} delivered`;
    this.bet.textContent = m.speedBet;
    this.hint.textContent = hasJunctions && m.status === 'rolling' ? '· tap a junction to switch' : '';
  }
}
