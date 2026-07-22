// Asset lab — renders every procedurally generated mesh on a grid so the look can be
// reviewed and the grid alignment verified. Doubles as the M3 render harness (docs/70).
// One shared flat-shaded material for all geometry (docs/30 §9).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL, PALETTE } from '../render/meshgen/palette';
import { ALL_PIECES, buildPiece, type PieceType } from '../render/meshgen/track';
import { makeCarriage, makeLocomotive } from '../render/meshgen/rollingstock';
import { makeHouse, makeLamp, makeStation, makeTree } from '../render/meshgen/structures';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe3f0');
scene.fog = new THREE.Fog('#bfe3f0', 26, 60);

// THE single shared material (vertex colors, flat toy shading)
const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.85,
  metalness: 0.0,
});

// lighting: one key directional + soft ambient (docs/30 §9)
const key = new THREE.DirectionalLight('#fff4e0', 2.1);
key.position.set(6, 12, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -18;
key.shadow.camera.right = 18;
key.shadow.camera.top = 18;
key.shadow.camera.bottom = -18;
key.shadow.camera.far = 60;
scene.add(key);
scene.add(new THREE.HemisphereLight('#eaf6ff', '#6b8f4e', 0.9));

// ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.001;
ground.receiveShadow = true;
scene.add(ground);

// grid aligned to CELL — visual proof that pieces snap to cell edges
const grid = new THREE.GridHelper(24, 24 / CELL, 0x39603a, 0x5c8a4f);
(grid.material as THREE.Material).opacity = 0.5;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.002;
scene.add(grid);

let triangles = 0;
function place(geo: THREE.BufferGeometry, x: number, z: number, rotY = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  triangles += geo.attributes.position.count / 3;
  return mesh;
}

function label(text: string, x: number, z: number, y = 2.1): void {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,30,36,0.0)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(text, 128, 34);
  ctx.fillStyle = '#243038';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.position.set(x, y, z);
  spr.scale.set(2.2, 0.55, 1);
  scene.add(spr);
}

// --- Row 1: all 10 track pieces ---
const trackZ = -6;
const pieceSpacing = CELL * 1.9;
const startX = (-(ALL_PIECES.length - 1) * pieceSpacing) / 2;
ALL_PIECES.forEach((p: PieceType, i) => {
  const x = startX + i * pieceSpacing;
  place(buildPiece(p), x, trackZ);
  label(p, x, trackZ - CELL * 0.9, 1.6);
});

// --- Row 2: rolling stock (a little train) ---
const stockZ = -1;
place(makeLocomotive(), -6.5, stockZ);
place(makeCarriage('passenger', PALETTE.commuter), -4.6, stockZ);
place(makeCarriage('container', PALETTE.kid), -2.7, stockZ);
place(makeCarriage('tank', PALETTE.doctor), -0.8, stockZ);
place(makeCarriage('flatbed', PALETTE.engineer), 1.1, stockZ);
place(makeCarriage('passenger', PALETTE.elder), 3.0, stockZ);
place(makeCarriage('container', PALETTE.musician), 4.9, stockZ);
label('locomotive + persona carriages', -0.8, stockZ - 1.4, 1.9);

// --- Row 3: station + props ---
const townZ = 4;
place(makeStation(), -5, townZ);
label('station', -5, townZ - 1.6, 1.9);
place(makeTree(), -1.5, townZ);
place(makeTree(), -0.4, townZ + 0.6);
place(makeHouse(), 1.6, townZ, Math.PI * 0.15);
place(makeLamp(), 3.6, townZ);
label('props: tree · house · lamp', 1.4, townZ - 1.6, 1.9);

// --- camera + controls ---
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, -1.5);
controls.enableDamping = true;

const views: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [0, 12, 16], target: [0, 0.4, -2] },
  track: { pos: [0, 16, 0.01], target: [0, 0, -6] }, // top-down on track row (alignment proof)
  trackPersp: { pos: [-2, 6, 3], target: [-2, 0.3, -6] },
  stock: { pos: [-1, 4.5, 7], target: [-1, 0.6, -1] },
  town: { pos: [-1, 5, 12], target: [-1, 0.4, 4] },
};

function applyView(name: string): void {
  const v = views[name] ?? views.overview;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}
const params = new URLSearchParams(location.search);
applyView(params.get('view') ?? 'overview');

// HUD stats
const hud = document.getElementById('hud')!;
const pieceGeoBytes = ALL_PIECES.reduce((s, p) => s + buildPiece(p).attributes.position.array.byteLength, 0);
hud.innerHTML =
  `Trainsportstation — procedural asset lab<br>` +
  `${ALL_PIECES.length} track pieces · 1 loco · 6 carriages · station · props<br>` +
  `~${Math.round(triangles).toLocaleString()} triangles · 1 shared material · 0 texture files<br>` +
  `10 track-piece geometries ≈ ${(pieceGeoBytes / 1024).toFixed(0)} KB in memory, generated at runtime`;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let rendered = 0;
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  rendered++;
  if (rendered === 3) (window as unknown as { __labReady?: boolean }).__labReady = true;
}
animate();
