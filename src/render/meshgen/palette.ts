// Warm toy palette + world constants shared by every generator.
// Single-material rule (docs/30 §9): all geometry carries a vertex-color attribute
// and renders through one flat-shaded MeshStandardMaterial.

export const CELL = 2.0; // world units per grid cell
export const HEIGHT_UNIT = 1.0; // world units per elevation level (0,1,2)

// Baked-shading parameters (see meshgen/shading.ts). Lighting is baked into the vertex
// color at build time — free at runtime and preserved through InstancedMesh.
export const SHADE = {
  // hemispheric term: how much down-facing faces darken vs up-facing (0..1)
  hemi: 0.42,
  // vertical gradient: extra darkening applied at the model's base, fading out with height
  gradient: 0.16,
  gradientHeight: 1.4, // world-Y over which the base gradient fades to none
  // contact darkening near y≈0 (fake ambient occlusion where a part meets the ground)
  contact: 0.22,
  contactHeight: 0.18,
  ambient: 0.55, // floor brightness so shadowed faces never go fully black
} as const;

// Colors at/above this luminance are treated as emissive and picked up by the bloom pass
// (see render/postfx.ts). Keep glow colors bright.
export const BLOOM_THRESHOLD = 0.75;

export const PALETTE = {
  rail: '#4a4a52',
  railHi: '#6b6b75',
  tie: '#8b6f47',
  ballast: '#c2b280',
  grass: '#8ec96b',
  grassDark: '#6fae52',
  stone: '#9aa0a6',
  wood: '#a9793f',
  deck: '#b8935a',
  water: '#5bb6d6',
  // rolling stock
  steel: '#7d8791',
  brass: '#d9a441',
  chimney: '#3a3a3f',
  window: '#bfe6f2',
  // emissive / glow (bright — above BLOOM_THRESHOLD so the bloom pass catches them)
  windowLit: '#eafcff',
  headlight: '#fff6d8',
  lampLit: '#ffe9a0',
  signal: '#ff5a4d',
  // persona carriage colors (docs/20 §3)
  commuter: '#3f7fd6',
  kid: '#e0563f',
  elder: '#5aa469',
  musician: '#a97fd0',
  doctor: '#e8e8ea',
  engineer: '#d9a441',
  // structures & props
  platform: '#c9b79c',
  awning: '#e05a5a',
  sign: '#f0e6d2',
  roof: '#c15b4a',
  house: '#efdcc0',
  leaf: '#4f9d5b',
  leafDark: '#3d7d48',
  trunk: '#8a5a34',
  lampPost: '#4a4a52',
  lampGlow: '#ffe08a',
} as const;
