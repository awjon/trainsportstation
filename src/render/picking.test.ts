// Headless proof for grid picking (docs/70 M3.2). Raycasting is pure math, so screen→cell
// mapping is testable without a browser.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickCell, pickGround } from './picking';

function topDownCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
  cam.position.set(0, 10, 0);
  cam.up.set(0, 0, -1); // define orientation when looking straight down
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('picking', () => {
  it('centre of the screen maps to the origin cell', () => {
    const cell = pickCell(topDownCamera(), new THREE.Vector2(0, 0));
    expect(cell).toEqual({ x: 0, z: 0 });
  });

  it('always lands on the ground plane (y = 0)', () => {
    const p = pickGround(topDownCamera(), new THREE.Vector2(0.4, -0.2));
    expect(p).not.toBeNull();
    expect(p!.y).toBeCloseTo(0, 6);
  });

  it('off-centre picks a non-origin cell to the right', () => {
    const cell = pickCell(topDownCamera(), new THREE.Vector2(0.6, 0));
    expect(cell).not.toBeNull();
    expect(cell!.x).toBeGreaterThan(0);
  });

  it('returns null when the ray misses the ground (looking at the sky)', () => {
    const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
    cam.position.set(0, 5, 10);
    cam.lookAt(0, 30, -10); // tilt up, away from the ground
    cam.updateMatrixWorld(true);
    expect(pickCell(cam, new THREE.Vector2(0, 0.8))).toBeNull();
  });
});
