// M2.2 tests (docs/70): each of the five failure reasons has a minimal repro, plus the
// bridge-over-water / tunnel-through-rock allowances, ramp height rule, and rotated occupancy.

import { describe, expect, it } from 'vitest';
import { makeGrid, setTerrain, validatePlacement, worldFootprint, type Placement } from './placement';

const grid = () => makeGrid(10, 10);

describe('validatePlacement', () => {
  it('places a straight on empty flat ground', () => {
    const r = validatePlacement(grid(), [], { piece: 'straight', cell: { x: 2, z: 2 }, rotation: 0 });
    expect(r.ok).toBe(true);
  });

  it('out-of-bounds when the footprint leaves the grid', () => {
    const g = makeGrid(4, 4);
    const r = validatePlacement(g, [], { piece: 'straight', cell: { x: 3, z: 5 }, rotation: 0 });
    expect(r).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('out-of-bounds for a multi-cell footprint that overhangs the edge', () => {
    const g = makeGrid(2, 2);
    // curve-large is 2×2 anchored at (1,1) → spills to (2,*)
    const r = validatePlacement(g, [], { piece: 'curve-large', cell: { x: 1, z: 1 }, rotation: 0 });
    expect(r).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('occupied when a cell is already taken', () => {
    const existing: Placement[] = [{ piece: 'straight', cell: { x: 2, z: 2 }, rotation: 0 }];
    const r = validatePlacement(grid(), existing, { piece: 'straight', cell: { x: 2, z: 2 }, rotation: 1 });
    expect(r).toEqual({ ok: false, reason: 'occupied' });
  });

  it('occupied respects a rotated multi-cell footprint', () => {
    const curve: Placement = { piece: 'curve-large', cell: { x: 2, z: 2 }, rotation: 1 };
    const cells = worldFootprint(curve);
    // pick one of the four occupied cells and try to drop a straight there
    const target = cells[2];
    const r = validatePlacement(grid(), [curve], { piece: 'straight', cell: target, rotation: 0 });
    expect(r).toEqual({ ok: false, reason: 'occupied' });
  });

  it('terrain-blocked: a straight cannot sit on water, but a bridge can', () => {
    const g = grid();
    setTerrain(g, 4, 4, { height: 0, feature: 'water' });
    expect(validatePlacement(g, [], { piece: 'straight', cell: { x: 4, z: 4 }, rotation: 0 })).toEqual({
      ok: false,
      reason: 'terrain-blocked',
    });
    // bridge spans it (its middle cell is over the water)
    setTerrain(g, 4, 5, { height: 0, feature: 'water' });
    setTerrain(g, 4, 6, { height: 0, feature: 'water' });
    expect(validatePlacement(g, [], { piece: 'bridge', cell: { x: 4, z: 4 }, rotation: 0 }).ok).toBe(true);
  });

  it('terrain-blocked: a straight cannot sit on rock, but a tunnel can', () => {
    const g = grid();
    setTerrain(g, 3, 3, { height: 0, feature: 'rock' });
    expect(validatePlacement(g, [], { piece: 'straight', cell: { x: 3, z: 3 }, rotation: 0 }).ok).toBe(false);
    expect(validatePlacement(g, [], { piece: 'tunnel', cell: { x: 3, z: 3 }, rotation: 0 }).ok).toBe(true);
  });

  it('height-mismatch: a flat piece cannot straddle a terrain step', () => {
    const g = grid();
    setTerrain(g, 3, 3, { height: 1 }); // one of curve-large's cells is a step up
    const r = validatePlacement(g, [], { piece: 'curve-large', cell: { x: 2, z: 2 }, rotation: 0 });
    expect(r).toEqual({ ok: false, reason: 'height-mismatch' });
  });

  it('port-mismatch: a port running into a solid side of a neighbour', () => {
    // curve-small at (0,0) exposes ports N and E only; its S edge is solid.
    const existing: Placement[] = [{ piece: 'curve-small', cell: { x: 0, z: 0 }, rotation: 0 }];
    // a straight at (0,1) points its N port into (0,0)'s solid S side
    const r = validatePlacement(grid(), existing, { piece: 'straight', cell: { x: 0, z: 1 }, rotation: 0 });
    expect(r).toEqual({ ok: false, reason: 'port-mismatch' });
  });

  it('connects two straights end-to-end at the same height', () => {
    const existing: Placement[] = [{ piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 }];
    const r = validatePlacement(grid(), existing, { piece: 'straight', cell: { x: 0, z: 1 }, rotation: 0 });
    expect(r.ok).toBe(true); // (0,1).N meets (0,0).S
  });

  it('height-mismatch when facing ports are at different heights', () => {
    const g = grid();
    setTerrain(g, 0, 1, { height: 1 }); // second straight sits a level higher
    const existing: Placement[] = [{ piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 }];
    const r = validatePlacement(g, existing, { piece: 'straight', cell: { x: 0, z: 1 }, rotation: 0 });
    expect(r).toEqual({ ok: false, reason: 'height-mismatch' });
  });

  it('a ramp bridges a one-level step between two straights', () => {
    const g = grid();
    // low straight on ground at (0,0); high straight on a shelf at (0,2)
    setTerrain(g, 0, 2, { height: 1 });
    const existing: Placement[] = [
      { piece: 'straight', cell: { x: 0, z: 0 }, rotation: 0 },
      { piece: 'straight', cell: { x: 0, z: 2 }, rotation: 0 },
    ];
    // ramp at (0,1): N port @0 meets the low straight, S port @1 meets the high straight
    const r = validatePlacement(g, existing, { piece: 'ramp', cell: { x: 0, z: 1 }, rotation: 0 });
    expect(r.ok).toBe(true);
  });
});
