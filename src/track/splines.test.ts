// M4.1 tests (docs/70): LUT fidelity, declared-vs-measured path lengths, and S-1 — the
// continuity invariant that connected pieces' paths meet at the shared node.

import { describe, expect, it } from 'vitest';
import { compilePath, compileWorldPath, measurePath, HEIGHT_PER_CELL } from './splines';
import { PIECE_DEFS, PIECE_TYPES } from './pieces';
import { dist, vec } from '../core/math';
import type { Placement } from './placement';

const EPS = 1e-4;

describe('compiled paths', () => {
  it('every piece path compiles with a positive length', () => {
    for (const t of PIECE_TYPES) {
      PIECE_DEFS[t].paths.forEach((_, i) => {
        const p = compilePath(t, i);
        expect(p.length, `${t}[${i}]`).toBeGreaterThan(0);
      });
    }
  });

  it('LUT length matches a dense measurement within 0.5%', () => {
    for (const t of PIECE_TYPES) {
      PIECE_DEFS[t].paths.forEach((_, i) => {
        const lut = compilePath(t, i).length;
        const measured = measurePath(t, i);
        expect(Math.abs(lut - measured) / measured, `${t}[${i}]`).toBeLessThan(0.005);
      });
    }
  });

  it('declared PathDef lengths match the real geometry within 1%', () => {
    for (const t of PIECE_TYPES) {
      PIECE_DEFS[t].paths.forEach((path, i) => {
        const measured = measurePath(t, i);
        expect(Math.abs(path.length - measured) / measured, `${t}[${i}]`).toBeLessThan(0.01);
      });
    }
  });

  it('sampling by distance is monotonic and hits both ends', () => {
    const p = compilePath('curve-large');
    const start = p.pointAt(0);
    const end = p.pointAt(p.length);
    expect(dist(start, vec(0, 0, -0.5))).toBeLessThan(EPS);
    expect(dist(end, vec(1.5, 0, 1))).toBeLessThan(EPS); // E edge midpoint of cell (1,1)
    // walking forward never goes backwards
    let prev = 0;
    for (let d = 0; d <= p.length; d += p.length / 20) {
      const travelled = dist(start, p.pointAt(d));
      expect(travelled).toBeGreaterThanOrEqual(prev - EPS);
      prev = travelled;
    }
  });

  it('arc-length parameterisation is even (half the distance ≈ half the arc)', () => {
    const p = compilePath('curve-small');
    const mid = p.pointAt(p.length / 2);
    const a = p.pointAt(0);
    const b = p.pointAt(p.length);
    // on a quarter circle the midpoint is equidistant from both ends
    expect(Math.abs(dist(a, mid) - dist(b, mid))).toBeLessThan(0.02);
  });

  it('a ramp climbs exactly one height level', () => {
    const p = compilePath('ramp');
    expect(p.pointAt(0).y).toBeCloseTo(0, 6);
    expect(p.pointAt(p.length).y).toBeCloseTo(HEIGHT_PER_CELL, 6);
  });

  it('a hill rises in the middle and returns to ground', () => {
    const p = compilePath('hill');
    expect(p.pointAt(0).y).toBeCloseTo(0, 6);
    expect(p.pointAt(p.length).y).toBeCloseTo(0, 6);
    expect(p.pointAt(p.length / 2).y).toBeGreaterThan(0.2);
  });
});

describe('world paths', () => {
  it('translates to the placement cell', () => {
    const pl: Placement = { piece: 'straight', cell: { x: 3, z: 4 }, rotation: 0 };
    const p = compileWorldPath(pl);
    expect(dist(p.pointAt(0), vec(3, 0, 3.5))).toBeLessThan(EPS);
    expect(dist(p.pointAt(p.length), vec(3, 0, 4.5))).toBeLessThan(EPS);
  });

  it('rotation 1 turns a N–S straight into a W–E straight', () => {
    const p = compileWorldPath({ piece: 'straight', cell: { x: 0, z: 0 }, rotation: 1 });
    // N edge (0,-0.5) rotates to E edge (0.5,0); S edge (0,0.5) to W edge (-0.5,0)
    expect(dist(p.pointAt(0), vec(0.5, 0, 0))).toBeLessThan(EPS);
    expect(dist(p.pointAt(p.length), vec(-0.5, 0, 0))).toBeLessThan(EPS);
  });

  it('terrain base lifts the whole path', () => {
    const p = compileWorldPath({ piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 }, 0, 1);
    expect(p.pointAt(0).y).toBeCloseTo(HEIGHT_PER_CELL, 6);
  });

  it('S-1: two connected straights meet at the shared node', () => {
    const a = compileWorldPath({ piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });
    const b = compileWorldPath({ piece: 'straight', cell: { x: 0, z: 1 }, rotation: 0 });
    expect(dist(a.pointAt(a.length), b.pointAt(0))).toBeLessThan(EPS);
  });

  it('S-1: a straight meets a curve at the shared node, tangents aligned', () => {
    // straight at (0,0) running N→S; curve-small at (0,1) entering from its N port
    const a = compileWorldPath({ piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 });
    const b = compileWorldPath({ piece: 'curve-small', cell: { x: 0, z: 1 }, rotation: 0 });
    expect(dist(a.pointAt(a.length), b.pointAt(0))).toBeLessThan(EPS);
    const t1 = a.tangentAt(a.length);
    const t2 = b.tangentAt(0);
    const dot = t1.x * t2.x + t1.y * t2.y + t1.z * t2.z;
    expect(dot).toBeGreaterThan(0.99); // within ~8°
  });

  it('S-1: a ramp meets a straight on the shelf above it', () => {
    const ramp = compileWorldPath({ piece: 'ramp', cell: { x: 0, z: 1 }, rotation: 0 }, 0, 0);
    const high = compileWorldPath({ piece: 'straight', cell: { x: 0, z: 2 }, rotation: 0 }, 0, 1);
    expect(dist(ramp.pointAt(ramp.length), high.pointAt(0))).toBeLessThan(EPS);
  });
});
