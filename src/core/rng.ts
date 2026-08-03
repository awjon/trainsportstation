// Seeded PRNG (docs/30 §3.3). The headless zone may never call Math.random — every random
// draw comes from a seeded generator owned by the sim, so a replay reproduces exactly.

/** mulberry32: small, fast, good enough for gameplay jitter. Returns floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded generator with the helpers gameplay actually needs. */
export class Rng {
  private readonly next01: () => number;

  constructor(readonly seed: number) {
    this.next01 = mulberry32(seed);
  }

  /** float in [0,1) */
  next(): number {
    return this.next01();
  }

  /** float in [min,max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next01();
  }

  /** integer in [min,max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next01() * (max - min + 1));
  }

  /** uniform pick; throws on an empty list so a bug never silently yields undefined */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.min(items.length - 1, Math.floor(this.next01() * items.length))];
  }
}
