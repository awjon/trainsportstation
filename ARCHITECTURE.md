# Architecture

Stack: Three.js, TypeScript, Vite.

Principles:
- Deterministic simulation.
- ECS-inspired composition.
- Data over code.
- Fixed timestep.
- Shared runtime/editor.

Modules:
core/
simulation/
track/
train/
camera/
editor/
ui/
audio/
effects/
data/
scenarios/

Replay stores player inputs only.
Scenario JSON defines biome, countdown, trains, stations, allowedPieces, hazards, objectives and stars.
