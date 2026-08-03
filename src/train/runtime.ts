// Track runtime (docs/70 M4.2). HEADLESS. Binds graph edges to their compiled geometry so a
// train can ask "where am I at distance s along this edge?" and "where can I go next?".
// Reverse edges traverse the same piece path backwards, so distance is mirrored.

import type { TrackEdge, TrackGraph } from '../track/graph';
import type { Placement } from '../track/placement';
import { compileWorldPath, type CompiledPath } from '../track/splines';
import { scale, type Vec3 } from '../core/math';

export interface EdgeRuntime {
  edge: TrackEdge;
  path: CompiledPath;
}

export class TrackRuntime {
  private readonly runtimes = new Map<string, EdgeRuntime>();

  constructor(
    readonly graph: TrackGraph,
    placements: Placement[],
    bases: number[] = [],
  ) {
    for (const edge of graph.edges.values()) {
      const placement = placements[edge.placementIndex];
      if (!placement) continue;
      const path = compileWorldPath(placement, edge.pathIndex, bases[edge.placementIndex] ?? 0);
      this.runtimes.set(edge.id, { edge, path });
    }
  }

  get(edgeId: string): EdgeRuntime {
    const r = this.runtimes.get(edgeId);
    if (!r) throw new Error(`TrackRuntime: unknown edge ${edgeId}`);
    return r;
  }

  has(edgeId: string): boolean {
    return this.runtimes.has(edgeId);
  }

  length(edgeId: string): number {
    return this.get(edgeId).path.length;
  }

  /** World position at arc length `s` from the edge's `from` node. */
  positionAt(edgeId: string, s: number): Vec3 {
    const { edge, path } = this.get(edgeId);
    const d = Math.max(0, Math.min(path.length, s));
    return path.pointAt(edge.reversed ? path.length - d : d);
  }

  /** Unit tangent pointing along travel direction at arc length `s`. */
  tangentAt(edgeId: string, s: number): Vec3 {
    const { edge, path } = this.get(edgeId);
    const d = Math.max(0, Math.min(path.length, s));
    const t = path.tangentAt(edge.reversed ? path.length - d : d);
    return edge.reversed ? scale(t, -1) : t;
  }

  /**
   * Onward edges from the end of `edgeId`, honouring switch state and never immediately
   * doubling back down the edge just travelled.
   */
  nextEdges(edgeId: string, switchStates: ReadonlyMap<number, 0 | 1> = new Map()): TrackEdge[] {
    const { edge } = this.get(edgeId);
    return this.graph
      .edgesFrom(edge.to, switchStates)
      .filter((e) => !(e.placementIndex === edge.placementIndex && e.pathIndex === edge.pathIndex));
  }
}
