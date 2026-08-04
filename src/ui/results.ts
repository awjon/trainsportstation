// The Results screen (docs/10 §7). Two jobs: show which of the three stars were earned, and
// show *where every Connection came from* — an itemized tally, because a quirk bonus the player
// can't see is a quirk bonus they'll never chase.
//
// `resultsModel` re-derives its rows from the same pure functions that produced the score
// (`starBreakdown`, `deliveryValue`, `quirkSatisfied`), so the receipt can never disagree with
// the total. The tally *animates* up rather than appearing (docs/10 §11).

import {
  BET_CONNECTION_MULTIPLIER,
  NO_CRASH_BONUS,
  OPTIONAL_STATION_BONUS,
  UNUSED_PIECE_BONUS,
  hasCrashed,
  starBreakdown,
  type SimResult,
  type StarTargets,
} from '../simulation/scoring';
import { PERSONAS, QUIRK_BONUS, quirkSatisfied, type QuirkContext } from '../simulation/personas';
import { retryLabel } from '../effects/crashes';
import { button, el } from './dom';
import { finalGoals, personaGlyph, personaName, type StarGoal } from './hud';

export type TallyKind = 'delivery' | 'quirk' | 'multiplier' | 'bonus' | 'total';

export interface TallyRow {
  kind: TallyKind;
  label: string;
  /** display string — multipliers read "×1.25", values read "+12" */
  value: string;
  /** the numeric contribution, for the count-up animation (null for multipliers) */
  amount: number | null;
}

export interface ResultsModel {
  headline: string;
  stars: 0 | 1 | 2 | 3;
  goals: StarGoal[];
  rows: TallyRow[];
  connections: number;
  crashed: boolean;
  retryLabel: string;
}

/**
 * Build the receipt. Deliveries are listed one per passenger with their quirk bonus called out
 * separately, then the multipliers, then the flat bonuses — the same order `computeConnections`
 * applies them, so reading top to bottom explains the number at the bottom.
 */
export function resultsModel(
  result: SimResult,
  ctx: QuirkContext,
  targets: StarTargets,
  stars: 0 | 1 | 2 | 3,
  connections: number,
): ResultsModel {
  const crashed = hasCrashed(result.events);
  const rows: TallyRow[] = [];

  const deliveries = result.events.filter((e) => e.type === 'Delivered') as Array<{
    passengerId: string;
  }>;

  for (const d of deliveries) {
    const persona = ctx.personaOf.get(d.passengerId) ?? 'commuter';
    const base = PERSONAS[persona]?.baseValue ?? 0;
    rows.push({
      kind: 'delivery',
      label: `${personaGlyph(persona)} ${personaName(persona)} delivered`,
      value: `+${base}`,
      amount: base,
    });
    if (quirkSatisfied(d.passengerId, ctx)) {
      const bonus = base * QUIRK_BONUS - base;
      rows.push({
        kind: 'quirk',
        label: `   quirk satisfied ×${QUIRK_BONUS}`,
        value: `+${bonus.toFixed(bonus % 1 === 0 ? 0 : 1)}`,
        amount: bonus,
      });
    }
  }

  const betMult = BET_CONNECTION_MULTIPLIER[result.speedBet];
  if (betMult !== 1) {
    rows.push({
      kind: 'multiplier',
      label: `Speed bet — ${result.speedBet}`,
      value: `×${betMult}`,
      amount: null,
    });
  }
  if (!crashed) {
    rows.push({
      kind: 'multiplier',
      label: 'No crash bonus',
      value: `×${NO_CRASH_BONUS}`,
      amount: null,
    });
  }
  if (result.optionalStationsServed > 0) {
    const amount = OPTIONAL_STATION_BONUS * result.optionalStationsServed;
    rows.push({
      kind: 'bonus',
      label: `Optional stops served ×${result.optionalStationsServed}`,
      value: `+${amount}`,
      amount,
    });
  }
  if (result.unusedTrayPieces > 0) {
    const amount = UNUSED_PIECE_BONUS * result.unusedTrayPieces;
    rows.push({
      kind: 'bonus',
      label: `Pieces left in the tray ×${result.unusedTrayPieces}`,
      value: `+${amount}`,
      amount,
    });
  }

  rows.push({ kind: 'total', label: 'Connections', value: String(connections), amount: connections });

  return {
    headline: headlineFor(stars, crashed, result.outcome === 'complete'),
    stars,
    goals: finalGoals(starBreakdown(result, targets)),
    rows,
    connections,
    crashed,
    retryLabel: retryLabel(crashed),
  };
}

/** Voice of the Guild (docs/20 §8): encouraging, a little grand, never blaming. */
export function headlineFor(stars: 0 | 1 | 2 | 3, crashed: boolean, complete: boolean): string {
  if (crashed && !complete) return 'Well. That’s one way to arrive.';
  if (!complete) return 'They’re still waiting, Conductor.';
  if (stars === 3) return 'Flawless. The line is whole again.';
  if (stars === 2) return 'A fine run, Conductor.';
  return 'Everybody home. Now do it in style.';
}

export interface ResultsCallbacks {
  onRetry(): void;
  onNext(): void;
}

/** Counts a number up over `ms`, because numbers must never simply appear (docs/10 §11). */
function countUp(node: HTMLElement, to: number, ms = 420): void {
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    node.textContent = String(Math.round(to * t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export class ResultsPanel {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;

  constructor(private readonly cb: ResultsCallbacks) {
    this.card = el('div', { class: 'card' });
    this.root = el('div', { class: 'panel' }, [this.card]);
  }

  show(m: ResultsModel): void {
    const total = el('div', { class: 'connections-total', text: '0' });

    this.card.replaceChildren(
      el(
        'div',
        { class: 'stars' },
        m.goals.map((g) => el('span', { class: `star${g.met ? ' is-earned' : ''}`, text: '★' })),
      ),
      el('h1', { text: m.headline }),
      el(
        'div',
        { class: 'tally' },
        m.rows.map((row) =>
          el('div', { class: `tally-row is-${row.kind}` }, [
            el('span', { class: 'tally-label', text: row.label }),
            el('span', { class: 'tally-value', text: row.value }),
          ]),
        ),
      ),
      total,
      el('div', { class: 'card-actions' }, [
        button(m.retryLabel, () => this.cb.onRetry(), 'btn btn-big btn-ghost'),
        button('World map ▸', () => this.cb.onNext(), 'btn btn-big'),
      ]),
    );

    countUp(total, m.connections);
  }
}
