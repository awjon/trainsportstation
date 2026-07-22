// Headless proof (docs/30 §2.1): the curve math the sim and the rail meshes share
// runs in Node with no three.js, no WebGL. These are the endpoints the ports must land on.

import { describe, expect, it } from 'vitest';
import { arcCurve, catmullCurve, curveLength, lineCurve } from './curves';
import { dist, vec } from './math';

const CELL = 2.0;
const HALF = CELL / 2;

describe('lineCurve (straight piece)', () => {
  it('runs from the north port to the south port', () => {
    const c = lineCurve(vec(0, 0, -HALF), vec(0, 0, HALF));
    expect(dist(c.pointAt(0), vec(0, 0, -HALF))).toBeLessThan(1e-9);
    expect(dist(c.pointAt(1), vec(0, 0, HALF))).toBeLessThan(1e-9);
  });
  it('length equals the cell span', () => {
    const c = lineCurve(vec(0, 0, -HALF), vec(0, 0, HALF));
    expect(curveLength(c)).toBeCloseTo(CELL, 6);
  });
});

describe('arcCurve (curve-small: N->E quarter turn)', () => {
  const c = arcCurve(vec(HALF, 0, -HALF), vec(0, 0, -HALF), -Math.PI / 2);
  it('starts on the north edge midpoint', () => {
    expect(dist(c.pointAt(0), vec(0, 0, -HALF))).toBeLessThan(1e-9);
  });
  it('ends on the east edge midpoint', () => {
    expect(dist(c.pointAt(1), vec(HALF, 0, 0))).toBeLessThan(1e-6);
  });
  it('length is a quarter circle of radius HALF', () => {
    expect(curveLength(c, 64)).toBeCloseTo((Math.PI / 2) * HALF, 3);
  });
});

describe('catmullCurve (hill)', () => {
  const c = catmullCurve([vec(0, 0, -HALF), vec(0, 0.7, HALF), vec(0, 0, 1.5 * CELL)]);
  it('starts and ends at ground level', () => {
    expect(c.pointAt(0).y).toBeCloseTo(0, 6);
    expect(c.pointAt(1).y).toBeCloseTo(0, 6);
  });
  it('rises above ground in the middle (a jumpable crest)', () => {
    expect(c.pointAt(0.5).y).toBeGreaterThan(0.3);
  });
});
