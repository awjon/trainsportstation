// Asset lab — renders every procedurally generated mesh on a grid so the look can be
// reviewed and grid alignment verified. Doubles as the M3 render harness (docs/70).
// Body meshes share one flat-shaded vertex-color material (docs/30 §9); glowing bits live on
// a separate bloom layer with an unlit material.
//
// URL params: ?view=overview|track|stock|town  ?focus=<name>  ?spin=1  ?wire=1

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL, PALETTE } from '../render/meshgen/palette';
import { ALL_PIECES, buildPiece, type PieceType } from '../render/meshgen/track';
import { makeCarriage, makeLocomotive } from '../render/meshgen/rollingstock';
import { makeHouse, makeLamp, makeStation, makeTree } from '../render/meshgen/structures';
import type { Asset } from '../render/meshgen/asset';
import { BLOOM_LAYER, makeBloom } from '../render/postfx';

const params = new URLSearchParams(location.search);
const SPIN = params.get('spin') === '1';
const WIRE = params.get('wire') === '1';
const FOCUS = params.get('focus');

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe3f0');
scene.fog = new THREE.Fog('#bfe3f0', 28, 62);

// shared materials: one lit body material (the instanced-piece material), one unlit glow material
const bodyMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.85,
  metalness: 0.0,
  wireframe: WIRE,
});
const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

// lighting: key directional + hemisphere fill
const key = new THREE.DirectionalLight('#fff4e0', 2.0);
key.position.set(6, 12, 5);
scene.add(key);
scene.add(new THREE.HemisphereLight('#eaf6ff', '#6b8f4e', 0.85));

// ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.002;
scene.add(ground);

// grid aligned to CELL — visual proof pieces snap to cell edges
const grid = new THREE.GridHelper(24, 24 / CELL, 0x39603a, 0x5c8a4f);
(grid.material as THREE.Material).opacity = 0.4;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.0;
scene.add(grid);

// soft blob-shadow texture (generated, no files) shared by all contact shadows
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: shadowTex,
  transparent: true,
  depthWrite: false,
});

const spinners: THREE.Object3D[] = [];
let triangles = 0;

function addShadow(parent: THREE.Object3D, radius: number): void {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), shadowMaterial);
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.012;
  parent.add(s);
}

/** Place an Asset at (x,z): body on the shared material, glow on the bloom layer, + a blob shadow. */
function place(
  asset: Asset,
  x: number,
  z: number,
  opts: { shadow?: number; rotY?: number; center?: boolean } = {},
): THREE.Object3D {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  if (opts.rotY) group.rotation.y = opts.rotY;

  const inner = new THREE.Group();
  if (opts.center) {
    // shift so the piece's horizontal footprint centre sits on (x,z) — keeps long pieces
    // (bridge, s-bend, hill) from overrunning their grid slot.
    asset.body.computeBoundingBox();
    const bb = asset.body.boundingBox!;
    inner.position.set(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  }
  group.add(inner);

  const bodyMesh = new THREE.Mesh(asset.body, bodyMaterial);
  inner.add(bodyMesh);
  triangles += asset.body.getAttribute('position').count / 3;

  if (asset.glow) {
    const glowMesh = new THREE.Mesh(asset.glow, glowMaterial);
    glowMesh.layers.enable(BLOOM_LAYER);
    inner.add(glowMesh);
    triangles += asset.glow.getAttribute('position').count / 3;
  }
  if (opts.shadow) addShadow(inner, opts.shadow);

  scene.add(group);
  spinners.push(group);
  return group;
}

function label(text: string, x: number, z: number, y = 1.7): void {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  // shrink the font until the label fits the canvas width (long names like curve-large-ramp)
  let fontSize = 34;
  do {
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    if (ctx.measureText(text).width <= c.width - 16) break;
    fontSize -= 2;
  } while (fontSize > 16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, c.width / 2, 34);
  ctx.fillStyle = '#243038';
  ctx.fillText(text, c.width / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.position.set(x, y, z);
  spr.scale.set(3.3, 0.55, 1);
  scene.add(spr);
}

// registry of everything the lab can show (used for both layout and ?focus)
const catalog: Record<string, () => Asset> = {
  locomotive: () => makeLocomotive(),
  'carriage-passenger': () => makeCarriage('passenger', PALETTE.commuter),
  'carriage-container': () => makeCarriage('container', PALETTE.kid),
  'carriage-tank': () => makeCarriage('tank', PALETTE.doctor),
  'carriage-flatbed': () => makeCarriage('flatbed', PALETTE.engineer),
  station: () => makeStation(),
  tree: () => makeTree(),
  house: () => makeHouse(),
  lamp: () => makeLamp(),
};
for (const p of ALL_PIECES) catalog[p] = () => buildPiece(p);

/** A flat water patch (generated box, no texture) for the bridge diorama. */
function waterPatch(w: number, d: number, x: number, z: number): void {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.1, d),
    new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.35, metalness: 0.1 }),
  );
  m.position.set(x, 0.03, z);
  scene.add(m);
}

if (FOCUS && catalog[FOCUS]) {
  // single-mesh inspection mode (long pieces are centred so they frame nicely)
  if (FOCUS === 'bridge') waterPatch(3.4, 3.2, 0, 0); // gap the span crosses
  const centred = FOCUS === 'bridge' || FOCUS === 's-bend' || FOCUS === 'hill';
  place(catalog[FOCUS](), 0, 0, { shadow: centred ? 0 : 1.6, center: true });
  label(FOCUS, 0, centred ? -3.4 : -1.8, 2.1);
  // prove the tunnel fits a train: a loco emerging from the mouth
  if (FOCUS === 'tunnel') {
    const loco = place(makeLocomotive(), 0, 1.9, { shadow: 0 });
    loco.rotation.y = Math.PI; // face into the hill (−Z)
  }
} else {
  // Track pieces: a labelled grid (5 columns) — every piece visible, centred in its slot.
  const cols = 5;
  const sx = 4.2;
  const sz = 4.6;
  ALL_PIECES.forEach((p: PieceType, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * sx;
    const z = -2 - row * sz;
    place(buildPiece(p), x, z, { shadow: 1.4, center: true });
    label(p, x, z - 2.0, 1.3);
  });

  // Rolling stock (in front of the grid)
  const stockZ = 7;
  place(makeLocomotive(), -6.5, stockZ, { shadow: 1.4 });
  place(makeCarriage('passenger', PALETTE.commuter), -4.6, stockZ, { shadow: 1.2 });
  place(makeCarriage('container', PALETTE.kid), -2.7, stockZ, { shadow: 1.2 });
  place(makeCarriage('tank', PALETTE.doctor), -0.8, stockZ, { shadow: 1.2 });
  place(makeCarriage('flatbed', PALETTE.engineer), 1.1, stockZ, { shadow: 1.2 });
  place(makeCarriage('passenger', PALETTE.elder), 3.0, stockZ, { shadow: 1.2 });
  place(makeCarriage('container', PALETTE.musician), 4.9, stockZ, { shadow: 1.2 });
  label('locomotive + persona carriages', -0.8, stockZ - 1.6, 1.9);

  // Station + props (front-most)
  const townZ = 11;
  place(makeStation(), -5, townZ, { shadow: 1.8 });
  label('station', -5, townZ - 1.8, 1.9);
  place(makeTree(), -1.5, townZ, { shadow: 0.9 });
  place(makeTree(), -0.4, townZ + 0.6, { shadow: 0.9 });
  place(makeHouse(), 1.6, townZ, { shadow: 1.2, rotY: Math.PI * 0.15 });
  place(makeLamp(), 3.6, townZ, { shadow: 0.6 });
  label('props: tree · house · lamp', 1.4, townZ - 1.8, 1.9);
}

// camera + controls
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
camera.layers.enableAll();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const views: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [0, 15, 22], target: [0, 0.4, -1] },
  pieces: { pos: [0, 22, 6], target: [0, 0, -6.5] }, // high angle over the whole piece grid
  track: { pos: [0, 24, -6], target: [0, 0, -6.5] }, // top-down piece grid
  stock: { pos: [-1, 4.5, 14], target: [-1, 0.6, 7] },
  town: { pos: [-1, 5, 19], target: [-1, 0.4, 11] },
  focus: { pos: [3.4, 2.4, 3.8], target: [0, 0.7, 0] },
};
const view = FOCUS ? 'focus' : (params.get('view') ?? 'overview');
const v = views[view] ?? views.overview;
camera.position.set(...v.pos);
controls.target.set(...v.target);
controls.update();

const bloom = makeBloom(renderer, scene, camera, { strength: 0.45, radius: 0.3 });

// HUD stats
const hud = document.getElementById('hud')!;
hud.innerHTML =
  `Trainsportstation — procedural asset lab<br>` +
  `${ALL_PIECES.length} track pieces · loco · carriages · station · props<br>` +
  `~${Math.round(triangles).toLocaleString()} triangles · baked shading · selective bloom · 0 texture files`;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

// keyboard: [w] wireframe, [s] spin
window.addEventListener('keydown', (e) => {
  if (e.key === 'w') bodyMaterial.wireframe = !bodyMaterial.wireframe;
});

let rendered = 0;
const clock = new THREE.Clock();
function animate(): void {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (SPIN || FOCUS) for (const o of spinners) o.rotation.y += dt * 0.6;
  controls.update();
  bloom.render();
  rendered++;
  if (rendered === 3) (window as unknown as { __labReady?: boolean }).__labReady = true;
}
animate();
