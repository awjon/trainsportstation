// The game (docs/70 M6.4). Glue only: this file owns the renderer, the frame loop, and the
// wiring between the screen machine, the session, the DOM overlay and the board view. Every
// decision it makes has already been made and tested somewhere else.
//
// The frame loop is deliberately dumb: advance sim time in whole ticks, then draw. Countdown,
// dispatch and resolution are all read off the session, never tracked separately here — one
// clock, one truth.

import * as THREE from 'three';
import { StageSession } from './session';
import { ScreenMachine, type ScreenId } from './screens';
import { BoardView } from '../render/board';
import { createCameraRig } from '../camera/rig';
import { makeBloom } from '../render/postfx';
import { attachBuildInput } from './input';
import { pickCell, pointerToNdc, type CellCoord } from '../render/picking';
import { Hud, manifestModel, starGoals } from '../ui/hud';
import { CountdownHud } from '../ui/countdown';
import { TrayHud, hasStock, remainingTotal, trayModel } from '../ui/tray';
import { PreviewPanel } from '../ui/preview';
import { SpeedBetPanel } from '../ui/speedbet';
import { WatchBar, watchModel } from '../ui/watch';
import { ResolvePanel } from '../ui/resolve';
import { ResultsPanel, resultsModel } from '../ui/results';
import { gagFor } from '../effects/crashes';
import { show } from '../ui/dom';
import type { PieceType, Rotation } from '../track/pieces';
import type { Scenario } from '../scenarios/types';
import scenarioDoc from '../scenarios/w1-s1.json';
import '../ui/styles.css';

const scenario = scenarioDoc as unknown as Scenario;

// ---------------------------------------------------------------- renderer

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // docs/30 §12 DPR clamp
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300);
camera.layers.enableAll();
const controls = createCameraRig(camera, renderer.domElement, { minDistance: 8, maxDistance: 90 });

// ---------------------------------------------------------------- session + board

let session = new StageSession(scenario, scenario.referenceSolution.seed);
let board = new BoardView(session.sim);
let bloom = makeBloom(renderer, board.scene, camera, { strength: 0.45, radius: 0.3 });

function frameBoard(): void {
  const { position, target } = board.framing(session.sim);
  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();
}
frameBoard();

// ---------------------------------------------------------------- UI

const ui = document.getElementById('ui') as HTMLElement;
const screens: ScreenMachine = session.screens;

let selectedPiece: PieceType | null = null;
let rotation: Rotation = 0;
let hovered: CellCoord | null = null;
let accumulator = 0;

const hud = new Hud();
const countdown = new CountdownHud(() => onDispatch());
const tray = new TrayHud({
  onSelect: (piece) => {
    selectedPiece = piece;
    refreshGhost();
  },
  onRotate: (d) => {
    rotation = ((((rotation + d) % 4) + 4) % 4) as Rotation;
    refreshGhost();
  },
});
const preview = new PreviewPanel(() => screens.dispatch('start') && enter('countdown'));
const speedBet = new SpeedBetPanel((bet) => {
  session.setSpeedBet(bet);
  screens.dispatch('confirmBet');
  enter('dispatch');
});
const watchBar = new WatchBar();
const resolve = new ResolvePanel({
  onContinue: () => screens.dispatch('showResults') && enter('results'),
  onRetry: () => screens.dispatch('retry') && retry(),
});
const results = new ResultsPanel({
  onRetry: () => screens.dispatch('retry') && retry(),
  onNext: () => location.reload(), // the world map arrives with M7; for now, back to the stage
});

ui.append(
  hud.root,
  countdown.root,
  tray.root,
  watchBar.root,
  preview.root,
  speedBet.root,
  resolve.root,
  results.root,
);

hud.setStage(scenario);

// ---------------------------------------------------------------- screen visibility

const VISIBLE: Record<ScreenId, string[]> = {
  title: [],
  worldMap: [],
  preview: ['hud', 'preview'],
  countdown: ['hud', 'countdown', 'tray'],
  speedBet: ['hud', 'speedBet'],
  dispatch: ['hud'],
  watch: ['hud', 'watch'],
  resolve: ['hud', 'resolve'],
  results: ['results'],
};

function enter(screen: ScreenId): void {
  const visible = new Set(VISIBLE[screen]);
  show(hud.root, visible.has('hud'));
  show(countdown.root, visible.has('countdown'));
  show(tray.root, visible.has('tray'));
  show(watchBar.root, visible.has('watch'));
  show(preview.root, visible.has('preview'));
  show(speedBet.root, visible.has('speedBet'));
  show(resolve.root, visible.has('resolve'));
  show(results.root, visible.has('results'));

  if (screen === 'preview') preview.show(scenario);
  if (screen === 'countdown') {
    tray.update(scenario.pieceTray, session.playerPlacements);
    tray.select(tray.selectedIndex);
    selectedPiece = tray.selectedPiece;
  }
  if (screen === 'speedBet') speedBet.reset();
  if (screen === 'dispatch') {
    session.dispatch();
    screens.dispatch('depart');
    enter('watch');
    return;
  }
  if (screen === 'resolve') showResolve();
  if (screen === 'results') showResults();

  board.setGhost(null, null, rotation, true);
  refreshHud();
}

function onDispatch(): void {
  if (screens.dispatch('dispatch')) enter(screens.current);
}

function retry(): void {
  session.retry();
  board = new BoardView(session.sim);
  bloom = makeBloom(renderer, board.scene, camera, { strength: 0.45, radius: 0.3 });
  bloom.setSize(window.innerWidth, window.innerHeight);
  accumulator = 0;
  frameBoard();
  enter('countdown');
}

function showResolve(): void {
  const outcome = session.finish();
  const crash = outcome.result.events.find((e) => e.type === 'Crashed');
  if (crash && crash.type === 'Crashed') resolve.showGag(gagFor(crash.cause));
  else {
    const station = scenario.stations.find((s) => s.id === scenario.payoff.focusStationId);
    resolve.showPayoff(scenario.payoff.type, station?.name ?? station?.id ?? 'The line');
  }
}

function showResults(): void {
  const o = session.finish();
  results.show(resultsModel(o.result, o.quirks, scenario.stars, o.stars, o.connections));
}

// ---------------------------------------------------------------- HUD refresh

function refreshHud(): void {
  const boarded = new Set<string>();
  const delivered = new Set<string>();
  for (const e of session.sim.events) {
    if (e.type === 'PassengerBoarded') boarded.add(e.passengerId);
    if (e.type === 'Delivered') delivered.add(e.passengerId);
  }

  hud.setManifest(manifestModel(scenario.passengers, { boarded, delivered }));

  const required = scenario.passengers.filter((p) => p.required !== false);
  hud.setGoals(
    starGoals(scenario.stars, {
      piecesPlaced: session.playerPlacements.length,
      delivered: required.filter((p) => delivered.has(p.id)).length,
      requiredTotal: required.length,
      crashed: session.sim.trains.some((t) => t.crashed !== null),
      lastRequiredDeliveryTick: session.finished?.result.lastRequiredDeliveryTick ?? null,
    }),
  );

  const slots = trayModel(scenario.pieceTray, session.playerPlacements);
  hud.setStatus(
    screens.current === 'countdown'
      ? `${remainingTotal(slots)} pieces left · click to place · R to rotate · Space to dispatch`
      : '',
  );
}

function refreshGhost(): void {
  if (screens.current !== 'countdown' || !selectedPiece || !hovered) {
    board.setGhost(null, null, rotation, true);
    return;
  }
  const slots = trayModel(scenario.pieceTray, session.playerPlacements);
  const legal = hasStock(slots, selectedPiece) && session.check(selectedPiece, hovered, rotation).ok;
  board.setGhost(selectedPiece, hovered, rotation, legal);
}

// ---------------------------------------------------------------- input

attachBuildInput(renderer.domElement, camera, {
  onHover: (cell) => {
    hovered = cell;
    board.setHighlight(screens.current === 'countdown' ? cell : null);
    refreshGhost();
  },
  onPlace: (cell) => {
    if (screens.current === 'watch') return flipJunctionAt(cell);
    if (screens.current !== 'countdown' || !selectedPiece) return;
    const slots = trayModel(scenario.pieceTray, session.playerPlacements);
    if (!hasStock(slots, selectedPiece)) return;
    if (!session.place(selectedPiece, cell, rotation).ok) return;
    board.sync(session.sim);
    tray.update(scenario.pieceTray, session.playerPlacements);
    selectedPiece = tray.selectedPiece;
    refreshHud();
    refreshGhost();
  },
  onRemove: (cell) => {
    if (screens.current !== 'countdown') return;
    if (!session.removeAt(cell)) return;
    board.sync(session.sim);
    tray.update(scenario.pieceTray, session.playerPlacements);
    refreshHud();
    refreshGhost();
  },
  onRotate: (d) => {
    rotation = ((((rotation + d) % 4) + 4) % 4) as Rotation;
    refreshGhost();
  },
  onSelect: (i) => tray.select(i),
});

/** A tap on a junction during Watch flips it — the one live input of the phase (docs/30 §5). */
function flipJunctionAt(cell: CellCoord): void {
  const index = session.sim.placements.findIndex(
    (p) => p.piece === 'junction' && p.cell.x === cell.x && p.cell.z === cell.z,
  );
  if (index < 0) return;
  const next = session.switchState(index) === 0 ? 1 : 0;
  session.flipSwitch(index, next);
  board.levers.setState(index, next);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (screens.current === 'countdown') onDispatch();
    else if (screens.current === 'preview') {
      screens.dispatch('start');
      enter('countdown');
    }
  }
});

// touch: tapping the canvas already places via attachBuildInput; a tap on the picked cell also
// needs the ghost to follow the finger, which pointermove on touch does not always send
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  hovered = pickCell(camera, pointerToNdc(renderer.domElement, e.clientX, e.clientY));
  board.setHighlight(screens.current === 'countdown' ? hovered : null);
  refreshGhost();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- frame loop

const clock = new THREE.Clock();
let frames = 0;

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.25);

  // sim time only runs during the build countdown and the watch phase
  if (screens.current === 'countdown' || screens.current === 'watch') {
    accumulator = session.advance(dt, accumulator);

    if (screens.current === 'countdown') {
      countdown.update(session.ticksLeft, scenario.countdownTicks);
      if (session.ticksLeft <= 0) onDispatch();
    } else {
      board.refreshCarriageColors(session.sim);
      const required = scenario.passengers.filter((p) => p.required !== false).map((p) => p.id);
      const delivered = new Set(
        session.sim.events.filter((e) => e.type === 'Delivered').map((e) => e.passengerId),
      );
      const m = watchModel({
        tick: session.tick,
        dispatchTick: session.sim.dispatchTick,
        speedBet: session.sim.speedBet,
        delivered,
        requiredIds: required,
        crashed: session.sim.trains.filter((t) => t.crashed !== null).length,
        trains: session.sim.trains.length,
      });
      watchBar.update(m, board.levers.count > 0);
      refreshHud();
      if (m.resolved || session.finished) {
        screens.dispatch('resolved');
        enter('resolve');
      }
    }
  }

  board.update(dt, session.sim);
  controls.update();
  bloom.render();

  frames++;
  if (frames === 3) (window as unknown as { __gameReady?: boolean }).__gameReady = true;
}

enter('preview');
animate();
