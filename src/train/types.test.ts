// M4.2 tests (docs/70; docs/30 §3.1, §4): TICK_DT is exactly the fixed sim timestep, and
// TrainState/CarriageState accept the canonical field set verbatim plus the one authorized
// additive `history` field. Mostly a compile-time shape check (there's little runtime behavior
// in a pair of plain interfaces) with a couple of sanity assertions.

import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../core/types';
import type { CarriageState, TrainState } from './types';

describe('core/types', () => {
  it('TICK_DT is exactly 1/60 (docs/30 §3.1 — the only dt used anywhere in sim math)', () => {
    expect(TICK_DT).toBe(1 / 60);
  });
});

describe('TrainState / CarriageState shape (docs/30 §4 verbatim + additive history)', () => {
  it('accepts every canonical field plus the additive history field', () => {
    const carriage: CarriageState = { personaId: 'p1', offset: 0.55 };
    const train: TrainState = {
      id: 't1',
      edgeId: '0:0:f',
      s: 0.5,
      facing: 1,
      v: 1.2,
      airborne: null,
      crashed: false,
      carriages: [carriage],
      history: ['0:0:f'],
    };
    expect(train.id).toBe('t1');
    expect(train.edgeId).toBe('0:0:f');
    expect(train.facing).toBe(1);
    expect(train.crashed).toBe(false);
    expect(train.carriages[0]).toEqual(carriage);
    expect(train.history).toEqual(['0:0:f']);
  });

  it('airborne holds a pos/vel triple when the train is in flight', () => {
    const train: TrainState = {
      id: 't2',
      edgeId: null,
      s: 0,
      facing: -1,
      v: 2,
      airborne: { pos: [0, 1, 0], vel: [0, -1, 2] },
      crashed: false,
      carriages: [],
      history: [],
    };
    expect(train.edgeId).toBeNull();
    expect(train.airborne?.pos).toEqual([0, 1, 0]);
    expect(train.airborne?.vel).toEqual([0, -1, 2]);
  });

  it('carriages may be empty and history may be empty (degenerate but valid states)', () => {
    const train: TrainState = {
      id: 't3',
      edgeId: '0:0:f',
      s: 0,
      facing: 1,
      v: 0,
      airborne: null,
      crashed: true,
      carriages: [],
      history: [],
    };
    expect(train.carriages).toHaveLength(0);
    expect(train.history).toHaveLength(0);
  });
});
