// Sweep a 2D cross-section along a path curve into a BufferGeometry.
// This is the heart of procedural track: rails, ballast, decks, portal arches are
// all just profiles extruded along the same curves the sim uses (docs/30 §6, §9).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { frameOffset, sampleFrames, type Curve } from '../../core/curves';

/** A closed 2D profile in (right, up) local coordinates, world units. */
export type Profile = Array<[number, number]>;

export interface SweepOptions {
  segments?: number;
  /** close the tube by capping both ends (default true) */
  cap?: boolean;
  color: THREE.ColorRepresentation;
}

/**
 * Bake a single flat color into a geometry's `color` attribute (one shared material,
 * vertexColors). Also normalizes every geometry to the SAME attribute shape —
 * non-indexed with {position, normal, color} and no uv — so mergeGeometries never
 * rejects a mix of swept tubes and box/cylinder primitives.
 */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  let g = geo;
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.deleteAttribute('uv1');
  g.deleteAttribute('uv2');
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * Sweep `profile` (a closed loop) along `curve`. Produces a solid tube with optional
 * end caps. Non-indexed for clean flat-shaded facets (the toy look).
 */
export function sweepProfile(curve: Curve, profile: Profile, opts: SweepOptions): THREE.BufferGeometry {
  const segments = opts.segments ?? 24;
  const cap = opts.cap ?? true;
  const frames = sampleFrames(curve, segments);
  const m = profile.length;

  // rings[i][j] = world position of profile point j at frame i
  const rings: THREE.Vector3[][] = frames.map((f) =>
    profile.map(([r, u]) => {
      const p = frameOffset(f, r, u);
      return new THREE.Vector3(p.x, p.y, p.z);
    }),
  );

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  // side walls
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = rings[i][j];
      const b = rings[i][j2];
      const c = rings[i + 1][j2];
      const d = rings[i + 1][j];
      pushTri(a, b, c);
      pushTri(a, c, d);
    }
  }

  // end caps (triangle fan around profile centroid)
  if (cap) {
    const capRing = (ring: THREE.Vector3[], flip: boolean) => {
      const centroid = new THREE.Vector3();
      ring.forEach((p) => centroid.add(p));
      centroid.multiplyScalar(1 / ring.length);
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m;
        if (flip) pushTri(centroid, ring[j2], ring[j]);
        else pushTri(centroid, ring[j], ring[j2]);
      }
    };
    capRing(rings[0], true);
    capRing(rings[segments], false);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return paint(geo, opts.color);
}

/** A rectangular profile of given width (along right) and height (along up), centered offsets applied. */
export function boxProfile(width: number, height: number, rightOffset = 0, upOffset = 0): Profile {
  const hw = width / 2;
  const hh = height / 2;
  return [
    [rightOffset - hw, upOffset - hh],
    [rightOffset + hw, upOffset - hh],
    [rightOffset + hw, upOffset + hh],
    [rightOffset - hw, upOffset + hh],
  ];
}

/** Merge a set of colored geometries into one (still one shared material via vertex colors). */
export function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('mergeGeometries failed — check attribute consistency');
  return merged;
}

/**
 * Mirror a (non-indexed) geometry across the X axis, producing the handed opposite of a piece.
 * Negates X on every vertex, then swaps two vertices of each triangle to correct the winding,
 * and recomputes normals. Colors travel with their vertices; baked shading (from Y / normal.y)
 * is unaffected by an X mirror, so it stays valid.
 */
export function mirrorX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const parr = pos.array as Float32Array;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const carr = col?.array as Float32Array | undefined;
  for (let i = 0; i < pos.count; i++) parr[i * 3] = -parr[i * 3]; // negate X
  const swap = (a: number, b: number, arr: Float32Array) => {
    for (let k = 0; k < 3; k++) {
      const ia = a * 3 + k;
      const ib = b * 3 + k;
      const t = arr[ia];
      arr[ia] = arr[ib];
      arr[ib] = t;
    }
  };
  for (let t = 0; t + 2 < pos.count; t += 3) {
    swap(t + 1, t + 2, parr);
    if (carr) swap(t + 1, t + 2, carr);
  }
  pos.needsUpdate = true;
  if (col) col.needsUpdate = true;
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/** Colored primitive helpers (rolling stock, props) sharing the vertex-color material. */
export function box(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  pos?: [number, number, number],
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pos) g.translate(pos[0], pos[1], pos[2]);
  return paint(g, color);
}

export function cyl(
  rTop: number,
  rBot: number,
  h: number,
  color: THREE.ColorRepresentation,
  pos?: [number, number, number],
  radialSegments = 12,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, radialSegments);
  if (pos) g.translate(pos[0], pos[1], pos[2]);
  return paint(g, color);
}

/** A chamfered box — soft toy-like edges that catch the key light. For hero parts only. */
export function roundedBox(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  opts: { bevel?: number; segments?: number; pos?: [number, number, number] } = {},
): THREE.BufferGeometry {
  const bevel = opts.bevel ?? Math.min(w, h, d) * 0.12;
  const g = new RoundedBoxGeometry(w, h, d, opts.segments ?? 2, bevel);
  if (opts.pos) g.translate(opts.pos[0], opts.pos[1], opts.pos[2]);
  return paint(g, color);
}

export function cone(
  r: number,
  h: number,
  color: THREE.ColorRepresentation,
  pos?: [number, number, number],
  radialSegments = 10,
): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, radialSegments);
  if (pos) g.translate(pos[0], pos[1], pos[2]);
  return paint(g, color);
}
