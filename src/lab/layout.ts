// A small demonstration layout built entirely from InstancedMesh (docs/70 M3.1). Shows that a
// whole board of track is a handful of draw calls — one per piece type (+ one per glow type) —
// regardless of how many pieces are placed. Track is intentionally NOT biome-tinted
// (docs/30 §9: track stays readable); biome tint rides on `instanceColor` for ground/props.

import * as THREE from 'three';
import { TrackInstances } from '../render/instances';
import { ALL_PIECES } from '../render/meshgen/track';

export function buildLayout(scene: THREE.Scene): { pieces: number; drawCalls: number } {
  const ti = new TrackInstances([...ALL_PIECES], 1024);

  // Five parallel sidings — 70 straights, still a single draw call for the type.
  for (let r = 0; r < 5; r++) {
    for (let x = 0; x < 14; x++) {
      ti.place('straight', { cell: { x, z: r * 2 }, rotation: 1 }); // rotation 1 = run E–W
    }
  }

  // A feature line behind the yard.
  ti.place('ramp', { cell: { x: 1, z: -2 } });
  ti.place('curve-large', { cell: { x: 4, z: -3 } });
  ti.place('bridge', { cell: { x: 7, z: -2 } });
  ti.place('tunnel', { cell: { x: 11, z: -2 } });
  ti.place('junction', { cell: { x: 13, z: -2 } });

  // A serpentine + crossing in front.
  ti.place('s-bend', { cell: { x: 2, z: 11 } });
  ti.place('s-bend-left', { cell: { x: 5, z: 11 } });
  ti.place('curve-small', { cell: { x: 9, z: 11 } });
  ti.place('crossing', { cell: { x: 12, z: 11 } });

  scene.add(ti.group);
  return { pieces: ti.total(), drawCalls: ti.drawCalls() };
}
