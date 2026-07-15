# 20 — Content Specification

Doc version: 1.0.0 · Normative for `data/personas.json`, `data/worldmap.json`, `src/scenarios/*`

What content exists: worlds, personas (as data), the 24 v1 stage briefs, the world map, and
the writing style guide. How the game works is in 10/30/40 — on conflict, 40 > 30 > 20 > 10.

**v1 scope (user decision):** the schema, world map, and progression support all **10
worlds** from day one. Worlds **1–3 (24 stages)** ship fully in v1; worlds 4–10 are
roadmap-level briefs (§7) that become drop-in content as their environment asset kits are
added (60 §3). Stage briefs guide scenario authoring; the shipped scenario JSON is the
normative artifact and must pass validation V1–V7 (40 §5) — if a brief and a solvable
scenario disagree, fix the scenario first, then the brief.

---

## 1. World progression table (all 10 worlds, normative)

One new mechanic and at most two new personas per world. "Kit" = recommended Kenney CC0
environment kit (confirm exact names at kenney.nl when downloading; procedural fallback in
60 §3 if a kit is unavailable).

| W | Name | Biome id | Palette accent | New mechanic | New pieces | New personas | Trains | Kit |
|---|---|---|---|---|---|---|---|---|
| 1 | Meadow Junction | `meadow` | spring green | routing basics | straight, curve-small, curve-large | commuter, kid | 1 | Nature Kit |
| 2 | Highland Gap | `highland` | heather purple | elevation & jumps | ramp, hill, bump, bridge | elder, musician | 1 | Nature Kit (cliffs/rocks) |
| 3 | Twin Rivers | `rivers` | river teal | junctions & crossings | junction, crossing | doctor, engineer | 2 | Fantasy Town Kit |
| 4 | Dusty Mesa | `mesa` | terracotta | tunnels & rockfalls | tunnel | — | 2 | (desert/western kit) |
| 5 | Frostfield | `frostfield` | ice blue | momentum (low drag/brake zones) | — (ice terrain) | — | 2 | Holiday Kit |
| 6 | Coast of Lanterns | `coast` | lantern amber | timed hazards (drawbridge/traffic) | — | — | 3 | Pirate Kit |
| 7 | Mushroom Hollow | `hollow` | glow violet | dark stages & beacon lighting | — | — | 3 | Nature/Fantasy Kit |
| 8 | Skyline City | `skyline` | signal yellow | multi-level (height 2, under/over) | — | — | 3 | City Kit (Commercial) |
| 9 | Cloudpeak | `cloudpeak` | cloud white | chained jumps | — | — | 4 | (mountain/sky props) |
| 10 | The Last Junction | `last-junction` | ember orange | all mechanics, finale | — | — | 4 | mixed |

Campaign trays only contain pieces unlocked at or before that world's row. Star time bands
(authoring guidance): W1 `timeTarget ≈ refRun × 1.35`, W2 `× 1.25`, W3+ `× 1.15–1.2`
(all must satisfy the §6 fairness minimum of × 1.15).

## 2. Star & Connection rules (restated)

Single source of truth is 30 §8. For content authors: ★1 deliver all required + no crash;
★2 = ★1 + pieces ≤ `pieceBudget`; ★3 = ★1 + last required delivery ≤ `timeTargetTicks`;
★2/★3 independent. Connections =
`floor(Σ(base × quirkBonus?) × betMult × noCrash(1.1) + 5·optionalStations + 1·unusedPieces)`.

## 3. Persona roster (normative data → `data/personas.json`)

`quirkBonus` is 1.5 for every persona; `baseValue` varies. Icons are shape-coded
(colorblind-safe set in 60 §6). All predicates are functions of
`(scenario, events: SimEvent[], passengerId)` only.

| id | Name | Icon | Carriage model | Base | Quirk predicate (normative) |
|---|---|---|---|---|---|
| `commuter` | Commuter | briefcase | train-carriage-container-blue | 10 | none — bonus never applies |
| `kid` | School Kid | kite | train-carriage-container-red | 8 | `max(DeliveredTick over all kid passengers) − min(...) ≤ 600` (a lone kid: trivially satisfied) |
| `elder` | Elder | ball of yarn | train-carriage-container-green | 12 | no `Airtime` event for any train while this elder is aboard, AND `speedBet ≠ 'ludicrous'` |
| `musician` | Musician | eighth note | train-carriage-wood | 10 | traveled arc length between `PassengerBoarded` and `Delivered` ≥ `1.3 × shortestPathLength(from, to)` |
| `doctor` | Doctor | cross | train-carriage-tank | 15 | `Delivered.tick ≤ passenger.timeLimitTicks` |
| `engineer` | Engineer | wrench | train-carriage-flatbed-wood | 12 | this passenger's `Delivered` triggers ≥ 1 `PieceRepaired` event |

Boarding rule: a passenger boards the first train with a free carriage that dwells at their
`from` station; trains have `carriageCount` seats. Persona-colored carriages + floating icon
billboards make "who is on which train" readable at a glance (no people meshes, 60 §6).

### 3.1 Worked scoring examples (test fixtures — SC-1 in 30 §13)

| # | Setup (events summarized) | Stars | Connections |
|---|---|---|---|
| E1 | w1-s1 ref solution: 1 commuter delivered @tick 1210, steady, no crash, 4/4 budget pieces, 2 unused | 3 | `floor(10·1.0·1.0·1.1 + 0 + 2)` = **13** |
| E2 | same, but dispatched at tick 890 → delivery @1610 > 1500 target | 2 (★1+★2) | **13** |
| E3 | 1 elder delivered, swift, no airtime, no crash, 0 unused | 3 (targets met) | `floor(12·1.5·1.25·1.1)` = **24** |
| E4 | same run at ludicrous (survives), elder quirk fails | 3 | `floor(12·1.0·1.5·1.1)` = **19** |
| E5 | 1 kid delivered (lone kid → quirk ok), second train crashes after, steady, 3 unused | 0 (crash voids ★1) | `floor(8·1.5·1.0·1.0 + 3)` = **15** |
| E6 | commuter + musician (path 1.4× shortest) delivered, steady, no crash, 1 optional station served, 0 unused | 3 | `floor((10 + 10·1.5)·1.0·1.1 + 5)` = **32** |

E3 vs E4 is intentional: betting Ludicrous with an Elder aboard *loses* Connections even on a
clean run — quirks outweigh greed.

## 4. Stage briefs — Worlds 1–3 (24 stages)

Legend for sketches: `.` flat grass · `~` water · `^` rock/hill (height 1) · `t` forest ·
`■` town cell · capital letter = station (D=depot/spawn) · grids shown width×height.
Briefs give intent + key numbers; authors tune countdown/budget/time to hit the §1 bands and
V6. Payoff types must all appear by end of W3 (10 §13).

### World 1 — Meadow Junction (teach routing; commuter, kid; 1 train)

**w1-s1 · First Light** — normative example A in 40 §2 (8×6, straight line D→B, tray 6
straights, budget 4, `lightsOn`, hints after 2 fails, no speed bet). Teaches: place, countdown, dispatch.

**w1-s2 · The Bend** — 8×8. D at (1,1) facing E; Bellbrook at (6,6) facing S. Tray: 6
straight, 3 curve-small. Budget 7. First curves; hint after 3 fails. Payoff `lightsOn`.
```
.D......
........
......t.
..t.....
........
......B.
```

**w1-s3 · Two Homes** — 10×8. One commuter to B, one to C; single train, 2 carriages — teach
multi-stop ordering (B en route to C). Tray: 10 straight, 4 curve-small. Budget 11.
Payoff `lightsOn`. First stage with `speedBetAllowed: true` (introduced gently: both quirkless).

**w1-s4 · School Run** — 10×8. Kids introduced: 3 kids from D to schoolhouse S, one train,
3 carriages — the 600-tick window is trivially satisfied (all one train) so the quirk teaches
itself as a freebie; the stage card explains the window. Forest wall forces one detour.
Budget 9. Payoff `festivalStart` (playground opens).

**w1-s5 · Roundabout** — 10×10. Curve-large introduced (teach-by-tray: 4 of them highlighted).
Ring route serving B and optional station O (first `optional: true`). Budget 12.
Payoff `lightsOn`.

**w1-s6 · Detour at Thistle Wood** — 12×8. Forest belt with one gap; longer of two obvious
routes is the efficient one (multiple-solutions showcase — both must be V6-viable; reference
uses the short one). 2 commuters, 1 kid. Budget 13. Payoff `reunionScene` (first).
```
.D..t.......
....t..t....
....t..t..B.
....t..t....
.......t....
....t..t....
```

**w1-s7 · Rush Hour** — 12×10. Gauntlet: 4 passengers (2 commuter, 2 kid) across 3 stations,
tight budget (ref uses budget exactly), countdown 660. No hints. Payoff `festivalStart`.

**w1-s8 · The Bellbrook Fair** — 12×10 finale. Every W1 skill; 5 passengers incl. kids split
across two pickups (window now matters: route must collect both kid groups without a big gap).
Optional station. Budget generous, timeTarget tight — the stage teaches that ★2 and ★3 may
need *different* builds. Payoff `festivalStart` (world finale set piece: full fairground).

### World 2 — Highland Gap (elevation & jumps; elder, musician; 1 train)

**w2-s1 · Up the Rise** — 8×8. Ramp teach-by-tray: B sits on a height-1 shelf (terrain `^`
row). Tray: 6 straight, 2 curve-small, 2 ramp. Budget 8. Payoff `lightsOn`.

**w2-s2 · Over the Gorge** — 10×8. Bridge teach: water channel splits the map (like example B
but 1 train). Tray adds 2 bridge. Budget 10. Payoff `bridgeRebuild` (must debut here).
```
.D...~....
.....~....
.....~..B.
.....~....
.....~....
.....~....
```

**w2-s3 · The Scenic Route** — 10×10. Musician debut: quirk card shown in Preview; map has a
direct 6-piece route and room to loop. Ref solution takes the loop (path ≥ 1.3×) —
first stage where the *longer* route scores more. Budget 14 (loose). Payoff `festivalStart`.

**w2-s4 · Grandma Ida** — 10×8. Elder debut. A bump sits on the direct route (pre-placed,
locked); going over it airs the train and voids Ida's bonus — route around it, or eat the
loss. Speed-bet lesson: Ludicrous voids her quirk even airless. Budget 12. Payoff `reunionScene`.

**w2-s5 · Big Air** — 12×8. Jump teach: a 2-cell gorge with **no bridges in the tray** — a
bump before the gap at speed ≥ Swift is the only crossing (V6 ref uses Swift; Steady teeters
into the gorge → the funniest mandatory failure in the campaign). Payoff `beaconLit` (debut).
```
.D....~~....
......~~....
......~~..B.
......~~....
```

**w2-s6 · Mixed Company** — 12×10. Elder *and* musician on one train: loop for the musician
without airtime for the elder; hill piece introduced as safe elevation. Budget 16.
Payoff `reunionScene`.

**w2-s7 · The Long Climb** — 12×12. Gauntlet: three shelves (heights 0→1→2), ramps + switchback
curves, 4 passengers. Countdown 720, no hints. Payoff `lightsOn` (hilltop village, biggest
lights-on grid yet).

**w2-s8 · Beacon of Harrowpeak** — 14×10 finale. Climb + jump + bridge; elder on board while a
musician wants the loop; optional cliffside station. Payoff `beaconLit` (beam answers across
the world map — first explicit map-heal moment mid-campaign).

### World 3 — Twin Rivers (junctions & crossings; doctor, engineer; 2 trains)

**w3-s1 · Two at Once** — 10×8. Two trains, disjoint routes (no shared cells) — pure
multitasking under one countdown. Budget 14. Payoff `lightsOn`.

**w3-s2 · The Junction** — 10×8. Junction teach: one spawn, two destinations; flip the switch
mid-Watch to serve both (first Watch-phase input). Tray: 1 junction highlighted. Budget 10.
Payoff `festivalStart`.

**w3-s3 · Crossed Paths** — 10×10. Crossing teach: two trains must share one crossing cell;
stagger via `dispatchOrder` shown in Preview. Collision here is the expected first funny
failure. Budget 12. Payoff `reunionScene`.

**w3-s4 · House Call** — 12×8. Doctor debut: `timeLimitTicks` HUD countdown chip; direct
route vs. safe route tension. Budget 12. Payoff `lightsOn` (clinic ward lights).

**w3-s5 · Repair Crew** — 12×10. Engineer debut: broken pre-placed bridge (`brokenPiece`
hazard) blocks the doctor's route; deliver the engineer first (train order puzzle).
Payoff `bridgeRebuild`.

**w3-s6 · Level Crossing** — 12×10. `crossingTraffic` hazard debut: road traffic cycles;
time dispatch or route around. Two trains. Budget 15. Payoff `festivalStart`.

**w3-s7 · Twin Rivers Relay** — normative example B in 40 §3 (14×10, broken shelf piece,
doctor deadline + engineer repair + kid + optional musician, junction switch input in ref).
Gauntlet. Payoff `bridgeRebuild`.

**w3-s8 · The Grand Reunion** — 14×12 finale. Two trains, junction + crossing web, doctor,
elders, kids in two groups, engineer unlocking the shortcut; optional Old Mill.
Payoff `reunionScene` (extended cut: both platforms, all delivered personas in the scene —
the emotional peak of v1). Completing it restores the Twin Rivers region and rolls v1 credits
over the healed map.

## 5. World map (normative data → `data/worldmap.json`)

Node = a place on the overworld; each campaign stage links two nodes (its rail line).
Restorations are one-way Connection purchases (cosmetic or side content — never power).

**Star gates:** World 2 opens at **12★**, World 3 at **28★** (of 24/48 available before the
gate). Worlds 4–10 gate placeholders: `28 + 20·(N−3)`★.

| World | Nodes | Restorations (cost) |
|---|---|---|
| 1 Meadow Junction | Guild Depot, Bellbrook, Thistle Wood, Fairground | Bellbrook lamplighting (30) · Fair carousel (60) · **Side stage: The Milk Run** (100) |
| 2 Highland Gap | Harrowpeak, Gorge Camp, Old Funicular, Cliffside | Gorge banners (40) · Funicular reopening — **side stage** (120) · Harrowpeak great beacon (80) |
| 3 Twin Rivers | Harrowgate, Eastbank, Riverside Clinic, Old Mill | Mill wheel turns (50) · Clinic garden (70) · **Side stage: Night Ferry Post** (150) |

Side stages are normal scenarios (same schema) flagged in `worldmap.json`, not in the star
economy (they award Connections only). Campaign totals must let a completionist of W1–W3
afford all listed restorations (checked by a data test: Σ earnable ≥ Σ prices × 1.3, using
per-stage max-Connection estimates recorded in `worldmap.json`).

## 6. Content fairness invariants (testable)

For every shipped scenario, CI asserts: schema + V1–V7 pass (40 §5) · reference solution → 3★
headlessly (V6) · `stars.timeTargetTicks ≥ referenceRunTicks × 1.15` (referenceRunTicks =
last required delivery tick of the V6 run) · `pieceTray` covers `referenceSolution` (V5) ·
`stars.pieceBudget ≥ referenceSolution.placements.length` · every persona/piece used is
unlocked at that world (§1 table) · every `payoff.type` appears ≥ 1× in W1–W3.

## 7. Worlds 4–10 (roadmap briefs, post-v1)

Each needs: its kit (§1), 8 stage briefs, 0–2 personas, one mechanic. Sketch: W4 tunnels
through mesas + scheduled rockfalls; W5 ice edges with `cDrag ≈ 0` (physics.json per-terrain
override) so momentum planning replaces throttle trust; W6 harbor drawbridges =
`crossingTraffic` at scale, 3 trains; W7 dark stages — delivering passengers lights beacons
that reveal the map (`beaconLit` chains); W8 height-2 city, under/over weaves, subway/tram
models unlock; W9 chained jumps (bump → bump → bump) and the Cloudpeak Grand Leap; W10 remix
finale, 4 trains, all personas, one 20-minute mega-stage with the full-map `reunionScene`.

## 8. Naming & writing style guide

- **Place names:** cozy English compounds — Bellbrook, Harrowgate, Thistle Wood, Eastbank.
  Two words max. No puns in place names (puns live in stage titles: "Big Air", "House Call").
- **Stage titles:** 1–3 words, warm or wry, never snarky.
- **Persona barks** (one-liners over heads at board/deliver): ≤ 6 words, present tense,
  personality not exposition — Kid: "Window seat!!" · Elder: "Mind the bumps, dear." ·
  Musician: "Every detour's a verse." · Doctor: "No time — go, go!" · Engineer: "I'll fix it
  en route." · Commuter: "Right on schedule."
- **Voice of the Guild** (stage cards, tips): second person, encouraging, a little grand —
  "Conductor, Bellbrook has waited long enough."
- Failure text is never blaming: "Well. That's one way to arrive." Retry button always says
  **"Once more, with feeling"** on crash, **"Again!"** on success.
