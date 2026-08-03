// Arcade physics (docs/30 §7.2–7.4, docs/70 M4.3). HEADLESS and deterministic — the sim only
// decides *that* a train crashed and why; the comedy (ragdolls, confetti, sad trombone) is
// render-side and may be as random as it likes (docs/30 §7.6).
//
// Three rules, in the order a tick evaluates them:
//   jumps    — leave a jumpCapable crest or an elevated dead end fast enough and you fly
//   derails  — sustained overspeed on a curve throws you off
//   collisions — two trains sweeping the same stretch of track in the same tick

import { TICK_DT } from '../core/loop';
import { dist, scale, vec, type Vec3 } from '../core/math';
import type { TrackRuntime } from './runtime';
import { PHYSICS, type CrashCause, type TrainState } from './types';

/** Landing candidates the airborne integrator can snap to. */
export interface LandingSite {
  edgeId: string;
  s: number;
  position: Vec3;
  tangent: Vec3;
}

/** Decide what a dead-end overrun becomes: a jump, a soft stop, or a crash into the gap. */
export function resolveDeadEnd(
  train: TrainState,
  runtime: TrackRuntime,
  overrun: number,
): { kind: 'stopped' } | { kind: 'launched' } | { kind: 'crashed'; cause: CrashCause } {
  const edgeId = train.edgeId!;
  const speed = train.v;

  if (speed <= PHYSICS.vCrawl) {
    train.v = 0;
    return { kind: 'stopped' };
  }
  if (speed >= PHYSICS.jump.vJump) {
    const pos = runtime.positionAt(edgeId, runtime.length(edgeId));
    const tan = runtime.tangentAt(edgeId, runtime.length(edgeId));
    train.airborne = {
      pos: [pos.x, pos.y, pos.z],
      vel: [tan.x * speed, tan.y * speed, tan.z * speed],
    };
    train.edgeId = null;
    void overrun; // the overrun is already spent leaving the rail
    return { kind: 'launched' };
  }
  train.crashed = 'gap';
  return { kind: 'crashed', cause: 'gap' };
}

/**
 * Integrate one tick of ballistic flight. Snaps to a landing site when one lines up, else
 * crashes on touching the ground. Floaty gravity by design — comedy over realism.
 */
export function stepAirborne(
  train: TrainState,
  sites: LandingSite[],
  dt = TICK_DT,
): { kind: 'flying' } | { kind: 'landed'; site: LandingSite } | { kind: 'crashed'; cause: CrashCause } {
  const air = train.airborne;
  if (!air) return { kind: 'flying' };

  air.vel[1] -= PHYSICS.jump.gAir * dt;
  const next: Vec3 = vec(
    air.pos[0] + air.vel[0] * dt,
    air.pos[1] + air.vel[1] * dt,
    air.pos[2] + air.vel[2] * dt,
  );
  air.pos = [next.x, next.y, next.z];

  const flightDir = normalizeSafe(vec(air.vel[0], air.vel[1], air.vel[2]));
  const cosLimit = Math.cos((PHYSICS.jump.landingAngleDeg * Math.PI) / 180);

  for (const site of sites) {
    if (dist(next, site.position) > PHYSICS.jump.landingRadius) continue;
    if (Math.abs(next.y - site.position.y) > PHYSICS.jump.landingHeightTolerance) continue;
    const alignment =
      flightDir.x * site.tangent.x + flightDir.y * site.tangent.y + flightDir.z * site.tangent.z;
    if (alignment < cosLimit) continue;

    const speed = Math.hypot(air.vel[0], air.vel[1], air.vel[2]);
    train.airborne = null;
    train.edgeId = site.edgeId;
    train.s = site.s;
    train.v = speed * PHYSICS.jump.landingSpeedRetained;
    train.overspeedTicks = 0;
    return { kind: 'landed', site };
  }

  if (next.y <= 0) {
    train.airborne = null;
    train.crashed = 'bad-landing';
    return { kind: 'crashed', cause: 'bad-landing' };
  }
  return { kind: 'flying' };
}

function normalizeSafe(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? scale(v, 1 / l) : vec(0, 0, 1);
}

/**
 * Sustained overspeed on a curve derails. The grace window is what makes Ludicrous a *bet*:
 * clipping a short curve too fast survives; holding it does not.
 */
export function checkDerail(train: TrainState, runtime: TrackRuntime): CrashCause | null {
  if (train.edgeId === null || train.crashed) return null;
  const { curveClass } = runtime.get(train.edgeId).edge;
  const limit = PHYSICS.derail.maxSpeed[curveClass];
  if (limit === null || limit === undefined) {
    train.overspeedTicks = 0;
    return null;
  }
  if (train.v <= limit) {
    train.overspeedTicks = 0;
    return null;
  }
  train.overspeedTicks++;
  if (train.overspeedTicks > PHYSICS.derail.graceTicks) {
    train.crashed = 'speeding-curve';
    return 'speeding-curve';
  }
  return null;
}

/** The stretch of track a train occupies: [tail, head] arc lengths on one edge. */
export interface Occupancy {
  trainId: string;
  edgeId: string;
  from: number;
  to: number;
}

/** A consist spans the locomotive body plus everything trailing behind it. */
export function consistLength(train: TrainState): number {
  const carriages = train.carriages.reduce((m, c) => Math.max(m, c.offset), 0);
  return PHYSICS.locoLength + carriages;
}

export function occupancyOf(train: TrainState): Occupancy | null {
  if (train.edgeId === null || train.crashed) return null;
  const head = train.s;
  const tail = head - consistLength(train);
  return { trainId: train.id, edgeId: train.edgeId, from: tail, to: head };
}

/**
 * Two trains whose swept intervals overlap on the same edge collide. Returns the colliding
 * pairs — deterministic, and evaluated after movement so the tick is exact.
 */
export function detectCollisions(trains: TrainState[], runtime: TrackRuntime): Array<[string, string]> {
  const occ = trains.map((t) => occupancyOf(t)).filter((o): o is Occupancy => o !== null);
  const hits: Array<[string, string]> = [];
  for (let i = 0; i < occ.length; i++) {
    for (let j = i + 1; j < occ.length; j++) {
      const a = occ[i];
      const b = occ[j];
      if (a.edgeId !== b.edgeId && !sameCell(a, b, runtime)) continue;
      if (a.edgeId === b.edgeId && (a.to < b.from || b.to < a.from)) continue;
      hits.push([a.trainId, b.trainId]);
    }
  }
  return hits;
}

/** Two trains on different edges still collide when those edges share a crossing cell. */
function sameCell(a: Occupancy, b: Occupancy, runtime: TrackRuntime): boolean {
  const ea = runtime.get(a.edgeId).edge;
  const eb = runtime.get(b.edgeId).edge;
  if (ea.placementIndex !== eb.placementIndex) return false;
  // same piece, different paths — a crossing: both lanes share the cell
  const pa = runtime.positionAt(a.edgeId, a.to);
  const pb = runtime.positionAt(b.edgeId, b.to);
  return dist(pa, pb) < 0.5;
}

/** Apply a crash cause to a train (idempotent — the first cause sticks). */
export function crash(train: TrainState, cause: CrashCause): void {
  if (!train.crashed) {
    train.crashed = cause;
    train.v = 0;
    train.airborne = null;
  }
}

/** Candidate landing sites sampled along every edge — used by the airborne integrator. */
export function landingSites(runtime: TrackRuntime, samplesPerEdge = 8): LandingSite[] {
  const sites: LandingSite[] = [];
  for (const edge of runtime.graph.edges.values()) {
    if (edge.reversed) continue; // one direction is enough for geometry
    const len = runtime.length(edge.id);
    for (let i = 0; i <= samplesPerEdge; i++) {
      const s = (len * i) / samplesPerEdge;
      sites.push({
        edgeId: edge.id,
        s,
        position: runtime.positionAt(edge.id, s),
        tangent: runtime.tangentAt(edge.id, s),
      });
    }
  }
  return sites;
}

/** Ballistic apex height above the launch point, for telegraphing a jump in the UI. */
export function apexHeight(speedY: number): number {
  return (speedY * speedY) / (2 * PHYSICS.jump.gAir);
}
