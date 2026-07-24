// M2.1 tests (docs/70): rotation round-trip (T-1) and port-table fixture equality (T-2).

import { describe, expect, it } from 'vitest';
import {
  PIECE_DEFS,
  PIECE_TYPES,
  rotateCell,
  rotateDir,
  rotatePort,
  type Direction,
  type Rotation,
} from './pieces';

describe('rotation', () => {
  it('T-1: rotating a direction 4× returns the original', () => {
    for (const d of ['N', 'E', 'S', 'W'] as Direction[]) {
      let r = d;
      for (let i = 0; i < 4; i++) r = rotateDir(r, 1);
      expect(r).toBe(d);
    }
  });

  it('T-1: rotating a cell offset 4× returns the original', () => {
    for (const cell of [
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: -1, z: 2 },
      { x: 0, z: 3 },
    ]) {
      let r = cell;
      for (let i = 0; i < 4; i++) r = rotateCell(r, 1);
      expect(r).toEqual(cell);
    }
  });

  it('rotation is clockwise: N→E→S→W', () => {
    expect(rotateDir('N', 1)).toBe('E');
    expect(rotateDir('E', 1)).toBe('S');
    expect(rotateDir('S', 1)).toBe('W');
    expect(rotateDir('W', 1)).toBe('N');
  });

  it('cell (x,z) → (−z, x) under one quarter turn (matches renderer)', () => {
    expect(rotateCell({ x: 0, z: -1 }, 1)).toEqual({ x: 1, z: 0 }); // N offset → E offset
    expect(rotateCell({ x: 1, z: 1 }, 1)).toEqual({ x: -1, z: 1 });
  });

  it('every piece round-trips all its ports under a full turn', () => {
    for (const t of PIECE_TYPES) {
      for (const port of PIECE_DEFS[t].ports) {
        let r = port;
        for (let i = 0; i < 4; i++) r = rotatePort(r, 1 as Rotation);
        expect(r).toEqual(port);
      }
    }
  });
});

describe('port table fixture (T-2)', () => {
  it('straight has N/S ports at height 0', () => {
    expect(PIECE_DEFS.straight.ports).toEqual([
      { cell: { x: 0, z: 0 }, edge: 'N', height: 0 },
      { cell: { x: 0, z: 0 }, edge: 'S', height: 0 },
    ]);
  });

  it('curve-large is a 2×2 footprint with N(0,0) → E(1,1)', () => {
    expect(PIECE_DEFS['curve-large'].footprint).toHaveLength(4);
    expect(PIECE_DEFS['curve-large'].ports).toEqual([
      { cell: { x: 0, z: 0 }, edge: 'N', height: 0 },
      { cell: { x: 1, z: 1 }, edge: 'E', height: 0 },
    ]);
  });

  it('ramp climbs one level (S port at height 1)', () => {
    expect(PIECE_DEFS.ramp.ports[1]).toEqual({ cell: { x: 0, z: 0 }, edge: 'S', height: 1 });
    expect(PIECE_DEFS.ramp.paths[0].grade).toBe(1);
  });

  it('bridge spans 3 cells at ground ports and is tagged elevated', () => {
    expect(PIECE_DEFS.bridge.footprint).toEqual([
      { x: 0, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: 2 },
    ]);
    expect(PIECE_DEFS.bridge.ports.map((pt) => pt.edge)).toEqual(['N', 'S']);
    expect(PIECE_DEFS.bridge.tags).toContain('elevated');
  });

  it('junction has 3 ports + switch tag with through/branch paths', () => {
    expect(PIECE_DEFS.junction.ports.map((pt) => pt.edge)).toEqual(['N', 'S', 'E']);
    expect(PIECE_DEFS.junction.tags).toContain('switch');
    expect(PIECE_DEFS.junction.paths).toHaveLength(2);
  });

  it('crossing has 4 ports and two independent paths', () => {
    expect(PIECE_DEFS.crossing.ports).toHaveLength(4);
    expect(PIECE_DEFS.crossing.paths.map((pa) => [pa.fromPort, pa.toPort])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('every path references valid port indices', () => {
    for (const t of PIECE_TYPES) {
      const def = PIECE_DEFS[t];
      for (const path of def.paths) {
        expect(path.fromPort).toBeGreaterThanOrEqual(0);
        expect(path.fromPort).toBeLessThan(def.ports.length);
        expect(path.toPort).toBeLessThan(def.ports.length);
      }
    }
  });
});
