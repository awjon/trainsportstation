// The always-on HUD: stage card, passenger manifest, and the three star goals (docs/30 §10).
//
// docs/10 §7 is emphatic that goals are known before you build — so the star targets are drawn
// in Preview and stay on screen through Countdown and Watch, updating live. The model functions
// are pure; the class is a DOM shell.

import { PERSONAS } from '../simulation/personas';
import { starBreakdown, type StarTargets } from '../simulation/scoring';
import type { Scenario, ScenarioPassenger } from '../scenarios/types';
import { el } from './dom';

/** Shape-coded glyphs — persona identity must never be carried by color alone (docs/10 §10). */
export const PERSONA_GLYPH: Record<string, string> = {
  briefcase: '▮',
  kite: '◆',
  yarn: '●',
  note: '♪',
  cross: '✚',
  wrench: '⚒',
};

export function personaGlyph(personaId: string): string {
  const icon = PERSONAS[personaId]?.icon;
  return (icon && PERSONA_GLYPH[icon]) ?? '◇';
}

export function personaName(personaId: string): string {
  return PERSONAS[personaId]?.name ?? personaId;
}

export type ChipStatus = 'waiting' | 'aboard' | 'delivered';

export interface ManifestChip {
  passengerId: string;
  persona: string;
  glyph: string;
  name: string;
  from: string;
  to: string;
  required: boolean;
  status: ChipStatus;
}

export interface ManifestProgress {
  boarded: ReadonlySet<string>;
  delivered: ReadonlySet<string>;
}

export function manifestModel(
  passengers: readonly ScenarioPassenger[],
  progress: ManifestProgress,
): ManifestChip[] {
  return passengers.map((p) => ({
    passengerId: p.id,
    persona: p.persona,
    glyph: personaGlyph(p.persona),
    name: personaName(p.persona),
    from: p.from,
    to: p.to,
    required: p.required !== false,
    status: progress.delivered.has(p.id) ? 'delivered' : progress.boarded.has(p.id) ? 'aboard' : 'waiting',
  }));
}

export interface StarGoal {
  id: 'complete' | 'efficient' | 'swift';
  label: string;
  detail: string;
  met: boolean;
}

/**
 * The three goals as printed on the stage card. `live` is optional: during Preview and
 * Countdown there is no run yet, so only the piece-budget goal can already be judged.
 */
export function starGoals(
  targets: StarTargets,
  live?: {
    piecesPlaced: number;
    delivered: number;
    requiredTotal: number;
    crashed: boolean;
    lastRequiredDeliveryTick: number | null;
  },
): StarGoal[] {
  const seconds = (ticks: number) => `${(ticks / 60).toFixed(0)}s`;
  return [
    {
      id: 'complete',
      label: 'Complete',
      detail: live
        ? `${live.delivered}/${live.requiredTotal} delivered${live.crashed ? ' · wrecked' : ''}`
        : 'deliver everyone, wreck nobody',
      met: !!live && !live.crashed && live.requiredTotal > 0 && live.delivered >= live.requiredTotal,
    },
    {
      id: 'efficient',
      label: 'Efficient',
      detail: live ? `${live.piecesPlaced}/${targets.pieceBudget} pieces` : `≤ ${targets.pieceBudget} pieces`,
      met: !!live && live.piecesPlaced <= targets.pieceBudget,
    },
    {
      id: 'swift',
      label: 'Swift',
      detail: `≤ ${seconds(targets.timeTargetTicks)}`,
      met:
        !!live &&
        live.lastRequiredDeliveryTick !== null &&
        live.lastRequiredDeliveryTick <= targets.timeTargetTicks,
    },
  ];
}

/** Final goals, computed from the same pure function the score uses — never a second opinion. */
export function finalGoals(breakdown: ReturnType<typeof starBreakdown>): StarGoal[] {
  const labels: Array<[StarGoal['id'], string]> = [
    ['complete', 'Complete'],
    ['efficient', 'Efficient'],
    ['swift', 'Swift'],
  ];
  return labels.map(([id, label]) => ({
    id,
    label,
    detail: '',
    met: breakdown[id],
  }));
}

export class Hud {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly goals: HTMLElement;
  private readonly manifest: HTMLElement;
  private readonly status: HTMLElement;

  constructor() {
    this.title = el('div', { class: 'hud-title' });
    this.goals = el('div', { class: 'hud-goals' });
    this.manifest = el('div', { class: 'hud-manifest' });
    this.status = el('div', { class: 'hud-status' });
    this.root = el('div', { class: 'hud' }, [this.title, this.goals, this.manifest, this.status]);
  }

  setStage(scenario: Scenario): void {
    this.title.replaceChildren(
      el('span', { class: 'hud-stage', text: scenario.meta.name }),
      el('span', { class: 'hud-world', text: `World ${scenario.meta.world} · ${scenario.meta.biome}` }),
    );
  }

  setGoals(goals: readonly StarGoal[]): void {
    this.goals.replaceChildren(
      ...goals.map((g) =>
        el('div', { class: `goal${g.met ? ' is-met' : ''}` }, [
          el('span', { class: 'goal-star', text: g.met ? '★' : '☆' }),
          el('span', { class: 'goal-label', text: g.label }),
          el('span', { class: 'goal-detail', text: g.detail }),
        ]),
      ),
    );
  }

  setManifest(chips: readonly ManifestChip[]): void {
    this.manifest.replaceChildren(
      ...chips.map((c) =>
        el(
          'div',
          {
            class: `chip is-${c.status}${c.required ? '' : ' is-optional'}`,
            attrs: { title: `${c.name}: ${c.from} → ${c.to}` },
          },
          [
            el('span', { class: 'chip-glyph', text: c.glyph }),
            el('span', { class: 'chip-route', text: `${c.from} → ${c.to}` }),
          ],
        ),
      ),
    );
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }
}
