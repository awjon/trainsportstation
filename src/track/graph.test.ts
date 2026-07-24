// M2.3 tests (docs/70): add/remove restores the graph (T-3), facing ports share a node, junction
// edges gate by switch state, and Dijkstra shortest paths match hand computation.

import { describe, expect, it } from 'vitest';
import { TrackGraph } from './graph';
import type { Placement } from './placement';

const straight = (x: number, z: number): Placement => ({ piece: 'straight', cell: { x, z }, rotation: 0 });

describe('TrackGraph', () => {
  it('facing ports of adjacent straights resolve to one shared node', () => {
    const g = new TrackGraph();
    const a = g.addPlacement(0, straight(0, 0)); // ports [N-node, S-node]
    const b = g.addPlacement(1, straight(0, 1)); // ports [N-node, S-node]
    expect(a[1]).toBe(b[0]); // A's south node === B's north node
    // three straights in a line share nodes → 4 nodes, 3 undirected paths (6 directed edges)
    g.addPlacement(2, straight(0, 2));
    expect(g.nodes.size).toBe(4);
    expect(g.edges.size).toBe(6);
  });

  it('T-3: add then remove restores the graph exactly', () => {
    const g = new TrackGraph();
    g.addPlacement(0, straight(0, 0));
    const before = g.snapshot();
    g.addPlacement(1, straight(0, 1)); // connects, adds one node + edges
    expect(g.snapshot()).not.toEqual(before);
    g.removePlacement(1);
    expect(g.snapshot()).toEqual(before);
  });

  it('junction edges are gated by switch state', () => {
    const g = new TrackGraph();
    const [nNode, sNode, eNode] = g.addPlacement(0, { piece: 'junction', cell: { x: 5, z: 5 }, rotation: 0 });

    const through = g.edgesFrom(nNode, new Map([[0, 0]]));
    expect(through).toHaveLength(1);
    expect(through[0].to).toBe(sNode); // switch 0 → straight through

    const branch = g.edgesFrom(nNode, new Map([[0, 1]]));
    expect(branch).toHaveLength(1);
    expect(branch[0].to).toBe(eNode); // switch 1 → branch
  });

  it('shortestPathLength over a line of straights equals the number of pieces', () => {
    const g = new TrackGraph();
    const a = g.addPlacement(0, straight(0, 0));
    g.addPlacement(1, straight(0, 1));
    const c = g.addPlacement(2, straight(0, 2));
    const start = a[0]; // far north node
    const end = c[1]; // far south node
    expect(g.shortestPathLength(start, end)).toBeCloseTo(6, 6); // 3 × straight length (CELL = 2.0)
  });

  it('shortestPathLength prefers the shorter junction route', () => {
    const g = new TrackGraph();
    const [nNode, sNode, eNode] = g.addPlacement(0, { piece: 'junction', cell: { x: 2, z: 2 }, rotation: 0 });
    const through = g.shortestPathLength(nNode, sNode); // straight length CELL = 2
    const branch = g.shortestPathLength(nNode, eNode); // tight quarter-arc < through
    expect(through).toBeCloseTo(2, 6);
    expect(branch).not.toBeNull();
    expect(branch!).toBeLessThan(through!);
  });

  it('returns null for unreachable nodes', () => {
    const g = new TrackGraph();
    const a = g.addPlacement(0, straight(0, 0));
    const b = g.addPlacement(1, straight(5, 5)); // disconnected island
    expect(g.shortestPathLength(a[0], b[1])).toBeNull();
  });
});
