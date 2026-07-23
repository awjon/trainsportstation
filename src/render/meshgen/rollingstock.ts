// Procedural trains: chunky toy locomotives and carriages. Hero shells use roundedBox for
// soft toy edges; windows/headlights are emitted as glow geometry (bloom layer) so only the
// lights bloom. Length runs along +Z (travel direction) so a train drops onto N-S track.
// Persona carriage colors: docs/20 §3.

import * as THREE from 'three';
import { PALETTE } from './palette';
import { box, cyl, paint, roundedBox } from './sweep';
import { buildAsset, type Asset } from './asset';

const WHEEL_R = 0.19;
const AXLE_Y = 0.19;
const GAUGE = 0.7;

function wheelPair(z: number, color = PALETTE.chimney): THREE.BufferGeometry[] {
  const mk = (x: number) => {
    const g = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.09, 14);
    g.rotateZ(Math.PI / 2); // axis along X
    g.translate(x, AXLE_Y, z);
    return paint(g, color);
  };
  return [mk(-GAUGE / 2 - 0.04), mk(GAUGE / 2 + 0.04)];
}

function frame(length: number, color = PALETTE.steel): THREE.BufferGeometry {
  return roundedBox(0.86, 0.14, length, color, { bevel: 0.05, pos: [0, 0.34, 0] });
}

function coupler(z: number): THREE.BufferGeometry {
  return box(0.14, 0.1, 0.16, PALETTE.chimney, [0, 0.36, z]);
}

/** Steam-style toy locomotive. */
export function makeLocomotive(bodyColor: THREE.ColorRepresentation = PALETTE.steel): Asset {
  const body: THREE.BufferGeometry[] = [frame(1.9)];
  const glow: THREE.BufferGeometry[] = [];

  // boiler (cylinder along Z)
  const boiler = new THREE.CylinderGeometry(0.33, 0.33, 1.1, 18);
  boiler.rotateX(Math.PI / 2);
  boiler.translate(0, 0.62, 0.42);
  body.push(paint(boiler, bodyColor));

  // smokebox front cap
  const cap = new THREE.CylinderGeometry(0.34, 0.34, 0.1, 18);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0.62, 0.98);
  body.push(paint(cap, PALETTE.chimney));

  // cab (rounded)
  body.push(roundedBox(0.9, 0.62, 0.62, bodyColor, { bevel: 0.08, pos: [0, 0.74, -0.62] }));

  // chimney + dome + sandbox
  body.push(cyl(0.13, 0.16, 0.38, PALETTE.chimney, [0, 1.02, 0.72]));
  body.push(cyl(0.16, 0.16, 0.16, PALETTE.brass, [0, 0.96, 0.32]));

  // cowcatcher wedge
  const wedge = new THREE.CylinderGeometry(0.0, 0.34, 0.34, 3);
  wedge.rotateX(-Math.PI / 2);
  wedge.rotateY(Math.PI / 2);
  wedge.translate(0, 0.3, 1.05);
  body.push(paint(wedge, PALETTE.chimney));

  // cab windows — normal light-blue surfaces (glass reads fine in daylight, no glow)
  body.push(box(0.66, 0.3, 0.03, PALETTE.window, [0, 0.86, -0.32])); // cab front window
  body.push(box(0.03, 0.3, 0.38, PALETTE.window, [0.36, 0.86, -0.62])); // side windows
  body.push(box(0.03, 0.3, 0.38, PALETTE.window, [-0.36, 0.86, -0.62]));

  body.push(...wheelPair(0.55), ...wheelPair(0.0), ...wheelPair(-0.55));
  body.push(coupler(-0.98), coupler(0.98));

  // glow: just the headlight lens (a small point light that blooms tastefully)
  glow.push(cyl(0.1, 0.1, 0.06, PALETTE.headlight, [0, 0.78, 1.06], 12));

  return buildAsset(body, glow);
}

export type CarriageKind = 'container' | 'passenger' | 'tank' | 'flatbed';

/** Carriage; `color` is the persona/livery color. */
export function makeCarriage(kind: CarriageKind, color: THREE.ColorRepresentation): Asset {
  const body: THREE.BufferGeometry[] = [frame(1.5)];
  const glow: THREE.BufferGeometry[] = [];
  body.push(...wheelPair(0.5), ...wheelPair(-0.5));
  body.push(coupler(-0.78), coupler(0.78));

  switch (kind) {
    case 'container':
      body.push(roundedBox(0.82, 0.72, 1.36, color, { bevel: 0.06, pos: [0, 0.78, 0] }));
      body.push(box(0.84, 0.06, 0.06, PALETTE.chimney, [0, 0.78, 0])); // seam
      break;
    case 'passenger':
      body.push(roundedBox(0.84, 0.72, 1.4, color, { bevel: 0.08, pos: [0, 0.78, 0] }));
      body.push(roundedBox(0.88, 0.1, 1.42, color, { bevel: 0.04, pos: [0, 1.15, 0] })); // roof cap
      body.push(box(0.86, 0.2, 1.08, PALETTE.window, [0, 0.9, 0])); // window band (glass, no glow)
      break;
    case 'tank': {
      const tank = new THREE.CylinderGeometry(0.36, 0.36, 1.36, 18);
      tank.rotateX(Math.PI / 2);
      tank.translate(0, 0.74, 0);
      body.push(paint(tank, color));
      body.push(cyl(0.1, 0.1, 0.12, PALETTE.brass, [0, 1.12, 0])); // dome hatch
      break;
    }
    case 'flatbed':
      body.push(roundedBox(0.86, 0.1, 1.44, PALETTE.wood, { bevel: 0.03, pos: [0, 0.46, 0] }));
      body.push(box(0.06, 0.28, 0.06, PALETTE.steel, [0.4, 0.58, 0.6]));
      body.push(box(0.06, 0.28, 0.06, PALETTE.steel, [-0.4, 0.58, 0.6]));
      body.push(box(0.06, 0.28, 0.06, PALETTE.steel, [0.4, 0.58, -0.6]));
      body.push(box(0.06, 0.28, 0.06, PALETTE.steel, [-0.4, 0.58, -0.6]));
      break;
  }
  return buildAsset(body, glow);
}
