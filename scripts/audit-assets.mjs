#!/usr/bin/env node
// M0.2 — Asset audit (docs/70 M0.2, contract 60 §4–5, §9).
//
// Walks kenney-train-kit/, measures every GLB's bounds/triangles/material from the raw glTF
// (no three.js — the audit runs in the headless CI zone), measures CELL_SIZE from
// railroad-straight, records wood/stone/metal swatch UVs sampled from colormap.png, and emits a
// diff-stable data/assets.json manifest. Exits non-zero on any 60 §5 / §9 gate failure.
//
// cellSize resolution (risk register #1): 60 §5 defines cellSize = X-extent of railroad-straight
// = 1.0. The shipped model is 1.0 wide but 4.0 long along the track (-Z), so it does not fill a
// square cell on its own. Per 60 §5's own scaleFactor mechanism we record kitScaleFactor =
// cellSize / alongTrackExtent = 0.25, which makes a straight span exactly one cell along the
// track. Track paths are authored in cell units (30 §5); the renderer applies kitScaleFactor.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_DIR = 'kenney-train-kit/Models/GLB';
const COLORMAP = 'kenney-train-kit/Models/GLB/Textures/colormap.png';
const OUT = 'data/assets.json';
const ROUND = 6; // fixed precision → diff-stable output (V)

const errors = [];
const fail = (msg) => errors.push(msg);
const round = (n) => Number(n.toFixed(ROUND));

// ---------- GLB / glTF parsing (accessor min/max + node transforms; no mesh decode needed) ----------
function parseGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + len)));
    off = start + len;
  }
  return json;
}
function mIdentity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function nodeMatrix(n) { return n.matrix ? n.matrix.slice() : fromTRS(n.translation, n.rotation, n.scale); }
function xform(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function measure(json) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const materials = new Set();
  const images = new Set();
  let triangles = 0;
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const walk = (idx, parent) => {
    const node = json.nodes[idx];
    const world = mMul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.material != null) materials.add(prim.material);
        const acc = json.accessors[prim.attributes.POSITION];
        if (prim.indices != null) triangles += json.accessors[prim.indices].count / 3;
        else if (acc) triangles += acc.count / 3;
        if (!acc?.min || !acc?.max) continue;
        for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
          const p = xform(world, [cx, cy, cz]);
          for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
        }
      }
    }
    for (const c of node.children ?? []) walk(c, world);
  };
  for (const r of roots) walk(r, mIdentity());
  for (const m of json.materials ?? []) materials.add(`mat:${m.name}`);
  for (const im of json.images ?? []) images.add(im.uri ?? im.name ?? 'embedded');
  return { min, max, materialCount: json.materials?.length ?? materials.size, images: [...images], triangles: Math.round(triangles) };
}

// ---------- palette PNG decode + swatch sampling ----------
function decodePalettePNG(path) {
  const png = readFileSync(join(ROOT, path));
  let off = 8, width = 0, height = 0, plte = null;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const idx = Buffer.alloc(width * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    for (let x = 0; x < width; x++) {
      const rb = raw[pos++];
      const a = x >= 1 ? idx[y * width + x - 1] : 0;
      const b = y > 0 ? idx[(y - 1) * width + x] : 0;
      const c = x >= 1 && y > 0 ? idx[(y - 1) * width + x - 1] : 0;
      let v;
      switch (f) { case 1: v = rb + a; break; case 2: v = rb + b; break; case 3: v = rb + ((a + b) >> 1); break; case 4: v = rb + paeth(a, b, c); break; default: v = rb; }
      idx[y * width + x] = v & 0xff;
    }
  }
  return { width, height, plte, idx };
}
function sampleSwatch(png, u, v) {
  const x = Math.min(png.width - 1, Math.floor(u * png.width));
  const y = Math.min(png.height - 1, Math.floor(v * png.height));
  const i = png.idx[y * png.width + x];
  return [png.plte[i * 3], png.plte[i * 3 + 1], png.plte[i * 3 + 2]];
}
function toHex([r, g, b]) { return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0'); }

// Chosen swatch UVs (hand-annotated at M0 from the palette scan). Class predicates guard them so
// the audit fails if a future kit swap moves the swatch off-color.
const SWATCH_UVS = {
  wood: [0.2788, 0.6268], // b06041 warm brown — trestles, decks (60 §3.1/§3.4)
  stone: [0.7884, 0.8654], // 4f5260 structural gray — footings, portals (60 §3.1/§3.2)
  metal: [0.1514, 0.8621], // d0d0e1 light steel — lever/signal posts (60 §3.3)
};
const swatchClass = {
  wood: (r, g, b) => r > g && g > b && r > 90 && r - b > 40,
  stone: (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= 24 && Math.max(r, g, b) >= 60 && Math.max(r, g, b) < 150,
  metal: (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= 24 && Math.max(r, g, b) >= 150,
};

// ---------- piece → model / procedural mapping (60 §2, footprints from 30 §5 port table) ----------
const PROCEDURAL = { bridge: 'trestle-v1', tunnel: 'portal-v1', junction: 'lever-v1', crossing: 'deck-v1', station: 'platform-v1' };
const PIECES = {
  straight: { model: 'railroad-straight', footprint: [[0, 0]], tags: [] },
  'curve-small': { model: 'railroad-corner-small', footprint: [[0, 0]], tags: [] },
  'curve-large': { model: 'railroad-corner-large', footprint: [[0, 0], [1, 0], [0, 1], [1, 1]], tags: [] },
  ramp: { model: 'railroad-corner-small-ramp', footprint: [[0, 0]], tags: [] },
  hill: { model: 'railroad-straight-hill-complete', footprint: [[0, 0], [0, 1]], tags: ['jumpCapable'] },
  bump: { model: 'railroad-straight-bump-up', footprint: [[0, 0]], tags: ['jumpCapable'] },
  bridge: { procedural: 'bridge', footprint: [[0, 0]], tags: ['elevated'] },
  tunnel: { procedural: 'tunnel', footprint: [[0, 0]], tags: ['covered'] },
  junction: { procedural: 'junction', footprint: [[0, 0]], tags: ['switch'] },
  crossing: { procedural: 'crossing', footprint: [[0, 0]], tags: [] },
};

function kindOf(name) {
  if (name.startsWith('train-carriage')) return 'carriage';
  if (name === 'train-connector') return 'connector';
  if (name.startsWith('train-')) return 'locomotive';
  return 'track';
}

// ---------- run ----------
const files = readdirSync(join(ROOT, KIT_DIR)).filter((f) => f.endsWith('.glb')).sort();
if (files.length !== 85) fail(`expected 85 GLBs, found ${files.length}`);

const models = {};
let totalGz = 0;
for (const file of files) {
  const id = file.replace(/\.glb$/, '');
  const buf = readFileSync(join(ROOT, KIT_DIR, file));
  totalGz += zlib.gzipSync(buf).length;
  const m = measure(parseGLB(buf));
  const size = { x: round(m.max[0] - m.min[0]), y: round(m.max[1] - m.min[1]), z: round(m.max[2] - m.min[2]) };
  // Gate: single material referencing the shared colormap (60 §5 / §9)
  if (m.materialCount !== 1) fail(`${id}: expected 1 material, found ${m.materialCount}`);
  if (!m.images.every((i) => i.endsWith('colormap.png'))) fail(`${id}: references non-colormap texture ${m.images}`);
  // Gate: triangle budget ≤ 4k per piece (60 §9)
  if (m.triangles > 4000) fail(`${id}: ${m.triangles} triangles exceeds 4000 budget`);
  const entry = {
    file: `${KIT_DIR}/${file}`,
    kind: kindOf(id),
    bounds: { min: m.min.map(round), max: m.max.map(round) },
    size,
    triangles: m.triangles,
    baseOffsetY: round(-m.min[1]), // lift base to y=0 (60 §5 pivot convention)
    yawOffset: 0,
  };
  if (entry.kind === 'locomotive' || entry.kind === 'carriage') entry.length = size.z; // feeds CARRIAGE_SPACING checks (60 §4)
  models[id] = entry;
}

// cellSize + scaleFactor from the reference straight (60 §5)
const straight = models['railroad-straight'];
if (!straight) fail('railroad-straight.glb missing — cannot derive cellSize');
const cellSize = straight ? round(straight.size.x) : 0; // X-extent per 60 §5
const alongTrack = straight ? Math.max(straight.size.x, straight.size.z) : 0;
const kitScaleFactor = straight ? round(cellSize / alongTrack) : 0;
if (!(cellSize > 0)) fail(`cellSize must be > 0, got ${cellSize}`);

// Gate: every tray-piece model fits its footprint box in cell space (60 §5).
// The reference straight calibrates scale exactly (≤2%); other pieces must fit within footprint.
const FIT_TOL = 0.02;
for (const [type, def] of Object.entries(PIECES)) {
  if (!def.model) continue;
  const mdl = models[def.model];
  if (!mdl) { fail(`piece ${type}: model ${def.model} not found in kit`); continue; }
  const cols = Math.max(...def.footprint.map((c) => c[0])) + 1;
  const rows = Math.max(...def.footprint.map((c) => c[1])) + 1;
  const fitX = (mdl.size.x * kitScaleFactor) / (cols * cellSize);
  const fitZ = (mdl.size.z * kitScaleFactor) / (rows * cellSize);
  if (fitX > 1 + FIT_TOL || fitZ > 1 + FIT_TOL) fail(`piece ${type} (${def.model}) overflows ${cols}x${rows} footprint: fitX=${fitX.toFixed(3)} fitZ=${fitZ.toFixed(3)}`);
  if (type === 'straight' && Math.abs(fitZ - 1) > FIT_TOL) fail(`reference straight along-track scale off by >${FIT_TOL * 100}%: ${fitZ.toFixed(4)}`);
}

// Gate: all 10 PieceTypes resolve to a model or a registered procedural generator (60 §9 completeness)
for (const [type, def] of Object.entries(PIECES)) {
  if (def.model && !models[def.model]) fail(`piece ${type}: unresolved model ${def.model}`);
  if (def.procedural && !PROCEDURAL[def.procedural]) fail(`piece ${type}: unresolved procedural ${def.procedural}`);
}

// Swatches (60 §3 / M0.2): sample + class-guard
const png = decodePalettePNG(COLORMAP);
const swatches = {};
for (const [name, uv] of Object.entries(SWATCH_UVS)) {
  const rgb = sampleSwatch(png, uv[0], uv[1]);
  const hex = toHex(rgb);
  if (!swatchClass[name](...rgb)) fail(`swatch ${name} at UV ${uv} is #${hex} — fails ${name} color class`);
  swatches[name] = { uv: [round(uv[0]), round(uv[1])], hex };
}

// Gate: boot budget — models ≤ 4 MB gzipped (60 §9)
const modelsGzMB = totalGz / (1024 * 1024);
if (modelsGzMB > 4) fail(`gzipped models ${modelsGzMB.toFixed(2)} MB exceeds 4 MB budget`);

// ---------- emit manifest (sorted keys → diff-stable) ----------
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const pieces = {};
for (const type of Object.keys(PIECES).sort()) {
  const d = PIECES[type];
  pieces[type] = d.model
    ? { model: d.model, footprint: d.footprint, tags: d.tags }
    : { procedural: d.procedural, generator: PROCEDURAL[d.procedural], footprint: d.footprint, tags: d.tags };
}
const manifest = {
  $schema: 'generated by scripts/audit-assets.mjs — do not edit by hand',
  cellSize,
  kitScaleFactor,
  colormap: COLORMAP,
  swatches: sortObj(swatches),
  pieces: sortObj(pieces),
  procedural: sortObj(PROCEDURAL),
  personaIcons: 'generated:persona-atlas-v1',
  audit: {
    modelCount: files.length,
    maxTriangles: Math.max(...Object.values(models).map((m) => m.triangles)),
    modelsGzBytes: totalGz,
    referenceModel: 'railroad-straight',
  },
  models: sortObj(models),
};

if (errors.length) {
  console.error('ASSET AUDIT FAILED:');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}

writeFileSync(join(ROOT, OUT), JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ asset audit passed — ${files.length} models`);
console.log(`  cellSize=${cellSize} kitScaleFactor=${kitScaleFactor} (straight ${straight.size.x}×${straight.size.z} world units)`);
console.log(`  swatches: wood #${swatches.wood.hex} stone #${swatches.stone.hex} metal #${swatches.metal.hex}`);
console.log(`  triangles≤${manifest.audit.maxTriangles}/4000 · models ${modelsGzMB.toFixed(2)}/4 MB gz`);
console.log(`  wrote ${OUT}`);
