// The transition table is the spec, so the test restates docs/10 §3 independently and checks
// the table matches it exactly — extra edges fail just as loudly as missing ones.

import { describe, expect, it } from 'vitest';
import { ScreenMachine, SCREENS, TRANSITIONS, type ScreenAction, type ScreenId } from './screens';

/** docs/10 §3 + docs/30 §10, transcribed by hand: `from action[guard] -> to`. */
const EXPECTED = [
  'title begin -> worldMap',
  'worldMap selectStage -> preview',
  'preview start -> countdown',
  'preview quit -> worldMap',
  'countdown dispatch[speedBetAllowed] -> speedBet',
  'countdown dispatch[speedBetSkipped] -> dispatch',
  'countdown quit -> worldMap',
  'speedBet confirmBet -> dispatch',
  'dispatch depart -> watch',
  'watch resolved -> resolve',
  'watch quit -> worldMap',
  'resolve retry -> countdown',
  'resolve showResults -> results',
  'results retry -> countdown',
  'results next -> worldMap',
  'results quit -> worldMap',
].sort();

const actual = TRANSITIONS.map(
  (t) => `${t.from} ${t.action}${t.guard ? `[${t.guard}]` : ''} -> ${t.to}`,
).sort();

describe('screen state machine', () => {
  it('matches the docs/10 §3 loop exactly — no missing and no extra transitions', () => {
    expect(actual).toEqual(EXPECTED);
  });

  it('plays the full loop with a speed bet', () => {
    const m = new ScreenMachine('title', { speedBetAllowed: true });
    const path: ScreenAction[] = [
      'begin',
      'selectStage',
      'start',
      'dispatch',
      'confirmBet',
      'depart',
      'resolved',
      'showResults',
    ];
    const visited = path.map((a) => m.dispatch(a));
    expect(visited).toEqual([
      'worldMap',
      'preview',
      'countdown',
      'speedBet',
      'dispatch',
      'watch',
      'resolve',
      'results',
    ]);
  });

  it('skips the bet screen when the scenario forbids betting', () => {
    const m = new ScreenMachine('countdown', { speedBetAllowed: false });
    expect(m.dispatch('dispatch')).toBe('dispatch');
  });

  it('offers the bet screen when the scenario allows betting', () => {
    const m = new ScreenMachine('countdown', { speedBetAllowed: true });
    expect(m.dispatch('dispatch')).toBe('speedBet');
  });

  it('setContext re-guards the conditional edge mid-session', () => {
    const m = new ScreenMachine('countdown', { speedBetAllowed: true });
    m.setContext({ speedBetAllowed: false });
    expect(m.peek('dispatch')).toBe('dispatch');
  });

  it('retry returns straight to the build phase from both resolve and results', () => {
    for (const from of ['resolve', 'results'] as ScreenId[]) {
      const m = new ScreenMachine(from);
      expect(m.dispatch('retry')).toBe('countdown');
    }
  });

  it('refuses an illegal action, stays put, and says so', () => {
    const m = new ScreenMachine('preview');
    let rejected = 0;
    m.bus.on('rejected', () => rejected++);
    expect(m.dispatch('confirmBet')).toBeNull();
    expect(m.current).toBe('preview');
    expect(rejected).toBe(1);
  });

  it('emits a change event with from/to/action', () => {
    const m = new ScreenMachine('title');
    const seen: string[] = [];
    m.bus.on('change', (c) => seen.push(`${c.from}-${c.action}->${c.to}`));
    m.dispatch('begin');
    expect(seen).toEqual(['title-begin->worldMap']);
  });

  it('every screen is reachable from the title', () => {
    const reachable = new Set<ScreenId>(['title']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of TRANSITIONS) {
        if (reachable.has(t.from) && !reachable.has(t.to)) {
          reachable.add(t.to);
          grew = true;
        }
      }
    }
    expect([...reachable].sort()).toEqual([...SCREENS].sort());
  });

  it('every transition names a declared screen', () => {
    for (const t of TRANSITIONS) {
      expect(SCREENS).toContain(t.from);
      expect(SCREENS).toContain(t.to);
    }
  });

  it('available() lists exactly the legal actions for the current screen', () => {
    const m = new ScreenMachine('results');
    expect(m.available().sort()).toEqual(['next', 'quit', 'retry']);
  });

  it('no screen has two unguarded transitions for the same action (the table is deterministic)', () => {
    const seen = new Map<string, number>();
    for (const t of TRANSITIONS) {
      const key = `${t.from}/${t.action}/${t.guard ?? ''}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, n] of seen) expect(n, key).toBe(1);
  });
});
