// M4.1 tests (docs/70, docs/30 §6): LUT length tolerance and the S-1 continuity invariant.
//
// S-1 pairs are built the same way graph.ts/graph.test.ts finds shared nodes — two placements
// (piece type + world cell + rotation) with a port on A facing a port on B across the same cell
// edge at the same height — except here we need *continuous* geometry (a world-space point and
// tangent), not just the discrete node id graph.ts computes, so pieceʼs local curve endpoints are
// rotated + translated into world space by hand (rotateXZ below matches pieces.ts's rotateCell /
// the renderer's actual -(rotation)·π/2-about-Y transform, confirmed against
// render/instances.test.ts's placement test — NOT core/math.ts's `rotateYQuarter`, which turns
// out to rotate the opposite way and isn't used anywhere else in the codebase).

import { describe, expect, it } from 'vitest';
import { vec, type Vec3 } from '../core/math';
import { PIECE_DEFS, PIECE_TYPES, type CellCoord, type PieceType, type Rotation } from './pieces';
import { compilePath, compileAllPaths } from './splines';

const CELL = 2.0; // docs/30 §5 (headless test — can't import render/meshgen/palette.ts)
const LENGTH_TOLERANCE = 0.005; // 0.5%
const POSITION_TOLERANCE = 1e-4 * CELL;
const TANGENT_TOLERANCE_DEG = 1;

describe('LUT length matches PathDef.length within 0.5% (docs/30 §6)', () => {
  for (const type of PIECE_TYPES) {
    PIECE_DEFS[type].paths.forEach((path, pathIndex) => {
      it(`${type}[${pathIndex}]`, () => {
        const compiled = compilePath(type, pathIndex);
        const diff = Math.abs(compiled.length - path.length) / path.length;
        expect(diff).toBeLessThanOrEqual(LENGTH_TOLERANCE);
      });
    });
  }

  it('compileAllPaths covers every PIECE_DEFS path exactly once', () => {
    const all = compileAllPaths();
    const expectedCount = PIECE_TYPES.reduce((n, t) => n + PIECE_DEFS[t].paths.length, 0);
    expect(all).toHaveLength(expectedCount);
  });
});

describe('CompiledPath interpolates between LUT samples (not nearest-sample snapping)', () => {
  it('pointAt/tangentAt vary smoothly with s, not in visible per-sample steps', () => {
    const cp = compilePath('curve-large', 0); // a 36-sample-in-render curve, 32-sample LUT here
    const samples = 200;
    let prev = cp.pointAt(0);
    let maxStep = 0;
    for (let i = 1; i <= samples; i++) {
      const s = (cp.length * i) / samples;
      const p = cp.pointAt(s);
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
      prev = p;
    }
    // if pointAt only snapped to the nearest of 32 LUT samples, steps would jump in
    // length/32-sized chunks (~0.147); smooth interpolation keeps every fine step tiny.
    expect(maxStep).toBeLessThan(cp.length / samples + 1e-6);
  });

  it('s is clamped to [0, length]', () => {
    const cp = compilePath('straight', 0);
    expect(cp.pointAt(-5)).toEqual(cp.pointAt(0));
    expect(cp.pointAt(cp.length + 5)).toEqual(cp.pointAt(cp.length));
  });

  it('tangentAt always returns a unit vector', () => {
    const cp = compilePath('hill', 0); // sampled/Catmull curve — most likely to expose lerp drift
    for (let i = 0; i <= 10; i++) {
      const s = (cp.length * i) / 10;
      const t = cp.tangentAt(s);
      expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(1, 6);
    }
  });
});

// --- S-1: continuity across adjacent placements (docs/30 §6) ---

/** Rotate a piece-local (x,z) `rotation` quarter turns clockwise (matches rotateCell/renderer). */
function rotateXZ(v: Vec3, rotation: Rotation): Vec3 {
  let { x, z } = v;
  for (let i = 0; i < rotation; i++) {
    const nx = -z;
    const nz = x;
    x = nx;
    z = nz;
  }
  return vec(x, v.y, z);
}

/** World-space position of a piece-local point for a placement at `cell` with `rotation`. */
function placedPoint(v: Vec3, cell: CellCoord, rotation: Rotation): Vec3 {
  const r = rotateXZ(v, rotation);
  return vec(r.x + cell.x * CELL, r.y, r.z + cell.z * CELL);
}

/** World-space direction of a piece-local tangent for a placement at `rotation` (no translation). */
function placedDirection(v: Vec3, rotation: Rotation): Vec3 {
  return rotateXZ(v, rotation);
}

function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** One side of a boundary: a placed piece's path, and whether the shared port is its curve's
 *  t=0 ('from') or t=1 ('to') end. */
interface Side {
  type: PieceType;
  pathIndex: number;
  role: 'from' | 'to';
  cell: CellCoord;
  rotation: Rotation;
}

function worldPointAndTangent(side: Side): { pos: Vec3; tangent: Vec3 } {
  const curve = compilePath(side.type, side.pathIndex);
  const s = side.role === 'from' ? 0 : curve.length;
  return {
    pos: placedPoint(curve.pointAt(s), side.cell, side.rotation),
    tangent: placedDirection(curve.tangentAt(s), side.rotation),
  };
}

describe('S-1: adjacent placements agree at the shared boundary', () => {
  it('straight → straight (flat, colinear)', () => {
    const a = worldPointAndTangent({
      type: 'straight',
      pathIndex: 0,
      role: 'to',
      cell: { x: 0, z: 0 },
      rotation: 0,
    });
    const b = worldPointAndTangent({
      type: 'straight',
      pathIndex: 0,
      role: 'from',
      cell: { x: 0, z: 1 },
      rotation: 0,
    });
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThanOrEqual(
      POSITION_TOLERANCE,
    );
    expect(angleBetweenDeg(a.tangent, b.tangent)).toBeLessThanOrEqual(TANGENT_TOLERANCE_DEG);
  });

  it('straight → curve-small (flat, both start heading the same way)', () => {
    const a = worldPointAndTangent({
      type: 'straight',
      pathIndex: 0,
      role: 'to',
      cell: { x: 0, z: 0 },
      rotation: 0,
    });
    const b = worldPointAndTangent({
      type: 'curve-small',
      pathIndex: 0,
      role: 'from',
      cell: { x: 0, z: 1 },
      rotation: 0,
    });
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThanOrEqual(
      POSITION_TOLERANCE,
    );
    expect(angleBetweenDeg(a.tangent, b.tangent)).toBeLessThanOrEqual(TANGENT_TOLERANCE_DEG);
  });

  it('curve-small → ramp: position matches exactly; horizontal heading matches; KNOWN grade kink', () => {
    // curve-small's E port (cell (0,0)) neighbours cell (1,0)'s W edge. Rotating `ramp` by 3
    // quarter turns puts its (originally N) port on that W edge, at the same height (both 0).
    const a = worldPointAndTangent({
      type: 'curve-small',
      pathIndex: 0,
      role: 'to',
      cell: { x: 0, z: 0 },
      rotation: 0,
    });
    const b = worldPointAndTangent({
      type: 'ramp',
      pathIndex: 0,
      role: 'from',
      cell: { x: 1, z: 0 },
      rotation: 3,
    });

    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThanOrEqual(
      POSITION_TOLERANCE,
    );
    // horizontal heading (compass direction, ignoring grade) is continuous...
    const headingA = vec(a.tangent.x, 0, a.tangent.z);
    const headingB = vec(b.tangent.x, 0, b.tangent.z);
    expect(angleBetweenDeg(headingA, headingB)).toBeLessThanOrEqual(TANGENT_TOLERANCE_DEG);
    // ...but the full 3D tangent is NOT within docs/30 §6's 1° S-1 tolerance here: `ramp` is a
    // constant-slope straight line (no easement), so it carries its full ~26.57° climb angle
    // right up to its flat-side port. This is a genuine, measured property of the existing
    // (M2/M3, out-of-scope-for-M4.1) ramp/hill/bump/curve-*-ramp curves, not a bug in this
    // extraction — flagged in the M4.1 report as a known risk for M4.2+ to decide on.
    const fullAngle = angleBetweenDeg(a.tangent, b.tangent);
    expect(fullAngle).toBeGreaterThan(TANGENT_TOLERANCE_DEG);
    expect(fullAngle).toBeCloseTo(26.565, 0);
  });

  it('junction (through path) → straight', () => {
    const a = worldPointAndTangent({
      type: 'junction',
      pathIndex: 0,
      role: 'to',
      cell: { x: 0, z: 0 },
      rotation: 0,
    });
    const b = worldPointAndTangent({
      type: 'straight',
      pathIndex: 0,
      role: 'from',
      cell: { x: 0, z: 1 },
      rotation: 0,
    });
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThanOrEqual(
      POSITION_TOLERANCE,
    );
    expect(angleBetweenDeg(a.tangent, b.tangent)).toBeLessThanOrEqual(TANGENT_TOLERANCE_DEG);
  });

  it('crossing (E–W path, the reversed-direction one) → straight', () => {
    // crossing's E–W path curve runs W→E (t=0 at the W port), a pre-existing render-code quirk
    // carried over verbatim (see paths.ts). `role` here tracks the CURVE's own t=0/t=1 ends, not
    // the PathDef's fromPort/toPort labels, so the reversal doesn't need special-casing below.
    const a = worldPointAndTangent({
      type: 'crossing',
      pathIndex: 1,
      role: 'from',
      cell: { x: 0, z: 0 },
      rotation: 0,
    });
    // straight's *toPort* (local S) needs to land on crossing's W edge — that means rotating
    // straight by 3 quarter turns (S → W) and placing it one cell further west.
    const b = worldPointAndTangent({
      type: 'straight',
      pathIndex: 0,
      role: 'to',
      cell: { x: -1, z: 0 },
      rotation: 3,
    });

    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThanOrEqual(
      POSITION_TOLERANCE,
    );
    expect(angleBetweenDeg(a.tangent, b.tangent)).toBeLessThanOrEqual(TANGENT_TOLERANCE_DEG);
  });
});
