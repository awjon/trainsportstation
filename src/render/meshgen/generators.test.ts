// Regression guard (docs/70 M3.3): every generator builds a well-formed asset and never throws
// (the mismatched-attribute merge failure that once broke buildPiece stays fixed).

import { describe, expect, it } from 'vitest';
import { ALL_PIECES, buildPiece } from './track';
import { makeCarriage, makeLocomotive, type CarriageKind } from './rollingstock';
import { makeHouse, makeLamp, makeStation, makeTree } from './structures';
import { makeCactus, makeMushroom, makeRock, makeRoundTree, makeSnowFir } from './props';
import { BIOMES } from './biomes';
import type { Asset } from './asset';

function wellFormed(a: Asset): void {
  const attrs = Object.keys(a.body.attributes).sort();
  expect(attrs).toEqual(['color', 'normal', 'position']);
  expect(a.body.index).toBeNull();
}

describe('generators never throw', () => {
  it('all 16 track pieces build and are well-formed', () => {
    for (const p of ALL_PIECES) {
      expect(() => buildPiece(p), p).not.toThrow();
      wellFormed(buildPiece(p));
    }
  });

  it('all rolling stock builds', () => {
    expect(() => makeLocomotive()).not.toThrow();
    for (const k of ['container', 'passenger', 'tank', 'flatbed'] as CarriageKind[]) {
      expect(() => makeCarriage(k, 0xff5555), k).not.toThrow();
    }
  });

  it('all structures and props build', () => {
    for (const f of [
      makeStation,
      makeTree,
      makeHouse,
      makeLamp,
      makeRoundTree,
      makeSnowFir,
      makeCactus,
      makeRock,
    ]) {
      expect(() => f()).not.toThrow();
    }
    expect(() => makeMushroom(true)).not.toThrow();
    expect(() => makeMushroom(false)).not.toThrow();
  });

  it('every biome prop factory yields a well-formed asset', () => {
    for (const b of Object.values(BIOMES)) {
      for (const make of b.props) wellFormed(make());
    }
  });
});
