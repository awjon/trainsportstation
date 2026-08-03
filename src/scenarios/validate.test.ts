// M5.1 tests (docs/70): each validation rule has a pass and a fail case, the shipped fixture
// validates, unknown fields survive, and errors carry a usable path.

import { describe, expect, it } from 'vitest';
import { validateScenario } from './validate';
import type { Scenario } from './types';
import fixture from './w1-s1.json';

const base = (): Scenario => structuredClone(fixture) as unknown as Scenario;

/** Convenience: validate and return the error rules that fired. */
function rules(doc: unknown): string[] {
  const r = validateScenario(doc);
  return r.ok ? [] : r.errors.map((e) => e.rule);
}

describe('V1 — structure', () => {
  it('the shipped fixture validates', () => {
    const r = validateScenario(base());
    if (!r.ok) console.error(r.errors);
    expect(r.ok).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(rules('nope')).toContain('V1');
    expect(rules(null)).toContain('V1');
  });

  it('rejects an unsupported schema version with the friendly V7 message, not a pile of V1s', () => {
    const s = base();
    s.schemaVersion = '9.9';
    expect(rules(s)).toEqual(['V7']);
  });

  it('rejects a same-major but malformed version at V1', () => {
    const s = base();
    s.schemaVersion = '1.7'; // major 1 is supported, but this build pins exactly "1.0"
    expect(rules(s)).toContain('V1');
  });

  it('rejects an out-of-range grid, countdown, and train count', () => {
    const tooSmall = base();
    tooSmall.grid = { width: 2, height: 2 };
    expect(rules(tooSmall)).toContain('V1');

    const tooFast = base();
    tooFast.countdownTicks = 10;
    expect(rules(tooFast)).toContain('V1');

    const noTrains = base();
    noTrains.trains = [];
    expect(rules(noTrains)).toContain('V1');
  });

  it('rejects an unknown persona and an unknown piece', () => {
    const badPersona = base();
    badPersona.passengers[0].persona = 'wizard';
    expect(rules(badPersona)).toContain('V1');

    const badPiece = base();
    badPiece.pieceTray[0].piece = 'teleporter' as never;
    expect(rules(badPiece)).toContain('V1');
  });

  it('reports a usable path for the offending field', () => {
    const s = base();
    s.meta.world = 99;
    const r = validateScenario(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === 'meta.world')).toBe(true);
  });
});

describe('V2 — bounds', () => {
  it('rejects a station outside the map', () => {
    const s = base();
    s.stations[1].cell = { x: 99, z: 99 };
    expect(rules(s)).toContain('V2');
  });

  it('rejects a reference placement outside the map', () => {
    const s = base();
    s.referenceSolution.placements[0].cell = { x: 50, z: 0 };
    expect(rules(s)).toContain('V2');
  });
});

describe('V3 — stations', () => {
  it('rejects two stations sharing a cell', () => {
    const s = base();
    s.stations[1].cell = { ...s.stations[0].cell };
    expect(rules(s)).toContain('V3');
  });

  it('rejects a duplicate station id', () => {
    const s = base();
    s.stations[1].id = s.stations[0].id;
    expect(rules(s)).toContain('V3');
  });

  it('rejects a station on water', () => {
    const s = base();
    s.terrain = [{ x: s.stations[0].cell.x, z: s.stations[0].cell.z, feature: 'water' }];
    expect(rules(s)).toContain('V3');
  });

  it('rejects a payoff or spawn pointing at a station that does not exist', () => {
    const badPayoff = base();
    badPayoff.payoff.focusStationId = 'atlantis';
    expect(rules(badPayoff)).toContain('V3');

    const badSpawn = base();
    badSpawn.trains[0].spawnStationId = 'atlantis';
    expect(rules(badSpawn)).toContain('V3');
  });
});

describe('V4 — references', () => {
  it('rejects a passenger routed to a station that does not exist', () => {
    const s = base();
    s.passengers[0].to = 'narnia';
    expect(rules(s)).toContain('V4');
  });

  it('rejects a passenger travelling from a station to itself', () => {
    const s = base();
    s.passengers[0].to = s.passengers[0].from;
    expect(rules(s)).toContain('V4');
  });

  it('rejects duplicate passenger and train ids', () => {
    const dupPassenger = base();
    dupPassenger.passengers = [...dupPassenger.passengers, { ...dupPassenger.passengers[0] }];
    expect(rules(dupPassenger)).toContain('V4');

    const dupTrain = base();
    dupTrain.trains = [...dupTrain.trains, { ...dupTrain.trains[0] }];
    expect(rules(dupTrain)).toContain('V4');
  });

  it('rejects a brokenPiece hazard that indexes nothing', () => {
    const s = base();
    s.hazards = [{ kind: 'brokenPiece', placementIndex: 7, repairStationId: 'depot' }];
    expect(rules(s)).toContain('V4');
  });
});

describe('V5 — the tray must build the solution', () => {
  it('rejects a tray too small for the reference solution', () => {
    const s = base();
    s.pieceTray = [{ piece: 'straight', count: 2 }]; // the solution needs 4
    expect(rules(s)).toContain('V5');
  });

  it('rejects a piece budget below the reference solution', () => {
    const s = base();
    s.stars.pieceBudget = 2;
    expect(rules(s)).toContain('V5');
  });

  it('accepts a budget exactly equal to the solution', () => {
    const s = base();
    s.stars.pieceBudget = s.referenceSolution.placements.length;
    expect(validateScenario(s).ok).toBe(true);
  });
});

describe('V7 — identity', () => {
  it('rejects a malformed id', () => {
    const s = base();
    s.id = 'Not A Valid Id!';
    expect(rules(s)).toContain('V7');
  });

  it('rejects a schema major this build does not support', () => {
    const s = base();
    s.schemaVersion = '2.0';
    const r = validateScenario(s);
    expect(r.ok).toBe(false);
    // V1 pins the exact version too, but V7 is the one with the friendly message
    if (!r.ok) expect(r.errors.some((e) => e.message.includes('newer version'))).toBe(true);
  });
});

describe('forward compatibility', () => {
  it('preserves unknown fields (docs/40 §1)', () => {
    const s = base() as Scenario & { futureField?: unknown };
    s.futureField = { added: 'by a later version' };
    const r = validateScenario(s);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.scenario as { futureField?: unknown }).futureField).toEqual({
        added: 'by a later version',
      });
  });
});
