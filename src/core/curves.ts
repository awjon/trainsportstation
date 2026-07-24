// Piece-local path curves (docs/30 §6). A curve maps a parameter t in [0,1] to a
// world-unit point and a unit tangent. The same curve drives both the train's
// arc-length movement (headless sim) and the swept rail mesh (render/meshgen) —
// that shared origin is what guarantees the visible track matches the collision path.
//
// Headless-zone module: no three.js.

import { add, cross, lerp, normalize, scale, sub, vec, type Vec3 } from './math';

export interface Curve {
  pointAt(t: number): Vec3;
  tangentAt(t: number): Vec3;
}

/** Straight segment between two points (used for straight/ramp/bridge/tunnel rails). */
export function lineCurve(a: Vec3, b: Vec3): Curve {
  const dir = normalize(sub(b, a));
  return {
    pointAt: (t) => lerp(a, b, t),
    tangentAt: () => dir,
  };
}

/**
 * Quarter (or arbitrary-sweep) arc in the XZ plane, optional linear Y ramp.
 * `center` is the arc center; `start` the starting point; `sweep` radians (signed).
 */
export function arcCurve(center: Vec3, start: Vec3, sweep: number, yEnd?: number): Curve {
  const r = Math.hypot(start.x - center.x, start.z - center.z);
  const a0 = Math.atan2(start.z - center.z, start.x - center.x);
  const y0 = start.y;
  const y1 = yEnd ?? start.y;
  return {
    pointAt: (t) => {
      const a = a0 + sweep * t;
      return vec(center.x + r * Math.cos(a), y0 + (y1 - y0) * t, center.z + r * Math.sin(a));
    },
    tangentAt: (t) => {
      const a = a0 + sweep * t;
      const s = Math.sign(sweep) || 1;
      return normalize(vec(-Math.sin(a) * s, (y1 - y0) / (Math.PI / 2), Math.cos(a) * s));
    },
  };
}

/** Catmull-Rom spline through control points (hills, bumps, organic rises). */
export function catmullCurve(points: Vec3[]): Curve {
  const pts = points.length >= 2 ? points : [vec(), vec(0, 0, 1)];
  const seg = pts.length - 1;
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const sample = (t: number): Vec3 => {
    if (t <= 0) return pts[0];
    if (t >= 1) return pts[pts.length - 1];
    const f = Math.min(0.999999, t) * seg;
    const i = Math.floor(f);
    const lt = f - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const t2 = lt * lt;
    const t3 = t2 * lt;
    const comp = (a: number, b: number, c: number, d: number) =>
      0.5 * (2 * b + (-a + c) * lt + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return vec(comp(p0.x, p1.x, p2.x, p3.x), comp(p0.y, p1.y, p2.y, p3.y), comp(p0.z, p1.z, p2.z, p3.z));
  };
  return {
    pointAt: sample,
    tangentAt: (t) => {
      const e = 1e-3;
      return normalize(sub(sample(Math.min(1, t + e)), sample(Math.max(0, t - e))));
    },
  };
}

export interface Frame {
  position: Vec3;
  tangent: Vec3;
  /** side vector (right of travel, in XZ) */
  right: Vec3;
  /** up vector */
  up: Vec3;
}

/**
 * Sample a curve into N+1 evenly-parameterised frames with a stable up vector.
 * Frames carry an orthonormal basis so a cross-section can be swept along the path.
 */
export function sampleFrames(curve: Curve, segments: number): Frame[] {
  const frames: Frame[] = [];
  const worldUp = vec(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const position = curve.pointAt(t);
    const tangent = normalize(curve.tangentAt(t));
    let right = normalize(cross(tangent, worldUp));
    if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = vec(1, 0, 0);
    const up = normalize(cross(right, tangent));
    frames.push({ position, tangent, right, up });
  }
  return frames;
}

/** Approximate arc length by polyline summation (arc-length LUT basis, docs/30 §6). */
export function curveLength(curve: Curve, segments = 32): number {
  let len = 0;
  let prev = curve.pointAt(0);
  for (let i = 1; i <= segments; i++) {
    const p = curve.pointAt(i / segments);
    len += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    prev = p;
  }
  return len;
}

/** Offset a frame's origin by (rightAmount, upAmount) in its local basis. */
export function frameOffset(f: Frame, rightAmount: number, upAmount: number): Vec3 {
  return add(f.position, add(scale(f.right, rightAmount), scale(f.up, upAmount)));
}
