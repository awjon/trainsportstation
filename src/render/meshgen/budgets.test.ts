// Guardrails for the generators (docs/60 §8): triangle budgets, single attribute shape, and
// throw-free builds. These freeze the polish so it can't silently blow up cost before we
// wire InstancedMesh.

import { describe, expect, it } from 'vitest';
import { ALL_PIECES, buildPiece } from './track';
import { makeCarriage, makeLocomotive, type CarriageKind } from './rollingstock';
import { makeHouse, makeLamp, makeStation, makeTree } from './structures';
import { triangles, type Asset } from './asset';
import { PALETTE } from './palette';
import * as THREE from 'three';

function assertShape(geo: THREE.BufferGeometry): void {
  const attrs = Object.keys(geo.attributes).sort();
  expect(attrs).toEqual(['color', 'normal', 'position']);
  expect(geo.index).toBeNull(); // non-indexed
}

function assertAsset(a: Asset): void {
  assertShape(a.body);
  if (a.glow) assertShape(a.glow);
}

describe('track pieces', () => {
  it('all 10 build, are well-formed, and stay within budget', () => {
    for (const p of ALL_PIECES) {
      const a = buildPiece(p);
      assertAsset(a);
      expect(triangles(a), `${p} triangle budget`).toBeLessThanOrEqual(4000);
    }
  });
});

describe('rolling stock', () => {
  const kinds: CarriageKind[] = ['container', 'passenger', 'tank', 'flatbed'];
  it('locomotive builds within budget', () => {
    const a = makeLocomotive();
    assertAsset(a);
    expect(triangles(a)).toBeLessThanOrEqual(6000);
  });
  it('all carriage kinds build within budget', () => {
    for (const k of kinds) {
      const a = makeCarriage(k, PALETTE.commuter);
      assertAsset(a);
      expect(triangles(a), `${k} triangle budget`).toBeLessThanOrEqual(4000);
    }
  });
});

describe('structures & props', () => {
  it('build, are well-formed, and stay within budget', () => {
    for (const a of [makeStation(), makeTree(), makeHouse(), makeLamp()]) {
      assertAsset(a);
      expect(triangles(a)).toBeLessThanOrEqual(4000);
    }
  });
});

describe('emissive routing', () => {
  it('assets with lights expose glow geometry (bloom layer)', () => {
    expect(makeLamp().glow).not.toBeNull();
    expect(makeLocomotive().glow).not.toBeNull();
    expect(buildPiece('junction').glow).not.toBeNull();
    // a plain straight has no lights
    expect(buildPiece('straight').glow).toBeNull();
  });
});

describe('mirrored variants', () => {
  it('s-bend-left is the X-mirror of s-bend (same tri count, negated X bounds)', () => {
    const right = buildPiece('s-bend').body;
    const left = buildPiece('s-bend-left').body;
    right.computeBoundingBox();
    left.computeBoundingBox();
    // same triangle count
    expect(left.getAttribute('position').count).toBe(right.getAttribute('position').count);
    // X bounds are mirrored: left.min.x ≈ -right.max.x
    expect(left.boundingBox!.min.x).toBeCloseTo(-right.boundingBox!.max.x, 4);
    expect(left.boundingBox!.max.x).toBeCloseTo(-right.boundingBox!.min.x, 4);
    // Z/Y unchanged by an X mirror
    expect(left.boundingBox!.min.z).toBeCloseTo(right.boundingBox!.min.z, 4);
  });
});
