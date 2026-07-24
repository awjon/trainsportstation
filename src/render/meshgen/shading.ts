// Bake soft lighting into a geometry's vertex `color` attribute at build time.
// This is the biggest single quality lift for flat-shaded low-poly, and it costs nothing
// at runtime and nothing at instancing time (it lives in the geometry the InstancedMesh
// freezes). Three cheap terms, multiplied and lifted by an ambient floor:
//   • hemispheric — up-facing faces keep full color, down-facing faces darken
//   • gradient    — the model's base is slightly darker, fading out with height
//   • contact     — a tight extra darkening right where a part meets the ground (fake AO)
//
// Single-material safe: only the color attribute is touched.

import * as THREE from 'three';
import { SHADE } from './palette';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface ShadeOptions {
  hemi?: number;
  gradient?: number;
  gradientHeight?: number;
  contact?: number;
  contactHeight?: number;
  ambient?: number;
}

/** Multiply each vertex color by a baked lighting factor. Mutates and returns `geo`. */
export function shade(geo: THREE.BufferGeometry, opts: ShadeOptions = {}): THREE.BufferGeometry {
  const color = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const position = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!color || !normal || !position) return geo;

  const hemi = opts.hemi ?? SHADE.hemi;
  const gradient = opts.gradient ?? SHADE.gradient;
  const gradientHeight = opts.gradientHeight ?? SHADE.gradientHeight;
  const contact = opts.contact ?? SHADE.contact;
  const contactHeight = opts.contactHeight ?? SHADE.contactHeight;
  const ambient = opts.ambient ?? SHADE.ambient;

  geo.computeBoundingBox();
  const minY = geo.boundingBox ? geo.boundingBox.min.y : 0;

  const n = color.count;
  for (let i = 0; i < n; i++) {
    const r = color.getX(i);
    const g = color.getY(i);
    const b = color.getZ(i);

    const ny = normal.getY(i); // -1..1
    const y = position.getY(i);

    const fHemi = 1 - hemi * (1 - (ny * 0.5 + 0.5)); // up=1, down=1-hemi
    const above = y - minY;
    const fGrad = 1 - gradient * clamp01(1 - above / gradientHeight);
    const fContact = 1 - contact * clamp01(1 - above / contactHeight);

    let m = clamp01(fHemi * fGrad * fContact);
    m = ambient + (1 - ambient) * m; // lift so nothing goes fully black

    color.setXYZ(i, r * m, g * m, b * m);
  }
  color.needsUpdate = true;
  return geo;
}

/** Standard finishing pass applied to every asset after its parts are merged. */
export function finalizeAsset(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return shade(geo);
}
