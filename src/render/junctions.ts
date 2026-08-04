// Junction levers (docs/70 M6.2, carrying the M3.3 deferral). A junction's switch stand is the
// one part of a track piece that has to MOVE, which is exactly what an InstancedMesh cannot do
// per instance — so the handle lives here as its own named Object3D per placement, parented at
// the piece's lever anchor.
//
// The sim owns the switch state; this layer only shows it. `setState` starts an eased swing and
// `update(dt)` advances it, so a flipped junction reads instantly even when the player is
// looking somewhere else.

import * as THREE from 'three';
import { CELL, HEIGHT_UNIT } from './meshgen/palette';
import { LEVER_ANCHOR, LEVER_ANGLES, makeJunctionLever } from './meshgen/track';
import { bodyMaterial, glowMaterial } from './materials';
import { BLOOM_LAYER } from './postfx';

export const LEVER_SWING_SECONDS = 0.18; // docs/10 §11: everything animates in <= 200ms

/** The name every lever node carries, so animation code (and tests) can find one by placement. */
export function leverNodeName(placementIndex: number): string {
  return `junction-lever-${placementIndex}`;
}

interface Lever {
  node: THREE.Object3D;
  from: number;
  to: number;
  /** 0..1 through the current swing */
  t: number;
}

export class JunctionLevers {
  readonly group = new THREE.Group();
  private readonly levers = new Map<number, Lever>();
  private readonly asset = makeJunctionLever();
  private readonly bodyMat = bodyMaterial();
  private readonly glowMat = glowMaterial();

  /**
   * Attach a lever for the junction at `placementIndex`. The returned node is named
   * `junction-lever-<index>` and is the animatable handle: rotating it about Z swings the arm.
   */
  add(
    placementIndex: number,
    cell: { x: number; z: number },
    rotation: 0 | 1 | 2 | 3 = 0,
    height = 0,
    state: 0 | 1 = 0,
  ): THREE.Object3D {
    // a group per placement carries the piece's own transform, so the pivot lands where the
    // instanced post is drawn no matter how the piece is rotated
    const piece = new THREE.Group();
    piece.position.set(cell.x * CELL, height * HEIGHT_UNIT, cell.z * CELL);
    piece.rotation.y = -(rotation * Math.PI) / 2;

    const pivot = new THREE.Object3D();
    pivot.name = leverNodeName(placementIndex);
    pivot.position.set(LEVER_ANCHOR[0], LEVER_ANCHOR[1], LEVER_ANCHOR[2]);
    pivot.rotation.z = LEVER_ANGLES[state];

    pivot.add(new THREE.Mesh(this.asset.body, this.bodyMat));
    if (this.asset.glow) {
      const glow = new THREE.Mesh(this.asset.glow, this.glowMat);
      glow.layers.enable(BLOOM_LAYER);
      pivot.add(glow);
    }

    piece.add(pivot);
    this.group.add(piece);
    this.levers.set(placementIndex, { node: pivot, from: pivot.rotation.z, to: pivot.rotation.z, t: 1 });
    return pivot;
  }

  /** Find a lever by placement index (the animatable node other systems address). */
  node(placementIndex: number): THREE.Object3D | undefined {
    return this.levers.get(placementIndex)?.node;
  }

  /** Begin swinging the lever to `state`. A no-op if it is already heading there. */
  setState(placementIndex: number, state: 0 | 1): void {
    const lever = this.levers.get(placementIndex);
    if (!lever) return;
    const to = LEVER_ANGLES[state];
    if (lever.to === to) return;
    lever.from = lever.node.rotation.z;
    lever.to = to;
    lever.t = 0;
  }

  /** Advance every in-flight swing by `dt` seconds. */
  update(dt: number): void {
    for (const lever of this.levers.values()) {
      if (lever.t >= 1) continue;
      lever.t = Math.min(1, lever.t + dt / LEVER_SWING_SECONDS);
      const eased = 1 - (1 - lever.t) * (1 - lever.t); // ease-out, so it lands with a clack
      lever.node.rotation.z = lever.from + (lever.to - lever.from) * eased;
    }
  }

  clear(): void {
    this.group.clear();
    this.levers.clear();
  }

  get count(): number {
    return this.levers.size;
  }
}
