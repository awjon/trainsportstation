// Track instancing (docs/70 M3.1). One InstancedMesh per PieceType for bodies (all sharing a
// single material) + one per type that has emissive glow. place() writes a transform and an
// optional biome tint into the next free slot — so an entire field of a piece type is a single
// draw call, and biome tint rides on `instanceColor` (multiplies the baked vertex color).
//
// This is the render-side placement surface the game shell and editor build on. It stays
// geometry-only: the sim owns where pieces go; this just draws them.

import * as THREE from 'three';
import { CELL, HEIGHT_UNIT } from './meshgen/palette';
import { buildPiece, type PieceType } from './meshgen/track';
import type { Asset } from './meshgen/asset';
import { bodyMaterial, glowMaterial } from './materials';
import { BLOOM_LAYER } from './postfx';

export interface PiecePlacement {
  cell: { x: number; z: number };
  rotation?: 0 | 1 | 2 | 3; // quarter turns clockwise (looking down +Y)
  height?: 0 | 1 | 2;
  tint?: THREE.ColorRepresentation; // biome tint; multiplies the baked vertex color
}

const DEFAULT_CAP = 512;

export class TrackInstances {
  readonly group = new THREE.Group();
  private readonly body = new Map<PieceType, THREE.InstancedMesh>();
  private readonly glow = new Map<PieceType, THREE.InstancedMesh>();
  private readonly count = new Map<PieceType, number>();
  private readonly assets = new Map<PieceType, Asset>();
  private readonly bodyMat = bodyMaterial();
  private readonly glowMat = glowMaterial();

  constructor(types: PieceType[], cap = DEFAULT_CAP) {
    for (const type of types) {
      const asset = buildPiece(type);
      this.assets.set(type, asset);

      const b = new THREE.InstancedMesh(asset.body, this.bodyMat, cap);
      b.count = 0;
      b.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      b.frustumCulled = false; // instances span the whole board
      this.body.set(type, b);
      this.group.add(b);

      if (asset.glow) {
        const g = new THREE.InstancedMesh(asset.glow, this.glowMat, cap);
        g.count = 0;
        g.frustumCulled = false;
        g.layers.enable(BLOOM_LAYER);
        this.glow.set(type, g);
        this.group.add(g);
      }
      this.count.set(type, 0);
    }
  }

  private static matrix(p: PiecePlacement): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -((p.rotation ?? 0) * Math.PI) / 2,
    );
    const pos = new THREE.Vector3(p.cell.x * CELL, (p.height ?? 0) * HEIGHT_UNIT, p.cell.z * CELL);
    return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  }

  /** Add one piece; returns its instance index. Throws past capacity. */
  place(type: PieceType, p: PiecePlacement): number {
    const b = this.body.get(type);
    if (!b) throw new Error(`TrackInstances: piece type not registered: ${type}`);
    const i = this.count.get(type)!;
    if (i >= b.instanceMatrix.count) throw new Error(`TrackInstances: capacity exceeded for ${type}`);

    const m = TrackInstances.matrix(p);
    b.setMatrixAt(i, m);
    b.setColorAt(i, new THREE.Color(p.tint ?? 0xffffff));
    b.count = i + 1;
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;

    const g = this.glow.get(type);
    if (g) {
      g.setMatrixAt(i, m); // glow stays emissive — no tint
      g.count = i + 1;
      g.instanceMatrix.needsUpdate = true;
    }

    this.count.set(type, i + 1);
    return i;
  }

  clear(): void {
    for (const [type, b] of this.body) {
      b.count = 0;
      this.count.set(type, 0);
    }
    for (const g of this.glow.values()) g.count = 0;
  }

  /** Read back a placed instance's world matrix (used by tests and picking). */
  readMatrix(type: PieceType, index: number, out: THREE.Matrix4): THREE.Matrix4 {
    const b = this.body.get(type);
    if (!b) throw new Error(`TrackInstances: piece type not registered: ${type}`);
    b.getMatrixAt(index, out);
    return out;
  }

  /** Live draw-call count: body + glow InstancedMeshes that currently hold ≥1 instance. */
  drawCalls(): number {
    let n = 0;
    for (const b of this.body.values()) if (b.count > 0) n++;
    for (const g of this.glow.values()) if (g.count > 0) n++;
    return n;
  }

  /** Total placed pieces across all types. */
  total(): number {
    let n = 0;
    for (const c of this.count.values()) n += c;
    return n;
  }
}
