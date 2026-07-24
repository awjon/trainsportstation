// Placement & validation (docs/30 §5, docs/70 M2.2). HEADLESS. Given a grid + terrain and the
// pieces already down, decide whether a new placement is legal, and if so hand back its world
// footprint and world ports (which the graph then wires up). Five failure reasons, checked in
// order: out-of-bounds → occupied → terrain-blocked → height-mismatch → port-mismatch.

import {
  PIECE_DEFS,
  edgeStep,
  opposite,
  rotateCell,
  rotateDir,
  type CellCoord,
  type Direction,
  type HeightLevel,
  type PieceType,
  type Port,
  type Rotation,
} from './pieces';

export type TerrainFeature = 'water' | 'rock' | 'forest' | 'town';

export interface TerrainCell {
  height: HeightLevel;
  feature?: TerrainFeature;
}

export interface Grid {
  width: number;
  height: number;
  /** sparse; unlisted cells are height 0 with no feature */
  terrain: Map<string, TerrainCell>;
}

export interface Placement {
  piece: PieceType;
  cell: CellCoord; // world cell of the piece's local (0,0)
  rotation: Rotation;
}

export type PlacementReason =
  'out-of-bounds' | 'occupied' | 'terrain-blocked' | 'height-mismatch' | 'port-mismatch';

export type PlacementResult =
  { ok: true; footprint: CellCoord[]; ports: Port[] } | { ok: false; reason: PlacementReason };

export const cellKey = (x: number, z: number): string => `${x},${z}`;
export const portKey = (cell: CellCoord, edge: Direction): string => `${cell.x},${cell.z}:${edge}`;

export function makeGrid(width: number, height: number): Grid {
  return { width, height, terrain: new Map() };
}

export function terrainAt(grid: Grid, x: number, z: number): TerrainCell {
  return grid.terrain.get(cellKey(x, z)) ?? { height: 0 };
}

export function setTerrain(grid: Grid, x: number, z: number, cell: TerrainCell): void {
  grid.terrain.set(cellKey(x, z), cell);
}

const add = (a: CellCoord, b: CellCoord): CellCoord => ({ x: a.x + b.x, z: a.z + b.z });

/** The world cells a placement occupies. */
export function worldFootprint(placement: Placement): CellCoord[] {
  return PIECE_DEFS[placement.piece].footprint.map((f) =>
    add(rotateCell(f, placement.rotation), placement.cell),
  );
}

/** The placement's ports in world space (cell + edge rotated, height carried through). */
export function worldPorts(placement: Placement): Port[] {
  return PIECE_DEFS[placement.piece].ports.map((p) => ({
    cell: add(rotateCell(p.cell, placement.rotation), placement.cell),
    edge: rotateDir(p.edge, placement.rotation),
    height: p.height,
  }));
}

/** Absolute world height of a port = the piece's base terrain height + the port's local height. */
function worldPortHeight(base: number, port: Port): number {
  return base + port.height;
}

interface Occupancy {
  cells: Set<string>;
  /** ports of already-placed pieces, keyed by cell:edge → world height (base + local) */
  ports: Map<string, number>;
}

function buildOccupancy(grid: Grid, existing: Placement[]): Occupancy {
  const cells = new Set<string>();
  const ports = new Map<string, number>();
  for (const pl of existing) {
    for (const f of worldFootprint(pl)) cells.add(cellKey(f.x, f.z));
    const base = terrainAt(grid, pl.cell.x, pl.cell.z).height;
    for (const wp of worldPorts(pl)) {
      ports.set(portKey(wp.cell, wp.edge), worldPortHeight(base, wp));
    }
  }
  return { cells, ports };
}

export function validatePlacement(grid: Grid, existing: Placement[], placement: Placement): PlacementResult {
  const def = PIECE_DEFS[placement.piece];
  const elevated = def.tags.includes('elevated');
  const covered = def.tags.includes('covered');
  const footprint = worldFootprint(placement);
  const occ = buildOccupancy(grid, existing);
  const base = terrainAt(grid, placement.cell.x, placement.cell.z).height;

  // 1. in bounds
  for (const f of footprint) {
    if (f.x < 0 || f.z < 0 || f.x >= grid.width || f.z >= grid.height)
      return { ok: false, reason: 'out-of-bounds' };
  }

  // 2. not overlapping another piece
  for (const f of footprint) {
    if (occ.cells.has(cellKey(f.x, f.z))) return { ok: false, reason: 'occupied' };
  }

  // 3. terrain features block the ground (water needs a bridge, rock needs a tunnel)
  for (const f of footprint) {
    const feat = terrainAt(grid, f.x, f.z).feature;
    if (feat === 'water' && !elevated) return { ok: false, reason: 'terrain-blocked' };
    if (feat === 'rock' && !covered) return { ok: false, reason: 'terrain-blocked' };
  }

  // 4. a flat (non-elevated, non-covered) piece must sit on level ground at its base height
  if (!elevated && !covered) {
    for (const f of footprint) {
      if (terrainAt(grid, f.x, f.z).height !== base) return { ok: false, reason: 'height-mismatch' };
    }
  }

  // 5. every port that runs into an occupied neighbour must meet a facing port at the same height
  for (const wp of worldPorts(placement)) {
    const neighbour = add(wp.cell, edgeStep(wp.edge));
    if (!occ.cells.has(cellKey(neighbour.x, neighbour.z))) continue; // open end — fine
    const facing = occ.ports.get(portKey(neighbour, opposite(wp.edge)));
    if (facing === undefined) return { ok: false, reason: 'port-mismatch' }; // ran into a solid side
    if (facing !== worldPortHeight(base, wp)) return { ok: false, reason: 'height-mismatch' };
  }

  return { ok: true, footprint, ports: worldPorts(placement) };
}
