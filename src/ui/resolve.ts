// The Resolve beat (docs/10 §3, §6): the moment between the run ending and the receipt. On a
// win it is the stage's payoff; on a wreck it is the gag.
//
// Both are skippable (docs/10 §10) and a crash offers the retry button right here, so a failed
// attempt costs one input and no meta progress — the "funny crashes > realism" pillar only
// works if failing is cheap.

import type { PayoffType } from '../scenarios/types';
import type { Gag } from '../effects/crashes';
import { RETRY_ON_CRASH } from '../effects/crashes';
import { button, el } from './dom';

/** Placeholder payoff copy per docs/10 §6 type — M7 replaces these with the real sequences. */
export const PAYOFF_COPY: Record<PayoffType, string> = {
  lightsOn: 'The lights come on, window by window.',
  bridgeRebuild: 'The bridge knits itself back together.',
  festivalStart: 'Bunting goes up. Someone finds a trumpet.',
  beaconLit: 'The beacon catches, and the valley answers.',
  reunionScene: 'They see each other from the platform.',
};

export interface ResolveCallbacks {
  onContinue(): void;
  onRetry(): void;
}

export class ResolvePanel {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;

  constructor(private readonly cb: ResolveCallbacks) {
    this.card = el('div', { class: 'card' });
    this.root = el('div', { class: 'panel' }, [this.card]);
  }

  /** The payoff card after a successful run. */
  showPayoff(payoff: PayoffType, stationName: string): void {
    this.card.replaceChildren(
      el('h1', { text: 'Connected!' }),
      el('h2', { text: stationName }),
      el('p', { text: PAYOFF_COPY[payoff] ?? PAYOFF_COPY.lightsOn }),
      el('div', { class: 'card-actions' }, [
        button('Continue ▸', () => this.cb.onContinue(), 'btn btn-big'),
      ]),
    );
  }

  /** The gag card after a wreck — retry is right here, one tap away. */
  showGag(gag: Gag): void {
    this.card.replaceChildren(
      el('h1', { text: gag.headline }),
      el('h2', { text: gag.animation }),
      el('div', { class: 'card-actions' }, [
        button(RETRY_ON_CRASH, () => this.cb.onRetry(), 'btn btn-big'),
        button('See the tally', () => this.cb.onContinue(), 'btn btn-big btn-ghost'),
      ]),
    );
  }
}
