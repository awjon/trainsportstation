// Build-mode input (docs/70 M3.2, input table docs/30 §12). Translates pointer + keyboard
// events into grid intents: hover a cell, place (left click), remove (right click), rotate
// (R / Shift+R). A click is a press-release with negligible movement, so left-drag still pans
// the camera (rig.ts) without placing. Returns a detach function.

import * as THREE from 'three';
import { pickCell, pointerToNdc, type CellCoord } from '../render/picking';

export interface BuildCallbacks {
  onHover?(cell: CellCoord | null): void;
  onPlace?(cell: CellCoord): void;
  onRemove?(cell: CellCoord): void;
  onRotate?(dir: 1 | -1): void;
  onSelect?(index: number): void; // number keys 1..9 select a tray slot
}

const CLICK_SLOP = 4; // px of movement below which a press-release counts as a click

export function attachBuildInput(dom: HTMLElement, camera: THREE.Camera, cb: BuildCallbacks): () => void {
  const ndc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  let downBtn = -1;
  let moved = false;

  const cellAt = (e: PointerEvent): CellCoord | null =>
    pickCell(camera, pointerToNdc(dom, e.clientX, e.clientY, ndc));

  const onMove = (e: PointerEvent) => {
    if (downBtn >= 0 && Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP) moved = true;
    cb.onHover?.(cellAt(e));
  };
  const onDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
    downBtn = e.button;
    moved = false;
  };
  const onUp = (e: PointerEvent) => {
    if (!moved) {
      const cell = cellAt(e);
      if (cell) {
        if (e.button === 0) cb.onPlace?.(cell);
        else if (e.button === 2) cb.onRemove?.(cell);
      }
    }
    downBtn = -1;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') cb.onRotate?.(e.shiftKey ? -1 : 1);
    else if (e.key >= '1' && e.key <= '9') cb.onSelect?.(Number(e.key) - 1);
  };
  const onCtx = (e: Event) => e.preventDefault();

  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('contextmenu', onCtx);
  window.addEventListener('keydown', onKey);

  return () => {
    dom.removeEventListener('pointermove', onMove);
    dom.removeEventListener('pointerdown', onDown);
    dom.removeEventListener('pointerup', onUp);
    dom.removeEventListener('contextmenu', onCtx);
    window.removeEventListener('keydown', onKey);
  };
}
