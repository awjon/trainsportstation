// The Preview card (docs/10 §3). Untimed: the puzzle is fully readable before the clock ever
// starts — manifest, star targets and the countdown length are all printed here, so pressing
// Start is an informed choice rather than a surprise.

import type { Scenario } from '../scenarios/types';
import { button, el } from './dom';
import { personaGlyph, personaName } from './hud';

export interface PreviewModel {
  name: string;
  world: number;
  biome: string;
  description: string;
  buildSeconds: number;
  /** e.g. "2 passengers · 1 optional stop" */
  briefing: string;
  lines: string[];
}

export function previewModel(scenario: Scenario): PreviewModel {
  const required = scenario.passengers.filter((p) => p.required !== false);
  const optionalStops = scenario.stations.filter((s) => s.optional).length;
  const briefing = [
    `${required.length} to deliver`,
    optionalStops > 0 ? `${optionalStops} optional stop${optionalStops === 1 ? '' : 's'}` : null,
    scenario.speedBetAllowed ? 'speed bet open' : 'no speed bet',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    name: scenario.meta.name,
    world: scenario.meta.world,
    biome: scenario.meta.biome,
    description: scenario.meta.description ?? '',
    buildSeconds: Math.round(scenario.countdownTicks / 60),
    briefing,
    lines: scenario.passengers.map(
      (p) => `${personaGlyph(p.persona)} ${personaName(p.persona)}: ${p.from} → ${p.to}`,
    ),
  };
}

export class PreviewPanel {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;

  constructor(private readonly onStart: () => void) {
    this.card = el('div', { class: 'card' });
    this.root = el('div', { class: 'panel' }, [this.card]);
  }

  show(scenario: Scenario): void {
    const m = previewModel(scenario);
    this.card.replaceChildren(
      el('h1', { text: m.name }),
      el('h2', { text: `World ${m.world} · ${m.biome}` }),
      el('p', { text: m.description }),
      el('p', { class: 'preview-brief', text: m.briefing }),
      el(
        'div',
        { class: 'tally' },
        m.lines.map((line) =>
          el('div', { class: 'tally-row' }, [el('span', { class: 'tally-label', text: line })]),
        ),
      ),
      el('p', { text: `You get ${m.buildSeconds} seconds to build. Dispatch early if you dare.` }),
      el('div', { class: 'card-actions' }, [button('Start building ▸', () => this.onStart(), 'btn btn-big')]),
    );
  }
}
