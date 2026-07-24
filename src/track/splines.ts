// Arc-length LUTs over piece-local path curves (docs/30 §6, docs/70 M4.1). HEADLESS — compiles
// each pathCurve() (parametric t in [0,1]) into an arc-length-parameterized CompiledPath so the
// train sim (M4.2) can move at a constant speed along any traversed edge without the underlying
// curve's own t-parameterization distorting speed near tight bends/ramps.

import { vec, type Vec3 } from '../core/math';
import { PIECE_DEFS, PIECE_TYPES, type PieceType } from './pieces';
import { pathCurve } from './paths';

const LUT_SAMPLES = 32;
const LUT_SAMPLES_SAMPLED = 64; // docs/30 §6: "sampled" (Catmull-Rom) curves get 64 samples

// Piece types whose pathCurve is built from catmullCurve — the "sampled" kind in 30 §6.
const SAMPLED_TYPES: ReadonlySet<PieceType> = new Set<PieceType>([
  'hill',
  'bump',
  's-bend',
  's-bend-left',
  'skew',
  'skew-left',
]);

export interface CompiledPath {
  type: PieceType;
  pathIndex: number;
  /** measured from the LUT, in world units */
  length: number;
  /** s clamped to [0, length] */
  pointAt(s: number): Vec3;
  /** unit tangent; s clamped to [0, length] */
  tangentAt(s: number): Vec3;
}

interface Lut {
  /** cumulative arc length at each sample; s[0] === 0, s[N] === length */
  s: number[];
  points: Vec3[];
  tangents: Vec3[];
}

function buildLut(type: PieceType, pathIndex: number): Lut {
  const curve = pathCurve(type, pathIndex);
  const n = SAMPLED_TYPES.has(type) ? LUT_SAMPLES_SAMPLED : LUT_SAMPLES;
  const points: Vec3[] = [curve.pointAt(0)];
  const tangents: Vec3[] = [curve.tangentAt(0)];
  const s: number[] = [0];
  let prev = points[0];
  let acc = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = curve.pointAt(t);
    acc += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    points.push(p);
    tangents.push(curve.tangentAt(t));
    s.push(acc);
    prev = p;
  }
  return { s, points, tangents };
}

/** Binary search + lerp between the two nearest LUT samples bracketing `target` arc length. */
function interpolate(lut: Lut, target: number, pick: (i: number) => Vec3): Vec3 {
  const length = lut.s[lut.s.length - 1];
  const clamped = Math.min(Math.max(target, 0), length);
  let lo = 0;
  let hi = lut.s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lut.s[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const segLen = lut.s[hi] - lut.s[lo];
  const localT = segLen > 1e-9 ? (clamped - lut.s[lo]) / segLen : 0;
  const a = pick(lo);
  const b = pick(hi);
  return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT, z: a.z + (b.z - a.z) * localT };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return len > 1e-9 ? vec(v.x / len, v.y / len, v.z / len) : v;
}

const registry = new Map<string, CompiledPath>();
const keyFor = (type: PieceType, pathIndex: number): string => `${type}:${pathIndex}`;

/** Compile (and cache) the arc-length-parameterized path for `PIECE_DEFS[type].paths[pathIndex]`. */
export function compilePath(type: PieceType, pathIndex: number): CompiledPath {
  const key = keyFor(type, pathIndex);
  const cached = registry.get(key);
  if (cached) return cached;

  const lut = buildLut(type, pathIndex);
  const length = lut.s[lut.s.length - 1];
  const compiled: CompiledPath = {
    type,
    pathIndex,
    length,
    pointAt: (sVal) => interpolate(lut, sVal, (i) => lut.points[i]),
    // tangents are sampled directly from the curve (not derived from position deltas), so lerping
    // two unit vectors isn't itself unit length — renormalize after interpolating.
    tangentAt: (sVal) => normalize(interpolate(lut, sVal, (i) => lut.tangents[i])),
  };
  registry.set(key, compiled);
  return compiled;
}

/** Every (PieceType, pathIndex) pair's compiled path, in PIECE_TYPES/paths order. */
export function compileAllPaths(): CompiledPath[] {
  const out: CompiledPath[] = [];
  for (const type of PIECE_TYPES) {
    PIECE_DEFS[type].paths.forEach((_, pathIndex) => {
      out.push(compilePath(type, pathIndex));
    });
  }
  return out;
}
