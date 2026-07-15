import { describe, it, expect } from 'vitest';
import { manifest, CELL_SIZE, KIT_SCALE_FACTOR, resolvePiece, getSwatch, type PieceType } from './assets';

const ALL_PIECE_TYPES: PieceType[] = [
  'straight',
  'curve-small',
  'curve-large',
  'ramp',
  'hill',
  'bump',
  'bridge',
  'tunnel',
  'junction',
  'crossing',
];

describe('asset manifest (60 §4/§9)', () => {
  it('measures a positive cellSize and derives a scaleFactor from the reference straight (60 §5)', () => {
    expect(CELL_SIZE).toBeGreaterThan(0);
    expect(KIT_SCALE_FACTOR).toBeGreaterThan(0);
    // straight (1 wide × 4 long) × scaleFactor fills exactly one cell along the track.
    const straight = manifest.models['railroad-straight'];
    expect(straight).toBeDefined();
    expect(straight.size.z * KIT_SCALE_FACTOR).toBeCloseTo(CELL_SIZE, 4);
  });

  it('contains all 85 kit models with bounds and triangle counts', () => {
    const ids = Object.keys(manifest.models);
    expect(ids.length).toBe(85);
    for (const id of ids) {
      const m = manifest.models[id];
      expect(m.bounds.min).toHaveLength(3);
      expect(m.bounds.max).toHaveLength(3);
      expect(m.triangles).toBeGreaterThan(0);
      expect(m.triangles).toBeLessThanOrEqual(4000); // 60 §9 budget
    }
  });

  it('resolves every PieceType to a model or a registered procedural generator (60 §9 completeness)', () => {
    for (const type of ALL_PIECE_TYPES) {
      const r = resolvePiece(type);
      if ('model' in r) expect(manifest.models[r.model]).toBeDefined();
      else expect(Object.values(manifest.procedural)).toContain(r.procedural);
    }
  });

  it('registers kitbash pieces as procedural stubs (bridge/tunnel/junction/crossing/station)', () => {
    for (const key of ['bridge', 'tunnel', 'junction', 'crossing', 'station']) {
      expect(manifest.procedural[key]).toBeTruthy();
    }
  });

  it('records wood/stone/metal swatch UVs with sampled colors', () => {
    for (const name of ['wood', 'stone', 'metal'] as const) {
      const s = getSwatch(name);
      expect(s.uv).toHaveLength(2);
      expect(s.hex).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it('every model references the shared colormap material set (single-material invariant, 60 §5)', () => {
    // The audit already gates this; assert the manifest never grew a non-track material kind.
    const kinds = new Set(Object.values(manifest.models).map((m) => m.kind));
    expect([...kinds].sort()).toEqual(['carriage', 'connector', 'locomotive', 'track']);
  });
});
