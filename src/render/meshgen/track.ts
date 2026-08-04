// Procedural track pieces. Every one of the 10 PieceTypes (docs/30 §4/§5) is built by
// sweeping rail + ballast profiles along the piece's own path curve, then dropping ties
// and any kitbash extras (trestle, portal, lever, deck). Because the curve is the same
// object the sim moves trains along, the rendered rails land exactly on the ports.

import * as THREE from 'three';
import { arcCurve, catmullCurve, lineCurve, sampleFrames, type Curve } from '../../core/curves';
import { vec } from '../../core/math';
import { CELL, HEIGHT_UNIT, PALETTE } from './palette';
import { box, boxProfile, paint, sweepProfile } from './sweep';
import { buildAsset, mirrorAssetX, type Asset } from './asset';
import { PIECE_TYPES, type PieceType } from '../../track/pieces';

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
  const parts: THREE.BufferGeometry[] = [...railsForCurve(straightCurve())];
  const hill = new THREE.SphereGeometry(1.0, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  hill.scale(1.4, 1.55, 1.12); // half-width 1.4, height 1.55 (> train), half-length 1.12
  parts.push(paint(hill, PALETTE.grassDark));
  parts.push(...tunnelMouth(-HALF - 0.02), ...tunnelMouth(HALF + 0.02));
  return parts;
}

/**
 * The static half of a junction's switch stand: a steel post with a lit signal lamp. This part
 * is baked into the instanced piece, so a field of junctions is still one draw call.
 *
 * The *moving* half — the handle that swings when the player taps the junction — is built
 * separately by `makeJunctionLever()` so it can be an addressable, animatable node
 * (docs/70 M3.3, deferred to M6.2).
 */
function leverPost(): { body: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  return {
    body: [box(0.14, 0.5, 0.14, PALETTE.steel, [LEVER_ANCHOR[0], 0.25, LEVER_ANCHOR[2]])],
    glow: [box(0.12, 0.12, 0.16, PALETTE.signal, [LEVER_ANCHOR[0], LEVER_ANCHOR[1] + 0.06, LEVER_ANCHOR[2]])],
  };
}

/**
 * Where the junction's lever pivots, in piece-local coordinates. The animated handle is parented
 * at this point so rotating the node about Z swings the handle without moving the post.
 */
export const LEVER_ANCHOR: readonly [number, number, number] = [HALF - 0.35, 0.5, 0];

/** Swing angles (radians about Z) for switch state 0 and 1 — the visible state of a junction. */
export const LEVER_ANGLES: readonly [number, number] = [-0.55, 0.55];

/**
 * The swinging handle of a junction's switch stand, built about its own pivot (origin = the
 * anchor above). Kept out of the instanced piece precisely because it must be animatable per
 * placement; junctions are rare enough that a mesh each is free.
 */
export function makeJunctionLever(): Asset {
  return buildAsset(
    [
      box(0.09, 0.42, 0.09, PALETTE.steel, [0, 0.21, 0]), // the arm
      box(0.2, 0.1, 0.16, PALETTE.brass, [0, 0.44, 0]), // the grip
    ],
    [box(0.13, 0.13, 0.13, PALETTE.signal, [0, 0.5, 0])], // tip light, so the state reads at a glance
  );
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
      body = railsForCurve(straightCurve());
      break;
    case 'curve-small':
      body = railsForCurve(curveSmall());
      break;
    case 'curve-large':
      body = railsForCurve(curveLarge(), { segments: 36 });
      break;
    case 's-bend':
      body = railsForCurve(sBendCurve(), { segments: 40 });
      break;
    case 's-bend-left':
      return mirrorAssetX(buildPiece('s-bend'));
    case 'skew':
      body = railsForCurve(skewCurve(), { segments: 32 });
      break;
    case 'skew-left':
      return mirrorAssetX(buildPiece('skew'));
    case 'ramp':
      body = railsForCurve(rampCurve());
      break;
    case 'curve-small-ramp':
      body = railsForCurve(curveSmallRampCurve());
      break;
    case 'curve-large-ramp':
      body = railsForCurve(curveLargeRampCurve(), { segments: 36 });
      break;
    case 'hill':
      body = railsForCurve(hillCurve(), { segments: 40 });
      break;
    case 'bump':
      body = railsForCurve(bumpCurve());
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
        ...railsForCurve(straightCurve(), { ballast: true }),
        ...railsForCurve(curveSmall(), { ballast: false, ties: false }),
        ...lever.body,
      ];
      glow.push(...lever.glow);
      break;
    }
    case 'crossing':
      body = [
        ...crossingDeck(),
        ...railsForCurve(straightCurve(), { ballast: false }),
        ...railsForCurve(lineCurve(vec(-HALF, 0, 0), vec(HALF, 0, 0)), { ballast: false }),
      ];
      break;
  }
  return buildAsset(body, glow);
}

export const ALL_PIECES: PieceType[] = PIECE_TYPES;
