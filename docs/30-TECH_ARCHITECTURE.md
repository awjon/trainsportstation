# 30 — Technical Architecture

Doc version: 1.0.0 · Supersedes root `ARCHITECTURE.md` · Normative for all code under `src/`

This document defines the stack, module layout, canonical TypeScript interfaces, determinism
contract, track/train/physics models, rendering, UI, save system, and mobile requirements.
Worker tasks in [70-IMPLEMENTATION_PLAN.md](70-IMPLEMENTATION_PLAN.md) cite sections of this doc
as their contract. Terms in *italics* are defined in the glossary of
[00-OVERVIEW.md](00-OVERVIEW.md).

---

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict: true` | No `any` except in third-party shims. |
| Renderer | Three.js (pin latest stable major at M0; record the pin here) | Only renderer-side modules may import it (§3). |
| Bundler/dev server | Vite | Single-page app, static hosting output. |
| Tests | Vitest | Unit + headless simulation tests; runs in Node without WebGL. |
| Lint/format | ESLint + Prettier | Config written at M0; CI-enforced. |
| UI | Plain DOM/CSS overlay | **No UI framework.** Keeps dependency surface minimal per CLAUDE.md stop rules. |

The complete dependency list for v1 is: `three`, `vite`, `typescript`, `vitest`, `eslint`,
`prettier` (+ their required plugins). **Adding anything else triggers the CLAUDE.md stop rule**
(halt, ask the human).

Canonical commands (must exist in `package.json` from M0 onward):
`npm run dev`, `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`.

## 2. Project layout

```
src/
  core/         # math, seeded PRNG, fixed-timestep driver, event bus, hashing. Zero imports.
  simulation/   # HEADLESS game core: sim state, tick function, scoring, replay. No three.js.
  track/        # HEADLESS piece definitions, placement validation, track graph, splines/LUTs.
  train/        # HEADLESS train movement, arcade physics, crash detection.
  data/         # Static data as typed JSON: pieces.json, physics.json, personas.json,
                #   worldmap.json, biomes.json + TS loaders/validators.
  scenarios/    # Shipped scenario JSON files (see 40-SCENARIO_SCHEMA.md) + validateScenario().
  core/curves + render/meshgen/   # Procedural asset generation (see 60-ASSET_PIPELINE.md).
  render/       # Three.js scene, procedural meshgen, instancing, biome tinting, payoff sequences.
  camera/       # Orbit rig, framing, payoff dolly moves.
  effects/      # Particles, confetti, crash gags (render-only, may be non-deterministic).
  audio/        # WebAudio wrapper, event→sfx mapping table.
  ui/           # DOM overlay: HUD, countdown, tray, results, world map, menus.
  editor/       # Editor modes and panels; reuses track/, simulation/, render/ (see 50-EDITOR_SPEC.md).
  app/          # Bootstrap, screen state machine, save system, input abstraction.
```

### 2.1 Import-direction rule (normative)

```
core  ←  (everything may import core)
simulation, track, train, data, scenarios   →  may import: core, each other. MUST NOT import:
                                               three.js, render/, camera/, effects/, audio/, ui/, DOM APIs.
render, camera, effects, audio, ui, editor, app  →  may import anything above.
```

An ESLint `no-restricted-imports` rule enforces this. The headless zone
(`core/ simulation/ track/ train/ data/ scenarios/`) is what makes every gameplay rule testable
in CI without a GPU — this rule is load-bearing for the whole implementation plan.

## 3. Determinism contract (normative)

1. **Fixed timestep.** The simulation advances in integer *ticks* at exactly `60 ticks/second`
   of sim time. `TICK_DT = 1/60` (seconds) is the only dt ever used in sim math.
2. **Render decoupling.** The render loop runs at display rate and interpolates entity
   transforms between the last two sim states. Rendering never advances sim state.
3. **Seeded randomness only.** `core/rng.ts` exports `mulberry32(seed: number): () => number`.
   Anything random in the headless zone draws from a PRNG instance owned by `SimState`.
   Forbidden inside the headless zone: `Math.random`, `Date.now`, `performance.now`,
   `crypto.getRandomValues`, and iteration order of `Set`/`Map` feeding stateful math
   (sort keys first).
4. **State hash.** `simulation/hash.ts` exports `stateHash(state: SimState): string` — a
   canonical serialization (sorted keys, numbers via `toFixed(9)`) piped through FNV-1a.
   Used by replay verification and CI determinism tests.
5. **Replay.** A *replay* is `{ scenarioId, schemaVersion, seed, inputs: InputEvent[] }`
   (inputs only — format in 40 §6). Playing a replay = constructing the sim from the scenario
   + seed and applying each input at its recorded tick. Identical replays must produce
   identical `stateHash` at every tick on the same build.
6. **Speed bet does not change tick rate.** Ludicrous multiplies train target speed, never
   `TICK_DT` — sim-time and star timing stay comparable across bets.

**Testable invariant D-1:** running any scenario's reference solution twice for N ticks yields
identical `stateHash(state)` at ticks {1, 60, 600, N}.
**Testable invariant D-2:** no file in the headless zone matches
`/Math\.random|Date\.now|performance\.now/` (lint rule + grep test).

## 4. Canonical types

These are the shared interfaces the CLAUDE.md "Reused Interfaces" contract points at.
Workers implement against these signatures; changing them mid-build triggers the
shared-interface stop rule. (Field lists may grow additively; renames/removals may not.)

```ts
// core/types.ts
export type Tick = number;                       // integer ≥ 0
export type HeightLevel = 0 | 1 | 2;             // track elevation layers
export type Rotation = 0 | 1 | 2 | 3;            // quarter turns clockwise
export type Direction = 'N' | 'E' | 'S' | 'W';
export interface CellCoord { x: number; z: number }   // integer grid coords, x→east, z→south

// track/pieces.ts — one PieceDef per PieceType, loaded from data/pieces.json
export type PieceType =
  | 'straight' | 'curve-small' | 'curve-large' | 'ramp' | 'hill'
  | 'bump' | 'bridge' | 'tunnel' | 'junction' | 'crossing';

export interface Port { cell: CellCoord; edge: Direction; height: HeightLevel } // piece-local
export interface PathDef {
  fromPort: number;                 // index into ports[]
  toPort: number;
  kind: 'line' | 'arc' | 'sampled'; // sampled = Catmull-Rom control points for hills/ramps
  controlPoints?: [number, number, number][];   // piece-local, required when kind='sampled'
  length: number;                   // arc length in world units (validated vs LUT at load)
}
export interface PieceDef {
  type: PieceType;
  footprint: CellCoord[];           // piece-local cells occupied (straight=[{0,0}], curve-large=2x2, …)
  ports: Port[];
  paths: PathDef[];                 // junction has 3 ports / 2 paths + switch; crossing 4 ports / 2 independent paths
  model: AssetId;                   // meshgen builder key (60-ASSET_PIPELINE.md §4), not a file
  tags: ('jumpCapable' | 'switch' | 'elevated' | 'covered')[];
}

export interface Placement {
  piece: PieceType;
  cell: CellCoord;                  // world cell of piece-local (0,0)
  rotation: Rotation;
}

// track/graph.ts
export interface TrackNode { id: string; cell: CellCoord; edge: Direction; height: HeightLevel }
export interface TrackEdge {
  id: string; from: string; to: string;         // TrackNode ids
  placementIndex: number; pathIndex: number;    // provenance
  length: number;
  curveClass: 'straight' | 'gentle' | 'tight';  // physics lookup key (§7.3)
  grade: -1 | 0 | 1;                            // downhill / flat / uphill
}
export interface TrackGraph {
  nodes: Map<string, TrackNode>;
  edges: Map<string, TrackEdge>;
  addPlacement(p: Placement, def: PieceDef): PlacementResult;   // incremental build
  removePlacement(index: number): void;
  edgesFrom(nodeId: string, switchStates: ReadonlyMap<string, 0 | 1>): TrackEdge[];
  shortestPathLength(fromStation: string, toStation: string): number | null;
}
export type PlacementResult =
  | { ok: true; edges: TrackEdge[] }
  | { ok: false; reason: 'occupied' | 'out-of-bounds' | 'port-mismatch' | 'height-mismatch' | 'terrain-blocked' };

// train/types.ts
export interface CarriageState { personaId: string | null; offset: number } // arc-length behind loco
export interface TrainState {
  id: string;
  edgeId: string | null;            // null while airborne or crashed
  s: number;                        // arc-length along edge, 0..edge.length
  facing: 1 | -1;                   // direction of travel along edge
  v: number;                        // scalar speed, world units / second
  airborne: null | { pos: [number, number, number]; vel: [number, number, number] };
  crashed: boolean;
  carriages: CarriageState[];
}

// simulation/events.ts — the SimEvent log is the input to scoring and persona quirks
export type CrashCause = 'gap' | 'speeding-curve' | 'collision' | 'bad-landing' | 'hazard';
export type SimEvent =
  | { tick: Tick; type: 'Dispatched'; trainId: string; speedBet: SpeedBet }
  | { tick: Tick; type: 'PassengerBoarded'; passengerId: string; trainId: string; stationId: string }
  | { tick: Tick; type: 'Delivered'; passengerId: string; trainId: string; stationId: string }
  | { tick: Tick; type: 'Airtime'; trainId: string; durationTicks: number }
  | { tick: Tick; type: 'SwitchFlipped'; placementIndex: number; state: 0 | 1 }
  | { tick: Tick; type: 'PieceRepaired'; placementIndex: number; byPassengerId: string }
  | { tick: Tick; type: 'Crashed'; trainId: string; cause: CrashCause; cell: CellCoord }
  | { tick: Tick; type: 'ArrivedDepot'; trainId: string };

// simulation/sim.ts
export type SpeedBet = 'steady' | 'swift' | 'ludicrous';
export interface SimState { /* scenario-derived immutables + mutable train/switch/passenger state + rng + tick */ }
export interface SimResult {
  outcome: 'complete' | 'failed';
  finalTick: Tick;
  lastRequiredDeliveryTick: Tick | null;
  events: SimEvent[];
  piecesPlaced: number;
  stars: 0 | 1 | 2 | 3;             // via computeStars, §8
  connections: number;              // via computeConnections, §8
}
export function createSim(scenario: Scenario, seed: number): SimState;
export function applyInput(state: SimState, input: InputEvent): void;   // InputEvent: 40 §6
export function tick(state: SimState): SimEvent[];                      // advances exactly one tick
export function runHeadless(scenario: Scenario, replay: Replay): SimResult;
```

`Scenario` is generated from the JSON schema in [40-SCENARIO_SCHEMA.md](40-SCENARIO_SCHEMA.md)
(hand-written TS interface mirroring the schema; a test asserts the two example scenarios
type-check and validate).

## 5. Track model

- The stage is a `grid.width × grid.height` field of *cells*. One cell = one track module
  footprint. `CELL` (world units per cell, = 2.0) is a constant in
  `render/meshgen/palette.ts`; all piece paths and geometry are authored in world units around
  a cell centered at the origin (60 §3).
- Terrain per cell: `height: HeightLevel` and optional feature `water | rock | forest | town`.
  Track requires port `height` to match terrain height unless the piece is `elevated` (bridge)
  or `covered` (tunnel, which requires `rock`/hill terrain above).
- **Placement validity** (all must hold): footprint cells in bounds; footprint cells not
  occupied by another placement, a station, or blocking terrain (`water`/`rock` unless
  bridge/tunnel); every piece port that touches an occupied neighbor edge must align with a
  facing port at the same height (rotated by `Placement.rotation`); ramps change height by
  exactly one level.
- Ports sit at cell-edge midpoints. Two placements connect when they have facing ports on the
  same shared edge at the same height. Connection is automatic — no explicit "join" input.
- **Junction** = 1 cell, 3 ports (through + branch), `switch` tag, per-placement switch state
  `0|1` togglable during Watch by tapping it (an `InputEvent`, so replays capture it).
  **Crossing** = 1 cell, 4 ports, two independent straight paths that share the cell for
  collision purposes but not connectivity.
- Stations are scenario-fixed (never tray pieces). A station occupies 1 cell, exposes two
  colinear ports (a straight-through path), and is where boarding/delivery happens when a
  train stops at it (§7.5).

**Testable invariants T-1..T-3:** T-1 every `PieceDef` in `data/pieces.json` round-trips
rotation: rotating ports 4× returns originals. T-2 the port table below is exactly what
`data/pieces.json` encodes (test fixture). T-3 `addPlacement` → `removePlacement` restores the
prior graph (node/edge sets equal).

Port table (piece-local, rotation 0; heights 0 unless noted):

| Piece | Footprint | Ports |
|---|---|---|
| straight | (0,0) | N(0,0), S(0,0) |
| curve-small | (0,0) | N(0,0), E(0,0) |
| curve-large | (0,0)(1,0)(0,1)(1,1) | N(0,0), E(1,1) |
| ramp | (0,0) | N(0,0)@h, S(0,0)@h+1 |
| hill | (0,0)(0,1) | N(0,0)@0, S(0,1)@0 (path rises over a bump, `jumpCapable`) |
| bump | (0,0) | N(0,0), S(0,0) (`jumpCapable`) |
| bridge | (0,0) | N(0,0)@1, S(0,0)@1 (`elevated`; legal over water/track) |
| tunnel | (0,0) | N(0,0)@0, S(0,0)@0 (`covered`; legal only through rock/hill cell) |
| junction | (0,0) | N(0,0), S(0,0), E(0,0) (`switch`; paths N↔S, N↔E) |
| crossing | (0,0) | N,S,E,W (paths N↔S, E↔W, independent) |

## 6. Splines and train movement

- Each `PathDef` is compiled at load into a piece-local curve: `line` (2 points), `arc`
  (quarter circle), or `sampled` (Catmull-Rom through `controlPoints`). For each compiled
  curve build an **arc-length LUT** of 32 samples (`sampled`: 64), giving
  `pointAt(s)`/`tangentAt(s)` by LUT interpolation. Tolerance: LUT length vs. `PathDef.length`
  within 0.5%.
- A train is a scalar `(edgeId, s, facing, v)`. Per tick: `s += v · facing · TICK_DT`
  (with the physics update of §7 applied to `v` first). On `s` crossing an edge boundary the
  train hands off to the next edge chosen by `edgesFrom(node, switchStates)`; leftover
  distance carries over (never lose partial-tick distance).
- Carriages trail the locomotive at fixed arc-length offsets (`CarriageState.offset`,
  `CARRIAGE_SPACING` from `data/physics.json`), resolved by walking backward along the edge
  chain — no independent carriage physics.
- Dead end (node with no onward edge) at height 0 and `v ≤ vCrawl`: train stops (soft).
  At speed: see jump/crash rules §7.4.

**Testable invariant S-1:** for any two connected edges, `pointAt` at the shared node from
both sides differs by ≤ 1e-4 · CELL_SIZE, and tangents differ by ≤ 1°.

## 7. Arcade physics

All constants live in `data/physics.json` — tuning never edits code, and the JSON doubles as
the fixture for physics unit tests. Baseline values below are starting points for tuning.

### 7.1 Longitudinal model (the only continuous dynamics)

```
vTarget = vBase · betMult(speedBet)              // betMult: steady 1.0, swift 1.4, ludicrous 1.9
a       = aThrottle · sign(vTarget − v) − gSlope · grade − cDrag · v
v'      = clamp(v + a · TICK_DT, 0, vHardMax)
```

Baseline: `vBase = 3.0` cells/s, `aThrottle = 2.0`, `gSlope = 1.2`, `cDrag = 0.08`,
`vHardMax = 8.0`, `vCrawl = 0.3`, `CARRIAGE_SPACING = 0.55` cells.

### 7.2 Jumps (the fun button)

Leaving a `jumpCapable` crest, or running off an up-ramp/dead-end at height ≥ 1, with
`v ≥ vJump` (baseline 3.5): the train goes **airborne** — ballistic integration
`vel.y −= gAir · TICK_DT` (`gAir = 9.0` cells/s², tuned floaty for comedy), position advances
straight. **Landing test** each tick: if within `landingRadius` (0.4 cells) of any track point
whose tangent is within `landingAngle` (25°) of the flight direction and height matches ±0.3,
snap to that edge, keep `0.85·v`, emit `Airtime`. If the train touches ground otherwise →
`Crashed{cause:'bad-landing'}`. Running off a dead end below `vJump` at height ≥ 1, or any
dead-end overrun at speed at height 0 → `Crashed{cause:'gap'}`.

### 7.3 Derail on curves

Per `curveClass` a max speed: `gentle 4.5`, `tight 3.2` (straight: none). Exceeding it for
more than `derailGraceTicks` (12) consecutive ticks on curved edges →
`Crashed{cause:'speeding-curve'}`. The grace window is what makes Ludicrous a *bet*: brief
overspeed on a short curve survives, sustained overspeed does not.

### 7.4 Collisions

Each tick, every train sweeps an interval on its edge (loco front to last carriage tail).
Two trains whose swept intervals overlap on the same edge, or who occupy the same `crossing`
cell in the same tick, both emit `Crashed{cause:'collision'}`.

### 7.5 Stations, boarding, hazards

A train entering a station edge decelerates to a stop at its midpoint, dwells
`dwellTicks` (90), exchanging passengers instantly at dwell start (`PassengerBoarded` /
`Delivered` events; capacity = number of carriages), then re-accelerates. Hazards (40 §3.10)
are cell-based: e.g. `rockfall` marks a cell blocked between `fromTick..toTick` — entering it
then → `Crashed{cause:'hazard'}`; `brokenPiece` marks a pre-placed placement unusable until an
Engineer persona is delivered to the linked station (`PieceRepaired`).

### 7.6 Crash presentation (render-only)

The sim only emits `Crashed{cause}` deterministically and freezes that train. `effects/`
maps cause → slapstick gag (derail → cartwheeling carriages + popcorn confetti; collision →
both trains accordion, passengers parachute out as icon billboards; gap → sad-trombone teeter
then tip). Gags may use unseeded randomness — they are pure presentation and never touch sim
state. Retry is instant (one input) and crashes never lose meta progress: this is the
"funny crashes > realism" pillar in code form.

**Testable invariants P-1..P-3:** P-1 flat straight track: v converges to `vTarget` within 3s
and stateHash stabilizes per-tick deltas. P-2 the §7.3 table is read from `data/physics.json`
and a fixture test derails at threshold+ε and survives at threshold−ε. P-3 two trains
dispatched head-on on one edge crash on the exact tick their swept intervals first overlap.

## 8. Scoring (pure functions, shared by game/editor/CI)

```ts
// simulation/scoring.ts
export function computeStars(scenario: Scenario, r: SimResult): 0 | 1 | 2 | 3;
export function computeConnections(scenario: Scenario, r: SimResult): number;
```

Normative formulas (single source of truth; 10 §7 and 20 §2 restate these verbatim):

```
star1 = all required passengers Delivered  AND  no Crashed event
star2 = star1 AND piecesPlaced ≤ scenario.stars.pieceBudget
star3 = star1 AND lastRequiredDeliveryTick ≤ scenario.stars.timeTargetTicks
stars = star1 ? (1 + (star2?1:0) + (star3?1:0)) : 0        // 2 and 3 independent

connections = floor(
    Σ_delivered( persona.baseValue · (quirkSatisfied ? persona.quirkBonus : 1.0) )
    · betConnMult(speedBet)          // steady 1.0, swift 1.25, ludicrous 1.5
    · (noCrashes ? 1.1 : 1.0)
  + 5 · optionalStationsServed
  + 1 · unusedTrayPieces )
```

Persona quirk predicates are functions of `(scenario, events, passengerId)` only — defined as
data in [20-CONTENT_SPEC.md §3](20-CONTENT_SPEC.md). Speed bet never affects stars.

**Testable invariant SC-1:** `computeStars`/`computeConnections` reproduce the six worked
examples in 20 §3.1 exactly.

## 9. Rendering

- **Assets:** all geometry is generated at runtime by `render/meshgen/` (see
  60-ASSET_PIPELINE.md) — no model or texture files. Every mesh carries a `color` vertex
  attribute and renders through a single shared flat-shaded `MeshStandardMaterial`
  (`vertexColors: true`, no env maps) so every piece type can be an `InstancedMesh`.
- **Budgets:** ≤ 150 draw calls, ≤ 250k triangles, 60fps on a 2020 mid-range laptop iGPU;
  30fps floor on mobile (§12). One directional light + ambient; soft blob shadows
  (texture decal), not shadow maps, on low tier.
- **Biome tinting:** per-biome ground/prop tint via instance color; track pieces never tinted
  (readability). Palette table in 60 §7.
- **Interpolation:** renderer keeps sim states `t-1`/`t` and lerps transforms; airborne trains
  additionally get render-only spin for comedy.
- **Payoff sequences** (`render/payoff.ts`): data-driven `RestorationEvent` from
  `scenario.payoff` — camera dolly (camera/), staged prop reveals (lights, banners, crowd-icon
  burst), particles, jingle. Runs after `SimResult.outcome==='complete'`, fully skippable with
  one input; presentation-only (sim already resolved).

## 10. UI architecture

DOM overlay above the WebGL canvas. `app/screens.ts` is a state machine mirroring the core
loop states (10 §3): `Title → WorldMap → Preview → Countdown → SpeedBet → Watch → Results`
(+ `Editor`, `Community`, `Settings`). Each screen is a class with
`mount(root: HTMLElement)/unmount()` and listens to a typed event bus (`core/events.ts`).
HUD elements: countdown radial timer, piece tray (remaining counts, drag or tap-to-select),
passenger manifest chips, star targets, Connections tally, dispatch-early button.

## 11. Save system

`app/save.ts`, localStorage key `trainsportstation.save.v1`:

```ts
interface SaveData {
  saveVersion: 1;
  stages: Record<string, { stars: 0|1|2|3; bestTimeTicks: number|null; bestPieces: number|null; completedAt: string }>;
  connectionsTotal: number;         // lifetime earned
  connectionsSpent: number;
  restorations: string[];           // purchased world-map restoration node ids
  settings: { assistMode: boolean; sfxVolume: number; musicVolume: number; colorblindIcons: boolean };
}
```

Full shape + migration policy is normative in 40 §7. Writes are debounced (1s) and on
`visibilitychange`. Community scenarios/saves live under separate keys (50 §6) and never touch
campaign data.

## 12. Mobile / touch

Desktop-web first, touch-ready (user decision). Requirements:

| Action | Desktop | Touch |
|---|---|---|
| Select piece | click tray / keys 1-9 | tap tray |
| Place piece | click cell | tap cell (ghost preview, tap again to confirm) |
| Rotate ghost | R / scroll | on-screen rotate button |
| Remove piece | right-click | long-press |
| Pan / zoom | drag / wheel | one-finger drag / pinch |
| Flip junction | click it | tap it |
| Dispatch early | Space | big button |

Minimum touch target 44×44 px; HUD reflows at ≤ 700px width (tray docks bottom). Perf
fallbacks (auto at detected tier): DPR clamp 1.5, blob shadows only, particle cap ÷ 4.
The **editor** is desktop-optimized in v1; it must not break on touch but gets no touch UX
polish (50 §3).

## 13. Testable invariants (roll-up)

D-1 determinism hash · D-2 no wall-clock/unseeded RNG in headless zone · T-1 rotation
round-trip · T-2 port table = data fixture · T-3 placement undo restores graph · S-1 spline
continuity at nodes · P-1..P-3 physics fixtures · SC-1 scoring worked examples · plus:
every scenario in `src/scenarios/` passes `validateScenario` and its reference solution runs
headlessly to 3 stars (the CI content gate, 40 §V6).
