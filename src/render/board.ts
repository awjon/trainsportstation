// The board view (docs/70 M6.4): draws a SimState. Scene, terrain, track, stations, props,
// trains, ghost preview, junction levers.
//
// This is a *projection*, not a second source of truth — nothing here decides where anything is.
// Track pieces are placed from `sim.placements` through the same InstancedMesh path the layout
// demo proved out (one draw call per piece type), and trains are positioned by asking the sim's
// own TrackRuntime where each carriage is. Rails and collision path are one curve, so what you
// see is what the sim solved.

import * as THREE from 'three';
import { CELL, HEIGHT_UNIT, PALETTE } from './meshgen/palette';
import { ALL_PIECES, buildPiece, type PieceType } from './meshgen/track';
import { makeCarriage, makeLocomotive, type CarriageKind } from './meshgen/rollingstock';
import { makeStation } from './meshgen/structures';
import { BIOMES } from './meshgen/biomes';
import { bodyMaterial, glowMaterial } from './materials';
import { TrackInstances } from './instances';
import { JunctionLevers } from './junctions';
import { BLOOM_LAYER } from './postfx';
import { makeCellHighlight, moveHighlight, type CellCoord } from './picking';
import type { Asset } from './meshgen/asset';
import { consistPositions } from '../train/movement';
import { PERSONAS } from '../simulation/personas';
import type { SimState } from '../simulation/sim';
import type { Rotation } from '../track/pieces';
import { Rng } from '../core/rng';
import type { Vec3 } from '../core/math';

/** How far above the rails a locomotive's origin sits, in world units. */
const RIDE_HEIGHT = 0.02;

function meshOf(asset: Asset, body: THREE.Material, glow: THREE.Material): THREE.Object3D {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(asset.body, body));
  if (asset.glow) {
    const g = new THREE.Mesh(asset.glow, glow);
    g.layers.enable(BLOOM_LAYER);
    group.add(g);
  }
  return group;
}

const toWorld = (p: Vec3) => new THREE.Vector3(p.x * CELL, p.y * CELL, p.z * CELL);

export class BoardView {
  readonly scene = new THREE.Scene();
  readonly track: TrackInstances;
  readonly levers = new JunctionLevers();
  private readonly bodyMat = bodyMaterial();
  private readonly glowMat = glowMaterial();
  private readonly highlight = makeCellHighlight(0xffe08a);
  private readonly ghost: THREE.Group = new THREE.Group();
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly trains = new THREE.Group();
  private readonly dressing = new THREE.Group();
  private readonly consists = new Map<string, THREE.Object3D[]>();
  private ghostPiece: PieceType | null = null;

  constructor(sim: SimState) {
    const biome = BIOMES[sim.scenario.meta.biome] ?? BIOMES.meadow;

    this.scene.background = new THREE.Color('#bfe3f0');
    this.scene.fog = new THREE.Fog('#bfe3f0', 40, 110);

    const key = new THREE.DirectionalLight('#fff4e0', 2.0);
    key.position.set(6, 12, 5);
    this.scene.add(key, new THREE.HemisphereLight('#eaf6ff', '#6b8f4e', 0.85));

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    this.track = new TrackInstances([...ALL_PIECES], 1024);
    this.scene.add(
      this.track.group,
      this.levers.group,
      this.trains,
      this.dressing,
      this.ghost,
      this.highlight,
    );

    this.buildGround(sim, biome.ground);
    this.dress(sim, biome);
    this.sync(sim);
  }

  /** Grid-sized ground slab plus per-cell terrain blocks, so height reads at a glance. */
  private buildGround(sim: SimState, groundColor: number): void {
    const { width, height } = sim.scenario.grid;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(width * CELL + 80, height * CELL + 80),
      new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(((width - 1) / 2) * CELL, -0.02, ((height - 1) / 2) * CELL);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(
      Math.max(width, height) * CELL,
      Math.max(width, height),
      0x4c7d4a,
      0x6d9c5c,
    );
    grid.position.set(((width - 1) / 2) * CELL, 0.001, ((height - 1) / 2) * CELL);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.35;
    this.scene.add(grid);

    // terrain features: water reads as a sunken slab, rock/forest raise the cell
    const featureColor: Record<string, number> = {
      water: new THREE.Color(PALETTE.water).getHex(),
      rock: new THREE.Color(PALETTE.stone).getHex(),
      forest: new THREE.Color(PALETTE.grassDark).getHex(),
      town: new THREE.Color(PALETTE.platform).getHex(),
    };
    for (const t of sim.scenario.terrain) {
      const h = (t.height ?? 0) * HEIGHT_UNIT;
      const isWater = t.feature === 'water';
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(CELL, Math.max(0.12, h + (isWater ? 0.1 : 0.12)), CELL),
        new THREE.MeshStandardMaterial({
          color: featureColor[t.feature ?? ''] ?? groundColor,
          roughness: isWater ? 0.35 : 1,
          metalness: isWater ? 0.1 : 0,
        }),
      );
      slab.position.set(t.x * CELL, isWater ? -0.12 : h / 2, t.z * CELL);
      this.scene.add(slab);
    }
  }

  /** Biome props scattered outside the playfield — seeded, so a retry looks the same. */
  private dress(sim: SimState, biome: (typeof BIOMES)[string]): void {
    const rng = new Rng(sim.scenario.id.length * 7919);
    const { width, height } = sim.scenario.grid;
    for (let i = 0; i < 18; i++) {
      const make = rng.pick(biome.props);
      const edge = rng.int(0, 3);
      const along = rng.range(-2, Math.max(width, height) + 2);
      const out = rng.range(1.2, 4);
      const cell =
        edge === 0
          ? { x: along, z: -out }
          : edge === 1
            ? { x: along, z: height - 1 + out }
            : edge === 2
              ? { x: -out, z: along }
              : { x: width - 1 + out, z: along };
      const node = meshOf(make(), this.bodyMat, this.glowMat);
      node.position.set(cell.x * CELL, 0, cell.z * CELL);
      node.rotation.y = rng.range(0, Math.PI * 2);
      this.dressing.add(node);
    }

    // A station building beside each platform, so stops are legible from any angle. It sits a
    // full cell clear of the rails and is scaled down — the track is the puzzle, the building is
    // scenery, and scenery must never be mistaken for something you can route through.
    for (const s of sim.scenario.stations) {
      const node = meshOf(makeStation(), this.bodyMat, this.glowMat);
      const offset = s.orientation === 'NS' ? [CELL, 0] : [0, CELL];
      node.position.set(s.cell.x * CELL + offset[0], 0, s.cell.z * CELL + offset[1]);
      node.rotation.y = s.orientation === 'NS' ? Math.PI / 2 : 0;
      node.scale.setScalar(0.62);
      this.dressing.add(node);
    }
  }

  /**
   * Re-place every track piece and rebuild the junction levers. Called whenever the board
   * changes, which is only during the build phase — cheap enough to redo wholesale, and
   * wholesale means the view can never drift from the sim.
   */
  sync(sim: SimState): void {
    this.track.clear();
    this.levers.clear();

    sim.placements.forEach((p, i) => {
      const base = sim.grid.terrain.get(`${p.cell.x},${p.cell.z}`)?.height ?? 0;
      this.track.place(p.piece, {
        cell: p.cell,
        rotation: p.rotation,
        height: base as 0 | 1 | 2,
      });
      if (p.piece === 'junction') {
        this.levers.add(i, p.cell, p.rotation, base, sim.switchStates.get(i) ?? 0);
      }
    });

    this.syncTrains(sim);
  }

  /** Build (or rebuild) the train meshes to match the scenario's consists. */
  private syncTrains(sim: SimState): void {
    this.trains.clear();
    this.consists.clear();

    for (const train of sim.trains) {
      const scenarioTrain = sim.scenario.trains.find((t) => t.id === train.id);
      const parts: THREE.Object3D[] = [meshOf(makeLocomotive(), this.bodyMat, this.glowMat)];
      for (let i = 0; i < (scenarioTrain?.carriageCount ?? train.carriages.length); i++) {
        parts.push(meshOf(makeCarriage('passenger', PALETTE.commuter), this.bodyMat, this.glowMat));
      }
      for (const p of parts) this.trains.add(p);
      this.consists.set(train.id, parts);
    }
  }

  /**
   * Move the trains to where the sim says they are. Carriage colors follow whoever is riding —
   * the manifest is readable on the board itself, not only in the HUD.
   */
  updateTrains(sim: SimState): void {
    for (const train of sim.trains) {
      const parts = this.consists.get(train.id);
      if (!parts || train.edgeId === null) continue;

      const positions = consistPositions(train, sim.runtime);
      const heading = sim.runtime.tangentAt(train.edgeId, train.s);

      parts.forEach((part, i) => {
        const p = positions[i] ?? positions[positions.length - 1];
        if (!p) return;
        part.position.copy(toWorld(p)).setY(p.y * HEIGHT_UNIT + RIDE_HEIGHT);
        part.visible = true;
      });

      // face travel direction; carriages inherit it (a toy train never jack-knifes)
      const yaw = Math.atan2(heading.x, heading.z);
      for (const part of parts) part.rotation.y = yaw;

      // a wrecked train tips over — the gag itself plays render-side (effects/crashes)
      if (train.crashed) {
        for (const part of parts) part.rotation.z = 1.2;
      }
    }
  }

  /**
   * Recolor carriages by their rider's persona (docs/20 §3), so the manifest is readable on the
   * board itself. Persona color is baked into vertex colors by the generator and every carriage
   * shares one material, so "recolor" means swapping the carriage's geometry — done only when a
   * rider actually changes, which is a handful of times per run.
   */
  refreshCarriageColors(sim: SimState): void {
    for (const train of sim.trains) {
      const parts = this.consists.get(train.id);
      if (!parts) continue;

      train.carriages.forEach((carriage, i) => {
        const part = parts[i + 1] as THREE.Group | undefined;
        if (!part) return;
        const riderId = carriage.personaId ?? '';
        if (part.userData.rider === riderId) return;
        part.userData.rider = riderId;

        const passenger = riderId ? sim.passengers.find((p) => p.id === riderId) : undefined;
        const persona = passenger?.persona;
        const color = persona
          ? ((PALETTE as Record<string, string>)[persona] ?? PALETTE.commuter)
          : PALETTE.steel;

        const asset = makeCarriage(carriageKindFor(persona ?? ''), color);
        const mesh = part.children[0] as THREE.Mesh;
        mesh.geometry.dispose();
        mesh.geometry = asset.body;
      });
    }
  }

  setHighlight(cell: CellCoord | null): void {
    moveHighlight(this.highlight, cell);
  }

  /** Translucent preview of the piece about to be placed; red when the placement is illegal. */
  setGhost(piece: PieceType | null, cell: CellCoord | null, rotation: Rotation, legal: boolean): void {
    if (!piece || !cell) {
      this.ghost.visible = false;
      return;
    }
    if (piece !== this.ghostPiece) {
      this.ghost.clear();
      this.ghost.add(new THREE.Mesh(buildPiece(piece).body, this.ghostMat));
      this.ghostPiece = piece;
    }
    this.ghost.visible = true;
    this.ghost.position.set(cell.x * CELL, 0.03, cell.z * CELL);
    this.ghost.rotation.y = -(rotation * Math.PI) / 2;
    this.ghostMat.color.set(legal ? 0xffffff : 0xff6a5a);
  }

  update(dt: number, sim: SimState): void {
    this.levers.update(dt);
    this.updateTrains(sim);
  }

  /** Where the camera should sit to frame this board. */
  framing(sim: SimState): { position: THREE.Vector3; target: THREE.Vector3 } {
    const { width, height } = sim.scenario.grid;
    const cx = ((width - 1) / 2) * CELL;
    const cz = ((height - 1) / 2) * CELL;
    const span = Math.max(width, height) * CELL;
    return {
      position: new THREE.Vector3(cx, span * 0.85, cz + span * 0.95),
      target: new THREE.Vector3(cx, 0, cz),
    };
  }
}

/** Carriage kinds by persona, for when a consist is rebuilt (docs/20 §3). */
export function carriageKindFor(persona: string): CarriageKind {
  return (PERSONAS[persona]?.carriage as CarriageKind) ?? 'passenger';
}
