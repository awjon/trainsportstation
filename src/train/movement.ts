// Train kinematics (docs/30 §7.1, §6, docs/70 M4.2). HEADLESS.
//
// A train is a scalar: (edge, distance along it, speed). Each tick we integrate longitudinal
// dynamics, advance by v·dt, and hand off across edge boundaries carrying the leftover
// distance — never losing a partial tick's travel, which is what keeps the sim exact.
// Carriages trail the locomotive by fixed arc lengths, walked back along the edges it came from.

import { TICK_DT } from '../core/loop';
import type { Vec3 } from '../core/math';
import type { TrackEdge } from '../track/graph';
import type { TrackRuntime } from './runtime';
import { PHYSICS, type SpeedBet, type TrainState } from './types';

export interface MoveOptions {
  speedBet: SpeedBet;
  switchStates?: ReadonlyMap<number, 0 | 1>;
  /** 1 = accelerate toward target, 0 = coast, -1 = brake (stations use this) */
  throttle?: number;
  dt?: number;
}

export type MoveOutcome =
  | { kind: 'moved'; distance: number; crossings: string[] }
  | { kind: 'dead-end'; distance: number; crossings: string[]; overrun: number }
  | { kind: 'blocked' };

/** Longitudinal dynamics — the only continuous physics in the game (docs/30 §7.1). */
export function integrateSpeed(
  v: number,
  grade: -1 | 0 | 1,
  bet: SpeedBet,
  throttle = 1,
  dt = TICK_DT,
): number {
  const vTarget = PHYSICS.vBase * PHYSICS.speedBet[bet] * Math.max(0, throttle);
  const dir = Math.sign(vTarget - v);
  const a = PHYSICS.aThrottle * dir - PHYSICS.gSlope * grade - PHYSICS.cDrag * v;
  return Math.max(0, Math.min(PHYSICS.vHardMax, v + a * dt));
}

/** How far the train's trail must reach to place every carriage. */
function trailSpan(train: TrainState): number {
  return train.carriages.reduce((max, c) => Math.max(max, c.offset), 0);
}

/**
 * Advance one train by one tick. Mutates `train`. Returns what happened so the physics layer
 * (M4.3) can turn a dead-end overrun into a jump or a crash.
 */
export function stepTrain(train: TrainState, runtime: TrackRuntime, opts: MoveOptions): MoveOutcome {
  const dt = opts.dt ?? TICK_DT;
  if (train.crashed || train.edgeId === null) return { kind: 'blocked' };

  const current = runtime.get(train.edgeId);
  train.v = integrateSpeed(train.v, current.edge.grade, opts.speedBet, opts.throttle ?? 1, dt);

  let remaining = train.v * dt;
  const distance = remaining;
  const crossings: string[] = [];

  while (remaining > 0) {
    const edgeLength = runtime.length(train.edgeId!);
    const room = edgeLength - train.s;
    if (remaining < room) {
      train.s += remaining;
      remaining = 0;
      break;
    }
    // consume the rest of this edge and hand off
    remaining -= room;
    const next: TrackEdge | undefined = runtime.nextEdges(train.edgeId!, opts.switchStates ?? new Map())[0];
    if (!next) {
      train.s = edgeLength;
      return { kind: 'dead-end', distance, crossings, overrun: remaining };
    }
    train.trail.unshift(train.edgeId!);
    const span = trailSpan(train) + PHYSICS.carriageSpacing;
    let acc = 0;
    let keep = 0;
    for (const id of train.trail) {
      acc += runtime.length(id);
      keep++;
      if (acc >= span) break;
    }
    train.trail.length = Math.min(train.trail.length, Math.max(keep, 1));
    train.edgeId = next.id;
    train.s = 0;
    crossings.push(next.id);
  }

  train.odometer += distance;
  return { kind: 'moved', distance, crossings };
}

/** World position of a point `behind` arc-length units back from the locomotive. */
export function trailingPosition(train: TrainState, runtime: TrackRuntime, behind: number): Vec3 {
  if (train.edgeId === null) throw new Error('trailingPosition: train is not on an edge');
  let d = behind;
  if (d <= train.s) return runtime.positionAt(train.edgeId, train.s - d);
  d -= train.s;
  for (const edgeId of train.trail) {
    const len = runtime.length(edgeId);
    if (d <= len) return runtime.positionAt(edgeId, len - d);
    d -= len;
  }
  // ran off the back of the recorded trail — clamp to its far end
  const oldest = train.trail[train.trail.length - 1] ?? train.edgeId;
  return runtime.positionAt(oldest, 0);
}

/** World positions of the locomotive and each carriage, front to back. */
export function consistPositions(train: TrainState, runtime: TrackRuntime): Vec3[] {
  const head = runtime.positionAt(train.edgeId!, train.s);
  return [head, ...train.carriages.map((c) => trailingPosition(train, runtime, c.offset))];
}
