// Hazards (docs/40 §1.1, docs/70 M4.4). HEADLESS — `simulation/` is headless zone (docs/30 §2.1).
//
// All three hazard kinds reduce to the same shape once `brokenPiece` is read as fitting the same
// "is this location currently blocked" predicate as the other two — the doc doesn't say
// `brokenPiece` crashes a train explicitly, but grouping all three under one file with "all three
// hazard kinds fixture-tested" as a single AC (docs/70), and `CrashCause` already having one
// generic `'hazard'` variant covering all of them (simulation/events.ts), strongly implies a
// uniform mechanism. Flagging this reading per the M4.4 task's own request, not asserting it's
// beyond doubt.
//
// Detecting "is a train in a blocked area" uses the same COARSE, piece-footprint-level check for
// all three (consistent with hazards being described as "cell-based" rather than continuous-
// position-based, docs/30 §7.5): rockfall/crossingTraffic block a `cell`, checked against the
// train's current edge's placement's whole `worldFootprint` (track/placement.ts, reused, not
// reinvented); brokenPiece blocks a whole `placementIndex`, checked directly against the train's
// current edge's `placementIndex` — no footprint check needed there.

import type { Tick } from '../core/types';
import type { CellCoord } from '../track/pieces';
import { worldFootprint } from '../track/placement';
import type { TrackEdge, TrackGraph } from '../track/graph';
import type { Hazard, Passenger } from '../scenarios/types';
import type { TrainState } from '../train/types';
import type { SimEvent } from './events';

/** Is `hazard` currently blocking, at `tick`? `repairedPlacements` only matters for `brokenPiece`. */
export function isHazardActive(hazard: Hazard, tick: Tick, repairedPlacements: ReadonlySet<number>): boolean {
  switch (hazard.kind) {
    case 'rockfall':
      // window is half-open [fromTick, toTick) — blocked at fromTick itself, clear again at
      // toTick itself (tested both edges: docs/70 M4.4 AC).
      return tick >= hazard.fromTick && tick < hazard.toTick;
    case 'crossingTraffic':
      // cycles from tick 0: open for the first `openTicks` ticks of each `periodTicks`-long
      // period, blocked for the rest.
      return tick % hazard.periodTicks >= hazard.openTicks;
    case 'brokenPiece':
      return !repairedPlacements.has(hazard.placementIndex);
  }
}

function trainOccupiesHazardCell(edge: TrackEdge, graph: TrackGraph, cell: CellCoord): boolean {
  const entry = graph.placements.get(edge.placementIndex);
  if (!entry) return false;
  return worldFootprint(entry.placement).some((f) => f.x === cell.x && f.z === cell.z);
}

function hazardCrashCell(edge: TrackEdge, graph: TrackGraph, hazard: Hazard): CellCoord {
  if (hazard.kind !== 'brokenPiece') return hazard.cell;
  // brokenPiece has no cell of its own — approximate with the edge's own "to" node cell (or
  // "from" as a fallback), same posture as physics.ts's crash-cell approximations elsewhere.
  return graph.nodes.get(edge.to)?.cell ?? graph.nodes.get(edge.from)?.cell ?? { x: 0, z: 0 };
}

/**
 * Every train currently occupying an active hazard's blocked area crashes with
 * `Crashed{cause:'hazard'}`. Read-only — same pattern as `train/physics.ts`'s `detectCollisions`:
 * does not mutate any `TrainState` or set `crashed` itself, just reports. The caller applies
 * `crashed = true` (and `edgeId: null`, per the same convention every other crash site follows) to
 * every trainId named in the returned events. At most one `Crashed` event per train per tick, even
 * if it happens to sit in more than one active hazard's area at once.
 */
export function detectHazardCrashes(
  trains: TrainState[],
  graph: TrackGraph,
  hazards: Hazard[],
  repairedPlacements: ReadonlySet<number>,
  tick: Tick,
): SimEvent[] {
  const events: SimEvent[] = [];

  for (const train of trains) {
    if (train.crashed || train.edgeId === null) continue;
    const edge = graph.edges.get(train.edgeId);
    if (!edge) continue;

    for (const hazard of hazards) {
      if (!isHazardActive(hazard, tick, repairedPlacements)) continue;

      const inHazard =
        hazard.kind === 'brokenPiece'
          ? edge.placementIndex === hazard.placementIndex
          : trainOccupiesHazardCell(edge, graph, hazard.cell);

      if (inHazard) {
        events.push({
          tick,
          type: 'Crashed',
          trainId: train.id,
          cause: 'hazard',
          cell: hazardCrashCell(edge, graph, hazard),
        });
        break; // one hazard crash event per train per tick is enough
      }
    }
  }

  return events;
}

/**
 * `PieceRepaired` for every `brokenPiece` hazard whose `repairStationId` matches a `Delivered`
 * event from THIS tick's event batch (`tickEvents` — not the whole event log, just this tick's),
 * for a passenger whose `persona === 'engineer'`, not already repaired. `alreadyRepaired` is a
 * caller-owned ledger (same "pure function, caller owns cross-cutting state" pattern as
 * `detectHazardCrashes`'s `repairedPlacements` and `train/stations.ts`'s `boarded`/`delivered`) —
 * the caller is expected to add every placementIndex named in the returned events into whatever
 * set it later passes as `repairedPlacements`/`alreadyRepaired`.
 */
export function detectRepairs(
  tickEvents: SimEvent[],
  hazards: Hazard[],
  passengers: Passenger[],
  alreadyRepaired: ReadonlySet<number>,
  tick: Tick,
): SimEvent[] {
  const delivered = tickEvents.filter(
    (e): e is Extract<SimEvent, { type: 'Delivered' }> => e.type === 'Delivered',
  );
  const events: SimEvent[] = [];

  for (const hazard of hazards) {
    if (hazard.kind !== 'brokenPiece') continue;
    if (alreadyRepaired.has(hazard.placementIndex)) continue;

    const repair = delivered.find((d) => {
      if (d.stationId !== hazard.repairStationId) return false;
      const passenger = passengers.find((p) => p.id === d.passengerId);
      return passenger?.persona === 'engineer';
    });

    if (repair) {
      events.push({
        tick,
        type: 'PieceRepaired',
        placementIndex: hazard.placementIndex,
        byPassengerId: repair.passengerId,
      });
    }
  }

  return events;
}
