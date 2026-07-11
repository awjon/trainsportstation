# 50 — Scenario Editor Specification

Doc version: 1.0.0 · Depends on: 40 (schema is the editor's output contract), 30 (§2 modules)

The editor is how "community scenarios" (pillar) becomes real. It ships in v1, in the main
build (no separate app), reachable from the world map.

---

## 1. Principle: gameplay tools == editor tools

The editor **reuses** the runtime; it never forks it:

- Piece placement/removal/rotation, ghost preview, validity feedback → the same
  `PlacementSystem` + `TrackGraph` the Countdown phase uses (30 §5).
- Playtest → the same `createSim`/`tick`/`runHeadless` runner and the same renderer/camera.
- Scoring preview → the same `computeStars`/`computeConnections` (30 §8).

**Import-graph rule (normative):** `editor/` may import `track/`, `simulation/`,
`scenarios/`, `render/`, `ui/`, `core/` — but nothing outside `editor/` may import
`editor/`. Enforced by the same ESLint rule as 30 §2.1. What the editor *adds* is authoring
of the things players can't touch: terrain, stations, passengers, trains, hazards, tray,
star targets, metadata.

## 2. Entry & modes

World map → "Workshop" → New scenario / Edit existing / Import. A scenario in the workshop is
a draft (stored per §6) until published. Mode bar, left to right — the intended authoring
order, but modes are freely revisitable:

`Terrain → Stations & People → Tray & Rules → Star Targets → Playtest → Publish`

### 2.1 Terrain mode

Grid size picker (6–32 per axis, resize preserves content, out-of-bounds content flagged).
Brushes: height 0/1/2, water, rock, forest, town, erase. Biome picker (sets tint + props,
40 biome enum). Click/drag paints cells.

```
┌─────────────────────────────────────────────┐
│ [Terrain][Stations][Tray][Stars][Play][Pub] │
│ ┌───────────────────────────┐ ┌───────────┐ │
│ │                           │ │ brushes   │ │
│ │      3D grid view         │ │ h0 h1 h2  │ │
│ │   (same renderer/camera   │ │ ~  ^  t ■ │ │
│ │    as gameplay)           │ │ biome: ▼  │ │
│ │                           │ │ grid: 12x10│ │
│ └───────────────────────────┘ └───────────┘ │
└─────────────────────────────────────────────┘
```

### 2.2 Stations & People mode

Place/drag stations (orientation toggle, optional flag, name field). Passenger list panel:
add row → persona picker (with quirk tooltip straight from `data/personas.json`), from/to
station dropdowns, required toggle, doctor time limit. Train list: model picker (thumbnails
from the asset manifest), carriage count, spawn station, dispatch delay. Pre-placed track:
place any piece as `locked` (and optionally `broken` + repair station — creating the hazard
row automatically). Hazard panel for rockfall/crossingTraffic (cell pick + timing fields with
a scrubber preview).

### 2.3 Tray & Rules mode

Piece palette with count steppers (0–99); countdown slider (300–1800 ticks, shown in
seconds); speed-bet-allowed toggle. Live warning chips (non-blocking): "no path possible from
tray" (cheap heuristic: tray piece count < Manhattan station distance), "passenger references
deleted station" (blocks publish via V-checks anyway).

### 2.4 Star Targets mode

`pieceBudget` and `timeTargetTicks` fields — **both start locked**, showing "beat your level
to set targets" (§5). After a winning playtest they unlock, pre-filled with the defaults
from §5 and editable within the validity floor (never below the author-run values).

### 2.5 Playtest mode

Exactly the player loop (Preview → Countdown → … → Results) inside the editor, using the
draft. Every run is recorded as a replay (40 §6). Exit back to any mode; the last **winning**
run is retained as the publish candidate. A "Re-verify" button replays the candidate
headlessly and warns if edits since have broken it (it clears whenever terrain/stations/
passengers/tray change — not for metadata edits).

## 3. Editing UX details

Undo/redo (≥ 50 steps) across all modes — command-pattern over draft mutations. Autosave
draft every 30 s + on mode switch. Keyboard: R rotate, Del remove, Ctrl+Z/Y, 1–6 modes.
The editor is desktop-optimized; it must not crash on touch but gets no touch polish in v1
(10 §12).

## 4. Validation UX

The Publish mode runs V1–V7 (40 §5) and renders each failure as a human card with a "show me"
button that jumps to the offending mode/cell:

| Rule | Card copy (example) |
|---|---|
| V2 | "Station 'Old Mill' sits outside the map." |
| V4 | "Rosa the Doctor wants to go to a station that no longer exists." |
| V5 | "Your winning run used 3 bridges, but the tray only offers 2." |
| V6 | "Your reference run no longer wins after your edits — beat it again." |

## 5. Publish gate (normative)

A scenario **cannot be exported until its author beats it** in Playtest, post-edits. On
publish:

1. The retained winning replay is converted to `referenceSolution` (40 §6 sugar).
2. `stars.timeTargetTicks` defaults to `ceil(authorRunTicks × 1.25)`; `stars.pieceBudget`
   defaults to `authorPiecesPlaced`. The author may edit both, floored at
   `authorRunTicks × 1.15` / `authorPiecesPlaced` (can't publish targets they didn't prove).
   If the author tightens targets, the reference run must still satisfy them (V6 re-runs
   headlessly at publish; a Swift author run with a Ludicrous-only target simply fails V6).
3. V1–V7 all green → write `.trainstation.json` (40 §8): file download + copy-to-clipboard.

This gate is why every community level in existence is **provably solvable and fairly
starred** — the same CI guarantee campaign content gets, enforced socially by the export
button.

## 6. Storage & the Community shelf

- Drafts: `trainsportstation.draft.<id>` (localStorage), listed in the Workshop.
- Imported levels: `trainsportstation.community.<id>` after passing the import pipeline
  (40 §8). Displayed on the world map's **Community shelf** — a siding at the map's edge
  with one card per level (name, author, best stars).
- Community play uses the normal loop and awards local stars/Connections tracked **per
  community level, fully isolated from campaign save data** (30 §11) — campaign
  progression/gates never read them.
- Deleting a community level or draft asks for confirmation and offers export-first.

## 7. v1 exclusions

No online browse/upload/rating (file & paste only) · no scripting/triggers beyond the hazard
kinds in 40 §1.1 · no custom assets/skins · no collaborative editing · no campaign-stage
editing (campaign JSONs are read-only in the shipped build; devs edit them as files with the
same tool in dev mode).

## 8. Testable invariants

- Round-trip: any draft → export JSON → import → export produces byte-identical JSON
  (after key-order canonicalization), including unknown fields injected into a fixture.
- Editor output always passes `validateScenario` — property test: N randomized editor
  action sequences → publish attempt → either blocked by a V-card or the output validates.
- Publish-gate math: fixture where authorRunTicks=2000 → default timeTarget 2500, floor 2300;
  attempts to publish below the floor are rejected.
- Placement parity: the same placement action sequence produces the same `TrackGraph` hash in
  editor mode and in Countdown mode (shared-code proof).
- Isolation: completing a community level mutates no campaign save key (30 §11).
