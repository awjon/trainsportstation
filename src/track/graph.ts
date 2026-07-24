// Track graph (docs/30 §4, docs/70 M2.3). HEADLESS. Turns placed pieces into a routable network
// of nodes (shared cell-edge boundaries) and directed edges (piece paths, both directions). Two
// facing ports of adjacent pieces resolve to the SAME node, so pieces wire themselves together.
// Junction paths carry a switch requirement so `edgesFrom` can gate them by switch state.

import {
  PIECE_DEFS,
  edgeStep,
  type CellCoord,
  type CurveClass,
  type Direction,
  type HeightLevel,
} from './pieces';
import { worldPorts, type Placement } from './placement';

export interface TrackNode {
  id: string;
  cell: CellCoord; // one of the two cells the boundary sits between
  edge: Direction;
  height: number;
}

export interface TrackEdge {
  id: string;
  from: string; // node id
  to: string;
  placementIndex: number;
  pathIndex: number;
  length: number;
  curveClass: CurveClass;
  grade: -1 | 0 | 1;
  /** if set, only traversable when the placement's switch is in this state */
  switchState?: 0 | 1;
}

const cellKey = (c: CellCoord): string => `${c.x},${c.z}`;

/** A node is the boundary between two adjacent cells at a height — canonical id, side-agnostic. */
function nodeIdFor(cell: CellCoord, edge: Direction, worldHeight: number): string {
  const neighbour: CellCoord = { x: cell.x + edgeStep(edge).x, z: cell.z + edgeStep(edge).z };
  const [a, b] = [cellKey(cell), cellKey(neighbour)].sort();
  return `${a}|${b}@${worldHeight}`;
}

export class TrackGraph {
  readonly nodes = new Map<string, TrackNode>();
  readonly edges = new Map<string, TrackEdge>();
  private readonly adjacency = new Map<string, string[]>(); // nodeId → edgeIds (outgoing)
  private readonly placementPorts = new Map<number, string[]>(); // placementIndex → node id per port
  /**
   * placementIndex → its own `Placement` (piece/cell/rotation) + terrain base height (docs/70
   * M4.3, additive — nothing above this reads or depends on it). Populated/deleted in lockstep
   * with `placementPorts` below. Needed because jump/landing physics (§7.2) must resolve
   * piece-local geometry (`compilePath`) to WORLD space across placements a train's current edge
   * isn't graph-connected to (the entire point of a jump is crossing a gap between disconnected
   * track) — `TrackEdge` alone (placementIndex/pathIndex, no transform) can't do that; this is the
   * transform lookup train/physics.ts needs, paired with track/placement.ts's
   * `pieceLocalToWorld`/`pieceLocalDirToWorld`.
   */
  readonly placements = new Map<number, { placement: Placement; base: number }>();

  /** Add a placed piece. `base` is the terrain height under its anchor cell. Returns its port nodes. */
  addPlacement(index: number, placement: Placement, base = 0): string[] {
    const def = PIECE_DEFS[placement.piece];
    const isSwitch = def.tags.includes('switch');
    const wports = worldPorts(placement);

    const portNodeIds = wports.map((wp) => {
      const worldHeight = base + wp.height;
      const id = nodeIdFor(wp.cell, wp.edge, worldHeight);
      if (!this.nodes.has(id)) {
        this.nodes.set(id, { id, cell: wp.cell, edge: wp.edge, height: worldHeight as HeightLevel });
        this.adjacency.set(id, []);
      }
      return id;
    });
    this.placementPorts.set(index, portNodeIds);
    this.placements.set(index, { placement, base });

    def.paths.forEach((path, pathIndex) => {
      const a = portNodeIds[path.fromPort];
      const b = portNodeIds[path.toPort];
      const sw: 0 | 1 | undefined = isSwitch ? ((pathIndex === 0 ? 0 : 1) as 0 | 1) : undefined;
      this.addEdge(index, pathIndex, 'f', a, b, path.length, path.curveClass, path.grade, sw);
      this.addEdge(index, pathIndex, 'r', b, a, path.length, path.curveClass, -path.grade as -1 | 0 | 1, sw);
    });

    return portNodeIds;
  }

  private addEdge(
    placementIndex: number,
    pathIndex: number,
    dir: 'f' | 'r',
    from: string,
    to: string,
    length: number,
    curveClass: CurveClass,
    grade: -1 | 0 | 1,
    switchState?: 0 | 1,
  ): void {
    const id = `${placementIndex}:${pathIndex}:${dir}`;
    this.edges.set(id, { id, from, to, placementIndex, pathIndex, length, curveClass, grade, switchState });
    this.adjacency.get(from)!.push(id);
  }

  removePlacement(index: number): void {
    for (const [id, edge] of [...this.edges]) {
      if (edge.placementIndex !== index) continue;
      this.edges.delete(id);
      const list = this.adjacency.get(edge.from);
      if (list)
        this.adjacency.set(
          edge.from,
          list.filter((e) => e !== id),
        );
    }
    // prune any node this placement introduced that no edge references any more
    for (const nodeId of this.placementPorts.get(index) ?? []) {
      const outgoing = this.adjacency.get(nodeId);
      const referenced =
        (outgoing && outgoing.length > 0) || [...this.edges.values()].some((e) => e.to === nodeId);
      if (!referenced) {
        this.nodes.delete(nodeId);
        this.adjacency.delete(nodeId);
      }
    }
    this.placementPorts.delete(index);
    this.placements.delete(index);
  }

  /** Outgoing edges from a node, gated by switch state (default 0) for junction pieces. */
  edgesFrom(nodeId: string, switchStates: ReadonlyMap<number, 0 | 1> = new Map()): TrackEdge[] {
    return (this.adjacency.get(nodeId) ?? [])
      .map((id) => this.edges.get(id)!)
      .filter(
        (e) => e.switchState === undefined || (switchStates.get(e.placementIndex) ?? 0) === e.switchState,
      );
  }

  /** The node id for a placement's port (for callers that placed it). */
  portNode(placementIndex: number, portIndex: number): string | undefined {
    return this.placementPorts.get(placementIndex)?.[portIndex];
  }

  /**
   * Dijkstra shortest path length between two nodes. Switches are assumed settable (a router
   * picks the best), so all junction branches are available. Returns null if unreachable.
   */
  shortestPathLength(from: string, to: string): number | null {
    if (from === to) return 0;
    const dist = new Map<string, number>([[from, 0]]);
    const visited = new Set<string>();
    while (visited.size < this.nodes.size) {
      // pick the unvisited node with the smallest tentative distance
      let cur: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          cur = id;
        }
      }
      if (cur === null) break;
      if (cur === to) return best;
      visited.add(cur);
      // routing may set any switch, so every outgoing edge is available (ignore switch gating)
      for (const edgeId of this.adjacency.get(cur) ?? []) {
        const edge = this.edges.get(edgeId)!;
        const nd = best + edge.length;
        if (nd < (dist.get(edge.to) ?? Infinity)) dist.set(edge.to, nd);
      }
    }
    return dist.has(to) ? dist.get(to)! : null;
  }

  /** Sorted node + edge ids — for equality checks (T-3). */
  snapshot(): { nodes: string[]; edges: string[] } {
    return {
      nodes: [...this.nodes.keys()].sort(),
      edges: [...this.edges.keys()].sort(),
    };
  }
}
