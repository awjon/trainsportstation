// Procedural track pieces. Every one of the 10 PieceTypes (docs/30 §4/§5) is built by
// sweeping rail + ballast profiles along the piece's own path curve, then dropping ties
// and any kitbash extras (trestle, portal, lever, deck). Because the curve is the same
// object the sim moves trains along, the rendered rails land exactly on the ports.

import * as THREE from 'three';
import { arcCurve, catmullCurve, lineCurve, sampleFrames, type Curve } from '../../core/curves';
import { vec } from '../../core/math';
import { CELL, HEIGHT_UNIT, PALETTE } from './palette';
import { box, boxProfile, merge, paint, sweepProfile } from './sweep';

export type PieceType =
  | 'straight'
  | 'curve-small'
  | 'curve-large'
  | 'ramp'
  | 'hill'
  | 'bump'
  | 'bridge'
  | 'tunnel'
  | 'junction'
  | 'crossing';

const HALF = CELL / 2;
const GAUGE = 0.7; // rail spacing
const RAIL_W = 0.12;
const RAIL_H = 0.14;
const RAIL_Y = 0.16; // rail center above the piece base
const TIE_EVERY = 0.42; // world units between ties

/** A box oriented to a curve frame — used for ties and braces that follow the path. */
function orientedBox(
  center: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  tangent: THREE.Vector3,
  dims: [number, number, number],
  color: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
  const m = new THREE.Matrix4().makeBasis(right, up, tangent);
  m.setPosition(center);
  g.applyMatrix4(m);
  return paint(g, color);
}

interface RailOpts {
  ballast?: boolean;
  ties?: boolean;
  railY?: number;
  segments?: number;
}

/** Rails (+ optional ballast bed and ties) swept/placed along a curve. */
function railsForCurve(curve: Curve, opts: RailOpts = {}): THREE.BufferGeometry[] {
  const { ballast = true, ties = true, railY = RAIL_Y, segments = 28 } = opts;
  const parts: THREE.BufferGeometry[] = [];

  // two rails
  parts.push(
    sweepProfile(curve, boxProfile(RAIL_W, RAIL_H, -GAUGE / 2, railY), { segments, color: PALETTE.rail }),
  );
  parts.push(
    sweepProfile(curve, boxProfile(RAIL_W, RAIL_H, GAUGE / 2, railY), { segments, color: PALETTE.rail }),
  );

  if (ballast) {
    parts.push(
      sweepProfile(curve, boxProfile(GAUGE + 0.55, 0.12, 0, railY - 0.13), {
        segments,
        color: PALETTE.ballast,
      }),
    );
  }

  if (ties) {
    const frames = sampleFrames(curve, segments * 2);
    // estimate length to space ties
    let acc = 0;
    let last: THREE.Vector3 | null = null;
    for (const f of frames) {
      const p = new THREE.Vector3(f.position.x, f.position.y, f.position.z);
      if (last) acc += p.distanceTo(last);
      if (!last || acc >= TIE_EVERY) {
        const right = new THREE.Vector3(f.right.x, f.right.y, f.right.z);
        const up = new THREE.Vector3(f.up.x, f.up.y, f.up.z);
        const tan = new THREE.Vector3(f.tangent.x, f.tangent.y, f.tangent.z);
        const center = p.clone().add(up.clone().multiplyScalar(railY - 0.09));
        parts.push(orientedBox(center, right, up, tan, [GAUGE + 0.34, 0.07, 0.14], PALETTE.tie));
        acc = 0;
      }
      last = p;
    }
  }

  return parts;
}

// --- per-piece curves (piece-local, cell (0,0) centered at origin) ---

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

// --- kitbash extras ---

function trestleLegs(curve: Curve): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const frames = sampleFrames(curve, 6);
  for (let i = 1; i < frames.length - 1; i += 2) {
    const f = frames[i];
    const legY = f.position.y + RAIL_Y - 0.19;
    const h = legY; // down to base
    parts.push(box(0.16, h, 0.16, PALETTE.wood, [f.position.x - GAUGE / 2, legY - h / 2, f.position.z]));
    parts.push(box(0.16, h, 0.16, PALETTE.wood, [f.position.x + GAUGE / 2, legY - h / 2, f.position.z]));
    parts.push(box(GAUGE + 0.3, 0.12, 0.14, PALETTE.wood, [f.position.x, legY - h + 0.2, f.position.z]));
  }
  return parts;
}

function portalArch(z: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const w = GAUGE + 0.9;
  const postH = 1.1;
  parts.push(box(0.22, postH, 0.3, PALETTE.stone, [-w / 2, postH / 2, z]));
  parts.push(box(0.22, postH, 0.3, PALETTE.stone, [w / 2, postH / 2, z]));
  // arch top (a few angled boxes to fake a rounded portal)
  const ring = new THREE.TorusGeometry(w / 2, 0.16, 6, 12, Math.PI);
  ring.rotateY(Math.PI / 2);
  ring.translate(0, postH, z);
  parts.push(paint(ring, PALETTE.stone));
  return parts;
}

function leverPost(): THREE.BufferGeometry[] {
  return [
    box(0.14, 0.5, 0.14, PALETTE.steel, [HALF - 0.35, 0.25, 0.0]),
    box(0.1, 0.1, 0.44, PALETTE.kid, [HALF - 0.35, 0.46, 0.18]),
  ];
}

function crossingDeck(): THREE.BufferGeometry[] {
  return [box(CELL - 0.2, 0.08, CELL - 0.2, PALETTE.deck, [0, RAIL_Y - 0.13, 0])];
}

/** Build the merged geometry for a piece type (piece-local, one shared material). */
export function buildPiece(type: PieceType): THREE.BufferGeometry {
  let parts: THREE.BufferGeometry[] = [];
  switch (type) {
    case 'straight':
      parts = railsForCurve(straightCurve());
      break;
    case 'curve-small':
      parts = railsForCurve(curveSmall());
      break;
    case 'curve-large':
      parts = railsForCurve(curveLarge(), { segments: 36 });
      break;
    case 'ramp':
      parts = railsForCurve(rampCurve());
      break;
    case 'hill':
      parts = railsForCurve(hillCurve(), { segments: 40 });
      break;
    case 'bump':
      parts = railsForCurve(bumpCurve());
      break;
    case 'bridge':
      parts = [
        ...railsForCurve(lineCurve(vec(0, HEIGHT_UNIT, -HALF), vec(0, HEIGHT_UNIT, HALF)), {
          ballast: false,
        }),
        ...trestleLegs(lineCurve(vec(0, HEIGHT_UNIT, -HALF), vec(0, HEIGHT_UNIT, HALF))),
      ];
      break;
    case 'tunnel':
      parts = [...railsForCurve(straightCurve()), ...portalArch(-HALF + 0.15), ...portalArch(HALF - 0.15)];
      break;
    case 'junction':
      parts = [
        ...railsForCurve(straightCurve(), { ballast: true }),
        ...railsForCurve(curveSmall(), { ballast: false, ties: false }),
        ...leverPost(),
      ];
      break;
    case 'crossing':
      parts = [
        ...crossingDeck(),
        ...railsForCurve(straightCurve(), { ballast: false }),
        ...railsForCurve(lineCurve(vec(-HALF, 0, 0), vec(HALF, 0, 0)), { ballast: false }),
      ];
      break;
  }
  return merge(parts);
}

export const ALL_PIECES: PieceType[] = [
  'straight',
  'curve-small',
  'curve-large',
  'ramp',
  'hill',
  'bump',
  'bridge',
  'tunnel',
  'junction',
  'crossing',
];
