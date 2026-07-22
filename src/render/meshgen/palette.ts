// Warm toy palette + world constants shared by every generator.
// Single-material rule (docs/30 §9): all geometry carries a vertex-color attribute
// and renders through one flat-shaded MeshStandardMaterial.

export const CELL = 2.0; // world units per grid cell
export const HEIGHT_UNIT = 1.0; // world units per elevation level (0,1,2)

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
