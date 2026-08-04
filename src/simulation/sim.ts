// Simulation orchestration (docs/30 §4, docs/70 M5.2). HEADLESS.
//
// One runner powers gameplay, replays, the editor's playtest, and the CI content gate — so all
// four agree by construction. It wires together the track model (M2), the train sim (M4) and
// scoring (M5.3): build the board from the scenario + player inputs, then advance whole ticks.
//
// Stations are ordinary straight pieces pre-placed by the scenario, which is what lets track
// connect to them with no special cases.

import { Rng } from '../core/rng';
import { stateHash } from '../core/hash';
import { TrackGraph } from '../track/graph';
import {
  makeGrid,
  setTerrain,
  validatePlacement,
  worldFootprint,
  type Grid,
  type Placement,
} from '../track/placement';
import type { Rotation } from '../track/pieces';
import { TrackRuntime } from '../train/runtime';
import { stepTrain } from '../train/movement';
import {
  checkDerail,
  crash,
  detectCollisions,
  landingSites,
  resolveDeadEnd,
  stepAirborne,
  type LandingSite,
} from '../train/physics';
import { makeTrain, type SpeedBet, type TrainState } from '../train/types';
import {
  initStations,
  stepStation,
  type Passenger,
  type Station,
  type StationState,
} from '../train/stations';
import { initHazards, isCellBlocked, repairOnDelivery, type Hazard, type HazardState } from './hazards';
import type { SimEvent } from './events';
import type { Scenario } from '../scenarios/types';
import { computeConnections, computeStars, type SimResult, type StarTargets } from './scoring';
import type { QuirkContext } from './personas';
import { inputsAt, referenceToReplay, type InputEvent, type Replay } from './inputs';

export const DEFAULT_MAX_TICKS = 10_800; // three sim-minutes — a stage that hasn't resolved has failed

export interface SimState {
  scenario: Scenario;
  tick: number;
  rng: Rng;
  grid: Grid;
  /** stations first, then prePlaced, then whatever the player laid */
  placements: Placement[];
  stationCount: number;
  fixedCount: number;
  graph: TrackGraph;
  runtime: TrackRuntime;
  sites: LandingSite[];
  trains: TrainState[];
  trainSpawn: Map<string, { edgeId: string; s: number; order: number }>;
  dispatched: boolean;
  dispatchTick: number | null;
  speedBet: SpeedBet;
  switchStates: Map<number, 0 | 1>;
  stationState: StationState;
  hazardState: HazardState;
  hazards: Hazard[];
  passengers: Passenger[];
  stationByEdge: Map<string, Station>;
  events: SimEvent[];
  playerPlacements: number;
  travelled: Map<string, number>;
  finished: boolean;
}

const orientationRotation = (o: 'NS' | 'EW'): Rotation => (o === 'NS' ? 0 : 1);

/** Build the board and place every train at its platform. */
export function createSim(scenario: Scenario, seed: number): SimState {
  const grid = makeGrid(scenario.grid.width, scenario.grid.height);
  for (const t of scenario.terrain) {
    setTerrain(grid, t.x, t.z, { height: t.height ?? 0, feature: t.feature });
  }

  // stations become straight pieces so ordinary track can connect to them
  const placements: Placement[] = scenario.stations.map((s) => ({
    piece: 'straight' as const,
    cell: { x: s.cell.x, z: s.cell.z },
    rotation: orientationRotation(s.orientation),
  }));
  const stationCount = placements.length;
  for (const p of scenario.prePlaced ?? []) {
    placements.push({ piece: p.piece, cell: { x: p.cell.x, z: p.cell.z }, rotation: p.rotation });
  }
  const fixedCount = placements.length;

  const state: SimState = {
    scenario,
    tick: 0,
    rng: new Rng(seed),
    grid,
    placements,
    stationCount,
    fixedCount,
    graph: new TrackGraph(),
    runtime: null as unknown as TrackRuntime,
    sites: [],
    trains: [],
    trainSpawn: new Map(),
    dispatched: false,
    dispatchTick: null,
    speedBet: 'steady',
    switchStates: new Map(),
    stationState: initStations(scenario.passengers as Passenger[]),
    hazardState: initHazards(),
    hazards: (scenario.hazards ?? []) as Hazard[],
    passengers: scenario.passengers as Passenger[],
    stationByEdge: new Map(),
    events: [],
    playerPlacements: 0,
    travelled: new Map(),
    finished: false,
  };

  rebuildTrack(state);
  spawnTrains(state);
  return state;
}

/** Rebuild the graph + runtime from the current placements (placements only change pre-dispatch). */
function rebuildTrack(state: SimState): void {
  const graph = new TrackGraph();
  state.placements.forEach((p, i) => {
    const base = state.grid.terrain.get(`${p.cell.x},${p.cell.z}`)?.height ?? 0;
    graph.addPlacement(i, p, base);
  });
  const bases = state.placements.map((p) => state.grid.terrain.get(`${p.cell.x},${p.cell.z}`)?.height ?? 0);
  state.graph = graph;
  state.runtime = new TrackRuntime(graph, state.placements, bases);
  state.sites = landingSites(state.runtime);

  // map both directions of each station's piece back to the station
  state.stationByEdge.clear();
  state.scenario.stations.forEach((s, i) => {
    for (const edge of graph.edges.values()) {
      if (edge.placementIndex !== i) continue;
      const station: Station = { id: s.id, edgeId: edge.id, optional: s.optional };
      state.stationByEdge.set(edge.id, station);
    }
  });
}

/** Put each train on its spawn station's platform, facing wherever the track leads. */
function spawnTrains(state: SimState): void {
  state.trains = [];
  state.trainSpawn.clear();
  state.scenario.trains.forEach((t) => {
    const stationIndex = state.scenario.stations.findIndex((s) => s.id === t.spawnStationId);
    if (stationIndex < 0) return;
    const candidates = [...state.graph.edges.values()]
      .filter((e) => e.placementIndex === stationIndex)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    // prefer a direction that actually leads somewhere
    const outward =
      candidates.find((e) => state.runtime.nextEdges(e.id, state.switchStates).length > 0) ?? candidates[0];
    if (!outward) return;
    const train = makeTrain(t.id, outward.id, t.carriageCount);
    train.s = state.runtime.length(outward.id) / 2; // sitting at the platform
    state.trains.push(train);
    state.trainSpawn.set(t.id, { edgeId: outward.id, s: train.s, order: t.dispatchOrder ?? 0 });
  });
}

/** Apply a player input. Placements are only legal before dispatch. */
export function applyInput(state: SimState, input: InputEvent): void {
  switch (input.type) {
    case 'placePiece': {
      if (state.dispatched) return;
      const placement: Placement = {
        piece: input.placement.piece,
        cell: { x: input.placement.cell.x, z: input.placement.cell.z },
        rotation: input.placement.rotation,
      };
      const check = validatePlacement(state.grid, state.placements, placement);
      if (!check.ok) return; // an illegal placement is simply refused, as in the UI
      state.placements.push(placement);
      state.playerPlacements++;
      rebuildTrack(state);
      spawnTrains(state);
      break;
    }
    case 'removePiece': {
      if (state.dispatched) return;
      const index = state.fixedCount + input.placementIndex;
      if (index < state.fixedCount || index >= state.placements.length) return;
      state.placements.splice(index, 1);
      state.playerPlacements--;
      rebuildTrack(state);
      spawnTrains(state);
      break;
    }
    case 'setSpeedBet':
      if (!state.dispatched) state.speedBet = state.scenario.speedBetAllowed ? input.bet : 'steady';
      break;
    case 'dispatch':
      if (!state.dispatched) {
        state.dispatched = true;
        state.dispatchTick = state.tick;
        for (const t of state.trains) {
          state.events.push({
            tick: state.tick,
            type: 'Dispatched',
            trainId: t.id,
            speedBet: state.speedBet,
          });
        }
      }
      break;
    case 'flipSwitch': {
      state.switchStates.set(input.placementIndex, input.state);
      state.events.push({
        tick: state.tick,
        type: 'SwitchFlipped',
        placementIndex: input.placementIndex,
        state: input.state,
      });
      break;
    }
  }
}

/** The grid cell a train currently sits over. */
function cellOf(state: SimState, train: TrainState): { x: number; z: number } {
  const p = state.runtime.positionAt(train.edgeId!, train.s);
  return { x: Math.round(p.x), z: Math.round(p.z) };
}

/** Advance exactly one tick. Returns the events produced during it. */
export function tick(state: SimState): SimEvent[] {
  const produced: SimEvent[] = [];
  if (state.finished) return produced;

  const emit = (events: SimEvent[]) => {
    produced.push(...events);
    state.events.push(...events);
  };

  if (state.dispatched) {
    for (const train of state.trains) {
      if (train.crashed) continue;

      // a staggered train waits its turn
      const spawn = state.trainSpawn.get(train.id);
      if (spawn && state.dispatchTick !== null && state.tick < state.dispatchTick + spawn.order) continue;

      if (train.airborne) {
        const air = stepAirborne(train, state.sites);
        if (air.kind === 'landed') {
          emit([{ tick: state.tick, type: 'Airtime', trainId: train.id, durationTicks: 1 }]);
        } else if (air.kind === 'crashed') {
          emit([
            {
              tick: state.tick,
              type: 'Crashed',
              trainId: train.id,
              cause: air.cause,
              cell: { x: 0, z: 0 },
            },
          ]);
        }
        continue;
      }

      // stations first: boarding/delivery may hold the train at a stop
      const station = train.edgeId ? state.stationByEdge.get(train.edgeId) : undefined;
      const stationEvents = stepStation(
        train,
        station ?? null,
        state.stationState,
        state.passengers,
        state.tick,
      );
      emit(stationEvents);

      // an engineer arriving may repair a broken piece
      for (const e of stationEvents) {
        if (e.type !== 'Delivered') continue;
        const passenger = state.passengers.find((p) => p.id === e.passengerId);
        if (!passenger) continue;
        emit(
          repairOnDelivery(
            state.hazards,
            state.hazardState,
            e.stationId,
            e.passengerId,
            passenger.persona,
            state.tick,
          ),
        );
      }

      if (train.dwellTicks > 0 || train.crashed) continue;

      const before = train.odometer;
      const outcome = stepTrain(train, state.runtime, {
        speedBet: state.speedBet,
        switchStates: state.switchStates,
      });

      if (outcome.kind === 'dead-end') {
        const resolved = resolveDeadEnd(train, state.runtime, outcome.overrun);
        if (resolved.kind === 'crashed') {
          emit([
            {
              tick: state.tick,
              type: 'Crashed',
              trainId: train.id,
              cause: resolved.cause,
              cell: train.edgeId ? cellOf(state, train) : { x: 0, z: 0 },
            },
          ]);
          continue;
        }
      }

      // credit distance to whoever is riding (the musician's scenic-route quirk)
      const moved = train.odometer - before;
      for (const carriage of train.carriages) {
        if (!carriage.personaId) continue;
        state.travelled.set(carriage.personaId, (state.travelled.get(carriage.personaId) ?? 0) + moved);
      }

      // hazards block cells; entering one is a crash
      if (train.edgeId && isCellBlocked(state.hazards, cellOf(state, train), state.tick)) {
        crash(train, 'hazard');
        emit([
          {
            tick: state.tick,
            type: 'Crashed',
            trainId: train.id,
            cause: 'hazard',
            cell: cellOf(state, train),
          },
        ]);
        continue;
      }

      const derail = checkDerail(train, state.runtime);
      if (derail) {
        emit([
          {
            tick: state.tick,
            type: 'Crashed',
            trainId: train.id,
            cause: derail,
            cell: cellOf(state, train),
          },
        ]);
      }
    }

    // collisions are resolved after everyone has moved, so the tick is exact
    for (const [a, b] of detectCollisions(state.trains, state.runtime)) {
      for (const id of [a, b]) {
        const train = state.trains.find((t) => t.id === id)!;
        if (train.crashed) continue;
        const cell = train.edgeId ? cellOf(state, train) : { x: 0, z: 0 };
        crash(train, 'collision');
        emit([{ tick: state.tick, type: 'Crashed', trainId: id, cause: 'collision', cell }]);
      }
    }
  }

  state.tick++;
  if (isResolved(state)) state.finished = true;
  return produced;
}

/** Complete (everyone required delivered) or hopeless (every train wrecked). */
export function isResolved(state: SimState): boolean {
  const required = state.passengers.filter((p) => p.required !== false);
  const allDelivered = required.every((p) => state.stationState.delivered.has(p.id));
  if (allDelivered) return true;
  return state.dispatched && state.trains.length > 0 && state.trains.every((t) => t.crashed !== null);
}

/**
 * The scoreable summary of a run so far. Exported because the game shell scores a live run the
 * same way the headless runner scores a replay — one function, so a played run and its replay
 * can never be scored differently.
 */
export function resultOf(state: SimState): SimResult {
  const required = state.passengers.filter((p) => p.required !== false).map((p) => p.id);
  const deliveries = state.events.filter((e) => e.type === 'Delivered') as Array<
    Extract<SimEvent, { type: 'Delivered' }>
  >;
  const requiredDeliveries = deliveries.filter((d) => required.includes(d.passengerId));
  const lastRequired =
    requiredDeliveries.length === required.length && required.length > 0
      ? Math.max(...requiredDeliveries.map((d) => d.tick))
      : null;

  const trayTotal = state.scenario.pieceTray.reduce((sum, t) => sum + t.count, 0);
  const optionalIds = new Set(state.scenario.stations.filter((s) => s.optional).map((s) => s.id));
  const optionalServed = new Set(
    deliveries.filter((d) => optionalIds.has(d.stationId)).map((d) => d.stationId),
  );

  return {
    outcome: lastRequired !== null ? 'complete' : 'failed',
    finalTick: state.tick,
    lastRequiredDeliveryTick: lastRequired,
    events: state.events,
    piecesPlaced: state.playerPlacements,
    unusedTrayPieces: Math.max(0, trayTotal - state.playerPlacements),
    optionalStationsServed: optionalServed.size,
    speedBet: state.speedBet,
    requiredPassengerIds: required,
  };
}

/** The quirk inputs a finished run needs (travelled distance vs. the shortest possible route). */
export function quirkContextFor(state: SimState, result: SimResult): QuirkContext {
  const personaOf = new Map(state.passengers.map((p) => [p.id, p.persona]));
  const timeLimitBy = new Map(
    state.passengers.filter((p) => p.timeLimitTicks !== undefined).map((p) => [p.id, p.timeLimitTicks!]),
  );

  const shortestBy = new Map<string, number>();
  for (const p of state.passengers) {
    const fromIndex = state.scenario.stations.findIndex((s) => s.id === p.from);
    const toIndex = state.scenario.stations.findIndex((s) => s.id === p.to);
    if (fromIndex < 0 || toIndex < 0) continue;
    const fromNode = state.graph.portNode(fromIndex, 0);
    const toNode = state.graph.portNode(toIndex, 1);
    if (!fromNode || !toNode) continue;
    const d = state.graph.shortestPathLength(fromNode, toNode);
    if (d !== null) shortestBy.set(p.id, d);
  }

  return {
    events: result.events,
    speedBet: result.speedBet,
    personaOf,
    travelledBy: state.travelled,
    shortestBy,
    timeLimitBy,
  };
}

export interface HeadlessOutcome {
  result: SimResult;
  /** the quirk inputs the score was computed from — the results screen itemizes from these */
  quirks: QuirkContext;
  stars: 0 | 1 | 2 | 3;
  connections: number;
  ticks: number;
  hash: string;
}

/** Run a replay to completion with no renderer — the CI gate and the editor's publish check. */
export function runHeadless(
  scenario: Scenario,
  replay: Replay,
  maxTicks = DEFAULT_MAX_TICKS,
): HeadlessOutcome {
  const state = createSim(scenario, replay.seed);

  while (!state.finished && state.tick < maxTicks) {
    for (const input of inputsAt(replay, state.tick)) applyInput(state, input);
    tick(state);
  }

  const result = resultOf(state);
  const targets: StarTargets = state.scenario.stars;
  const ctx = quirkContextFor(state, result);
  return {
    result,
    quirks: ctx,
    stars: computeStars(result, targets),
    connections: computeConnections(result, ctx),
    ticks: state.tick,
    hash: simHash(state),
  };
}

/** Replay a scenario's own reference solution (docs/40 V6). */
export function runReferenceSolution(scenario: Scenario, maxTicks = DEFAULT_MAX_TICKS): HeadlessOutcome {
  const replay = referenceToReplay(scenario.id, scenario.schemaVersion, scenario.referenceSolution);
  return runHeadless(scenario, replay, maxTicks);
}

/** Canonical hash of the moving parts — two identical runs must agree at every tick (D-1). */
export function simHash(state: SimState): string {
  return stateHash({
    tick: state.tick,
    trains: state.trains.map((t) => ({
      id: t.id,
      edgeId: t.edgeId,
      s: t.s,
      v: t.v,
      crashed: t.crashed,
      dwell: t.dwellTicks,
      odometer: t.odometer,
      carriages: t.carriages.map((c) => c.personaId),
    })),
    delivered: [...state.stationState.delivered].sort(),
    switches: [...state.switchStates.entries()].sort(),
  });
}

/** Cells occupied by every placed piece — used by the editor to draw the board. */
export function occupiedCells(state: SimState): string[] {
  return state.placements.flatMap((p) => worldFootprint(p).map((c) => `${c.x},${c.z}`));
}
