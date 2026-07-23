// Biome dressing table (docs/20 §1). Each biome names a ground/accent tint and the set of
// procedural props that give it identity. Ground/accent feed instance tint on ground & props
// (never track — docs/30 §9). This is data; the game reads it to dress a stage's terrain.

import type { Asset } from './asset';
import { makeHouse, makeTree } from './structures';
import { makeCactus, makeMushroom, makeRock, makeRoundTree, makeSnowFir } from './props';

export interface BiomeDef {
  id: string;
  ground: number;
  accent: number;
  props: Array<() => Asset>;
}

export const BIOMES: Record<string, BiomeDef> = {
  meadow: {
    id: 'meadow',
    ground: 0x8ec96b,
    accent: 0x9ed17a,
    props: [() => makeTree(), () => makeRoundTree(), () => makeHouse()],
  },
  highland: {
    id: 'highland',
    ground: 0x7fae6a,
    accent: 0xa98fd0,
    props: [() => makeSnowFir(), () => makeRock()],
  },
  mesa: {
    id: 'mesa',
    ground: 0xcda86a,
    accent: 0xd2734a,
    props: [() => makeCactus(), () => makeRock(0xb98a5a)],
  },
  frostfield: {
    id: 'frostfield',
    ground: 0xdfeaf0,
    accent: 0x9ec7de,
    props: [() => makeSnowFir(), () => makeRock(0xdfe6ea)],
  },
  hollow: {
    id: 'hollow',
    ground: 0x5f7a52,
    accent: 0xa77fd0,
    props: [() => makeMushroom(true), () => makeMushroom(false), () => makeRoundTree(0x6f9d5b)],
  },
};
