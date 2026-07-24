// Biome prop variants (docs/60 §5, docs/20 §1 dressing). Each biome dresses its stages with a
// different set of these — all generated in code, all through the one shared body material
// (+ glow for the luminous mushroom). Trees/houses/lamps live in structures.ts.

import * as THREE from 'three';
import { PALETTE } from './palette';
import { cone, cyl, paint } from './sweep';
import { buildAsset, type Asset } from './asset';

const CACTUS = '#4f9d5b';

/** Round-canopy deciduous tree (meadow/hollow). */
export function makeRoundTree(leaf: THREE.ColorRepresentation = PALETTE.leaf): Asset {
  const canopy = new THREE.IcosahedronGeometry(0.6, 1);
  canopy.scale(1, 1.1, 1);
  canopy.translate(0, 1.0, 0);
  return buildAsset([cyl(0.1, 0.14, 0.6, PALETTE.trunk, [0, 0.3, 0]), paint(canopy, leaf)]);
}

/** Snow-capped fir (highland/frostfield). */
export function makeSnowFir(): Asset {
  return buildAsset([
    cyl(0.1, 0.14, 0.4, PALETTE.trunk, [0, 0.2, 0]),
    cone(0.5, 0.6, PALETTE.leafDark, [0, 0.6, 0]),
    cone(0.4, 0.55, PALETTE.leaf, [0, 0.95, 0]),
    cone(0.28, 0.5, PALETTE.leaf, [0, 1.28, 0]),
    cone(0.2, 0.26, '#f4fbff', [0, 1.52, 0]), // snow cap
  ]);
}

/** Saguaro-ish cactus (mesa). */
export function makeCactus(): Asset {
  return buildAsset([
    cyl(0.17, 0.21, 1.1, CACTUS, [0, 0.55, 0]),
    cyl(0.09, 0.11, 0.5, CACTUS, [-0.28, 0.7, 0]),
    cyl(0.09, 0.09, 0.32, CACTUS, [-0.28, 0.98, 0]),
    cyl(0.09, 0.11, 0.42, CACTUS, [0.28, 0.6, 0]),
    cyl(0.09, 0.09, 0.28, CACTUS, [0.28, 0.86, 0]),
  ]);
}

/** Low-poly boulder (highland/mesa/frostfield). */
export function makeRock(color: THREE.ColorRepresentation = PALETTE.stone): Asset {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.scale(1.2, 0.8, 1.0);
  g.translate(0, 0.3, 0);
  return buildAsset([paint(g, color)]);
}

/** Toadstool. `glowing` (hollow biome) routes the cap to the bloom layer. */
export function makeMushroom(glowing = false): Asset {
  const stem = cyl(0.12, 0.16, 0.5, '#efe7d0', [0, 0.25, 0]);
  const cap = new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.85, 1);
  cap.translate(0, 0.5, 0);
  if (glowing) return buildAsset([stem], [paint(cap, PALETTE.lampLit)]);
  return buildAsset([stem, paint(cap, PALETTE.roof)]);
}
