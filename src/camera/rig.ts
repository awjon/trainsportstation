// Camera rig (docs/70 M3.2): OrbitControls with clamps that keep the camera above the ground
// and within a sensible zoom range, plus builder-friendly mouse/touch mappings (left-drag pans
// the board, right-drag orbits, wheel/pinch zooms — so a left *click* is free for placement).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface RigOptions {
  minDistance?: number;
  maxDistance?: number;
  maxPolarAngle?: number;
  target?: [number, number, number];
}

export function createCameraRig(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  opts: RigOptions = {},
): OrbitControls {
  const c = new OrbitControls(camera, dom);
  c.enableDamping = true;
  c.dampingFactor = 0.08;
  c.minDistance = opts.minDistance ?? 6;
  c.maxDistance = opts.maxDistance ?? 60;
  c.maxPolarAngle = opts.maxPolarAngle ?? Math.PI * 0.48; // never drop below the ground
  c.screenSpacePanning = false; // pan across the ground plane, not the screen
  c.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  if (opts.target) c.target.set(...opts.target);
  c.update();
  return c;
}
