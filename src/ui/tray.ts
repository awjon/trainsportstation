// The piece tray (docs/30 §10, docs/10 §9 "teach-by-tray"). A scenario hands the player an
// exact inventory; the tray shows what is left and is the only way to pick what you are about
// to place — so a stage that introduces a piece can introduce it by putting it in the tray
// alone, with no modal text.
//
// `trayModel` is pure: given the scenario's tray and what has been placed, it returns the slots
// to draw. The DOM class underneath owns nothing but buttons.

import type { PieceType } from '../track/pieces';
import type { TrayEntry } from '../scenarios/types';
import { button, el } from './dom';

export interface TraySlot {
  piece: PieceType;
  total: number;
  used: number;
  remaining: number;
  /** nothing left — the button greys out but stays in place so the tray doesn't reflow */
  exhausted: boolean;
}

/**
 * Merge duplicate tray entries by piece (a scenario may list the same piece twice) and subtract
 * what the player has already laid. First-appearance order is kept so the tray is stable and
 * the number keys always mean the same thing.
 */
export function trayModel(
  tray: readonly TrayEntry[],
  placed: readonly { piece: PieceType }[],
): TraySlot[] {
  const totals = new Map<PieceType, number>();
  for (const entry of tray) totals.set(entry.piece, (totals.get(entry.piece) ?? 0) + entry.count);

  const used = new Map<PieceType, number>();
  for (const p of placed) used.set(p.piece, (used.get(p.piece) ?? 0) + 1);

  return [...totals].map(([piece, total]) => {
    const u = used.get(piece) ?? 0;
    const remaining = Math.max(0, total - u);
    return { piece, total, used: u, remaining, exhausted: remaining === 0 };
  });
}

/** Total pieces still available — the "unused pieces" Connections bonus previews from this. */
export function remainingTotal(slots: readonly TraySlot[]): number {
  return slots.reduce((n, s) => n + s.remaining, 0);
}

/** Is this piece still placeable? The UI refuses the click; the sim would refuse the input. */
export function hasStock(slots: readonly TraySlot[], piece: PieceType): boolean {
  return (slots.find((s) => s.piece === piece)?.remaining ?? 0) > 0;
}

/**
 * The slot the selection should land on after a change: keep the current one while it has
 * stock, otherwise step forward to the next slot that does. Returns -1 when the tray is empty.
 */
export function nextUsableSlot(slots: readonly TraySlot[], from: number): number {
  if (slots.length === 0) return -1;
  for (let i = 0; i < slots.length; i++) {
    const idx = (from + i) % slots.length;
    if (!slots[idx].exhausted) return idx;
  }
  return -1;
}

/** Short human labels for the tray buttons (the piece ids are kebab-case and shouty). */
export const PIECE_LABEL: Record<string, string> = {
  straight: 'Straight',
  'curve-small': 'Curve',
  'curve-large': 'Wide curve',
  's-bend': 'S-bend',
  's-bend-left': 'S-bend ↰',
  skew: 'Skew',
  'skew-left': 'Skew ↰',
  ramp: 'Ramp',
  'curve-small-ramp': 'Curve ramp',
  'curve-large-ramp': 'Wide ramp',
  hill: 'Hill',
  bump: 'Bump',
  bridge: 'Bridge',
  tunnel: 'Tunnel',
  junction: 'Junction',
  crossing: 'Crossing',
};

export function pieceLabel(piece: PieceType): string {
  return PIECE_LABEL[piece] ?? piece;
}

export interface TrayCallbacks {
  onSelect(piece: PieceType, index: number): void;
  onRotate(dir: 1 | -1): void;
}

export class TrayHud {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private slots: TraySlot[] = [];
  private selected = 0;

  constructor(private readonly cb: TrayCallbacks) {
    this.list = el('div', { class: 'tray-slots' });
    this.root = el('div', { class: 'tray' }, [
      this.list,
      el('div', { class: 'tray-tools' }, [
        button('⟳ Rotate', () => this.cb.onRotate(1), 'btn btn-small'),
      ]),
    ]);
  }

  get selectedIndex(): number {
    return this.selected;
  }

  get selectedPiece(): PieceType | null {
    return this.slots[this.selected]?.piece ?? null;
  }

  /** Move the selection, skipping exhausted slots. */
  select(index: number): void {
    if (index < 0 || index >= this.slots.length) return;
    this.selected = this.slots[index].exhausted ? nextUsableSlot(this.slots, index) : index;
    if (this.selected < 0) this.selected = index;
    this.paint();
    const piece = this.slots[this.selected]?.piece;
    if (piece) this.cb.onSelect(piece, this.selected);
  }

  update(tray: readonly TrayEntry[], placed: readonly { piece: PieceType }[]): void {
    this.slots = trayModel(tray, placed);
    if (this.slots[this.selected]?.exhausted) {
      const next = nextUsableSlot(this.slots, this.selected);
      if (next >= 0) this.selected = next;
    }
    this.paint();
  }

  private paint(): void {
    this.list.replaceChildren(
      ...this.slots.map((slot, i) => {
        const b = button(
          '',
          () => this.select(i),
          `tray-slot${i === this.selected ? ' is-selected' : ''}${slot.exhausted ? ' is-empty' : ''}`,
        );
        b.append(
          el('span', { class: 'tray-key', text: String(i + 1) }),
          el('span', { class: 'tray-name', text: pieceLabel(slot.piece) }),
          el('span', { class: 'tray-count', text: `×${slot.remaining}` }),
        );
        return b;
      }),
    );
  }
}
