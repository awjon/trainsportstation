# 10 — Game Design (GDD v2.0)

Doc version: 1.0.0 · Supersedes `Trainsportstation_GDD_v1.1.md`

All player-facing design and its rationale. Where a number here is also used by code
(star formulas, bet multipliers), the single source of truth is
[30-TECH_ARCHITECTURE.md §8](30-TECH_ARCHITECTURE.md) — values are restated here verbatim
and must never diverge.

---

## 1. Vision & tone

Trainsportstation is a whimsical real-time 3D railroad puzzle game. You are a conductor of
the **Guild of Conductors**, re-knitting a world of isolated communities after the AI era
left them disconnected. Every stage: study a broken landscape, get **10–15 frantic seconds**
to lay track, then watch your trains go — to triumph or to gloriously silly disaster.

Tone target: the toy-diorama warmth and gleeful chaos of RollerCoaster Tycoon. Operational
rule for every feature: **failure must always be funnier than success is satisfying.**
Crashes are slapstick spectacle, never punishment — retry is instant, meta progress is never
lost, and the crash gags (30 §7.6) are content players will *want* to trigger.

Pillars (unchanged from v1.1): Nintendo-style accessibility · fun-first arcade physics ·
Build → Watch → Retry · multiple valid solutions · data-driven content · community scenarios.

## 2. Fantasy & theme

Communities aren't rebuilt with money — they're rebuilt with **people showing up for each
other**. Every passenger is a person with a reason to travel (§4); every delivery is a small
reunion; every completed stage visibly restores a place (§6); and the world map heals as you
play (§5). The currency is literally called **Connections** because that's what you're
collecting.

## 3. Core loop (normative state machine)

`Preview → Countdown → SpeedBet → Dispatch → Watch → Resolve → Results → (Retry | Next)`

| State | Duration | Player inputs | Notes |
|---|---|---|---|
| Preview | untimed | pan/zoom, inspect stations & manifest, press Start | Camera tours the stage once (skippable). Puzzle is fully readable here: all passengers, hazards, star targets visible. |
| Countdown | `countdownTicks` (max) | place/remove/rotate pieces, pan/zoom, **Dispatch Early** | The signature mechanic. Radial timer with escalating tick-tock audio. Countdown is a **maximum** — dispatching early is always allowed and is the expert flex. |
| SpeedBet | untimed (skipped if `speedBetAllowed: false`) | pick Steady / Swift / Ludicrous | One choice for all trains. See §8. |
| Dispatch | instant | — | Trains depart (staggered by `dispatchOrder`). |
| Watch | sim-driven | flip junctions (tap), camera | No track edits. Tension + comedy phase. |
| Resolve | sim-driven | skip | Success → payoff Restoration Event (§6). Crash → gag plays, big friendly RETRY button. |
| Results | untimed | retry / next / world map | Stars, Connections tally-up animation, quirk bonuses itemized. |

Timer pressure with zero downside pressure: build time is scarce, but attempts are free and
instant. Retry regenerates nothing — same puzzle, new plan.

## 4. Passenger personas

Passengers are the puzzle's verbs. Each **persona** is a visually distinct kind of person
whose quirk bends your track plan a different way. Normative data (values, carriage mapping,
exact predicates) lives in [20-CONTENT_SPEC.md §3](20-CONTENT_SPEC.md); design intent here:

| Persona | Fantasy | Quirk pressure on the player |
|---|---|---|
| Commuter | just wants to get home | none — the baseline that makes others legible |
| Kid | school group on a trip | all kids must arrive close together → synchronize routes |
| Elder | grandma visiting family | no jumps, no Ludicrous while aboard → route around the fun |
| Musician | wandering busker | *enjoys* the scenic route (longer path = bonus) → rewards the loopy solution |
| Doctor | emergency house call | hard deadline → demands the fast route, conflicts with Elder/Musician |
| Engineer | Guild repair crew | delivering them fixes a broken piece → ordering puzzle (deliver Engineer first, unlock the route the Doctor needs) |

Rules baked in: every quirk is a computable predicate over the sim event log (30 §4
`SimEvent`) — no vibes-based scoring; quirks affect **Connections, never stars** (except that
a `required` passenger must be delivered for star 1); personas are introduced one per world
alongside the world's mechanic so each new person teaches the new track toy.

## 5. Progression — Restoring World Connections

The overworld is a **broken diorama**: ten regions, desaturated and dim, rail lines snapped,
towns dark. It is the progression system *and* the emotional scoreboard:

- Completing a stage (★1+) draws a **glowing rail line** between its towns and relights its
  node — the map literally re-connects as you play.
- **Stars** gate worlds: world N+1 opens at the cumulative star count in 20 §5 (generous —
  roughly half the available stars; 3-starring is chase content, never a wall).
- **Connections** (the currency) are spent on the map, on one-way **Restoration purchases**:
  relight the lighthouse, rebuild the festival square, reopen the funicular (a side stage).
  Restorations are cosmetic or unlock side content — **never gameplay power** (no better
  trains, no extra pieces). This keeps GDD v1.1's "economy out of scope" promise while making
  Connections feel meaningful: you're spending goodwill on the world, not on yourself.
- Map completion meter: "World Connection: 43% restored" — the long-game goal is 100%.

## 6. Stage payoff moments

Every stage ends in a **Restoration Event** — a 6–10 second, fully skippable, data-driven
celebration (`scenario.payoff`, render spec 30 §9): the camera dollies to the focus station,
the delivered passengers hop out as chunky icon-billboard people, and the place *changes*:

| `payoff.type` | The moment |
|---|---|
| `lightsOn` | windows flick on one by one, streetlamps pop, warm glow spreads |
| `bridgeRebuild` | scaffold drops away, flags unfurl along the span, first lantern crosses |
| `festivalStart` | bunting zips between poles, confetti, crowd-icon burst, music sting |
| `beaconLit` | lighthouse/beacon ignites, beam sweeps the map, distant node twinkles in reply |
| `reunionScene` | two icon-people run to each other in slow-mo, hearts, group cheer |

The sim has already resolved before the payoff plays (presentation-only, deterministic
outcome). Persona-specific reaction vignettes layer on top (the Musician starts a song, kids
chase each other). The payoff is the emotional paycheck for the theme — every stage must
ship with one, and stages within a world vary them.

## 7. Stars & scoring

Nintendo-style 3-star mastery. Formulas are normative in 30 §8; restated:

- ★ **Complete** — every required passenger delivered, no train destroyed.
- ★ **Efficient** — ★1 and `piecesPlaced ≤ pieceBudget`.
- ★ **Swift** — ★1 and last required delivery at or before `timeTargetTicks`.

★2 and ★3 are **independently earnable** (you can have ★1+★3 without ★2) — two different
mastery axes, both replayable. Star targets are printed on the stage card in Preview: goals
are always known before you build. Connections earned =
deliveries × quirk bonuses × speed-bet multiplier × no-crash bonus + flat bonuses (optional
stations +5, unused pieces +1) — bonuses feed **Connections, never stars**, so score-chasing
and star-chasing are distinct games.

## 8. The Speed Bet

After building, before dispatch: choose a throttle for all trains.

| Bet | Train speed | Connections | Read |
|---|---|---|---|
| Steady | ×1.0 | ×1.0 | the safe run |
| Swift | ×1.4 | ×1.25 | confident |
| Ludicrous | ×1.9 | ×1.5 | one hand on the crash gallery |

The bet is the post-build "double or nothing" beat: it multiplies Connections but **never
affects stars**, and higher speed genuinely raises crash risk (curve derail thresholds,
30 §7.3). Elder passengers cap the sensible bet at Swift — quirk/bet interplay is
intentional. Tutorial stages set `speedBetAllowed: false`.

## 9. Difficulty & tutorialization

No modal text tutorials. Teaching tools, in order of preference:

1. **Teach-by-tray** — a new piece appears alone and highlighted in the tray of the stage
   that introduces it; the puzzle is unsolvable without it.
2. **Ghost-track hints** — after N failed attempts (per-scenario `hints`), a translucent
   ghost of a valid partial route fades in. Campaign convention: W1 stages 1–3 only.
3. **Generous early countdowns** — W1 uses 15 s (900 ticks) shrinking to the 10–12 s norm by W2.
4. **One mechanic per world** (table in 20 §1), and each world's stage 1 is a safe sandbox
   for it.
5. **Assist mode** (settings): countdown pauseable with the sim paused too. No scoring
   penalty — accessibility is not a difficulty setting. (No-reflex-only-failure rule.)

Difficulty curve inside a world: stages 1–2 teach, 3–6 combine, 7 is the "gauntlet",
8 is the world finale with the biggest payoff event and a signature set piece.

## 10. Controls & accessibility

Full input table (desktop + touch parity) is normative in 30 §12. Accessibility commitments:
persona icons are shape-coded, not only color-coded (`colorblindIcons` setting swaps to
high-contrast glyph set); UI text scale setting; all payoffs/gags skippable; assist mode
(§9); no flashing above 3 Hz; audio never required to solve a puzzle (visual telegraphs for
hazards).

## 11. Audio & UX direction

**Audio:** toybox orchestra — marimba/whistle/brass stabs. The countdown has an escalating
tick-tock that resolves into the dispatch whistle (the game's signature sound). Each biome
has one loopable theme; payoff jingles are per-`payoff.type` variations on the main motif.
Crash sfx are cartoon (slide-whistle, boing, distant "wilhelm-esque" honk) — never violent.
Source: Kenney CC0 audio packs (60 §8).

**UX:** chunky, rounded, high-contrast UI over the diorama; one accent color per biome;
everything animates in ≤ 200 ms; numbers always tally up (never appear); the world map is
the home screen — the game opens on the thing you're healing.

## 12. Out of scope for v1

Multiplayer/backend services · monetization · localization beyond English · weather physics ·
procedural generation · custom asset import in the editor · online scenario browsing
(sharing is file/paste, 40 §8) · touch-optimized editor (50 §3).

## 13. Testable invariants

- `computeStars` and `computeConnections` are pure functions of `(scenario, SimResult)` —
  no UI, wall-clock, or save-state inputs (30 §8).
- Every persona quirk in 20 §3 lists its predicate signature over the `SimEvent` log, and
  each has at least one satisfying and one violating synthetic trace in tests (20 §3.1).
- Speed bet changes no star outcome in any test fixture (bet-sweep test: same solution run
  under all three bets yields identical stars).
- Every campaign scenario declares a `payoff` and every `payoff.type` value is exercised at
  least once in Worlds 1–3 content.
- The state machine in §3 is implemented as data (`app/screens.ts`) and every transition
  above has a test; no screen is reachable outside these transitions.
