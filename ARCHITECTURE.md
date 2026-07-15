# Architecture

> **SUPERSEDED** — the normative technical architecture is
> [docs/30-TECH_ARCHITECTURE.md](docs/30-TECH_ARCHITECTURE.md); start at
> [docs/00-OVERVIEW.md](docs/00-OVERVIEW.md) for the full document map.

Original seed principles, preserved for history (all carried forward into docs/30):
Three.js + TypeScript + Vite · deterministic simulation · ECS-inspired composition · data
over code · fixed timestep · shared runtime/editor · modules `core/ simulation/ track/
train/ camera/ editor/ ui/ audio/ effects/ data/ scenarios/` · replay stores player inputs
only · scenario JSON defines biome, countdown, trains, stations, allowedPieces, hazards,
objectives and stars.
