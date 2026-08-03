// M5.2 tests (docs/70): the runner drives a scenario end to end, replays reproduce it exactly
// (D-1 determinism), and inputs behave (illegal placements refused, no building after dispatch).

import { describe, expect, it } from 'vitest';
import { applyInput, createSim, runHeadless, runReferenceSolution, simHash, tick } from './sim';
import { referenceToReplay, type Replay } from './inputs';
import { validateScenario } from '../scenarios/validate';
import type { Scenario } from '../scenarios/types';
import fixture from '../scenarios/w1-s1.json';

const load = (): Scenario => {
  const r = validateScenario(structuredClone(fixture));
  if (!r.ok) throw new Error(`fixture invalid: ${JSON.stringify(r.errors)}`);
  return r.scenario;
};

describe('running a scenario', () => {
  it('the reference solution delivers its passenger and earns 3 stars', () => {
    const outcome = runReferenceSolution(load());
    expect(outcome.result.outcome).toBe('complete');
    expect(outcome.stars).toBe(3);
    expect(outcome.connections).toBeGreaterThan(0);
  });

  it('produces the expected event story', () => {
    const outcome = runReferenceSolution(load());
    const types = outcome.result.events.map((e) => e.type);
    expect(types).toContain('Dispatched');
    expect(types).toContain('PassengerBoarded');
    expect(types).toContain('Delivered');
    expect(types).not.toContain('Crashed');
  });

  it('finishes well inside the time target', () => {
    const scenario = load();
    const outcome = runReferenceSolution(scenario);
    expect(outcome.result.lastRequiredDeliveryTick).not.toBeNull();
    expect(outcome.result.lastRequiredDeliveryTick!).toBeLessThanOrEqual(scenario.stars.timeTargetTicks);
  });

  it('counts pieces placed and left over', () => {
    const scenario = load();
    const outcome = runReferenceSolution(scenario);
    expect(outcome.result.piecesPlaced).toBe(scenario.referenceSolution.placements.length);
    const trayTotal = scenario.pieceTray.reduce((sum, t) => sum + t.count, 0);
    expect(outcome.result.unusedTrayPieces).toBe(trayTotal - outcome.result.piecesPlaced);
  });

  it('fails when the track is never built — the train has nowhere to go', () => {
    const scenario = load();
    const empty: Replay = {
      formatVersion: '1.0',
      scenarioId: scenario.id,
      schemaVersion: scenario.schemaVersion,
      seed: 1,
      inputs: [
        { tick: 10, type: 'setSpeedBet', bet: 'steady' },
        { tick: 10, type: 'dispatch' },
      ],
    };
    const outcome = runHeadless(scenario, empty, 3000);
    expect(outcome.result.outcome).toBe('failed');
    expect(outcome.stars).toBe(0);
  });
});

describe('D-1 determinism', () => {
  it('two identical runs agree at every checkpoint', () => {
    const scenario = load();
    const replay = referenceToReplay(scenario.id, scenario.schemaVersion, scenario.referenceSolution);

    const hashesOf = (): string[] => {
      const state = createSim(scenario, replay.seed);
      const out: string[] = [];
      for (let i = 0; i < 900; i++) {
        for (const input of replay.inputs.filter((x) => x.tick === state.tick)) applyInput(state, input);
        tick(state);
        if ([1, 60, 300, 600, 899].includes(i)) out.push(simHash(state));
      }
      return out;
    };

    expect(hashesOf()).toEqual(hashesOf());
  });

  it('the same replay yields identical results and final hash', () => {
    const scenario = load();
    const a = runReferenceSolution(scenario);
    const b = runReferenceSolution(scenario);
    expect(a.hash).toBe(b.hash);
    expect(a.stars).toBe(b.stars);
    expect(a.connections).toBe(b.connections);
    expect(a.ticks).toBe(b.ticks);
  });

  it('hash changes as the run progresses', () => {
    const scenario = load();
    const state = createSim(scenario, 1);
    const start = simHash(state);
    applyInput(state, { tick: 0, type: 'dispatch' });
    for (let i = 0; i < 200; i++) tick(state);
    expect(simHash(state)).not.toBe(start);
  });
});

describe('inputs', () => {
  it('refuses an illegal placement instead of corrupting the board', () => {
    const scenario = load();
    const state = createSim(scenario, 1);
    const before = state.placements.length;
    applyInput(state, {
      tick: 0,
      type: 'placePiece',
      placement: { piece: 'straight', cell: { x: 99, z: 99 }, rotation: 0 }, // off the map
    });
    expect(state.placements.length).toBe(before);
    expect(state.playerPlacements).toBe(0);
  });

  it('refuses to place on an occupied cell', () => {
    const scenario = load();
    const state = createSim(scenario, 1);
    const stationCell = scenario.stations[0].cell;
    applyInput(state, {
      tick: 0,
      type: 'placePiece',
      placement: { piece: 'straight', cell: stationCell, rotation: 0 },
    });
    expect(state.playerPlacements).toBe(0);
  });

  it('accepts a legal placement', () => {
    const scenario = load();
    const state = createSim(scenario, 1);
    applyInput(state, {
      tick: 0,
      type: 'placePiece',
      placement: { piece: 'straight', cell: { x: 2, z: 3 }, rotation: 1 },
    });
    expect(state.playerPlacements).toBe(1);
  });

  it('building stops once the train is dispatched', () => {
    const scenario = load();
    const state = createSim(scenario, 1);
    applyInput(state, { tick: 0, type: 'dispatch' });
    applyInput(state, {
      tick: 1,
      type: 'placePiece',
      placement: { piece: 'straight', cell: { x: 2, z: 3 }, rotation: 1 },
    });
    expect(state.playerPlacements).toBe(0);
  });

  it('honours speedBetAllowed: false by pinning the bet to steady', () => {
    const scenario = load(); // w1-s1 has speedBetAllowed: false
    const state = createSim(scenario, 1);
    applyInput(state, { tick: 0, type: 'setSpeedBet', bet: 'ludicrous' });
    expect(state.speedBet).toBe('steady');
  });

  it('records a dispatch event per train', () => {
    const scenario = load();
    const state = createSim(scenario, 1);
    applyInput(state, { tick: 5, type: 'dispatch' });
    const dispatched = state.events.filter((e) => e.type === 'Dispatched');
    expect(dispatched).toHaveLength(scenario.trains.length);
  });
});

describe('replay conversion', () => {
  it('a reference solution expands to a replay ordered by tick', () => {
    const scenario = load();
    const replay = referenceToReplay(scenario.id, scenario.schemaVersion, scenario.referenceSolution);
    expect(replay.scenarioId).toBe(scenario.id);
    expect(replay.seed).toBe(scenario.referenceSolution.seed);
    const ticks = replay.inputs.map((i) => i.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(replay.inputs.filter((i) => i.type === 'placePiece')).toHaveLength(
      scenario.referenceSolution.placements.length,
    );
    expect(replay.inputs.some((i) => i.type === 'dispatch')).toBe(true);
  });
});
