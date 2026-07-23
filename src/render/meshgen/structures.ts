// Procedural stations (docs/60 §3.5) and biome props (docs/60 §3.7).
// A station is a platform slab beside the track, posts, an awning, and a signboard.
// Lit windows / lamp heads are emitted as glow geometry (bloom layer).

import * as THREE from 'three';
import { CELL, PALETTE } from './palette';
import { box, cone, cyl, paint, roundedBox } from './sweep';
import { buildAsset, type Asset } from './asset';

/** Station platform running along Z beside the track (offset to +X). */
export function makeStation(awningColor: THREE.ColorRepresentation = PALETTE.awning): Asset {
  const body: THREE.BufferGeometry[] = [];
  const px = CELL * 0.62; // platform center offset from track
  const len = CELL * 1.4;

  // platform slab + plank cap
  body.push(roundedBox(0.9, 0.28, len, PALETTE.platform, { bevel: 0.05, pos: [px, 0.14, 0] }));
  body.push(box(0.9, 0.06, len, PALETTE.wood, [px, 0.31, 0]));

  // posts
  const postH = 0.9;
  for (const z of [-len / 2 + 0.2, len / 2 - 0.2]) {
    body.push(box(0.1, postH, 0.1, PALETTE.wood, [px - 0.32, 0.28 + postH / 2, z]));
    body.push(box(0.1, postH, 0.1, PALETTE.wood, [px + 0.32, 0.28 + postH / 2, z]));
  }

  // awning + fascia
  body.push(
    roundedBox(1.0, 0.09, len - 0.1, awningColor, { bevel: 0.04, pos: [px, 0.28 + postH + 0.05, 0] }),
  );
  body.push(box(1.02, 0.05, 0.12, PALETTE.sign, [px, 0.28 + postH - 0.02, -len / 2 + 0.06]));

  // signboard facing the track
  body.push(box(0.06, 0.3, 0.7, PALETTE.sign, [px - 0.48, 0.72, 0]));
  body.push(box(0.08, 0.06, 0.7, PALETTE.wood, [px - 0.48, 0.55, 0]));

  // bench
  body.push(box(0.5, 0.05, 0.18, PALETTE.wood, [px + 0.1, 0.5, 0.4]));

  return buildAsset(body);
}

export function makeTree(): Asset {
  return buildAsset([
    cyl(0.1, 0.14, 0.5, PALETTE.trunk, [0, 0.25, 0]),
    cone(0.45, 0.7, PALETTE.leafDark, [0, 0.72, 0]),
    cone(0.36, 0.6, PALETTE.leaf, [0, 1.02, 0]),
    cone(0.26, 0.5, PALETTE.leaf, [0, 1.32, 0]),
  ]);
}

export function makeHouse(
  roofColor: THREE.ColorRepresentation = PALETTE.roof,
  wall: THREE.ColorRepresentation = PALETTE.house,
): Asset {
  const body: THREE.BufferGeometry[] = [];
  body.push(roundedBox(1.0, 0.7, 0.9, wall, { bevel: 0.05, pos: [0, 0.35, 0] }));

  // gable roof: a triangular prism (3-sided cylinder) laid along X
  const roofGeo = new THREE.CylinderGeometry(0.0, 0.62, 1.06, 3);
  roofGeo.rotateY(Math.PI / 2);
  roofGeo.scale(1, 0.7, 1);
  roofGeo.translate(0, 0.92, 0);
  body.push(paint(roofGeo, roofColor));

  body.push(box(0.16, 0.34, 0.16, PALETTE.chimney, [0.3, 1.05, 0.2])); // chimney
  body.push(box(0.28, 0.36, 0.02, PALETTE.wood, [0, 0.34, 0.46])); // door
  body.push(box(0.22, 0.22, 0.03, PALETTE.window, [-0.32, 0.44, 0.46])); // window (glass)
  return buildAsset(body);
}

export function makeLamp(): Asset {
  const body = [cyl(0.06, 0.08, 1.0, PALETTE.lampPost, [0, 0.5, 0])];
  const glow = [box(0.2, 0.2, 0.2, PALETTE.lampLit, [0, 1.05, 0])];
  return buildAsset(body, glow);
}
