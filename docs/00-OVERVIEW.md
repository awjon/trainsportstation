# 00 — Overview & Document Map

Doc version: 1.0.0 · Start here.

**Trainsportstation** is a whimsical real-time 3D railroad puzzle game (Three.js +
TypeScript, all art generated procedurally in code — no model or texture files). You get
10–15 seconds to lay track before your trains
auto-depart; deliver people, reconnect communities, earn **Connections**, restore the world
map, and enjoy the crashes when you don't. Pillars: Nintendo-style accessibility ·
fun-first arcade physics · Build → Watch → Retry · multiple valid solutions · data-driven
content · community scenarios.

## 1. Document map & reading order

| Doc | Read this if you are… |
|---|---|
| [10-GAME_DESIGN.md](10-GAME_DESIGN.md) | designing/reviewing anything player-facing; implementing the loop, scoring feel, payoffs, tutorials |
| [20-CONTENT_SPEC.md](20-CONTENT_SPEC.md) | authoring scenarios, personas, worlds, the map; writing any player-visible text |
| [30-TECH_ARCHITECTURE.md](30-TECH_ARCHITECTURE.md) | writing any code — modules, canonical interfaces, determinism, physics, rendering, save, mobile |
| [40-SCENARIO_SCHEMA.md](40-SCENARIO_SCHEMA.md) | touching scenario/replay/save/share JSON in any way |
| [50-EDITOR_SPEC.md](50-EDITOR_SPEC.md) | building the editor or community-content features |
| [60-ASSET_PIPELINE.md](60-ASSET_PIPELINE.md) | generating meshes in code (track, trains, structures, props), icons, audio |
| [70-IMPLEMENTATION_PLAN.md](70-IMPLEMENTATION_PLAN.md) | orchestrating or executing the build — task contracts, DAG, gates |

Root files `Trainsportstation_GDD_v1.1.md` and `ARCHITECTURE.md` are superseded seeds kept
for history. `CLAUDE.md` governs the **process** (orchestrator/worker rules), never product
decisions.

## 2. Precedence

On conflict between docs: **40 > 30 > 20 > 10 > 50/60** (50/60 defer to all four on
game-rule matters and are authoritative only for their own domain: editor UX, assets).
70 never defines product behavior — it only sequences it; if 70 disagrees with 10–60, fix 70.
Numbers that appear in several docs (star formulas, bet multipliers) name their single
source of truth at the point of restatement.

## 3. Glossary (normative — all docs and code use these exact meanings)

- **Cell** — one grid square of a stage; unit of placement. World size = `cellSize` (60 §4).
- **Piece** — a placeable track module (`PieceType`, 30 §4); lives in the **tray** with a count.
- **Port** — a connection point a piece exposes at a cell edge + height; facing ports at the
  same height auto-connect (30 §5).
- **Track edge / graph** — the routed connectivity built from placements; trains move on
  edges (30 §4).
- **Tick** — 1/60 s of deterministic sim time; the only clock the sim knows (30 §3).
- **Countdown** — the build-phase timer (a *maximum*; early dispatch allowed). The signature
  mechanic.
- **Speed bet** — post-build throttle choice (Steady/Swift/Ludicrous); multiplies speed and
  Connections, never affects stars (10 §8).
- **Dispatch** — the moment trains depart; starts the Watch phase.
- **Persona** — a passenger type with a scoring quirk defined as a predicate over sim events
  (20 §3).
- **Connection(s)** — the only currency; earned by deliveries, spent on world-map
  restorations; never buys gameplay power (10 §5).
- **Restoration node** — a world-map purchase (cosmetic or side stage) that visibly heals the
  world.
- **Star** — per-stage mastery: ★1 complete, ★2 piece budget, ★3 time target; ★2/★3
  independent (30 §8).
- **Scenario** — one stage as a JSON document (40); campaign and community stages are the
  same format.
- **Replay** — scenario id + seed + timestamped inputs; the only thing needed to reproduce a
  run bit-for-bit (40 §6).
- **Reference solution** — the embedded winning replay every scenario must carry; CI/publish
  replays it to 3★ (40 §V6).
- **Payoff / Restoration Event** — the data-driven celebration sequence that ends a
  successful stage (10 §6).
- **Headless zone** — `core/ simulation/ track/ train/ data/ scenarios/`: no Three.js, no
  DOM, no wall-clock; runs in CI (30 §2.1).
- **Assist mode** — accessibility setting: pausable countdown (sim paused too), no scoring
  penalty (10 §9).

## 4. Version & change policy

Every doc carries `Doc version` (semver): editorial fix = patch, additive = minor,
breaking/meaning-changing = major + a note in the doc's header area. Any change to scenario
semantics must bump `schemaVersion` per 40 §9 — the schema doc wins disputes about what a
scenario means. Interfaces in 30 §4 may grow additively; renames/removals require the
CLAUDE.md shared-interface halt.
