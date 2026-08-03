// Scenario document types (docs/40 §1). HEADLESS. This mirrors the normative JSON schema —
// campaign stages and community levels are the same format, so anything the editor publishes
// the game can load.

import type { PieceType, Rotation } from '../track/pieces';
import type { SpeedBet } from '../train/types';

export const SCHEMA_VERSION = '1.0';
export const SUPPORTED_SCHEMA_MAJORS = [1];

export type BiomeId =
  | 'meadow'
  | 'highland'
  | 'rivers'
  | 'mesa'
  | 'frostfield'
  | 'coast'
  | 'hollow'
  | 'skyline'
  | 'cloudpeak'
  | 'last-junction';

export type PayoffType = 'lightsOn' | 'bridgeRebuild' | 'festivalStart' | 'beaconLit' | 'reunionScene';

export interface ScenarioCell {
  x: number;
  z: number;
}

export interface ScenarioPlacement {
  piece: PieceType;
  cell: ScenarioCell;
  rotation: Rotation;
}

export interface TerrainEntry extends ScenarioCell {
  height?: 0 | 1 | 2;
  feature?: 'water' | 'rock' | 'forest' | 'town';
}

export interface ScenarioTrain {
  id: string;
  model: string;
  carriageCount: number;
  spawnStationId: string;
  /** ticks after dispatch before this train departs */
  dispatchOrder?: number;
}

export interface ScenarioStation {
  id: string;
  cell: ScenarioCell;
  orientation: 'NS' | 'EW';
  optional?: boolean;
  name?: string;
}

export interface ScenarioPassenger {
  id: string;
  persona: string;
  from: string;
  to: string;
  required?: boolean;
  timeLimitTicks?: number;
}

export interface TrayEntry {
  piece: PieceType;
  count: number;
}

export type ScenarioHazard =
  | { kind: 'rockfall'; cell: ScenarioCell; fromTick: number; toTick: number }
  | { kind: 'crossingTraffic'; cell: ScenarioCell; periodTicks: number; openTicks: number }
  | { kind: 'brokenPiece'; placementIndex: number; repairStationId: string };

export interface ReferenceSolution {
  seed: number;
  speedBet: SpeedBet;
  dispatchTick: number;
  placements: ScenarioPlacement[];
  switchInputs?: Array<{ tick: number; placementIndex: number; state: 0 | 1 }>;
}

export interface Scenario {
  schemaVersion: string;
  id: string;
  meta: { name: string; author: string; world: number; biome: BiomeId; description?: string };
  grid: { width: number; height: number };
  terrain: TerrainEntry[];
  countdownTicks: number;
  speedBetAllowed: boolean;
  trains: ScenarioTrain[];
  stations: ScenarioStation[];
  passengers: ScenarioPassenger[];
  pieceTray: TrayEntry[];
  prePlaced?: Array<ScenarioPlacement & { locked: true; broken?: boolean }>;
  hazards?: ScenarioHazard[];
  objectives?: Array<{ id: string; kind: string; text: string }>;
  stars: { pieceBudget: number; timeTargetTicks: number };
  payoff: { type: PayoffType; focusStationId: string; jingle?: string };
  hints?: Array<{ afterFailures: number; placements: ScenarioPlacement[] }>;
  referenceSolution: ReferenceSolution;
  /** unknown fields are preserved verbatim for forward compatibility (docs/40 §1) */
  [extra: string]: unknown;
}
