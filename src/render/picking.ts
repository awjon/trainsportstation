// Screen → grid picking (docs/70 M3.2). Casts a ray from the camera through a normalized
// device coordinate onto the ground plane and rounds the hit to a cell. Pure math (Raycaster),
// so the mapping is unit-testable without WebGL. Also provides the hover-highlight quad.

import * as THREE from 'three';
import { CELL } from './meshgen/palette';

export interface CellCoord {
  x: number;
  z: number;
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const hit = new THREE.Vector3();

/** World point where the camera ray through `ndc` (x,y in [-1,1]) meets the ground, or null. */
export function pickGround(
  camera: THREE.Camera,
  ndc: THREE.Vector2,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, out);
}

/** The grid cell under `ndc`, or null if the ray misses the ground (looking at the sky). */
export function pickCell(camera: THREE.Camera, ndc: THREE.Vector2): CellCoord | null {
  if (!pickGround(camera, ndc, hit)) return null;
  // `+ 0` normalizes -0 → +0 so cells serialize/compare cleanly
  return { x: Math.round(hit.x / CELL) + 0, z: Math.round(hit.z / CELL) + 0 };
}

/** Convert a pointer event on `dom` to normalized device coordinates. */
export function pointerToNdc(
  dom: HTMLElement,
  clientX: number,
  clientY: number,
  out = new THREE.Vector2(),
): THREE.Vector2 {
  const r = dom.getBoundingClientRect();
  out.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
  return out;
}

/** A translucent square that highlights the hovered cell. */
export function makeCellHighlight(color: THREE.ColorRepresentation = 0xffffff): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 2;
  return mesh;
}

export function moveHighlight(h: THREE.Mesh, cell: CellCoord | null): void {
  if (!cell) {
    h.visible = false;
    return;
  }
  h.position.set(cell.x * CELL, 0.02, cell.z * CELL);
  h.visible = true;
}
