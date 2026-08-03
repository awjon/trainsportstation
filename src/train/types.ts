// Train state + physics config types (docs/30 §4, §7). HEADLESS.

import physics from '../../data/physics.json';

export type SpeedBet = 'steady' | 'swift' | 'ludicrous';

export interface CarriageState {
  /** persona riding in this carriage, or null when empty */
  personaId: string | null;
  /** arc-length distance behind the locomotive */
  offset: number;
}

export interface Airborne {
  pos: [number, number, number];
  vel: [number, number, number];
}

export type CrashCause = 'gap' | 'speeding-curve' | 'collision' | 'bad-landing' | 'hazard';

export interface TrainState {
  id: string;
  /** current graph edge, or null while airborne / crashed / parked */
  edgeId: string | null;
  /** arc length travelled along the current edge */
  s: number;
  /** scalar speed in cell units per second */
  v: number;
  airborne: Airborne | null;
  crashed: CrashCause | null;
  /** consecutive ticks spent over the current edge's derail threshold */
  overspeedTicks: number;
  carriages: CarriageState[];
  /** ticks remaining of a station dwell (0 when running) */
  dwellTicks: number;
  /** edges already travelled, most recent first — carriages trail back along these */
  trail: string[];
  /** total arc length travelled, for distance-conservation checks */
  odometer: number;
}

export interface PhysicsConfig {
  vBase: number;
  aThrottle: number;
  gSlope: number;
  cDrag: number;
  vHardMax: number;
  vCrawl: number;
  carriageSpacing: number;
  /** length of the locomotive body itself, so a solo engine still occupies track */
  locoLength: number;
  speedBet: Record<SpeedBet, number>;
  jump: {
    vJump: number;
    gAir: number;
    landingRadius: number;
    landingAngleDeg: number;
    landingHeightTolerance: number;
    landingSpeedRetained: number;
  };
  derail: {
    graceTicks: number;
    maxSpeed: { straight: number | null; gentle: number | null; tight: number | null };
  };
  station: { dwellTicks: number; stopTolerance: number };
}

export const PHYSICS: PhysicsConfig = physics as unknown as PhysicsConfig;

export function makeTrain(id: string, edgeId: string | null, carriageCount = 0): TrainState {
  return {
    id,
    edgeId,
    s: 0,
    v: 0,
    airborne: null,
    crashed: null,
    overspeedTicks: 0,
    dwellTicks: 0,
    trail: [],
    odometer: 0,
    carriages: Array.from({ length: carriageCount }, (_, i) => ({
      personaId: null,
      offset: PHYSICS.carriageSpacing * (i + 1),
    })),
  };
}
