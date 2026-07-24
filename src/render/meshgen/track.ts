// Procedural track pieces. Every one of the 10 PieceTypes (docs/30 §4/§5) is built by
// sweeping rail + ballast profiles along the piece's own path curve, then dropping ties
// and any kitbash extras (trestle, portal, lever, deck). Because the curve is the same
// object the sim moves trains along, the rendered rails land exactly on the ports.

import * as THREE from 'three';
import { lineCurve, sampleFrames, type Curve } from '../../core/curves';
import { vec } from '../../core/math';
import { CELL, HEIGHT_UNIT, PALETTE } from './palette';
import { box, boxProfile, paint, sweepProfile } from './sweep';
import { buildAsset, mirrorAssetX, type Asset } from './asset';
import { PIECE_TYPES, type PieceType } from '../../track/pieces';
import { pathCurve } from '../../track/paths';

// The canonical PieceType lives in the headless track model (src/track/pieces.ts); re-export it
// so render-side consumers keep importing it from here.
export type { PieceType };

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

// Piece-local path curves now live in track/paths.ts (headless — M4.1 extraction), shared
// verbatim with the sim's arc-length LUTs (track/splines.ts). Use `pathCurve(type, pathIndex)`
// below instead of a private per-piece builder.

// --- kitbash extras ---

/**
 * Bridge as a self-contained span: ramp up → railed deck at height 1 → ramp down, with
 * stone piers and abutments, over a 3-cell N-S footprint. Ports N@0 / S@0 (drops between two
 * ground tracks and carries them over a water gap). The lab shows it over a water strip.
 */
function bridgeSpan(): THREE.BufferGeometry[] {
  const H = HEIGHT_UNIT;
  const zDeckStart = HALF; // z=1
  const zDeckEnd = 1.5 * CELL; // z=3
  const zEnd = 2.5 * CELL; // z=5 (three cells long)
  const zc = (zDeckStart + zDeckEnd) / 2; // deck center
  const deckLen = zDeckEnd - zDeckStart;

  const parts: THREE.BufferGeometry[] = [
    ...railsForCurve(lineCurve(vec(0, 0, -HALF), vec(0, H, zDeckStart)), { ballast: false }),
    ...railsForCurve(lineCurve(vec(0, H, zDeckStart), vec(0, H, zDeckEnd)), { ballast: false }),
    ...railsForCurve(lineCurve(vec(0, H, zDeckEnd), vec(0, 0, zEnd)), { ballast: false }),
  ];

  // side railings + posts along the deck
  const railX = GAUGE / 2 + 0.18;
  for (const sx of [-1, 1]) {
    parts.push(box(0.07, 0.34, deckLen, PALETTE.wood, [sx * railX, H + RAIL_Y + 0.22, zc]));
    for (const z of [zDeckStart, zc, zDeckEnd]) {
      parts.push(box(0.1, 0.4, 0.1, PALETTE.wood, [sx * railX, H + RAIL_Y + 0.1, z]));
    }
  }

  // stone piers under the deck ends + abutments at the ramp feet
  const pierTop = H + RAIL_Y - 0.19;
  for (const z of [zDeckStart, zDeckEnd]) {
    parts.push(box(GAUGE + 0.5, pierTop, 0.3, PALETTE.stone, [0, pierTop / 2, z]));
  }
  parts.push(box(GAUGE + 0.5, 0.3, 0.5, PALETTE.stone, [0, 0.15, -HALF + 0.12]));
  parts.push(box(GAUGE + 0.5, 0.3, 0.5, PALETTE.stone, [0, 0.15, zEnd - 0.12]));
  return parts;
}

// Opening sized to clear the tallest train (locomotive chimney ≈ 1.2 high, body ≈ 0.9 wide).
const TUNNEL_W = 1.5; // outer doorway width
const TUNNEL_H = 1.42; // doorway height

/** A stone tunnel mouth: a doorway frame with a dark opening, set into the hillside. */
function tunnelMouth(z: number): THREE.BufferGeometry[] {
  const w = TUNNEL_W;
  const h = TUNNEL_H;
  return [
    box(0.2, h, 0.34, PALETTE.stone, [-w / 2, h / 2, z]), // jambs
    box(0.2, h, 0.34, PALETTE.stone, [w / 2, h / 2, z]),
    box(w + 0.4, 0.22, 0.38, PALETTE.stone, [0, h + 0.09, z]), // lintel
    box(w - 0.06, h - 0.06, 0.08, PALETTE.chimney, [0, (h - 0.06) / 2, z]), // dark opening
  ];
}

/**
 * Tunnel as a grassy hill over the straight track, big enough to fully contain a train (so the
 * opaque hill hides it in transit — a real tunnel, no mesh culling needed), with a stone
 * doorway at each end. Ports N@0 / S@0.
 */
function moundTunnel(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [...railsForCurve(pathCurve('tunnel', 0))];
  const hill = new THREE.SphereGeometry(1.0, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  hill.scale(1.4, 1.55, 1.12); // half-width 1.4, height 1.55 (> train), half-length 1.12
  parts.push(paint(hill, PALETTE.grassDark));
  parts.push(...tunnelMouth(-HALF - 0.02), ...tunnelMouth(HALF + 0.02));
  return parts;
}

/** Switch lever: a steel post (body) topped by a glowing signal flag (bloom layer). */
function leverPost(): { body: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  return {
    body: [box(0.14, 0.5, 0.14, PALETTE.steel, [HALF - 0.35, 0.25, 0.0])],
    glow: [box(0.12, 0.12, 0.44, PALETTE.signal, [HALF - 0.35, 0.46, 0.18])],
  };
}

function crossingDeck(): THREE.BufferGeometry[] {
  return [box(CELL - 0.2, 0.08, CELL - 0.2, PALETTE.deck, [0, RAIL_Y - 0.13, 0])];
}

/** Build a piece type as an Asset (shaded body + optional glow), piece-local. */
export function buildPiece(type: PieceType): Asset {
  let body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  switch (type) {
    case 'straight':
      body = railsForCurve(pathCurve('straight', 0));
      break;
    case 'curve-small':
      body = railsForCurve(pathCurve('curve-small', 0));
      break;
    case 'curve-large':
      body = railsForCurve(pathCurve('curve-large', 0), { segments: 36 });
      break;
    case 's-bend':
      body = railsForCurve(pathCurve('s-bend', 0), { segments: 40 });
      break;
    case 's-bend-left':
      return mirrorAssetX(buildPiece('s-bend'));
    case 'skew':
      body = railsForCurve(pathCurve('skew', 0), { segments: 32 });
      break;
    case 'skew-left':
      return mirrorAssetX(buildPiece('skew'));
    case 'ramp':
      body = railsForCurve(pathCurve('ramp', 0));
      break;
    case 'curve-small-ramp':
      body = railsForCurve(pathCurve('curve-small-ramp', 0));
      break;
    case 'curve-large-ramp':
      body = railsForCurve(pathCurve('curve-large-ramp', 0), { segments: 36 });
      break;
    case 'hill':
      body = railsForCurve(pathCurve('hill', 0), { segments: 40 });
      break;
    case 'bump':
      body = railsForCurve(pathCurve('bump', 0));
      break;
    case 'bridge':
      body = bridgeSpan();
      break;
    case 'tunnel':
      body = moundTunnel();
      break;
    case 'junction': {
      const lever = leverPost();
      body = [
        ...railsForCurve(pathCurve('junction', 0), { ballast: true }),
        ...railsForCurve(pathCurve('junction', 1), { ballast: false, ties: false }),
        ...lever.body,
      ];
      glow.push(...lever.glow);
      break;
    }
    case 'crossing':
      body = [
        ...crossingDeck(),
        ...railsForCurve(pathCurve('crossing', 0), { ballast: false }),
        ...railsForCurve(pathCurve('crossing', 1), { ballast: false }),
      ];
      break;
  }
  return buildAsset(body, glow);
}

export const ALL_PIECES: PieceType[] = PIECE_TYPES;
