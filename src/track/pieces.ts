// Canonical piece definitions (docs/30 §4/§5). HEADLESS — no three.js — this is the source of
// truth the simulation, placement, and graph build on. The mesh generator (render/meshgen)
// imports `PieceType` from here so the visual and the model can never disagree about the set.
//
// Coordinates: integer grid cells, x→east, z→south. Ports sit on a cell edge (N=−z, E=+x,
// S=+z, W=−x) at a height level. Rotation is quarter turns clockwise looking down +Y — the
// same convention the renderer uses (`-(rotation)·π/2` about Y ⇒ cell (x,z) → (−z, x)).

export type PieceType =
  | 'straight'
  | 'curve-small'
  | 'curve-large'
  | 's-bend'
  | 's-bend-left'
  | 'skew'
  | 'skew-left'
  | 'ramp'
  | 'curve-small-ramp'
  | 'curve-large-ramp'
  | 'hill'
  | 'bump'
  | 'bridge'
  | 'tunnel'
  | 'junction'
  | 'crossing';

export const PIECE_TYPES: PieceType[] = [
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
];

export type Direction = 'N' | 'E' | 'S' | 'W';
export type HeightLevel = 0 | 1 | 2;
export type Rotation = 0 | 1 | 2 | 3;

export interface CellCoord {
  x: number;
  z: number;
}

export interface Port {
  cell: CellCoord;
  edge: Direction;
  height: HeightLevel;
}

export type CurveClass = 'straight' | 'gentle' | 'tight';

export interface PathDef {
  fromPort: number; // index into PieceDef.ports
  toPort: number;
  curveClass: CurveClass;
  grade: -1 | 0 | 1; // height change from → to (per one traversal in that direction)
  length: number; // arc length in world units (LUT-verified within 0.5%, docs/30 §6, M4.1)
  jumpCapable?: boolean;
}

export type PieceTag = 'jumpCapable' | 'switch' | 'elevated' | 'covered';

export interface PieceDef {
  type: PieceType;
  footprint: CellCoord[]; // piece-local cells occupied
  ports: Port[];
  paths: PathDef[];
  tags: PieceTag[];
}

const c = (x: number, z: number): CellCoord => ({ x, z });
const p = (cell: CellCoord, edge: Direction, height: HeightLevel = 0): Port => ({ cell, edge, height });

// World-unit constants mirrored from render/meshgen/palette.ts (this file is headless and must
// not import render/*, docs/30 §2.1) — keep numerically in sync with palette.ts by hand.
// CELL/HEIGHT_UNIT are exported (docs/70 M4.3) so track/placement.ts's pieceLocalToWorld/
// pieceLocalDirToWorld can reuse them rather than adding a third hand-kept-in-sync copy (splines.ts's
// paths.ts already has its own; this is a deliberate exception to that "each headless file
// re-declares its own copy" pattern, per the M4.3 task's explicit instruction to reuse these).
export const CELL = 2.0;
export const HEIGHT_UNIT = 1.0;
const HALF = CELL / 2;

// Exact path lengths in world units (M4.1: LUT-verified in track/splines.test.ts against
// track/paths.ts's actual curve geometry, docs/30 §6, within the 0.5% tolerance). Curves with a
// closed-form length (lines and arcCurve, which has constant angular speed and constant y-rate in
// its parameter, so length = hypot(r·sweep, Δy)) use that formula; Catmull-Rom "sampled" curves
// (hill/bump/s-bend/skew — no closed form) use their 64-sample LUT-measured length verbatim.
const L_STRAIGHT = CELL;
const L_RAMP = Math.hypot(CELL, HEIGHT_UNIT); // rises one level over one cell
const L_CURVE_SMALL = (Math.PI / 2) * HALF; // quarter circle, r = HALF cell
const L_CURVE_LARGE = (Math.PI / 2) * (1.5 * CELL); // quarter circle, r = 1.5 cell
const L_CURVE_SMALL_RAMP = Math.hypot(L_CURVE_SMALL, HEIGHT_UNIT); // small curve + one-level climb
const L_CURVE_LARGE_RAMP = Math.hypot(L_CURVE_LARGE, HEIGHT_UNIT); // large curve + one-level climb
const L_HILL = 4.265541101; // Catmull-Rom "sampled" curve — 64-sample LUT length (no closed form)
const L_BUMP = 2.188047933; // Catmull-Rom "sampled" curve — 64-sample LUT length
const L_SBEND = 5.356824393; // Catmull-Rom "sampled" curve — 64-sample LUT length (s-bend-left shares it)
const L_SKEW = 3.333641208; // Catmull-Rom "sampled" curve — 64-sample LUT length (skew-left shares it)
const L_BRIDGE = 2 * Math.hypot(CELL, HEIGHT_UNIT) + CELL; // ramp up + flat deck (one cell) + ramp down

export const PIECE_DEFS: Record<PieceType, PieceDef> = {
  straight: {
    type: 'straight',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N'), p(c(0, 0), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_STRAIGHT }],
    tags: [],
  },
  'curve-small': {
    type: 'curve-small',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N'), p(c(0, 0), 'E')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'tight', grade: 0, length: L_CURVE_SMALL }],
    tags: [],
  },
  'curve-large': {
    type: 'curve-large',
    footprint: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)],
    ports: [p(c(0, 0), 'N'), p(c(1, 1), 'E')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'gentle', grade: 0, length: L_CURVE_LARGE }],
    tags: [],
  },
  's-bend': {
    type: 's-bend',
    footprint: [c(0, 0), c(0, 1), c(1, 0), c(1, 1)],
    ports: [p(c(0, 0), 'N'), p(c(1, 1), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'gentle', grade: 0, length: L_SBEND }],
    tags: [],
  },
  's-bend-left': {
    type: 's-bend-left',
    footprint: [c(0, 0), c(0, 1), c(-1, 0), c(-1, 1)],
    ports: [p(c(0, 0), 'N'), p(c(-1, 1), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'gentle', grade: 0, length: L_SBEND }],
    tags: [],
  },
  skew: {
    type: 'skew',
    footprint: [c(0, 0), c(1, 0)],
    ports: [p(c(0, 0), 'N'), p(c(1, 0), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'gentle', grade: 0, length: L_SKEW }],
    tags: [],
  },
  'skew-left': {
    type: 'skew-left',
    footprint: [c(0, 0), c(-1, 0)],
    ports: [p(c(0, 0), 'N'), p(c(-1, 0), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'gentle', grade: 0, length: L_SKEW }],
    tags: [],
  },
  ramp: {
    type: 'ramp',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N', 0), p(c(0, 0), 'S', 1)],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'straight', grade: 1, length: L_RAMP }],
    tags: [],
  },
  'curve-small-ramp': {
    type: 'curve-small-ramp',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N', 0), p(c(0, 0), 'E', 1)],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'tight', grade: 1, length: L_CURVE_SMALL_RAMP }],
    tags: [],
  },
  'curve-large-ramp': {
    type: 'curve-large-ramp',
    footprint: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)],
    ports: [p(c(0, 0), 'N', 0), p(c(1, 1), 'E', 1)],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'gentle', grade: 1, length: L_CURVE_LARGE_RAMP }],
    tags: [],
  },
  hill: {
    type: 'hill',
    footprint: [c(0, 0), c(0, 1)],
    ports: [p(c(0, 0), 'N'), p(c(0, 1), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_HILL, jumpCapable: true }],
    tags: ['jumpCapable'],
  },
  bump: {
    type: 'bump',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N'), p(c(0, 0), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_BUMP, jumpCapable: true }],
    tags: ['jumpCapable'],
  },
  bridge: {
    type: 'bridge',
    footprint: [c(0, 0), c(0, 1), c(0, 2)],
    ports: [p(c(0, 0), 'N', 0), p(c(0, 2), 'S', 0)],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_BRIDGE }],
    tags: ['elevated'],
  },
  tunnel: {
    type: 'tunnel',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N'), p(c(0, 0), 'S')],
    paths: [{ fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_STRAIGHT }],
    tags: ['covered'],
  },
  junction: {
    type: 'junction',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N'), p(c(0, 0), 'S'), p(c(0, 0), 'E')],
    paths: [
      { fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_STRAIGHT }, // through (switch state 0)
      { fromPort: 0, toPort: 2, curveClass: 'tight', grade: 0, length: L_CURVE_SMALL }, // branch (switch state 1)
    ],
    tags: ['switch'],
  },
  crossing: {
    type: 'crossing',
    footprint: [c(0, 0)],
    ports: [p(c(0, 0), 'N'), p(c(0, 0), 'S'), p(c(0, 0), 'E'), p(c(0, 0), 'W')],
    paths: [
      { fromPort: 0, toPort: 1, curveClass: 'straight', grade: 0, length: L_STRAIGHT }, // N–S
      { fromPort: 2, toPort: 3, curveClass: 'straight', grade: 0, length: L_STRAIGHT }, // E–W
    ],
    tags: [],
  },
};

// --- rotation (clockwise, quarter turns) ---

const DIRS: Direction[] = ['N', 'E', 'S', 'W'];

export function rotateDir(d: Direction, rot: Rotation): Direction {
  return DIRS[(DIRS.indexOf(d) + rot) % 4];
}

export function rotateCell(cell: CellCoord, rot: Rotation): CellCoord {
  let { x, z } = cell;
  for (let i = 0; i < rot; i++) {
    const nx = -z;
    const nz = x;
    x = nx;
    z = nz;
  }
  return { x, z };
}

export function rotatePort(port: Port, rot: Rotation): Port {
  return { cell: rotateCell(port.cell, rot), edge: rotateDir(port.edge, rot), height: port.height };
}

/** The unit step (dx,dz) from a cell across an edge to the neighbouring cell. */
export function edgeStep(edge: Direction): CellCoord {
  switch (edge) {
    case 'N':
      return c(0, -1);
    case 'S':
      return c(0, 1);
    case 'E':
      return c(1, 0);
    case 'W':
      return c(-1, 0);
  }
}

export const opposite = (d: Direction): Direction => rotateDir(d, 2);
