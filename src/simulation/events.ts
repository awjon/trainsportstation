// Canonical SimEvent log (docs/30 §4 verbatim, docs/70 M4.3+). HEADLESS — `simulation/` is
// headless zone (docs/30 §2.1): zero three.js/render/camera/ui/effects/audio/DOM.
//
// This is the input to scoring (M5's simulation/scoring.ts) and persona quirk predicates (20 §3).
// train/physics.ts (M4.3, this task) only ever constructs `Crashed`/`Airtime` variants — the rest
// of the union exists now so M4.4 (stations/hazards), M5 (sim orchestration, replay,
// PassengerBoarded/Delivered), and M6 (SwitchFlipped on junction taps) don't have to touch this
// file again just to add their own event kind to the union. This is the first file in
// `simulation/` — M5 builds the rest of that directory (sim.ts, scoring.ts, replay.ts, etc.)
// around what's added here.

import type { Tick } from '../core/types';
import type { CellCoord } from '../track/pieces';
import type { SpeedBet } from '../train/physics-constants';

export type CrashCause = 'gap' | 'speeding-curve' | 'collision' | 'bad-landing' | 'hazard';

export type SimEvent =
  | { tick: Tick; type: 'Dispatched'; trainId: string; speedBet: SpeedBet }
  | { tick: Tick; type: 'PassengerBoarded'; passengerId: string; trainId: string; stationId: string }
  | { tick: Tick; type: 'Delivered'; passengerId: string; trainId: string; stationId: string }
  | { tick: Tick; type: 'Airtime'; trainId: string; durationTicks: number }
  | { tick: Tick; type: 'SwitchFlipped'; placementIndex: number; state: 0 | 1 }
  | { tick: Tick; type: 'PieceRepaired'; placementIndex: number; byPassengerId: string }
  | { tick: Tick; type: 'Crashed'; trainId: string; cause: CrashCause; cell: CellCoord }
  | { tick: Tick; type: 'ArrivedDepot'; trainId: string };
