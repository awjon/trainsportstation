# 40 — Scenario Schema & Data Formats

Doc version: 1.0.0 · `schemaVersion: "1.0"` · **Highest-precedence doc** (00 §3)

This is the normative contract for scenarios (campaign *and* community), replays, save data,
and the share file. `validateScenario()` and its tests are written directly from §5.
Everything here lives in the headless zone (30 §2.1).

---

## 1. Field specification

A scenario is one JSON document. Unknown fields MUST be preserved on read/write
(forward compatibility) and ignored by the runtime.

| Field | Type | Req | Meaning / constraints |
|---|---|---|---|
| `schemaVersion` | string | ✔ | `"1.0"`. Major bump = breaking (§8). |
| `id` | string | ✔ | kebab-case `[a-z0-9-]{3,64}`, globally unique among installed scenarios. Campaign: `w1-s1`…; community: author-prefixed, e.g. `jon-canyon-chaos`. |
| `meta.name` | string | ✔ | ≤ 48 chars, player-facing. |
| `meta.author` | string | ✔ | ≤ 32 chars. `"guild"` for campaign stages. |
| `meta.world` | int | ✔ | 1–10. Community scenarios use it for the mechanic/piece palette hint. |
| `meta.biome` | string | ✔ | one of the 10 biome ids in 20 §1. Drives tint + props only. |
| `meta.description` | string | – | ≤ 200 chars, shown on stage card. |
| `grid.width`, `grid.height` | int | ✔ | 6–32 each. |
| `terrain` | Cell[] | ✔ | sparse list; unlisted cells are `height 0`, no feature. Cell: `{x, z, height?, feature?}`, feature ∈ `water\|rock\|forest\|town`. |
| `countdownTicks` | int | ✔ | 300–1800 (5–30 s). Campaign norm 600–900; countdown is a **maximum** — early dispatch always allowed. |
| `speedBetAllowed` | bool | ✔ | `false` locks bet to `steady` (used in tutorial stages). |
| `trains` | Train[] | ✔ | 1–4. Train: `{id, model, carriageCount (1–4), spawnStationId, dispatchOrder?}`. `model` = AssetId from 60 §4. Trains dispatch simultaneously unless `dispatchOrder` staggers them (value = delay ticks after dispatch). |
| `stations` | Station[] | ✔ | 2–8. Station: `{id, cell, orientation: 'NS'\|'EW', optional?: bool, name?}`. `optional: true` = bonus station (scoring 30 §8), not required for star 1. |
| `passengers` | Passenger[] | ✔ | 1–16. `{id, persona, from, to, required?: bool (default true), timeLimitTicks?}`. `persona` = id from 20 §3; `from`/`to` = station ids; `timeLimitTicks` only meaningful for `doctor`. |
| `pieceTray` | TrayEntry[] | ✔ | `{piece: PieceType, count: int ≥ 0}`. Pieces absent from the tray cannot be placed. Tray ⊆ world's unlocked palette for campaign (20 §1). |
| `prePlaced` | PrePlaced[] | – | fixed track: `Placement & {locked: true, broken?: bool}`. `broken` pieces need an Engineer delivery (30 §7.5). |
| `hazards` | Hazard[] | – | see §1.1. |
| `objectives` | Objective[] | – | extra flavor goals shown in UI, never required for stars: `{id, kind: 'serveOptionalStation'\|'noCrash'\|'underBudget', text}`. Scoring already counts these as Connection bonuses; this array only controls display. |
| `stars.pieceBudget` | int | ✔ | star-2 threshold (placed pieces ≤ budget). |
| `stars.timeTargetTicks` | int | ✔ | star-3 threshold (last required delivery tick ≤ target). |
| `payoff` | Payoff | ✔ | `{type: 'lightsOn'\|'bridgeRebuild'\|'festivalStart'\|'beaconLit'\|'reunionScene', focusStationId, jingle?: AssetId}`. Semantics in 10 §6. |
| `hints` | Hint[] | – | ghost-track hints: `{afterFailures: int, placements: Placement[]}` — shown as translucent ghosts after N failed attempts. Campaign W1 only by convention. |
| `referenceSolution` | RefSolution | ✔ | `{seed: int, speedBet, dispatchTick, placements: Placement[], switchInputs?: {tick, placementIndex, state}[]}`. Must satisfy V5/V6. |

### 1.1 Hazards

| kind | Fields | Behavior (sim, deterministic) |
|---|---|---|
| `rockfall` | `cell, fromTick, toTick` | cell blocked in window; entering → crash `hazard`. Telegraphed 120 ticks ahead (render). |
| `crossingTraffic` | `cell, periodTicks, openTicks` | level-crossing cell cycles blocked/open from tick 0. |
| `brokenPiece` | `placementIndex, repairStationId` | pre-placed piece unusable until Engineer `Delivered` at that station. |

## 2. Example A — minimal (tutorial stage W1-S1)

```json
{
  "schemaVersion": "1.0",
  "id": "w1-s1",
  "meta": { "name": "First Light", "author": "guild", "world": 1, "biome": "meadow",
            "description": "Bring the morning commuters home to Bellbrook." },
  "grid": { "width": 8, "height": 6 },
  "terrain": [],
  "countdownTicks": 900,
  "speedBetAllowed": false,
  "trains": [ { "id": "t1", "model": "train-locomotive-a", "carriageCount": 1, "spawnStationId": "depot" } ],
  "stations": [
    { "id": "depot", "cell": { "x": 1, "z": 3 }, "orientation": "EW", "name": "Guild Depot" },
    { "id": "bellbrook", "cell": { "x": 6, "z": 3 }, "orientation": "EW", "name": "Bellbrook" }
  ],
  "passengers": [ { "id": "p1", "persona": "commuter", "from": "depot", "to": "bellbrook" } ],
  "pieceTray": [ { "piece": "straight", "count": 6 } ],
  "stars": { "pieceBudget": 4, "timeTargetTicks": 1500 },
  "payoff": { "type": "lightsOn", "focusStationId": "bellbrook" },
  "hints": [ { "afterFailures": 2, "placements": [
    { "piece": "straight", "cell": { "x": 2, "z": 3 }, "rotation": 1 },
    { "piece": "straight", "cell": { "x": 3, "z": 3 }, "rotation": 1 },
    { "piece": "straight", "cell": { "x": 4, "z": 3 }, "rotation": 1 },
    { "piece": "straight", "cell": { "x": 5, "z": 3 }, "rotation": 1 } ] } ],
  "referenceSolution": { "seed": 1, "speedBet": "steady", "dispatchTick": 300,
    "placements": [
      { "piece": "straight", "cell": { "x": 2, "z": 3 }, "rotation": 1 },
      { "piece": "straight", "cell": { "x": 3, "z": 3 }, "rotation": 1 },
      { "piece": "straight", "cell": { "x": 4, "z": 3 }, "rotation": 1 },
      { "piece": "straight", "cell": { "x": 5, "z": 3 }, "rotation": 1 } ] }
}
```

4 placements ≤ pieceBudget 4 → star 2 reachable; straight-line run finishes well under
1500 ticks → star 3 reachable; V6 holds.

## 3. Example B — maximal (W3-S7, exercises every field)

```json
{
  "schemaVersion": "1.0",
  "id": "w3-s7",
  "meta": { "name": "Twin Rivers Relay", "author": "guild", "world": 3, "biome": "rivers",
            "description": "Two trains, one bridge, and a doctor who cannot be late." },
  "grid": { "width": 14, "height": 10 },
  "terrain": [
    { "x": 6, "z": 0, "feature": "water" }, { "x": 6, "z": 1, "feature": "water" },
    { "x": 6, "z": 2, "feature": "water" }, { "x": 6, "z": 3, "feature": "water" },
    { "x": 6, "z": 4, "feature": "water" }, { "x": 6, "z": 5, "feature": "water" },
    { "x": 6, "z": 6, "feature": "water" }, { "x": 6, "z": 7, "feature": "water" },
    { "x": 6, "z": 8, "feature": "water" }, { "x": 6, "z": 9, "feature": "water" },
    { "x": 10, "z": 2, "height": 1 }, { "x": 2, "z": 7, "feature": "town" }
  ],
  "countdownTicks": 720,
  "speedBetAllowed": true,
  "trains": [
    { "id": "west", "model": "train-locomotive-passenger-a", "carriageCount": 2, "spawnStationId": "harrowgate" },
    { "id": "east", "model": "train-diesel-a", "carriageCount": 2, "spawnStationId": "eastbank", "dispatchOrder": 120 }
  ],
  "stations": [
    { "id": "harrowgate", "cell": { "x": 2, "z": 2 }, "orientation": "EW", "name": "Harrowgate" },
    { "id": "eastbank",  "cell": { "x": 11, "z": 7 }, "orientation": "EW", "name": "Eastbank" },
    { "id": "clinic",    "cell": { "x": 11, "z": 2 }, "orientation": "EW", "name": "Riverside Clinic" },
    { "id": "old-mill",  "cell": { "x": 2, "z": 8 }, "orientation": "EW", "optional": true, "name": "Old Mill" }
  ],
  "passengers": [
    { "id": "doc1", "persona": "doctor", "from": "harrowgate", "to": "clinic", "timeLimitTicks": 2400 },
    { "id": "eng1", "persona": "engineer", "from": "eastbank", "to": "harrowgate" },
    { "id": "kid1", "persona": "kid", "from": "eastbank", "to": "harrowgate" },
    { "id": "mus1", "persona": "musician", "from": "harrowgate", "to": "old-mill", "required": false }
  ],
  "pieceTray": [
    { "piece": "straight", "count": 14 }, { "piece": "curve-small", "count": 8 },
    { "piece": "bridge", "count": 3 }, { "piece": "ramp", "count": 2 },
    { "piece": "junction", "count": 2 }, { "piece": "crossing", "count": 1 }
  ],
  "prePlaced": [
    { "piece": "straight", "cell": { "x": 10, "z": 2 }, "rotation": 1, "locked": true, "broken": true }
  ],
  "hazards": [
    { "kind": "brokenPiece", "placementIndex": 0, "repairStationId": "harrowgate" },
    { "kind": "crossingTraffic", "cell": { "x": 4, "z": 5 }, "periodTicks": 480, "openTicks": 300 }
  ],
  "objectives": [
    { "id": "o1", "kind": "serveOptionalStation", "text": "Bring music back to Old Mill" },
    { "id": "o2", "kind": "noCrash", "text": "A gentle day on the rails" }
  ],
  "stars": { "pieceBudget": 22, "timeTargetTicks": 3300 },
  "payoff": { "type": "bridgeRebuild", "focusStationId": "clinic" },
  "referenceSolution": {
    "seed": 7, "speedBet": "swift", "dispatchTick": 600,
    "placements": [ { "piece": "straight", "cell": { "x": 3, "z": 2 }, "rotation": 1 } ],
    "switchInputs": [ { "tick": 1400, "placementIndex": 4, "state": 1 } ]
  }
}
```

*(Example B's `referenceSolution.placements` is abbreviated here for readability; the shipped
file must contain the full winning placement list — V5/V6 enforce this mechanically.)*

## 4. JSON Schema (draft 2020-12, normative)

Stored as `src/scenarios/scenario.schema.json`; `validateScenario()` = this schema (V1) plus
the semantic rules V2–V7.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://trainsportstation.dev/scenario.schema.json",
  "type": "object",
  "required": ["schemaVersion", "id", "meta", "grid", "terrain", "countdownTicks",
               "speedBetAllowed", "trains", "stations", "passengers", "pieceTray",
               "stars", "payoff", "referenceSolution"],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{2,63}$" },
    "meta": { "type": "object",
      "required": ["name", "author", "world", "biome"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 48 },
        "author": { "type": "string", "minLength": 1, "maxLength": 32 },
        "world": { "type": "integer", "minimum": 1, "maximum": 10 },
        "biome": { "enum": ["meadow", "highland", "rivers", "mesa", "frostfield",
                             "coast", "hollow", "skyline", "cloudpeak", "last-junction"] },
        "description": { "type": "string", "maxLength": 200 } } },
    "grid": { "type": "object", "required": ["width", "height"],
      "properties": { "width": { "type": "integer", "minimum": 6, "maximum": 32 },
                      "height": { "type": "integer", "minimum": 6, "maximum": 32 } } },
    "terrain": { "type": "array", "items": { "type": "object", "required": ["x", "z"],
      "properties": { "x": { "type": "integer", "minimum": 0 },
                      "z": { "type": "integer", "minimum": 0 },
                      "height": { "enum": [0, 1, 2] },
                      "feature": { "enum": ["water", "rock", "forest", "town"] } } } },
    "countdownTicks": { "type": "integer", "minimum": 300, "maximum": 1800 },
    "speedBetAllowed": { "type": "boolean" },
    "trains": { "type": "array", "minItems": 1, "maxItems": 4,
      "items": { "type": "object", "required": ["id", "model", "carriageCount", "spawnStationId"],
        "properties": { "id": { "type": "string" }, "model": { "type": "string" },
          "carriageCount": { "type": "integer", "minimum": 1, "maximum": 4 },
          "spawnStationId": { "type": "string" },
          "dispatchOrder": { "type": "integer", "minimum": 0 } } } },
    "stations": { "type": "array", "minItems": 2, "maxItems": 8,
      "items": { "type": "object", "required": ["id", "cell", "orientation"],
        "properties": { "id": { "type": "string" },
          "cell": { "$ref": "#/$defs/cell" },
          "orientation": { "enum": ["NS", "EW"] },
          "optional": { "type": "boolean" }, "name": { "type": "string", "maxLength": 32 } } } },
    "passengers": { "type": "array", "minItems": 1, "maxItems": 16,
      "items": { "type": "object", "required": ["id", "persona", "from", "to"],
        "properties": { "id": { "type": "string" },
          "persona": { "enum": ["commuter", "kid", "elder", "musician", "doctor", "engineer"] },
          "from": { "type": "string" }, "to": { "type": "string" },
          "required": { "type": "boolean" },
          "timeLimitTicks": { "type": "integer", "minimum": 60 } } } },
    "pieceTray": { "type": "array",
      "items": { "type": "object", "required": ["piece", "count"],
        "properties": { "piece": { "$ref": "#/$defs/pieceType" },
                        "count": { "type": "integer", "minimum": 0, "maximum": 99 } } } },
    "prePlaced": { "type": "array", "items": { "allOf": [ { "$ref": "#/$defs/placement" } ],
      "properties": { "locked": { "const": true }, "broken": { "type": "boolean" } },
      "required": ["locked"] } },
    "hazards": { "type": "array", "items": { "type": "object", "required": ["kind"],
      "oneOf": [
        { "properties": { "kind": { "const": "rockfall" }, "cell": { "$ref": "#/$defs/cell" },
            "fromTick": { "type": "integer" }, "toTick": { "type": "integer" } },
          "required": ["kind", "cell", "fromTick", "toTick"] },
        { "properties": { "kind": { "const": "crossingTraffic" }, "cell": { "$ref": "#/$defs/cell" },
            "periodTicks": { "type": "integer", "minimum": 60 },
            "openTicks": { "type": "integer", "minimum": 60 } },
          "required": ["kind", "cell", "periodTicks", "openTicks"] },
        { "properties": { "kind": { "const": "brokenPiece" },
            "placementIndex": { "type": "integer", "minimum": 0 },
            "repairStationId": { "type": "string" } },
          "required": ["kind", "placementIndex", "repairStationId"] } ] } },
    "objectives": { "type": "array", "items": { "type": "object",
      "required": ["id", "kind", "text"],
      "properties": { "id": { "type": "string" },
        "kind": { "enum": ["serveOptionalStation", "noCrash", "underBudget"] },
        "text": { "type": "string", "maxLength": 80 } } } },
    "stars": { "type": "object", "required": ["pieceBudget", "timeTargetTicks"],
      "properties": { "pieceBudget": { "type": "integer", "minimum": 1 },
                      "timeTargetTicks": { "type": "integer", "minimum": 60 } } },
    "payoff": { "type": "object", "required": ["type", "focusStationId"],
      "properties": { "type": { "enum": ["lightsOn", "bridgeRebuild", "festivalStart",
                                          "beaconLit", "reunionScene"] },
        "focusStationId": { "type": "string" }, "jingle": { "type": "string" } } },
    "hints": { "type": "array", "items": { "type": "object",
      "required": ["afterFailures", "placements"],
      "properties": { "afterFailures": { "type": "integer", "minimum": 1 },
        "placements": { "type": "array", "items": { "$ref": "#/$defs/placement" } } } } },
    "referenceSolution": { "type": "object",
      "required": ["seed", "speedBet", "dispatchTick", "placements"],
      "properties": { "seed": { "type": "integer" },
        "speedBet": { "enum": ["steady", "swift", "ludicrous"] },
        "dispatchTick": { "type": "integer", "minimum": 0 },
        "placements": { "type": "array", "minItems": 1,
                        "items": { "$ref": "#/$defs/placement" } },
        "switchInputs": { "type": "array", "items": { "type": "object",
          "required": ["tick", "placementIndex", "state"],
          "properties": { "tick": { "type": "integer", "minimum": 0 },
            "placementIndex": { "type": "integer", "minimum": 0 },
            "state": { "enum": [0, 1] } } } } } }
  },
  "$defs": {
    "cell": { "type": "object", "required": ["x", "z"],
      "properties": { "x": { "type": "integer", "minimum": 0, "maximum": 31 },
                      "z": { "type": "integer", "minimum": 0, "maximum": 31 } } },
    "pieceType": { "enum": ["straight", "curve-small", "curve-large",
                             "s-bend", "s-bend-left", "skew", "skew-left",
                             "ramp", "curve-small-ramp", "curve-large-ramp", "hill",
                             "bump", "bridge", "tunnel", "junction", "crossing"] },
    "placement": { "type": "object", "required": ["piece", "cell", "rotation"],
      "properties": { "piece": { "$ref": "#/$defs/pieceType" },
        "cell": { "$ref": "#/$defs/cell" }, "rotation": { "enum": [0, 1, 2, 3] } } }
  }
}
```

## 5. Validation rules (normative, numbered — tests are written from this list)

`validateScenario(json): { ok: true, scenario: Scenario } | { ok: false, errors: VError[] }`
runs V1–V5 and V7 statically; V6 requires the headless sim.

- **V1** Document validates against the JSON Schema in §4.
- **V2** Every cell referenced anywhere (terrain, stations, prePlaced, hazards, hints,
  referenceSolution) lies within `grid`.
- **V3** Station cells are pairwise distinct and not on `water`/`rock` terrain; station ids
  unique; `payoff.focusStationId`, every `spawnStationId`, every hazard `repairStationId`
  exists.
- **V4** Every passenger's `from`/`to` name existing stations and `from ≠ to`; passenger and
  train ids unique; `hazards[].placementIndex` indexes into `prePlaced`.
- **V5** For each piece type, `pieceTray` count ≥ uses in `referenceSolution.placements`
  (the reference solution must be buildable from the tray).
- **V6** Replaying the `referenceSolution` headlessly (`runHeadless`, 30 §4) yields
  `stars === 3`. This proves solvability *and* that both `pieceBudget` and `timeTargetTicks`
  are achievable. **Every scenario shipped or published must pass V6 in CI / at editor
  publish time.**
- **V7** `id` matches the pattern, is unique among installed scenarios at import time, and
  `schemaVersion` is supported by this build (else a friendly "made with a newer version"
  error).

Fairness rule for campaign content (20 §6): `timeTargetTicks ≥ referenceRunTicks × 1.15`.
The editor enforces `authorTime × 1.25` as the default for community levels (50 §5).

## 6. Replay format

```json
{ "formatVersion": "1.0", "scenarioId": "w3-s7", "schemaVersion": "1.0", "seed": 7,
  "inputs": [
    { "tick": 0,   "type": "placePiece",  "placement": { "piece": "straight", "cell": {"x":3,"z":2}, "rotation": 1 } },
    { "tick": 240, "type": "removePiece", "placementIndex": 3 },
    { "tick": 600, "type": "setSpeedBet", "bet": "swift" },
    { "tick": 600, "type": "dispatch" },
    { "tick": 1400, "type": "flipSwitch", "placementIndex": 4, "state": 1 } ] }
```

Inputs only (root architecture decision). `InputEvent` union in `simulation/inputs.ts` mirrors
this exactly. A `referenceSolution` is sugar for a replay (placements at tick 0..n, one
`setSpeedBet` + `dispatch` at `dispatchTick`, plus `switchInputs`); the editor records real
replays and converts on publish.

## 7. Save data

Shape in 30 §11 is normative. Rules: `saveVersion` int, bumped on any breaking change;
`app/save.ts` keeps pure migration functions `migrateV1toV2(old): SaveData` chained at load;
unknown keys preserved; a corrupt save is renamed `*.corrupt.<timestamp>` (never silently
deleted) and a fresh save started.

## 8. Share format — `.trainstation.json`

A community level is **one self-contained file**: exactly the scenario document of §1 (the
embedded `referenceSolution` is the proof of solvability). Conventions:

- Suggested filename `<id>.trainstation.json`; MIME `application/json`.
- Max size 256 KB (import rejects larger).
- Import pipeline: parse → V1–V7 (V6 via headless sim, with a 10-second wall-clock cap →
  reject as "unverifiable") → store under `trainsportstation.community.<id>` → appears on the
  Community shelf (50 §6). Duplicate id: prompt replace/keep-both (keep-both suffixes `-2`).
- Export = pretty-printed JSON via file download *and* copy-to-clipboard.
- Unknown fields round-trip untouched (§1).

## 9. Versioning policy

`schemaVersion` is `major.minor`. **Additive** optional fields → minor bump; readers accept
any same-major version. **Breaking** (rename/remove/semantic change) → major bump + a
migration note appended to this doc + loader-side migration if feasible. The runtime declares
`SUPPORTED_SCHEMA_MAJORS = [1]`. Never reuse a scenario `id` for different content.
