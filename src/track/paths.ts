// Piece-local path curves (docs/30 §6, docs/70 M4.1). HEADLESS module — the single source of
// truth for "what is the actual 3D curve shape of path index N of piece type X." The same curve
// objects drive both the train's arc-length movement (track/splines.ts → train/movement, M4.2)
// and the rail mesh sweep (render/meshgen/track.ts) — sim and render share this construction so
// they can never visually disagree about where the track goes (docs/30 §2.1, §6).
//
// Moved here from render/meshgen/track.ts (M3.1) as part of M4.1's extraction — same math, same
// control points, just relocated so the headless zone can reach it without pulling in three.js.
// Only s-bend-left/skew-left are new: previously those two piece types were only ever produced as
// a *rendering* shortcut (mirroring an already-built mesh), which gives no headless Curve to
// compile a LUT from.

import { arcCurve, catmullCurve, lineCurve, type Curve } from '../core/curves';
import { vec, type Vec3 } from '../core/math';
import type { PieceType } from './pieces';

// Headless duplicate of render/meshgen/palette.ts's CELL/HEIGHT_UNIT (docs/30 §5). This module
// must not import anything under render/ (headless-zone rule, docs/30 §2.1), so the two world
// constants are re-declared here; keep them numerically in sync with palette.ts by hand.
const CELL = 2.0;
const HEIGHT_UNIT = 1.0;
const HALF = CELL / 2;

// --- per-piece curves (piece-local, cell (0,0) centered at origin) ---
// Same functions/math as the old render/meshgen/track.ts private builders.

function straightCurve(): Curve {
  return lineCurve(vec(0, 0, -HALF), vec(0, 0, HALF));
}
function curveSmall(): Curve {
  return arcCurve(vec(HALF, 0, -HALF), vec(0, 0, -HALF), -Math.PI / 2);
}
function curveLarge(): Curve {
  return arcCurve(vec(1.5 * CELL, 0, -HALF), vec(0, 0, -HALF), -Math.PI / 2);
}
function rampCurve(): Curve {
  return lineCurve(vec(0, 0, -HALF), vec(0, HEIGHT_UNIT, HALF));
}
function hillCurve(): Curve {
  return catmullCurve([vec(0, 0, -HALF), vec(0, 0.7, HALF), vec(0, 0, 1.5 * CELL)]);
}
function bumpCurve(): Curve {
  return catmullCurve([vec(0, 0, -HALF), vec(0, 0.42, 0), vec(0, 0, HALF)]);
}
// curved inclines: same arcs as the flat curves, but climbing one height level (N@0 → E@+1)
function curveSmallRampCurve(): Curve {
  return arcCurve(vec(HALF, 0, -HALF), vec(0, 0, -HALF), -Math.PI / 2, HEIGHT_UNIT);
}
function curveLargeRampCurve(): Curve {
  return arcCurve(vec(1.5 * CELL, 0, -HALF), vec(0, 0, -HALF), -Math.PI / 2, HEIGHT_UNIT);
}
// s-bend: a gentle 2-cell lateral shift (+1 cell in x), entering and leaving heading +Z
function sBendCurve(): Curve {
  return catmullCurve([vec(0, 0, -HALF), vec(0, 0, HALF), vec(CELL, 0, CELL), vec(CELL, 0, 1.5 * CELL)]);
}
// skew: a sharper single-cell lane change (+1 cell in x over one cell of length)
function skewCurve(): Curve {
  return catmullCurve([
    vec(0, 0, -HALF),
    vec(0, 0, -HALF + 0.25),
    vec(CELL, 0, HALF - 0.25),
    vec(CELL, 0, HALF),
  ]);
}

/** Negate world-X on every control point — mirrors a piece-local curve's shape (not its mesh). */
function mirrorX(points: Vec3[]): Vec3[] {
  return points.map((pt) => vec(-pt.x, pt.y, pt.z));
}

// s-bend-left / skew-left: real headless curves, mirrored by negating X on every control point of
// the right-handed version (NOT the render-only mirrorAssetX mesh-mirror trick — that mirrors a
// *built mesh*, it does not produce a Curve). Endpoints land on the -left piece's own ports
// (checked in paths.test.ts): s-bend-left's far port sits at footprint cell (-1,1); skew-left's
// at cell (-1,0) — both reached by negating X on the same control points used above.
function sBendLeftCurve(): Curve {
  return catmullCurve(
    mirrorX([vec(0, 0, -HALF), vec(0, 0, HALF), vec(CELL, 0, CELL), vec(CELL, 0, 1.5 * CELL)]),
  );
}
function skewLeftCurve(): Curve {
  return catmullCurve(
    mirrorX([vec(0, 0, -HALF), vec(0, 0, -HALF + 0.25), vec(CELL, 0, HALF - 0.25), vec(CELL, 0, HALF)]),
  );
}

/** Crossing's E–W path (independent of its N–S path, which reuses straightCurve()). */
function crossingEWCurve(): Curve {
  return lineCurve(vec(-HALF, 0, 0), vec(HALF, 0, 0));
}

/**
 * Bridge's single N→S path as one continuous Curve: ramp up to the height-1 deck, flat across,
 * ramp back down. Same three straight segments render/meshgen/track.ts's bridgeSpan() sweeps
 * rails along (bridgeSpan is a rendering-only kitbash out of scope for this extraction, so the
 * segment endpoints are kept in sync here by hand).
 */
function bridgeCurve(): Curve {
  const H = HEIGHT_UNIT;
  const zDeckStart = HALF;
  const zDeckEnd = 1.5 * CELL;
  const zEnd = 2.5 * CELL;
  const segmentEnds: [Vec3, Vec3][] = [
    [vec(0, 0, -HALF), vec(0, H, zDeckStart)],
    [vec(0, H, zDeckStart), vec(0, H, zDeckEnd)],
    [vec(0, H, zDeckEnd), vec(0, 0, zEnd)],
  ];
  const segments = segmentEnds.map(([a, b]) => lineCurve(a, b));
  const lens = segmentEnds.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  const total = lens.reduce((sum, l) => sum + l, 0);
  const bounds = [0, lens[0] / total, (lens[0] + lens[1]) / total, 1];

  const locate = (t: number): { i: number; lt: number } => {
    const clamped = Math.min(1, Math.max(0, t));
    for (let i = 0; i < segments.length; i++) {
      if (clamped <= bounds[i + 1] || i === segments.length - 1) {
        const span = bounds[i + 1] - bounds[i];
        const lt = span > 1e-9 ? (clamped - bounds[i]) / span : 0;
        return { i, lt: Math.min(1, Math.max(0, lt)) };
      }
    }
    return { i: segments.length - 1, lt: 1 };
  };

  return {
    pointAt: (t) => {
      const { i, lt } = locate(t);
      return segments[i].pointAt(lt);
    },
    tangentAt: (t) => {
      const { i, lt } = locate(t);
      return segments[i].tangentAt(lt);
    },
  };
}

type PathBuilder = (pathIndex: number) => Curve;

// Keyed by PieceType so the Record forces exhaustiveness (adding a PieceType without a builder
// here is a compile error). Junction/crossing dispatch on pathIndex to their two paths, matching
// PIECE_DEFS[type].paths order (through=0/branch=1; N–S=0/E–W=1).
const PATH_BUILDERS: Record<PieceType, PathBuilder> = {
  straight: () => straightCurve(),
  'curve-small': () => curveSmall(),
  'curve-large': () => curveLarge(),
  's-bend': () => sBendCurve(),
  's-bend-left': () => sBendLeftCurve(),
  skew: () => skewCurve(),
  'skew-left': () => skewLeftCurve(),
  ramp: () => rampCurve(),
  'curve-small-ramp': () => curveSmallRampCurve(),
  'curve-large-ramp': () => curveLargeRampCurve(),
  hill: () => hillCurve(),
  bump: () => bumpCurve(),
  bridge: () => bridgeCurve(),
  tunnel: () => straightCurve(), // a covered straight — identical path shape to `straight`
  junction: (pathIndex) => (pathIndex === 0 ? straightCurve() : curveSmall()),
  crossing: (pathIndex) => (pathIndex === 0 ? straightCurve() : crossingEWCurve()),
};

/**
 * The piece-local Curve for path index `pathIndex` of piece `type`, matching
 * `PIECE_DEFS[type].paths[pathIndex]`. Single source of truth for path geometry — both
 * render/meshgen/track.ts (rails) and track/splines.ts (arc-length LUTs / train movement) build
 * on it, so the visible track and the collision/movement path can never disagree.
 */
export function pathCurve(type: PieceType, pathIndex: number): Curve {
  return PATH_BUILDERS[type](pathIndex);
}
