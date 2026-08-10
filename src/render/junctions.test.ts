// The junction lever is the one animatable node in an otherwise fully instanced track, so its
// contract (named, addressable, actually swings, ends exactly on the target angle) is pinned
// here — docs/70 M3.3, delivered with M6.2.

import { describe, expect, it } from 'vitest';
import { JunctionLevers, LEVER_SWING_SECONDS, leverNodeName } from './junctions';
import { LEVER_ANGLES } from './meshgen/track';
import { CELL } from './meshgen/palette';

describe('JunctionLevers', () => {
  it('exposes each lever as a named node', () => {
    const levers = new JunctionLevers();
    const node = levers.add(7, { x: 2, z: 3 });
    expect(node.name).toBe(leverNodeName(7));
    expect(levers.node(7)).toBe(node);
    expect(levers.node(8)).toBeUndefined();
  });

  it('places the lever over its own cell, respecting piece rotation', () => {
    const levers = new JunctionLevers();
    const node = levers.add(0, { x: 2, z: 3 }, 1);
    const piece = node.parent!;
    expect(piece.position.x).toBeCloseTo(2 * CELL, 9);
    expect(piece.position.z).toBeCloseTo(3 * CELL, 9);
    expect(piece.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('starts at the angle for its initial switch state', () => {
    const levers = new JunctionLevers();
    expect(levers.add(0, { x: 0, z: 0 }, 0, 0, 1).rotation.z).toBeCloseTo(LEVER_ANGLES[1], 9);
  });

  it('swings to the new state and lands exactly on the target angle', () => {
    const levers = new JunctionLevers();
    const node = levers.add(3, { x: 0, z: 0 });
    expect(node.rotation.z).toBeCloseTo(LEVER_ANGLES[0], 9);

    levers.setState(3, 1);
    levers.update(LEVER_SWING_SECONDS / 2);
    const mid = node.rotation.z;
    expect(mid).toBeGreaterThan(LEVER_ANGLES[0]);
    expect(mid).toBeLessThan(LEVER_ANGLES[1]);

    levers.update(LEVER_SWING_SECONDS); // overshoot the remaining time
    expect(node.rotation.z).toBeCloseTo(LEVER_ANGLES[1], 9);
  });

  it('flipping back mid-swing starts from where the arm actually is', () => {
    const levers = new JunctionLevers();
    const node = levers.add(1, { x: 0, z: 0 });
    levers.setState(1, 1);
    levers.update(LEVER_SWING_SECONDS / 2);
    const mid = node.rotation.z;

    levers.setState(1, 0);
    expect(node.rotation.z).toBeCloseTo(mid, 9); // no snap
    levers.update(LEVER_SWING_SECONDS);
    expect(node.rotation.z).toBeCloseTo(LEVER_ANGLES[0], 9);
  });

  it('re-requesting the current state does not restart the swing', () => {
    const levers = new JunctionLevers();
    const node = levers.add(2, { x: 0, z: 0 });
    levers.setState(2, 1);
    levers.update(LEVER_SWING_SECONDS);
    levers.setState(2, 1);
    levers.update(LEVER_SWING_SECONDS / 2);
    expect(node.rotation.z).toBeCloseTo(LEVER_ANGLES[1], 9);
  });

  it('setState on an unknown junction is ignored rather than throwing', () => {
    const levers = new JunctionLevers();
    expect(() => levers.setState(42, 1)).not.toThrow();
  });

  it('clear drops every lever so a retry can rebuild the board', () => {
    const levers = new JunctionLevers();
    levers.add(0, { x: 0, z: 0 });
    levers.add(1, { x: 1, z: 0 });
    expect(levers.count).toBe(2);
    levers.clear();
    expect(levers.count).toBe(0);
    expect(levers.node(0)).toBeUndefined();
  });
});
