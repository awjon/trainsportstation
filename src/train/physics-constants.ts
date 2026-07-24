// Thin typed loader over the top-level `data/physics.json` (docs/30 §7 baseline constants,
// docs/70 M4.2). HEADLESS. The JSON is the single source of truth for tuning — nothing here
// hardcodes a value, and nothing in this file re-derives or edits one.
//
// M4.2 (this task) only consumes `vCrawl` (dead-end soft-stop threshold, docs/30 §6) and
// `CARRIAGE_SPACING` (used by movement.test.ts to build realistic carriage offsets) — every
// other constant here is recorded now purely so M4.3 (arcade physics: §7.1-7.4) and M4.4
// (stations/dwell: §7.5) can import this same module later without ever touching this file.

import physicsJson from '../../data/physics.json';

export interface PhysicsConstants {
  // §7.1 longitudinal model
  vBase: number;
  aThrottle: number;
  gSlope: number;
  cDrag: number;
  vHardMax: number;
  vCrawl: number;
  CARRIAGE_SPACING: number;
  betMult: { steady: number; swift: number; ludicrous: number };
  // §7.2 jumps
  vJump: number;
  gAir: number;
  landingRadius: number;
  landingAngleDeg: number;
  landingHeightTolerance: number;
  // §7.3 derail on curves
  maxSpeedByCurveClass: { gentle: number; tight: number };
  derailGraceTicks: number;
  // §7.5 stations
  dwellTicks: number;
}

export const PHYSICS: PhysicsConstants = physicsJson;
