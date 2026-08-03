// Hazards (docs/40 §1.1, docs/30 §7.5, docs/70 M4.4). HEADLESS and deterministic — every
// hazard is a pure function of the tick, so replays reproduce them exactly.
//
//   rockfall        — a cell is blocked during a tick window; entering it crashes you
//   crossingTraffic — a level crossing cycles blocked/open from tick 0
//   brokenPiece     — a pre-placed piece is unusable until an Engineer is delivered

import type { CellCoord } from '../track/pieces';
import type { SimEvent, Tick } from './events';

export type Hazard =
  | { kind: 'rockfall'; cell: CellCoord; fromTick: number; toTick: number }
  | { kind: 'crossingTraffic'; cell: CellCoord; periodTicks: number; openTicks: number }
  | { kind: 'brokenPiece'; placementIndex: number; repairStationId: string };

export interface HazardState {
  /** placement indices repaired so far */
  repaired: Set<number>;
}

export function initHazards(): HazardState {
  return { repaired: new Set() };
}

const sameCell = (a: CellCoord, b: CellCoord): boolean => a.x === b.x && a.z === b.z;

/** Is a cell blocked at this tick by a timed hazard? */
export function isCellBlocked(hazards: readonly Hazard[], cell: CellCoord, tick: Tick): boolean {
  for (const h of hazards) {
    if (h.kind === 'rockfall') {
      if (sameCell(h.cell, cell) && tick >= h.fromTick && tick <= h.toTick) return true;
    } else if (h.kind === 'crossingTraffic') {
      if (!sameCell(h.cell, cell)) continue;
      // the cycle opens for `openTicks` at the start of each period, then closes
      const phase = ((tick % h.periodTicks) + h.periodTicks) % h.periodTicks;
      if (phase >= h.openTicks) return true;
    }
  }
  return false;
}

/** Ticks until a blocked crossing cell next opens — used to telegraph the wait in the UI. */
export function ticksUntilOpen(hazards: readonly Hazard[], cell: CellCoord, tick: Tick): number | null {
  for (const h of hazards) {
    if (h.kind !== 'crossingTraffic' || !sameCell(h.cell, cell)) continue;
    const phase = ((tick % h.periodTicks) + h.periodTicks) % h.periodTicks;
    if (phase < h.openTicks) return 0;
    return h.periodTicks - phase;
  }
  return null;
}

/** Is a pre-placed piece currently unusable? */
export function isPieceBroken(
  hazards: readonly Hazard[],
  state: HazardState,
  placementIndex: number,
): boolean {
  return hazards.some(
    (h) =>
      h.kind === 'brokenPiece' && h.placementIndex === placementIndex && !state.repaired.has(placementIndex),
  );
}

/**
 * Delivering an Engineer to a repair station fixes every broken piece linked to it.
 * Returns the PieceRepaired events produced.
 */
export function repairOnDelivery(
  hazards: readonly Hazard[],
  state: HazardState,
  stationId: string,
  passengerId: string,
  persona: string,
  tick: Tick,
): SimEvent[] {
  if (persona !== 'engineer') return [];
  const events: SimEvent[] = [];
  for (const h of hazards) {
    if (h.kind !== 'brokenPiece' || h.repairStationId !== stationId) continue;
    if (state.repaired.has(h.placementIndex)) continue;
    state.repaired.add(h.placementIndex);
    events.push({
      tick,
      type: 'PieceRepaired',
      placementIndex: h.placementIndex,
      byPassengerId: passengerId,
    });
  }
  return events;
}
