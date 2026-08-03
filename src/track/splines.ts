// Path geometry + arc-length LUTs (docs/30 §6, docs/70 M4.1). HEADLESS.
//
// Every piece path is a curve in CELL UNITS: cell (x,z) is centred at (x,z), so the N-edge
// midpoint of cell (0,0) is (0,-0.5). These are the same shapes the mesh generator sweeps
// (which works in world units, CELL = 2.0) — one description of the track, so the rails a
// player sees and the line a train rides are the same curve.
//
// Trains move by arc length, so each compiled path carries a LUT mapping distance → parameter.

import { arcCurve, catmullCurve, curveLength, lineCurve, type Curve } from '../core/curves';
import { normalize, sub, vec, type Vec3 } from '../core/math';
import { PIECE_DEFS, rotateCell, type PieceType, type Rotation } from './pieces';
import type { Placement } from './placement';

/** One elevation level, in ground-plane cell units (render: HEIGHT_UNIT 1.0 / CELL 2.0). */
export const HEIGHT_PER_CELL = 0.5;

const H = 0.5; // half a cell — the distance from a cell centre to an edge midpoint
const LEV = HEIGHT_PER_CELL;

/** Piece-local path curves, indexed by piece type then path index. */
function localCurve(piece: PieceType, pathIndex: number): Curve {
  switch (piece) {
    case 'straight':
    case 'tunnel':
      return lineCurve(vec(0, 0, -H), vec(0, 0, H));
    case 'curve-small':
      return arcCurve(vec(H, 0, -H), vec(0, 0, -H), -Math.PI / 2);
    case 'curve-large':
      return arcCurve(vec(1.5, 0, -H), vec(0, 0, -H), -Math.PI / 2);
    case 'curve-small-ramp':
      return arcCurve(vec(H, 0, -H), vec(0, 0, -H), -Math.PI / 2, LEV);
    case 'curve-large-ramp':
      return arcCurve(vec(1.5, 0, -H), vec(0, 0, -H), -Math.PI / 2, LEV);
    case 'ramp':
      return lineCurve(vec(0, 0, -H), vec(0, LEV, H));
    case 'hill':
      return catmullCurve([vec(0, 0, -H), vec(0, 0.35, H), vec(0, 0, 1.5)]);
    case 'bump':
      return catmullCurve([vec(0, 0, -H), vec(0, 0.21, 0), vec(0, 0, H)]);
    case 's-bend':
      return catmullCurve([vec(0, 0, -H), vec(0, 0, H), vec(1, 0, 1), vec(1, 0, 1.5)]);
    case 's-bend-left':
      return catmullCurve([vec(0, 0, -H), vec(0, 0, H), vec(-1, 0, 1), vec(-1, 0, 1.5)]);
    case 'skew':
      return catmullCurve([vec(0, 0, -H), vec(0, 0, -0.375), vec(1, 0, 0.375), vec(1, 0, H)]);
    case 'skew-left':
      return catmullCurve([vec(0, 0, -H), vec(0, 0, -0.375), vec(-1, 0, 0.375), vec(-1, 0, H)]);
    case 'bridge':
      // ramp up → level deck → ramp down, across three cells
      return catmullCurve([vec(0, 0, -H), vec(0, LEV, H), vec(0, LEV, 1.5), vec(0, 0, 2.5)]);
    case 'junction':
      return pathIndex === 0
        ? lineCurve(vec(0, 0, -H), vec(0, 0, H)) // through
        : arcCurve(vec(H, 0, -H), vec(0, 0, -H), -Math.PI / 2); // branch
    case 'crossing':
      return pathIndex === 0
        ? lineCurve(vec(0, 0, -H), vec(0, 0, H)) // N–S
        : lineCurve(vec(-H, 0, 0), vec(H, 0, 0)); // W–E
  }
}

export interface CompiledPath {
  /** total arc length in cell units */
  length: number;
  /** position at a distance along the path (clamped to [0, length]) */
  pointAt(distance: number): Vec3;
  /** unit tangent at a distance along the path */
  tangentAt(distance: number): Vec3;
}

const LUT_SAMPLES = 64;

/** Wrap a curve with an arc-length LUT so it can be sampled by distance. */
export function compileCurve(curve: Curve, samples = LUT_SAMPLES): CompiledPath {
  const ts: number[] = [];
  const cum: number[] = [0];
  let prev = curve.pointAt(0);
  ts.push(0);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const p = curve.pointAt(t);
    cum.push(cum[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
    ts.push(t);
    prev = p;
  }
  const length = cum[cum.length - 1];

  /** distance → curve parameter t, by binary search + linear interpolation in the LUT */
  const tAt = (distance: number): number => {
    const d = Math.max(0, Math.min(length, distance));
    let lo = 0;
    let hi = cum.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo];
    const frac = span > 1e-12 ? (d - cum[lo]) / span : 0;
    return ts[lo] + (ts[hi] - ts[lo]) * frac;
  };

  return {
    length,
    pointAt: (distance) => curve.pointAt(tAt(distance)),
    tangentAt: (distance) => normalize(curve.tangentAt(tAt(distance))),
  };
}

/** Piece-local compiled path (cell units, piece anchor at the origin). */
export function compilePath(piece: PieceType, pathIndex = 0): CompiledPath {
  return compileCurve(localCurve(piece, pathIndex));
}

/** Rotate a continuous point about the origin in quarter turns — matches `rotateCell`. */
export function rotatePoint(p: Vec3, rot: Rotation): Vec3 {
  const r = rotateCell({ x: p.x, z: p.z }, rot);
  return vec(r.x, p.y, r.z);
}

/**
 * A placement's path in world cell-space: local curve rotated, translated to its cell, and
 * lifted by the terrain height under the piece.
 */
export function compileWorldPath(placement: Placement, pathIndex = 0, base = 0): CompiledPath {
  const local = localCurve(placement.piece, pathIndex);
  const dy = base * HEIGHT_PER_CELL;
  const toWorld = (p: Vec3): Vec3 => {
    const r = rotatePoint(p, placement.rotation);
    return vec(r.x + placement.cell.x, r.y + dy, r.z + placement.cell.z);
  };
  const world: Curve = {
    pointAt: (t) => toWorld(local.pointAt(t)),
    tangentAt: (t) => {
      const a = toWorld(local.pointAt(Math.max(0, t - 1e-4)));
      const b = toWorld(local.pointAt(Math.min(1, t + 1e-4)));
      return normalize(sub(b, a));
    },
  };
  return compileCurve(world);
}

/** How many paths a piece has (junction/crossing have two). */
export function pathCount(piece: PieceType): number {
  return PIECE_DEFS[piece].paths.length;
}

/** Straight-line length estimate used to sanity-check declared PathDef lengths. */
export function measurePath(piece: PieceType, pathIndex = 0): number {
  return curveLength(localCurve(piece, pathIndex), 128);
}
