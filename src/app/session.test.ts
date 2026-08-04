// The session is the play loop. The claim that matters here is the one the whole determinism
// contract rests on: a run you PLAY and the replay it records are the same run. If that holds,
// ghost replays, the editor's publish gate and the CI content gate are all the same code path.

import { describe, expect, it } from 'vitest';
import { StageSession } from './session';
import { runHeadless, runReferenceSolution } from '../simulation/sim';
import type { Scenario } from '../scenarios/types';
import scenarioDoc from '../scenarios/w1-s1.json';

const scenario = () => structuredClone(scenarioDoc) as unknown as Scenario;

/** Play the scenario the way its author solved it, but through the player-facing API. */
function playReference(s: StageSession): void {
  const ref = s.scenario.referenceSolution;
  for (const p of ref.placements) {
    const r = s.place(p.piece, p.cell, p.rotation);
    expect(r.ok, `${p.piece} @ ${p.cell.x},${p.cell.z}`).toBe(true);
  }
  while (s.tick < ref.dispatchTick) s.step();
  s.setSpeedBet(ref.speedBet);
  s.dispatch();
  while (!s.finished && s.tick < 10_000) s.step();
}

describe('StageSession', () => {
  it('starts on Preview with a blank board and the full countdown', () => {
    const s = new StageSession(scenario(), scenario().referenceSolution.seed);
    expect(s.screen).toBe('preview');
    expect(s.phase).toBe('building');
    expect(s.playerPlacements).toHaveLength(0);
    expect(s.ticksLeft).toBe(s.scenario.countdownTicks);
  });

  it('records every accepted placement as a replay input', () => {
    const s = new StageSession(scenario());
    const p = s.scenario.referenceSolution.placements[0];
    s.place(p.piece, p.cell, p.rotation);
    expect(s.replay.inputs).toHaveLength(1);
    expect(s.replay.inputs[0]).toMatchObject({ type: 'placePiece' });
    expect(s.playerPlacements).toHaveLength(1);
  });

  it('refuses an illegal placement and records nothing', () => {
    const s = new StageSession(scenario());
    const r = s.place('straight', { x: -5, z: -5 }, 0);
    expect(r.ok).toBe(false);
    expect(s.replay.inputs).toHaveLength(0);
    expect(s.playerPlacements).toHaveLength(0);
  });

  it('removeAt takes back the piece over a cell, and reports when there is none', () => {
    const s = new StageSession(scenario());
    const p = s.scenario.referenceSolution.placements[0];
    s.place(p.piece, p.cell, p.rotation);
    expect(s.removeAt(p.cell)).toBe(true);
    expect(s.playerPlacements).toHaveLength(0);
    expect(s.removeAt({ x: 0, z: 0 })).toBe(false);
  });

  it('the countdown drains with sim time and never goes negative', () => {
    const s = new StageSession(scenario());
    for (let i = 0; i < 100; i++) s.step();
    expect(s.ticksLeft).toBe(s.scenario.countdownTicks - 100);
    for (let i = 0; i < s.scenario.countdownTicks; i++) s.step();
    expect(s.ticksLeft).toBe(0);
  });

  it('a played run reproduces exactly when its own replay is run headlessly', () => {
    const s = new StageSession(scenario(), scenario().referenceSolution.seed);
    playReference(s);
    const played = s.finish();

    const replayed = runHeadless(scenario(), s.replay);
    expect(replayed.stars).toBe(played.stars);
    expect(replayed.connections).toBe(played.connections);
    expect(replayed.result.lastRequiredDeliveryTick).toBe(played.result.lastRequiredDeliveryTick);
    expect(replayed.ticks).toBe(s.tick);
  });

  it('playing the author’s solution scores what the content gate scores', () => {
    const s = new StageSession(scenario(), scenario().referenceSolution.seed);
    playReference(s);
    const played = s.finish();
    const gate = runReferenceSolution(scenario());
    expect(played.stars).toBe(gate.stars);
    expect(played.connections).toBe(gate.connections);
    expect(played.crashed).toBe(false);
  });

  it('finish() is idempotent — reading the receipt twice does not re-score', () => {
    const s = new StageSession(scenario(), scenario().referenceSolution.seed);
    playReference(s);
    expect(s.finish()).toBe(s.finish());
    expect(s.phase).toBe('over');
  });

  it('retry restores a blank board, a fresh recording and zero meta loss', () => {
    const s = new StageSession(scenario(), scenario().referenceSolution.seed);
    playReference(s);
    expect(s.finished).not.toBeNull();

    s.retry();
    expect(s.finished).toBeNull();
    expect(s.tick).toBe(0);
    expect(s.playerPlacements).toHaveLength(0);
    expect(s.replay.inputs).toHaveLength(0);
    expect(s.phase).toBe('building');
    expect(s.ticksLeft).toBe(s.scenario.countdownTicks);

    playReference(s); // and it is still solvable second time around
    expect(s.finish().stars).toBe(3);
  });

  it('dispatching twice is a no-op, so a double-tap cannot desync the replay', () => {
    const s = new StageSession(scenario());
    s.dispatch();
    s.dispatch();
    expect(s.replay.inputs.filter((i) => i.type === 'dispatch')).toHaveLength(1);
  });

  it('records junction flips as replay inputs and mirrors the state back', () => {
    const s = new StageSession(scenario());
    s.flipSwitch(3, 1);
    expect(s.switchState(3)).toBe(1);
    expect(s.switchState(4)).toBe(0);
    expect(s.replay.inputs.at(-1)).toMatchObject({ type: 'flipSwitch', placementIndex: 3, state: 1 });
  });

  it('advance() consumes whole ticks and carries the remainder', () => {
    const s = new StageSession(scenario());
    const rest = s.advance(1 / 60 + 1 / 240, 0);
    expect(s.tick).toBe(1);
    expect(rest).toBeCloseTo(1 / 240, 9);
  });

  it('advance() clamps a long frame instead of spiralling', () => {
    const s = new StageSession(scenario());
    s.advance(10, 0, 5);
    expect(s.tick).toBe(5);
  });
});
