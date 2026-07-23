// Headless proof for instancing (docs/70 M3.1). InstancedMesh matrix/count logic is pure JS —
// no WebGL — so the draw-call and transform guarantees are testable in CI.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrackInstances } from './instances';
import { CELL } from './meshgen/palette';

describe('TrackInstances', () => {
  it('500 straights render as ONE draw call (a single InstancedMesh)', () => {
    const ti = new TrackInstances(['straight'], 512);
    for (let i = 0; i < 500; i++) ti.place('straight', { cell: { x: i % 25, z: Math.floor(i / 25) } });
    expect(ti.total()).toBe(500);
    expect(ti.drawCalls()).toBe(1);
  });

  it('places at the correct world position and rotation', () => {
    const ti = new TrackInstances(['straight']);
    const idx = ti.place('straight', { cell: { x: 3, z: 2 }, rotation: 1 });
    const m = ti.readMatrix('straight', idx, new THREE.Matrix4());
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(3 * CELL, 5);
    expect(pos.z).toBeCloseTo(2 * CELL, 5);
    // rotation 1 = one quarter turn about Y
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    expect(Math.abs(q.dot(expected))).toBeCloseTo(1, 4);
  });

  it('a piece with glow adds a second draw call (body + glow layer)', () => {
    const ti = new TrackInstances(['junction']);
    ti.place('junction', { cell: { x: 0, z: 0 } });
    expect(ti.drawCalls()).toBe(2);
  });

  it('a whole 16-type palette with one of each stays well under the draw-call budget', () => {
    const types = [
      'straight',
      'curve-small',
      'curve-large',
      's-bend',
      's-bend-left',
      'skew',
      'skew-left',
      'ramp',
      'curve-small-ramp',
      'curve-large-ramp',
      'hill',
      'bump',
      'bridge',
      'tunnel',
      'junction',
      'crossing',
    ] as const;
    const ti = new TrackInstances([...types]);
    types.forEach((t, i) => ti.place(t, { cell: { x: i, z: 0 }, tint: 0x88cc66 }));
    // 16 body meshes + 1 glow (junction) = 17, well under the 150 draw-call budget (docs/30 §9)
    expect(ti.drawCalls()).toBeLessThanOrEqual(20);
    expect(ti.drawCalls()).toBe(17);
  });

  it('clear() resets counts and draw calls', () => {
    const ti = new TrackInstances(['straight']);
    ti.place('straight', { cell: { x: 0, z: 0 } });
    ti.clear();
    expect(ti.total()).toBe(0);
    expect(ti.drawCalls()).toBe(0);
  });
});
