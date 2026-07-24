// Station/Passenger/Hazard types (docs/40 §1, §1.1 verbatim). HEADLESS — `scenarios/` is headless
// zone (docs/30 §2.1): zero three.js/render/camera/ui/effects/audio/DOM.
//
// This is the first file in `scenarios/` — docs/40 §1 is its documented home for these three
// types; M5.1 builds the rest of this directory (scenario.schema.json, validate.ts, the full
// `Scenario` interface docs/30 §4 names) around what's added here. train/stations.ts and
// simulation/hazards.ts (docs/70 M4.4, this task) need Station/Passenger/Hazard now, well before
// M5.1 lands, so they're extracted here rather than waiting.
//
// `Passenger.persona` is an opaque string id into a persona table (20 §3) that doesn't exist as
// code yet — nothing here (or in train/stations.ts / simulation/hazards.ts) builds a persona
// registry; the one place persona matters (an Engineer's repair, docs/40 §1.1) just compares the
// string literal `'engineer'` directly.

import type { Tick } from '../core/types';
import type { CellCoord } from '../track/pieces';

export interface Station {
  id: string;
  cell: CellCoord;
  orientation: 'NS' | 'EW';
  optional?: boolean;
  name?: string;
}

export interface Passenger {
  id: string;
  persona: string;
  from: string; // station id
  to: string; // station id
  required?: boolean;
  timeLimitTicks?: number;
}

export type HazardKind = 'rockfall' | 'crossingTraffic' | 'brokenPiece';

export type Hazard =
  | { kind: 'rockfall'; cell: CellCoord; fromTick: Tick; toTick: Tick }
  | { kind: 'crossingTraffic'; cell: CellCoord; periodTicks: number; openTicks: number }
  | { kind: 'brokenPiece'; placementIndex: number; repairStationId: string };
