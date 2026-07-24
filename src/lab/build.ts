// Interactive build demo (docs/70 M3.2): hover a cell, left-click to place the selected piece,
// right-click to remove, R to rotate, number keys to pick from the tray. Ties together the
// camera rig, grid picking, input abstraction, and InstancedMesh placement — the same loop the
// game's Countdown phase and the editor will use.

import * as THREE from 'three';
import { TrackInstances } from '../render/instances';
import { ALL_PIECES, type PieceType } from '../render/meshgen/track';
import { makeCellHighlight, moveHighlight, type CellCoord } from '../render/picking';
import { attachBuildInput } from '../app/input';

const TRAY: PieceType[] = [
  'straight',
  'curve-small',
  'curve-large',
  's-bend',
  'ramp',
  'bridge',
  'tunnel',
  'junction',
  'crossing',
];

interface Placed {
  type: PieceType;
  cell: CellCoord;
  rotation: 0 | 1 | 2 | 3;
}

export function buildDemo(scene: THREE.Scene, camera: THREE.Camera, dom: HTMLElement): void {
  const ti = new TrackInstances([...ALL_PIECES], 2048);
  scene.add(ti.group);

  const highlight = makeCellHighlight(0xffe08a);
  scene.add(highlight);

  const placements: Placed[] = [];
  let current = 0;
  let rotation: 0 | 1 | 2 | 3 = 1; // straights default to E–W so a click makes a visible line

  const hud = document.getElementById('hud')!;
  const refreshHud = () => {
    hud.innerHTML =
      `Trainsportstation — build demo (${ti.total()} pieces · ${ti.drawCalls()} draw calls)<br>` +
      `selected: <b>${TRAY[current]}</b> · rotation ${rotation}<br>` +
      `left-click place · right-click remove · R rotate · 1–9 pick piece`;
  };

  const rebuild = () => {
    ti.clear();
    for (const p of placements) ti.place(p.type, { cell: p.cell, rotation: p.rotation });
  };

  attachBuildInput(dom, camera, {
    onHover: (cell) => moveHighlight(highlight, cell),
    onPlace: (cell) => {
      placements.push({ type: TRAY[current], cell, rotation });
      ti.place(TRAY[current], { cell, rotation });
      refreshHud();
    },
    onRemove: (cell) => {
      const before = placements.length;
      for (let i = placements.length - 1; i >= 0; i--) {
        if (placements[i].cell.x === cell.x && placements[i].cell.z === cell.z) placements.splice(i, 1);
      }
      if (placements.length !== before) {
        rebuild();
        refreshHud();
      }
    },
    onRotate: (d) => {
      rotation = ((((rotation + d) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
      refreshHud();
    },
    onSelect: (i) => {
      if (i < TRAY.length) current = i;
      refreshHud();
    },
  });

  // Seed a small demo track so a fresh (or headless) view shows the loop in action.
  const seed: Placed[] = [
    { type: 'straight', cell: { x: 0, z: 0 }, rotation: 1 },
    { type: 'straight', cell: { x: 1, z: 0 }, rotation: 1 },
    { type: 'straight', cell: { x: 2, z: 0 }, rotation: 1 },
    { type: 'curve-small', cell: { x: 3, z: 0 }, rotation: 2 },
    { type: 'straight', cell: { x: 3, z: 1 }, rotation: 0 },
    { type: 'straight', cell: { x: 3, z: 2 }, rotation: 0 },
    { type: 'junction', cell: { x: 3, z: 3 }, rotation: 0 },
    { type: 'bridge', cell: { x: 5, z: 0 }, rotation: 0 },
  ];
  for (const p of seed) {
    placements.push(p);
    ti.place(p.type, { cell: p.cell, rotation: p.rotation });
  }
  moveHighlight(highlight, { x: 4, z: 0 }); // show the hover cursor at the next cell
  refreshHud();
}
