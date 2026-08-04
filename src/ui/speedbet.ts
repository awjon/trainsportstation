// The Speed Bet (docs/10 §8) — the post-build "double or nothing" beat. Speed multipliers come
// from data/physics.json and Connection multipliers from the scoring module, so this screen can
// never quote odds the sim won't honour.
//
// The bet moves Connections only, never stars: that is stated on the card, because a player who
// thinks Ludicrous is required for three stars will play the game wrong.

import { PHYSICS, type SpeedBet } from '../train/types';
import { BET_CONNECTION_MULTIPLIER } from '../simulation/scoring';
import { button, el } from './dom';

export interface BetOption {
  bet: SpeedBet;
  name: string;
  speedMultiplier: number;
  connectionMultiplier: number;
  read: string;
}

const READS: Record<SpeedBet, { name: string; read: string }> = {
  steady: { name: 'Steady', read: 'the safe run' },
  swift: { name: 'Swift', read: 'confident' },
  ludicrous: { name: 'Ludicrous', read: 'one hand on the crash gallery' },
};

export const BET_ORDER: SpeedBet[] = ['steady', 'swift', 'ludicrous'];

export function betOptions(): BetOption[] {
  return BET_ORDER.map((bet) => ({
    bet,
    name: READS[bet].name,
    speedMultiplier: PHYSICS.speedBet[bet],
    connectionMultiplier: BET_CONNECTION_MULTIPLIER[bet],
    read: READS[bet].read,
  }));
}

export class SpeedBetPanel {
  readonly root: HTMLElement;
  private readonly bets: HTMLElement;
  private selected: SpeedBet = 'steady';

  constructor(private readonly onConfirm: (bet: SpeedBet) => void) {
    this.bets = el('div', { class: 'bets' });
    this.root = el('div', { class: 'panel' }, [
      el('div', { class: 'card' }, [
        el('h1', { text: 'Speed bet' }),
        el('h2', { text: 'Connections only — stars are never affected' }),
        this.bets,
        el('div', { class: 'card-actions' }, [
          button('Dispatch ▸', () => this.onConfirm(this.selected), 'btn btn-big'),
        ]),
      ]),
    ]);
    this.paint();
  }

  get bet(): SpeedBet {
    return this.selected;
  }

  reset(): void {
    this.selected = 'steady';
    this.paint();
  }

  private paint(): void {
    this.bets.replaceChildren(
      ...betOptions().map((o) => {
        const b = button(
          '',
          () => {
            this.selected = o.bet;
            this.paint();
          },
          `bet${o.bet === this.selected ? ' is-selected' : ''}`,
        );
        b.append(
          el('span', { class: 'bet-name', text: o.name }),
          el('span', { class: 'bet-mult', text: `×${o.connectionMultiplier} Connections` }),
          el('span', { class: 'bet-read', text: `×${o.speedMultiplier} speed · ${o.read}` }),
        );
        return b;
      }),
    );
  }
}
