// Thin typed loader over the top-level `data/physics.json` (docs/30 §7 baseline constants,
// docs/70 M4.2). HEADLESS. The JSON is the single source of truth for tuning — nothing here
// hardcodes a value, and nothing in this file re-derives or edits one.
//
// M4.2 (this task) consumes `vBase`/`aThrottle`/`gSlope`/`cDrag`/`vHardMax`/`betMult` (the §7.1
// longitudinal/acceleration model — implemented in movement.ts's `advanceTrain`, corrected into
// scope after an initial task-contract miscue: docs/70's M4.3 "Reuse" line starts at §7.2,
// meaning §7.1 was always M4.2's), `vCrawl` (dead-end soft-stop threshold, docs/30 §6), and
// `CARRIAGE_SPACING` (used by movement.test.ts to build realistic carriage offsets). Every other
// constant here is recorded purely so M4.3 (jumps/derails/collisions: §7.2-7.4) and M4.4
// (stations/dwell: §7.5) can import this same module later without ever touching this file.

import physicsJson from '../../data/physics.json';

/**
 * A run-level input (chosen once per dispatch, not per-tick sim state — consistent with how
 * `switchStates` is passed into `advanceTrain` rather than stored on `TrainState`, since
 * `TrainState` per docs/30 §4 has no bet field). Defined here (next to `PHYSICS.betMult`, its
 * natural home) because `simulation/sim.ts` is M5's file and doesn't exist yet — M5 should
 * import/re-export this rather than redefine it.
 */
export type SpeedBet = 'steady' | 'swift' | 'ludicrous';

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
