// The radial countdown (docs/10 §3 — the signature mechanic) and the Dispatch Early button.
//
// `countdownModel` is pure so the timer's behaviour (seconds shown, ring sweep, when it starts
// screaming at you) is testable without a browser; the class below is just SVG plumbing.
//
// The countdown is a MAXIMUM: dispatching early is always allowed and is the expert flex, so
// the button is live from the first frame, not only when the ring runs out.

import { TICK_DT } from '../core/loop';
import { button, el, svg } from './dom';

export type Urgency = 'calm' | 'warn' | 'urgent';

export interface CountdownModel {
  ticksLeft: number;
  secondsLeft: number;
  /** 1 at the start, 0 when time is up — the fraction of ring still drawn */
  fraction: number;
  urgency: Urgency;
  expired: boolean;
  /** what the ring shows: e.g. "9.4" while tense, "12" while calm */
  label: string;
}

export const WARN_FRACTION = 0.5;
export const URGENT_SECONDS = 3;

export function countdownModel(ticksLeft: number, totalTicks: number): CountdownModel {
  const total = Math.max(1, totalTicks);
  const left = Math.min(Math.max(ticksLeft, 0), total);
  const seconds = left * TICK_DT;
  const fraction = left / total;
  const urgency: Urgency = seconds <= URGENT_SECONDS ? 'urgent' : fraction <= WARN_FRACTION ? 'warn' : 'calm';
  return {
    ticksLeft: left,
    secondsLeft: seconds,
    fraction,
    urgency,
    expired: left <= 0,
    // one decimal once it matters, whole seconds while there is room to breathe
    label: urgency === 'calm' ? String(Math.ceil(seconds)) : seconds.toFixed(1),
  };
}

/** Stroke offset for a ring of radius r drawn with `fraction` of it remaining. */
export function ringOffset(fraction: number, radius: number): number {
  const circumference = 2 * Math.PI * radius;
  return circumference * (1 - fraction);
}

const R = 34;

export class CountdownHud {
  readonly root: HTMLElement;
  private readonly arc: SVGCircleElement;
  private readonly text: SVGTextElement;
  private last = '';

  constructor(private readonly onDispatch: () => void) {
    this.arc = svg('circle', {
      cx: '40',
      cy: '40',
      r: String(R),
      fill: 'none',
      'stroke-width': '7',
      'stroke-linecap': 'round',
      transform: 'rotate(-90 40 40)',
      class: 'ring-arc',
    });
    this.text = svg('text', {
      x: '40',
      y: '40',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: 'ring-text',
    });

    const ring = svg('svg', { viewBox: '0 0 80 80', class: 'ring' });
    ring.append(
      svg('circle', {
        cx: '40',
        cy: '40',
        r: String(R),
        fill: 'none',
        'stroke-width': '7',
        class: 'ring-track',
      }),
      this.arc,
      this.text,
    );

    this.root = el('div', { class: 'countdown' }, [
      ring,
      button('Dispatch ▸', () => this.onDispatch(), 'btn btn-dispatch'),
    ]);
    this.arc.style.strokeDasharray = String(2 * Math.PI * R);
  }

  update(ticksLeft: number, totalTicks: number): void {
    const m = countdownModel(ticksLeft, totalTicks);
    this.arc.style.strokeDashoffset = String(ringOffset(m.fraction, R));
    if (m.label !== this.last) {
      this.text.textContent = m.label;
      this.last = m.label;
    }
    this.root.dataset.urgency = m.urgency;
  }
}
