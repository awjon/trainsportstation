# 60 — Asset Pipeline (Procedural)

Doc version: 2.0.0 · Normative for `src/render/meshgen/*`, `src/core/curves.ts`, `data/*`

**All game art is generated in code at runtime. There are no model files and no texture
files.** This supersedes the v1.x pipeline (Kenney GLB kit + colormap), which has been
removed from the repo. The whole asset payload is a few KB of TypeScript compiled into the
bundle; the only meaningful download weight is Three.js itself (~131 KB gzipped).

Why procedural, beyond size: track meshes are **swept along the exact curves the simulation
moves trains on** (docs/30 §6), so the rails can never drift from the collision path — grid
alignment is guaranteed by construction, and the missing-model gap from v1 (bridge, tunnel,
junction, crossing, station) disappears because those are just more generated geometry.

Reference implementation for everything in this doc already exists under
`src/render/meshgen/` and is exercised by the asset lab (`src/lab/main.ts`).

---

## 1. Principles (normative)

1. **No binary assets.** No `.glb`, `.gltf`, `.png`, `.jpg`, `.ktx`. A build test asserts the
   repo (outside `docs/`) contains no such files (60 §8). Icons/audio: see §6, §7.
2. **One shared body material + baked lighting.** Every body mesh renders through a single
   flat-shaded `MeshStandardMaterial` with `vertexColors: true` (docs/30 §9). Color lives in
   each geometry's `color` attribute (`paint()`); soft lighting (hemispheric + gradient +
   contact AO) is baked into that same attribute by `shade()`/`finalizeAsset` at build time —
   free at runtime and preserved through `InstancedMesh`. Emissive lights (headlight, lamp,
   junction signal) are kept as separate `glow` geometry on a bloom layer (`postfx.ts`,
   unlit `MeshBasicMaterial`) so bloom is selective — only lights glow, never bright surfaces.
3. **One attribute shape.** Every generated geometry is non-indexed with exactly
   `{ position, normal, color }` and no `uv`. `paint()` normalizes this so heterogeneous
   parts (swept tubes + box/cylinder primitives) always merge.
4. **Curve-derived track.** Track geometry is produced by sweeping a 2D profile along a
   `Curve` (`src/core/curves.ts`) — the same curve type the sim uses. Track pieces are never
   authored as static vertex lists.
5. **Deterministic geometry.** Generators take explicit parameters only (no `Math.random`);
   the same inputs yield byte-identical geometry. Any decorative variation is a seeded
   parameter passed in by the caller.

## 2. Module map

| File | Responsibility |
|---|---|
| `src/core/math.ts` | dependency-free `Vec3` + helpers (headless zone) |
| `src/core/curves.ts` | `Curve` (line/arc/catmull), `sampleFrames`, `curveLength`, `frameOffset` — shared by sim and meshgen |
| `src/render/meshgen/palette.ts` | `CELL`, `HEIGHT_UNIT`, the `PALETTE` (single source of color truth) |
| `src/render/meshgen/sweep.ts` | `sweepProfile`, `boxProfile`, `paint`, `merge`, `box`/`cyl`/`cone` primitives |
| `src/render/meshgen/sweep.ts` | + `roundedBox` (chamfered hero parts) |
| `src/render/meshgen/shading.ts` | `shade`/`finalizeAsset` — bake hemispheric + gradient + contact lighting into vertex color |
| `src/render/meshgen/asset.ts` | `Asset { body, glow }` + `buildAsset` — splits shaded body from emissive glow geometry |
| `src/render/meshgen/track.ts` | `buildPiece(type): Asset` for each of the 10 `PieceType`s |
| `src/render/meshgen/rollingstock.ts` | `makeLocomotive(color)`, `makeCarriage(kind, color)` → `Asset` |
| `src/render/meshgen/structures.ts` | `makeStation(awningColor)`, `makeTree`, `makeHouse`, `makeLamp` → `Asset` |
| `src/render/postfx.ts` | selective bloom (`BLOOM_LAYER`) — only emissive `glow` geometry blooms |

## 3. World constants (`palette.ts`)

- `CELL = 2.0` world units per grid cell. All piece geometry is authored in world units
  around a cell centered at the origin (N = −Z, S = +Z, E = +X, W = −X; ports at edge
  midpoints, matching the port table in docs/30 §5).
- `HEIGHT_UNIT = 1.0` world units per elevation level (ramps rise one unit; bridge decks sit
  at `HEIGHT_UNIT`).
- `PALETTE` holds every color as a named hex (rails, ties, ballast, grass, persona liveries,
  structure and prop colors). Biome tinting (§5) multiplies instance colors against these.

## 4. Track generation (`track.ts`)

`buildPiece(type: PieceType): Asset` returns a shaded body (+ optional glow) per piece, built
from a piece-local `Curve` plus rails/ties/ballast and any kitbash extras:

| PieceType | Curve | Extras |
|---|---|---|
| `straight` | line N→S | ballast + ties |
| `curve-small` | quarter arc N→E, r = CELL/2 | ballast + ties |
| `curve-large` | quarter arc N→E, r = 1.5·CELL (2×2 footprint) | ballast + ties |
| `s-bend` | catmull S, +1 cell lateral over 2 cells | ballast + ties |
| `s-bend-left` | `mirrorAssetX(s-bend)` | mirror across X |
| `skew` | catmull sharp lane change, +1 cell over ~1 cell | ballast + ties |
| `skew-left` | `mirrorAssetX(skew)` | mirror across X |
| `ramp` | line rising `HEIGHT_UNIT` over one cell | ballast + ties |
| `curve-small-ramp` | quarter arc N→E rising `HEIGHT_UNIT` (`arcCurve` yEnd) | ballast + ties |
| `curve-large-ramp` | wide quarter arc rising `HEIGHT_UNIT` (2×2) | ballast + ties |
| `hill` | catmull crest over 2 cells (`jumpCapable`) | ballast + ties |
| `bump` | short catmull crest, 1 cell (`jumpCapable`) | ballast + ties |
| `bridge` | ramp-up → deck at `HEIGHT_UNIT` → ramp-down (3 cells) | wood railings/posts + stone piers & abutments; shown over water |
| `tunnel` | line N→S at ground | grassy mound (hemisphere) + a stone portal at each end |
| `junction` | line N→S + arc N→E sharing the N port | lever post + glowing signal (bloom) |
| `crossing` | line N→S + line W→E | plank deck plate at the shared cell |

Rails: two swept `boxProfile` rails at ±gauge/2; ballast: a swept low wide bed; ties:
frame-oriented boxes placed at fixed arc-length intervals via `sampleFrames`. Because the
sweep uses the piece's own curve, each piece's rails terminate exactly on its ports — this is
the sim-mesh parity that motivates the whole approach (verified visually top-down and by the
curve unit tests, `src/core/curves.test.ts`).

## 5. Rolling stock, structures, props

- **`makeLocomotive(bodyColor)`** — chunky toy steam engine: swept-frame base, cylindrical
  boiler, cab with window insets, chimney + brass dome, headlight, cowcatcher wedge, three
  wheel pairs, couplers. Length along +Z so it drops onto N-S track.
- **`makeCarriage(kind, color)`** — `kind ∈ container | passenger | tank | flatbed`. `color`
  is the persona livery (docs/20 §3: commuter blue, kid red, elder green, musician violet,
  doctor white, engineer amber). Passenger cars get a window band; tank cars a horizontal
  cylinder + hatch; flatbeds corner stakes.
- **`makeStation(awningColor)`** — platform slab + plank cap + posts + awning + fascia +
  trackside signboard + bench. Per-biome awning tint.
- **Props** — `makeTree` (stacked cones + trunk), `makeHouse(roof, wall)` (box + gable prism
  + chimney + door/window), `makeLamp` (post + glowing head). These dress biomes and the
  world-map diorama.

**People:** no character meshes. Personas are the livery-colored carriages above plus floating
icon billboards (§6); payoff "crowds" are icon billboards on capsule bodies (docs/60 §3.6 of
v1 carried forward). This keeps the roster style-proof and adds zero assets.

## 6. Icons

Persona/UI icons are drawn to a canvas at runtime (shapes + text via Canvas2D) and used as
`CanvasTexture` sprites — the same technique the asset lab uses for its labels. One atlas
canvas covers all persona ids in two variants (colored + high-contrast glyph for the
colorblind setting, docs/10 §10). No image files.

## 7. Audio

Audio is the one category that is not geometry. Options, in preference order: (a) synthesized
at runtime via WebAudio (oscillator/noise + envelopes) for stings, chimes, whistle, and crash
gags — keeps the "zero asset files" property intact; (b) a small set of CC0 `.ogg` clips if
synthesis proves insufficient for music beds, which would be the only binary files in the
build and must be explicitly approved (CLAUDE.md dependency-style decision). v1 target: **(a)
synthesized**, with the event→sound table from docs/10 §11 realized as WebAudio patches. This
is a later milestone (docs/70 M9.4) and does not affect the no-binary-assets test if (a) holds.

## 8. Testable invariants

- **No binary assets:** a test globs the repo (excluding `docs/`, `node_modules/`, `dist/`)
  and asserts zero `.glb/.gltf/.png/.jpg/.jpeg/.ktx/.fbx/.obj` files.
- **Single material / attribute shape:** every `buildPiece`, `makeLocomotive`,
  `makeCarriage`, and structure returns a geometry with exactly `{position, normal, color}`,
  non-indexed, no `uv` (unit test over all generators).
- **Merge safety:** building all 10 pieces + all rolling stock never throws (the mismatched-
  attribute merge failure is regression-tested).
- **Curve/port parity:** each track piece's swept rail endpoints coincide with its port
  positions within 1e-4·CELL (drives from `src/core/curves.test.ts` endpoints).
- **Budgets:** ≤ 4k triangles per track piece, ≤ 2k per kitbash extra, ≤ 6k per locomotive;
  full campaign scene ≤ 250k triangles, ≤ 150 draw calls via `InstancedMesh` per piece type
  (docs/30 §9). The lab reports the live triangle total for spot checks.
