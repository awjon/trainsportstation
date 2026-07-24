// M4.2 test: data/physics.json's baseline values transcribed correctly against docs/30 §7.1-7.5
// (this task only *records* these constants; M4.3/M4.4 read them, this is just a transcription
// guard so a typo here doesn't silently corrupt later tasks).

import { describe, expect, it } from 'vitest';
import { PHYSICS } from './physics-constants';

describe('PHYSICS constants match docs/30 §7 baselines', () => {
  it('§7.1 longitudinal model', () => {
    expect(PHYSICS.vBase).toBe(3.0);
    expect(PHYSICS.aThrottle).toBe(2.0);
    expect(PHYSICS.gSlope).toBe(1.2);
    expect(PHYSICS.cDrag).toBe(0.08);
    expect(PHYSICS.vHardMax).toBe(8.0);
    expect(PHYSICS.vCrawl).toBe(0.3);
    expect(PHYSICS.CARRIAGE_SPACING).toBe(0.55);
    expect(PHYSICS.betMult).toEqual({ steady: 1.0, swift: 1.4, ludicrous: 1.9 });
  });

  it('§7.2 jumps', () => {
    expect(PHYSICS.vJump).toBe(3.5);
    expect(PHYSICS.gAir).toBe(9.0);
    expect(PHYSICS.landingRadius).toBe(0.4);
    expect(PHYSICS.landingAngleDeg).toBe(25);
    expect(PHYSICS.landingHeightTolerance).toBe(0.3);
  });

  it('§7.3 derail on curves', () => {
    expect(PHYSICS.maxSpeedByCurveClass).toEqual({ gentle: 4.5, tight: 3.2 });
    expect(PHYSICS.derailGraceTicks).toBe(12);
  });

  it('§7.5 stations', () => {
    expect(PHYSICS.dwellTicks).toBe(90);
  });
});
