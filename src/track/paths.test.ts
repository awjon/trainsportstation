// M4.1 tests (docs/70, docs/30 §6): every pathCurve(type, pathIndex) actually starts/ends at the
// ports PIECE_DEFS says it should. Special attention on s-bend-left/skew-left — the two curves
// this milestone adds — since previously those piece types only ever existed as a render-mesh
// mirror (mirrorAssetX), which gives no headless Curve to check against ports at all.

import { describe, expect, it } from 'vitest';
import { curveLength } from '../core/curves';
import { dist, vec, type Vec3 } from '../core/math';
import { PIECE_DEFS, PIECE_TYPES, edgeStep, type Port } from './pieces';
import { pathCurve } from './paths';

const CELL = 2.0; // docs/30 §5 (headless test — can't import render/meshgen/palette.ts)
const HEIGHT_UNIT = 1.0;
const HALF = CELL / 2;
const EPS = 1e-6;

/** A port's piece-local world position (rotation 0, anchor cell (0,0)): the cell center, offset
 *  half a cell toward the port's edge, at the port's height. */
function portWorldPos(port: Port): Vec3 {
  const step = edgeStep(port.edge);
  return vec(
    port.cell.x * CELL + step.x * HALF,
    port.height * HEIGHT_UNIT,
    port.cell.z * CELL + step.z * HALF,
  );
}

describe('pathCurve endpoints land on PIECE_DEFS ports', () => {
  for (const type of PIECE_TYPES) {
    const def = PIECE_DEFS[type];
    def.paths.forEach((path, pathIndex) => {
      // crossing's E–W path (index 1) is a pre-existing render-code quirk (verbatim from
      // render/meshgen/track.ts): its curve runs toPort→fromPort (W→E), not fromPort→toPort —
      // see paths.ts's crossingEWCurve() comment.
      const reversed = type === 'crossing' && pathIndex === 1;
      const startPort = def.ports[reversed ? path.toPort : path.fromPort];
      const endPort = def.ports[reversed ? path.fromPort : path.toPort];

      it(`${type}[${pathIndex}] t=0 lands on its start port`, () => {
        const c = pathCurve(type, pathIndex);
        expect(dist(c.pointAt(0), portWorldPos(startPort))).toBeLessThan(EPS);
      });
      it(`${type}[${pathIndex}] t=1 lands on its end port`, () => {
        const c = pathCurve(type, pathIndex);
        expect(dist(c.pointAt(1), portWorldPos(endPort))).toBeLessThan(EPS);
      });
    });
  }
});

describe('s-bend-left / skew-left: real mirrored curves, not the render-only mesh mirror', () => {
  it("s-bend-left ends at footprint cell (-1,1) — the X-mirror of s-bend's end", () => {
    const rightEnd = pathCurve('s-bend', 0).pointAt(1);
    const leftEnd = pathCurve('s-bend-left', 0).pointAt(1);
    expect(leftEnd.x).toBeCloseTo(-rightEnd.x, 9);
    expect(leftEnd.y).toBeCloseTo(rightEnd.y, 9);
    expect(leftEnd.z).toBeCloseTo(rightEnd.z, 9);

    const port = PIECE_DEFS['s-bend-left'].ports[1];
    expect(port.cell).toEqual({ x: -1, z: 1 });
    expect(dist(leftEnd, portWorldPos(port))).toBeLessThan(EPS);
  });

  it("skew-left ends at footprint cell (-1,0) — the X-mirror of skew's end", () => {
    const rightEnd = pathCurve('skew', 0).pointAt(1);
    const leftEnd = pathCurve('skew-left', 0).pointAt(1);
    expect(leftEnd.x).toBeCloseTo(-rightEnd.x, 9);
    expect(leftEnd.y).toBeCloseTo(rightEnd.y, 9);
    expect(leftEnd.z).toBeCloseTo(rightEnd.z, 9);

    const port = PIECE_DEFS['skew-left'].ports[1];
    expect(port.cell).toEqual({ x: -1, z: 0 });
    expect(dist(leftEnd, portWorldPos(port))).toBeLessThan(EPS);
  });

  it('mirroring preserves arc length (s-bend-left/skew-left share L_SBEND/L_SKEW)', () => {
    expect(curveLength(pathCurve('s-bend-left', 0), 256)).toBeCloseTo(
      curveLength(pathCurve('s-bend', 0), 256),
      6,
    );
    expect(curveLength(pathCurve('skew-left', 0), 256)).toBeCloseTo(
      curveLength(pathCurve('skew', 0), 256),
      6,
    );
  });
});
