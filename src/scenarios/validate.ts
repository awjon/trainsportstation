// Scenario validation (docs/40 §5). HEADLESS.
//
// The JSON Schema in docs/40 §4 is normative; this is a hand-written implementation of it,
// because the dependency list is frozen (docs/30 §1) and pulling in a schema library would
// trip CLAUDE.md's stop rule. Rules V1–V5 and V7 are static and live here; V6 (the reference
// solution must replay to 3 stars) needs the simulation and lives in `verifyReference`.
//
// Errors are structured so the editor can point straight at the offending field (docs/50 §4).

import { PIECE_TYPES, type PieceType } from '../track/pieces';
import { SUPPORTED_SCHEMA_MAJORS, type Scenario } from './types';

export type ValidationRule = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7';

export interface VError {
  rule: ValidationRule;
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; scenario: Scenario } | { ok: false; errors: VError[] };

const BIOMES = [
  'meadow',
  'highland',
  'rivers',
  'mesa',
  'frostfield',
  'coast',
  'hollow',
  'skyline',
  'cloudpeak',
  'last-junction',
];
const PAYOFFS = ['lightsOn', 'bridgeRebuild', 'festivalStart', 'beaconLit', 'reunionScene'];
const PERSONAS = ['commuter', 'kid', 'elder', 'musician', 'doctor', 'engineer'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isCell = (v: unknown): v is { x: number; z: number } =>
  isObject(v) && isInt(v.x) && isInt(v.z) && v.x >= 0 && v.z >= 0;

/** V1 — structural validation against the schema shape. */
function checkStructure(doc: unknown, errors: VError[]): doc is Scenario {
  const before = errors.length;
  const err = (path: string, message: string) => errors.push({ rule: 'V1', path, message });

  if (!isObject(doc)) {
    err('', 'scenario must be an object');
    return false;
  }

  if (doc.schemaVersion !== '1.0') err('schemaVersion', 'expected "1.0"');
  if (typeof doc.id !== 'string') err('id', 'required string');

  const meta = doc.meta;
  if (!isObject(meta)) err('meta', 'required object');
  else {
    if (typeof meta.name !== 'string' || meta.name.length < 1 || meta.name.length > 48)
      err('meta.name', 'required, 1–48 characters');
    if (typeof meta.author !== 'string' || meta.author.length < 1) err('meta.author', 'required string');
    if (!isInt(meta.world) || meta.world < 1 || meta.world > 10) err('meta.world', 'integer 1–10');
    if (typeof meta.biome !== 'string' || !BIOMES.includes(meta.biome))
      err('meta.biome', `one of ${BIOMES.join(', ')}`);
  }

  const grid = doc.grid;
  if (!isObject(grid)) err('grid', 'required object');
  else {
    if (!isInt(grid.width) || grid.width < 6 || grid.width > 32) err('grid.width', 'integer 6–32');
    if (!isInt(grid.height) || grid.height < 6 || grid.height > 32) err('grid.height', 'integer 6–32');
  }

  if (!Array.isArray(doc.terrain)) err('terrain', 'required array');
  if (!isInt(doc.countdownTicks) || doc.countdownTicks < 300 || doc.countdownTicks > 1800)
    err('countdownTicks', 'integer 300–1800');
  if (typeof doc.speedBetAllowed !== 'boolean') err('speedBetAllowed', 'required boolean');

  if (!Array.isArray(doc.trains) || doc.trains.length < 1 || doc.trains.length > 4)
    err('trains', '1–4 trains required');
  else
    doc.trains.forEach((t, i) => {
      if (!isObject(t)) {
        err(`trains[${i}]`, 'must be an object');
        return;
      }
      if (typeof t.id !== 'string') err(`trains[${i}].id`, 'required string');
      if (typeof t.model !== 'string') err(`trains[${i}].model`, 'required string');
      if (!isInt(t.carriageCount) || t.carriageCount < 1 || t.carriageCount > 4)
        err(`trains[${i}].carriageCount`, 'integer 1–4');
      if (typeof t.spawnStationId !== 'string') err(`trains[${i}].spawnStationId`, 'required string');
    });

  if (!Array.isArray(doc.stations) || doc.stations.length < 2 || doc.stations.length > 8)
    err('stations', '2–8 stations required');
  else
    doc.stations.forEach((s, i) => {
      if (!isObject(s)) {
        err(`stations[${i}]`, 'must be an object');
        return;
      }
      if (typeof s.id !== 'string') err(`stations[${i}].id`, 'required string');
      if (!isCell(s.cell)) err(`stations[${i}].cell`, 'requires integer x/z ≥ 0');
      if (s.orientation !== 'NS' && s.orientation !== 'EW')
        err(`stations[${i}].orientation`, 'must be "NS" or "EW"');
    });

  if (!Array.isArray(doc.passengers) || doc.passengers.length < 1 || doc.passengers.length > 16)
    err('passengers', '1–16 passengers required');
  else
    doc.passengers.forEach((p, i) => {
      if (!isObject(p)) {
        err(`passengers[${i}]`, 'must be an object');
        return;
      }
      if (typeof p.id !== 'string') err(`passengers[${i}].id`, 'required string');
      if (typeof p.persona !== 'string' || !PERSONAS.includes(p.persona))
        err(`passengers[${i}].persona`, `one of ${PERSONAS.join(', ')}`);
      if (typeof p.from !== 'string') err(`passengers[${i}].from`, 'required station id');
      if (typeof p.to !== 'string') err(`passengers[${i}].to`, 'required station id');
    });

  if (!Array.isArray(doc.pieceTray)) err('pieceTray', 'required array');
  else
    doc.pieceTray.forEach((t, i) => {
      if (!isObject(t)) {
        err(`pieceTray[${i}]`, 'must be an object');
        return;
      }
      if (!PIECE_TYPES.includes(t.piece as PieceType)) err(`pieceTray[${i}].piece`, 'unknown piece type');
      if (!isInt(t.count) || t.count < 0 || t.count > 99) err(`pieceTray[${i}].count`, 'integer 0–99');
    });

  const stars = doc.stars;
  if (!isObject(stars)) err('stars', 'required object');
  else {
    if (!isInt(stars.pieceBudget) || stars.pieceBudget < 1) err('stars.pieceBudget', 'integer ≥ 1');
    if (!isInt(stars.timeTargetTicks) || stars.timeTargetTicks < 60)
      err('stars.timeTargetTicks', 'integer ≥ 60');
  }

  const payoff = doc.payoff;
  if (!isObject(payoff)) err('payoff', 'required object');
  else {
    if (typeof payoff.type !== 'string' || !PAYOFFS.includes(payoff.type))
      err('payoff.type', `one of ${PAYOFFS.join(', ')}`);
    if (typeof payoff.focusStationId !== 'string') err('payoff.focusStationId', 'required station id');
  }

  const ref = doc.referenceSolution;
  if (!isObject(ref)) err('referenceSolution', 'required object');
  else {
    if (!isInt(ref.seed)) err('referenceSolution.seed', 'required integer');
    if (!['steady', 'swift', 'ludicrous'].includes(ref.speedBet as string))
      err('referenceSolution.speedBet', 'steady | swift | ludicrous');
    if (!isInt(ref.dispatchTick) || ref.dispatchTick < 0)
      err('referenceSolution.dispatchTick', 'integer ≥ 0');
    if (!Array.isArray(ref.placements) || ref.placements.length < 1)
      err('referenceSolution.placements', 'at least one placement');
    else
      ref.placements.forEach((p, i) => {
        if (!isObject(p)) {
          err(`referenceSolution.placements[${i}]`, 'must be an object');
          return;
        }
        if (!PIECE_TYPES.includes(p.piece as PieceType))
          err(`referenceSolution.placements[${i}].piece`, 'unknown piece type');
        if (!isCell(p.cell)) err(`referenceSolution.placements[${i}].cell`, 'requires integer x/z ≥ 0');
        if (![0, 1, 2, 3].includes(p.rotation as number))
          err(`referenceSolution.placements[${i}].rotation`, 'must be 0–3');
      });
  }

  return errors.length === before;
}

/** V2 — every referenced cell lies inside the grid. */
function checkBounds(s: Scenario, errors: VError[]): void {
  const inside = (c: { x: number; z: number }) =>
    c.x >= 0 && c.z >= 0 && c.x < s.grid.width && c.z < s.grid.height;
  const check = (c: { x: number; z: number }, path: string) => {
    if (!inside(c)) errors.push({ rule: 'V2', path, message: `cell (${c.x},${c.z}) is outside the map` });
  };
  s.terrain.forEach((t, i) => check(t, `terrain[${i}]`));
  s.stations.forEach((st, i) => check(st.cell, `stations[${i}].cell`));
  (s.prePlaced ?? []).forEach((p, i) => check(p.cell, `prePlaced[${i}].cell`));
  s.referenceSolution.placements.forEach((p, i) => check(p.cell, `referenceSolution.placements[${i}].cell`));
  (s.hazards ?? []).forEach((h, i) => {
    if ('cell' in h) check(h.cell, `hazards[${i}].cell`);
  });
}

/** V3 — station cells are distinct and buildable; referenced station ids exist. */
function checkStations(s: Scenario, errors: VError[]): void {
  const seenCells = new Set<string>();
  const ids = new Set<string>();
  const blocked = new Map<string, string>();
  for (const t of s.terrain) {
    if (t.feature === 'water' || t.feature === 'rock') blocked.set(`${t.x},${t.z}`, t.feature);
  }

  s.stations.forEach((st, i) => {
    const key = `${st.cell.x},${st.cell.z}`;
    if (seenCells.has(key))
      errors.push({ rule: 'V3', path: `stations[${i}].cell`, message: 'two stations share a cell' });
    seenCells.add(key);
    if (ids.has(st.id))
      errors.push({ rule: 'V3', path: `stations[${i}].id`, message: `duplicate station id "${st.id}"` });
    ids.add(st.id);
    const feature = blocked.get(key);
    if (feature)
      errors.push({
        rule: 'V3',
        path: `stations[${i}].cell`,
        message: `station "${st.id}" sits on ${feature}`,
      });
  });

  if (!ids.has(s.payoff.focusStationId))
    errors.push({
      rule: 'V3',
      path: 'payoff.focusStationId',
      message: `no station "${s.payoff.focusStationId}"`,
    });
  s.trains.forEach((t, i) => {
    if (!ids.has(t.spawnStationId))
      errors.push({
        rule: 'V3',
        path: `trains[${i}].spawnStationId`,
        message: `no station "${t.spawnStationId}"`,
      });
  });
  (s.hazards ?? []).forEach((h, i) => {
    if (h.kind === 'brokenPiece' && !ids.has(h.repairStationId))
      errors.push({
        rule: 'V3',
        path: `hazards[${i}].repairStationId`,
        message: `no station "${h.repairStationId}"`,
      });
  });
}

/** V4 — passenger/train ids are unique, routes reference real stations, hazards index prePlaced. */
function checkReferences(s: Scenario, errors: VError[]): void {
  const stationIds = new Set(s.stations.map((st) => st.id));
  const passengerIds = new Set<string>();
  s.passengers.forEach((p, i) => {
    if (passengerIds.has(p.id))
      errors.push({ rule: 'V4', path: `passengers[${i}].id`, message: `duplicate passenger id "${p.id}"` });
    passengerIds.add(p.id);
    if (!stationIds.has(p.from))
      errors.push({ rule: 'V4', path: `passengers[${i}].from`, message: `no station "${p.from}"` });
    if (!stationIds.has(p.to))
      errors.push({ rule: 'V4', path: `passengers[${i}].to`, message: `no station "${p.to}"` });
    if (p.from === p.to)
      errors.push({ rule: 'V4', path: `passengers[${i}]`, message: 'origin and destination are the same' });
  });

  const trainIds = new Set<string>();
  s.trains.forEach((t, i) => {
    if (trainIds.has(t.id))
      errors.push({ rule: 'V4', path: `trains[${i}].id`, message: `duplicate train id "${t.id}"` });
    trainIds.add(t.id);
  });

  const prePlacedCount = (s.prePlaced ?? []).length;
  (s.hazards ?? []).forEach((h, i) => {
    if (h.kind === 'brokenPiece' && (h.placementIndex < 0 || h.placementIndex >= prePlacedCount))
      errors.push({
        rule: 'V4',
        path: `hazards[${i}].placementIndex`,
        message: 'does not index a prePlaced piece',
      });
  });
}

/** V5 — the tray can actually build the reference solution, and the budget covers it. */
function checkTrayCoversSolution(s: Scenario, errors: VError[]): void {
  const tray = new Map<string, number>();
  for (const t of s.pieceTray) tray.set(t.piece, (tray.get(t.piece) ?? 0) + t.count);

  const used = new Map<string, number>();
  for (const p of s.referenceSolution.placements) used.set(p.piece, (used.get(p.piece) ?? 0) + 1);

  for (const [piece, count] of used) {
    const available = tray.get(piece) ?? 0;
    if (available < count)
      errors.push({
        rule: 'V5',
        path: 'pieceTray',
        message: `the winning run uses ${count} × ${piece}, but the tray offers ${available}`,
      });
  }

  if (s.referenceSolution.placements.length > s.stars.pieceBudget)
    errors.push({
      rule: 'V5',
      path: 'stars.pieceBudget',
      message: `budget ${s.stars.pieceBudget} is below the reference solution's ${s.referenceSolution.placements.length} pieces`,
    });
}

/** V7 — id format and a schema version this build understands. */
function checkIdentity(s: Scenario, errors: VError[]): void {
  if (!ID_PATTERN.test(s.id))
    errors.push({ rule: 'V7', path: 'id', message: 'ids are lowercase letters, digits and dashes (3–64)' });
  const major = Number(String(s.schemaVersion).split('.')[0]);
  if (!SUPPORTED_SCHEMA_MAJORS.includes(major))
    errors.push({
      rule: 'V7',
      path: 'schemaVersion',
      message: 'this level was made with a newer version of the game',
    });
}

/**
 * Static validation (V1–V5, V7). V6 — the reference solution must replay to 3 stars — needs the
 * simulation and is applied by the content gate / editor publish step.
 */
export function validateScenario(doc: unknown): ValidationResult {
  const errors: VError[] = [];

  // Version first: a level from a newer build should say so plainly rather than drown the
  // player in structural errors for fields this version has never heard of (docs/40 V7).
  if (isObject(doc) && typeof doc.schemaVersion === 'string') {
    const major = Number(doc.schemaVersion.split('.')[0]);
    if (!Number.isNaN(major) && !SUPPORTED_SCHEMA_MAJORS.includes(major)) {
      return {
        ok: false,
        errors: [
          {
            rule: 'V7',
            path: 'schemaVersion',
            message: 'this level was made with a newer version of the game',
          },
        ],
      };
    }
  }

  if (!checkStructure(doc, errors)) return { ok: false, errors };

  const scenario = doc as Scenario;
  checkBounds(scenario, errors);
  checkStations(scenario, errors);
  checkReferences(scenario, errors);
  checkTrayCoversSolution(scenario, errors);
  checkIdentity(scenario, errors);

  return errors.length === 0 ? { ok: true, scenario } : { ok: false, errors };
}
