// M1 tests (docs/70): seeded PRNG reproducibility, canonical hashing, fixed-timestep behaviour,
// and the typed event bus. These underpin the determinism contract (docs/30 §3).

import { describe, expect, it, vi } from 'vitest';
import { Rng, mulberry32 } from './rng';
import { canonicalize, stateHash } from './hash';
import { FixedTimestepLoop, TICK_DT } from './loop';
import { EventBus } from './events';

describe('rng', () => {
  it('is reproducible for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays within [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('Rng helpers respect their bounds', () => {
    const r = new Rng(99);
    for (let i = 0; i < 500; i++) {
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      expect(Number.isInteger(n)).toBe(true);
      const f = r.range(-2, 2);
      expect(f).toBeGreaterThanOrEqual(-2);
      expect(f).toBeLessThan(2);
    }
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(() => r.pick([])).toThrow();
  });
});

describe('hash', () => {
  it('is independent of object key order', () => {
    expect(stateHash({ a: 1, b: 2 })).toBe(stateHash({ b: 2, a: 1 }));
  });

  it('quantizes harmless float noise away but catches real differences', () => {
    expect(stateHash({ v: 1.0000000001 })).toBe(stateHash({ v: 1.0 }));
    expect(stateHash({ v: 1.001 })).not.toBe(stateHash({ v: 1.0 }));
  });

  it('normalizes -0 to 0', () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
  });

  it('handles nested structures, Maps and Sets deterministically', () => {
    const m1 = new Map([
      ['b', 2],
      ['a', 1],
    ]);
    const m2 = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    expect(stateHash(m1)).toBe(stateHash(m2));
    expect(stateHash(new Set([3, 1, 2]))).toBe(stateHash(new Set([1, 2, 3])));
    expect(stateHash({ t: [1, { z: 0 }] })).toBe(stateHash({ t: [1, { z: 0 }] }));
  });
});

describe('fixed timestep loop', () => {
  it('runs exactly 60 ticks per simulated second', () => {
    const onTick = vi.fn();
    const loop = new FixedTimestepLoop({ onTick, maxTicksPerFrame: 1000 });
    for (let i = 0; i < 60; i++) loop.advance(TICK_DT);
    expect(onTick).toHaveBeenCalledTimes(60);
    expect(loop.tick).toBe(60);
  });

  it('accumulates sub-tick deltas rather than dropping them', () => {
    const onTick = vi.fn();
    const loop = new FixedTimestepLoop({ onTick });
    loop.advance(TICK_DT / 2);
    expect(onTick).toHaveBeenCalledTimes(0);
    loop.advance(TICK_DT / 2);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('runs 2 ticks for a 33ms frame', () => {
    const onTick = vi.fn();
    const loop = new FixedTimestepLoop({ onTick });
    expect(loop.advance(0.033)).toBe(1); // 0.033 / 0.01667 = 1.98 → 1 whole tick
    expect(loop.advance(0.033)).toBe(2); // leftover carries → 2 ticks
  });

  it('clamps a huge frame (no spiral of death)', () => {
    const onTick = vi.fn();
    const loop = new FixedTimestepLoop({ onTick, maxTicksPerFrame: 5 });
    expect(loop.advance(10)).toBe(5);
    expect(loop.alpha()).toBe(0); // backlog dropped
  });

  it('is pausable and single-steppable', () => {
    const onTick = vi.fn();
    const loop = new FixedTimestepLoop({ onTick });
    loop.setPaused(true);
    expect(loop.advance(1)).toBe(0);
    loop.step(); // stepping works while paused (assist mode)
    expect(onTick).toHaveBeenCalledTimes(1);
    loop.setPaused(false);
    loop.advance(TICK_DT);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('exposes an interpolation alpha in [0,1)', () => {
    const loop = new FixedTimestepLoop({ onTick: () => {} });
    loop.advance(TICK_DT * 0.25);
    expect(loop.alpha()).toBeCloseTo(0.25, 6);
  });
});

describe('event bus', () => {
  it('dispatches to listeners and supports unsubscribe', () => {
    const bus = new EventBus<{ ping: number }>();
    const seen: number[] = [];
    const off = bus.on('ping', (n) => seen.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(seen).toEqual([1]);
  });

  it('survives a handler unsubscribing during dispatch', () => {
    const bus = new EventBus<{ ping: void }>();
    const calls: string[] = [];
    const offA = bus.on('ping', () => {
      calls.push('a');
      offA();
    });
    bus.on('ping', () => calls.push('b'));
    bus.emit('ping', undefined);
    expect(calls).toEqual(['a', 'b']);
    bus.emit('ping', undefined);
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});
