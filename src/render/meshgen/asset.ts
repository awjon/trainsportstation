// An Asset splits a generated model into its shaded body and its (optional) emissive glow
// geometry. Keeping glow separate is what lets bloom be *selective* — only lights bloom, not
// bright white surfaces — while the body keeps the single shared material. At instancing time
// (docs/70 M3.1) body and glow become two InstancedMesh layers.

import * as THREE from 'three';
import { merge } from './sweep';
import { finalizeAsset } from './shading';

export interface Asset {
  body: THREE.BufferGeometry;
  /** emissive parts, on the bloom layer; null when the asset has no lights */
  glow: THREE.BufferGeometry | null;
}

/** Merge body parts (shaded) and glow parts (left bright) into an Asset. */
export function buildAsset(bodyParts: THREE.BufferGeometry[], glowParts: THREE.BufferGeometry[] = []): Asset {
  return {
    body: finalizeAsset(merge(bodyParts)),
    glow: glowParts.length ? merge(glowParts) : null,
  };
}

/** Triangle count of an Asset (body + glow), for budget tests. */
export function triangles(a: Asset): number {
  const t = (g: THREE.BufferGeometry | null) => (g ? g.getAttribute('position').count / 3 : 0);
  return t(a.body) + t(a.glow);
}
