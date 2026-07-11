# 60 — Asset Pipeline

Doc version: 1.0.0 · Normative for `data/assets.json`, `kenney-train-kit/`, and future kit drops

The repo ships the **Kenney Train Kit**: 85 GLB models sharing one texture
(`kenney-train-kit/Models/GLB/Textures/colormap.png`). The user will add further Kenney CC0
environment kits (per-biome, 20 §1); this doc defines the manifest, mappings, the resolution
for models the train kit lacks, and the conventions any new kit must be checked against.

---

## 1. Kit inventory (as shipped)

| Category | Count | Models (pattern) |
|---|---|---|
| Full track (ballast + rails) | 18 | `railroad-straight*`, `railroad-curve`, `railroad-corner-{small,large}[-ramp]`, `railroad-straight-{bend[-large],bump-{up,down},hill-*,skew-*}` |
| Rail-only variants | 18 | same set as `railroad-rail-*` (no ballast base — used elevated, §3) |
| Spline/track primitives | 7 | `spline-segment`, `spline-track[-damaged]`, `track[-single][-detailed]` |
| Locomotives | 23 | `train-locomotive-{a,b,c}`, `-passenger-{a,b}`, `train-diesel-{a,b,c}[-box]`, `train-electric-{bullet,city,double,square,subway}-{a,b,c}`, `train-tram-{classic,modern,round}` |
| Carriages | 12 | `train-carriage-{box,coal,dirt,wood,lumber,flatbed[-wood],tank[-large],container-{blue,green,red}}` |
| Other | 2 | `train-connector`, `Textures/colormap.png` |

**Not present** (the gap this doc resolves in §3): bridge, tunnel, junction, crossing,
station, buildings, people, foliage, particles.

## 2. Piece → model mapping (normative, → `data/assets.json`)

| PieceType (30 §4) | Model(s) | Notes |
|---|---|---|
| `straight` | `railroad-straight` | the CELL_SIZE reference model (§5) |
| `curve-small` | `railroad-corner-small` | 1×1 quarter turn |
| `curve-large` | `railroad-corner-large` | 2×2 quarter turn |
| `ramp` | `railroad-corner-small-ramp` (curved) / `railroad-straight-hill-beginning`+`-end` pair (straight rise) | authoring picks per PieceDef path |
| `hill` | `railroad-straight-hill-complete` (2 cells) | rises and falls; `jumpCapable` at crest |
| `bump` | `railroad-straight-bump-up` + `-bump-down` composed | `jumpCapable` |
| `bridge` | **kitbash** §3.1 | |
| `tunnel` | **kitbash** §3.2 | |
| `junction` | **kitbash** §3.3 | |
| `crossing` | **kitbash** §3.4 | |
| station (fixed) | **kitbash/kit** §3.5 | not a tray piece |

Unused-by-v1 track models (`bend`, `skew`, `spline-*`, `track*`) stay in the repo; `skew`
pairs are earmarked for a possible parallel-tracks piece in W8.

Train models: campaign defaults `train-locomotive-a/b/c` (W1), `-passenger-a/b` (W2+),
`train-diesel-*` (W3+); electrics/trams/subways unlock as W8 content and are valid in any
`trains[].model` today (the manifest exposes all locomotives). Carriage models are chosen by
**persona**, not by scenario — mapping normative in 20 §3.

## 3. Missing-model resolution

Two-track strategy per the user decision: **(a)** preferred model from an added Kenney CC0
kit (user downloads from kenney.nl; exact kit names confirmed at download time — candidates
in 20 §1), **(b)** a procedural kitbash recipe using only the train kit + generated geometry
tinted from `colormap.png` palette swatches. **v1 implementation must build the kitbash
recipes first** — kits then upgrade visuals as pure `assets.json` swaps, with no code change.

All generated geometry samples its vertex colors/UVs from designated colormap swatches
(wood, stone, metal — swatch UV coordinates recorded in `data/assets.json` at M0 audit) so
kitbashed pieces are indistinguishable in style and share the single material (§5).

### 3.1 Bridge
`railroad-rail-straight` (rail-only, no ballast) at height 1 + procedural trestle: two
A-frame leg pairs (boxes, wood swatch) at cell edges + side rails. Over water, legs get a
stone footing block. Height-2 (W8): stack a second leg tier.

### 3.2 Tunnel
Legal only through a `rock`/height-≥1 cell (30 §5): procedural portal arch (half-torus +
keystone box, stone swatch) at each open face; track inside is `railroad-rail-straight`;
the terrain mound itself hides the train (`covered` tag: renderer fades the roof when the
camera looks straight down).

### 3.3 Junction
Kitbash merge of `railroad-straight` + `railroad-curve` geometry in one cell + a procedural
lever/signal post (metal swatch) whose flag flips with switch state (the tap target,
30 §5 — min 44 px projected, 30 §12).

### 3.4 Crossing
Two `railroad-rail-straight` meshes crossed at 90° + a procedural plank deck (wood swatch)
where they intersect. With a `crossingTraffic` hazard, add procedural gate arms that animate
with the hazard cycle (render reads the deterministic hazard clock; no sim state added).

### 3.5 Station
Procedural platform slab + 4 posts + awning (biome-tinted canvas swatch) beside the track
cell + a name signboard. Upgrade path: building props from the biome's kit placed behind the
platform (pure manifest data: `station.props[biome] = [assetId...]`).

### 3.6 People
**No people meshes.** Personas are persona-colored carriages (20 §3) + floating icon
billboards (one 8-icon SVG-rendered-to-canvas atlas, shape-coded per 10 §10). In payoffs,
"people" are the same icon billboards on capsule bodies hopping about — chunky and legible,
and style-proof against any future kit.

### 3.7 Payoff & map props
Per-payoff prop sets (10 §6) start procedural (lamp = pole + emissive sphere; bunting =
catmull line + triangles; confetti/particles in `effects/`) and upgrade from added kits via
manifest swaps. Same for world-map node dioramas.

## 4. Manifest — `data/assets.json` (normative shape)

```json
{
  "cellSize": 0.0,                       // world units; measured at M0 from railroad-straight bounds
  "colormap": "kenney-train-kit/Models/GLB/Textures/colormap.png",
  "swatches": { "wood": [0.0, 0.0], "stone": [0.0, 0.0], "metal": [0.0, 0.0] },
  "models": {
    "railroad-straight": { "file": "kenney-train-kit/Models/GLB/railroad-straight.glb",
                            "kind": "track", "footprint": [[0,0]], "yawOffset": 0 },
    "train-locomotive-a": { "file": "...", "kind": "locomotive", "length": 0.0 }
  },
  "procedural": { "bridge": "trestle-v1", "tunnel": "portal-v1", "junction": "lever-v1",
                   "crossing": "deck-v1", "station": "platform-v1" },
  "personaIcons": "generated:persona-atlas-v1",
  "audio": { "dispatch-whistle": "audio/dispatch.ogg" }
}
```

Every `PieceDef.model`, `trains[].model`, persona carriage, and `payoff.jingle` must resolve
here. `kind` drives loader handling; `length` (locos/carriages) feeds `CARRIAGE_SPACING`
sanity checks.

## 5. Conventions (checked by the M0 audit script for every kit, present and future)

- **Units/scale:** `cellSize` = X-extent of `railroad-straight` bounds; every track model
  must fit its declared footprint × cellSize within 2% (audit-enforced). New kits get a
  per-kit `scaleFactor` in the manifest if their unit differs.
- **Axes/pivot:** Y-up, model "forward" = −Z at `yawOffset: 0`; pivot at footprint center,
  base at y=0. Deviations recorded as per-model `yawOffset`/`pivotOffset` rather than
  re-exporting GLBs (repo assets are treated as read-only upstream files).
- **Material:** exactly one material for all kit + procedural geometry (30 §9 instancing
  budget). Kits with their own colormaps: atlas them into one texture at audit time
  (script-generated combined colormap + UV remap manifest entry) or, if trivial, retint to
  swatches. Audit fails the build if a loaded scene produces > 1 material.
- **Naming:** manifest ids are the GLB basename; procedural assets are `name-vN`.
- **Loading:** all GLBs loaded up-front at boot behind the title screen (v1 total is small);
  budget: ≤ 4 MB gzipped models, ≤ 2 s parse on desktop reference hardware.

## 6. Persona icon atlas

Generated at build time from inline SVG (no binary art assets): briefcase, kite, yarn ball,
eighth-note, cross, wrench + star + heart. Two variants: colored (persona accent) and
high-contrast glyph (colorblind setting, 10 §10). One 512×512 canvas atlas → one texture for
all billboards.

## 7. Biome palettes

Ground/prop instance tints per biome (track never tinted — 30 §9). Accent colors from 20 §1
table; full 10-biome palette (`ground`, `accent`, `sky`, `fog`) lives in `data/biomes.json`,
authored at M3 under one contrast rule: station signboard text ≥ 4.5:1 against its board in
every biome.

## 8. Audio assets

Source: Kenney CC0 audio packs (candidates: "Interface Sounds", "Music Jingles",
"Impact Sounds" — confirm at kenney.nl, same policy as model kits). Event → sfx table
(→ `data/assets.json audio`): countdown tick(-tock accelerando), dispatch whistle (signature,
10 §11), piece place/remove, junction clack, boarding chime, delivery chime (per-persona
pitch), airtime whoosh, crash suite per `CrashCause` (slide-whistle, accordion, boing,
distant honk), payoff jingles per `payoff.type` (5), map restoration hum, UI tick. Music:
one loop per biome (3 in v1) + title. Total audio budget ≤ 3 MB.

## 9. Testable invariants

- **Manifest completeness:** every `PieceType`, every campaign `trains[].model`, every
  persona carriage (20 §3), every `payoff.jingle` referenced by shipped scenarios resolves to
  an existing file or registered procedural generator (unit test over `data/*.json` +
  `src/scenarios/*`).
- **Audit gates:** cellSize measured > 0; every track model within 2% of footprint; single
  material after load; per-piece triangle count ≤ 4k (procedural pieces ≤ 2k).
- **Boot budget:** models ≤ 4 MB gz / audio ≤ 3 MB (size test in CI).
- **Icon atlas:** contains all persona ids in `data/personas.json` in both variants
  (generated-output test).
