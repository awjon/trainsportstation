// Procedural trains: chunky toy locomotives and carriages from boxes + cylinders.
// Length runs along +Z (travel direction); everything sits on the rail plane so a
// generated train drops straight onto generated track. Persona carriage colors: docs/20 §3.

import * as THREE from 'three';
import { PALETTE } from './palette';
import { box, cyl, merge, paint } from './sweep';

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
  return box(0.86, 0.12, length, color, [0, 0.34, 0]);
}

function coupler(z: number): THREE.BufferGeometry {
  return box(0.14, 0.1, 0.16, PALETTE.chimney, [0, 0.36, z]);
}

/** Steam-style toy locomotive. */
export function makeLocomotive(bodyColor = PALETTE.steel): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(frame(1.9));

  // boiler (cylinder along Z)
  const boiler = new THREE.CylinderGeometry(0.33, 0.33, 1.1, 16);
  boiler.rotateX(Math.PI / 2);
  boiler.translate(0, 0.62, 0.42);
  parts.push(paint(boiler, bodyColor));

  // smokebox front cap
  const cap = new THREE.CylinderGeometry(0.34, 0.34, 0.1, 16);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0.62, 0.98);
  parts.push(paint(cap, PALETTE.chimney));

  // cab
  parts.push(box(0.9, 0.62, 0.62, bodyColor, [0, 0.74, -0.62]));
  parts.push(box(0.7, 0.32, 0.02, PALETTE.window, [0, 0.86, -0.32])); // cab front window
  parts.push(box(0.02, 0.32, 0.4, PALETTE.window, [0.36, 0.86, -0.62])); // side window

  // chimney + dome
  parts.push(cyl(0.13, 0.16, 0.38, PALETTE.chimney, [0, 1.02, 0.72]));
  parts.push(cyl(0.16, 0.16, 0.16, PALETTE.brass, [0, 0.96, 0.32]));

  // headlight
  parts.push(box(0.16, 0.16, 0.12, PALETTE.lampGlow, [0, 0.78, 1.02]));

  // cowcatcher wedge
  const wedge = new THREE.CylinderGeometry(0.0, 0.34, 0.34, 3);
  wedge.rotateX(-Math.PI / 2);
  wedge.rotateY(Math.PI / 2);
  wedge.translate(0, 0.3, 1.05);
  parts.push(paint(wedge, PALETTE.chimney));

  parts.push(...wheelPair(0.55), ...wheelPair(0.0), ...wheelPair(-0.55));
  parts.push(coupler(-0.98), coupler(0.98));
  return merge(parts);
}

export type CarriageKind = 'container' | 'passenger' | 'tank' | 'flatbed';

/** Carriage; `color` is the persona/livery color. */
export function makeCarriage(kind: CarriageKind, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [frame(1.5)];
  parts.push(...wheelPair(0.5), ...wheelPair(-0.5));
  parts.push(coupler(-0.78), coupler(0.78));

  switch (kind) {
    case 'container':
      parts.push(box(0.82, 0.72, 1.36, color, [0, 0.78, 0]));
      parts.push(box(0.84, 0.06, 0.06, PALETTE.chimney, [0, 0.78, 0])); // seam
      break;
    case 'passenger':
      parts.push(box(0.84, 0.72, 1.4, color, [0, 0.78, 0]));
      parts.push(box(0.86, 0.24, 1.1, PALETTE.window, [0, 0.9, 0])); // window band
      parts.push(box(0.88, 0.08, 1.42, color, [0, 1.14, 0])); // roof cap
      break;
    case 'tank': {
      const tank = new THREE.CylinderGeometry(0.36, 0.36, 1.36, 16);
      tank.rotateX(Math.PI / 2);
      tank.translate(0, 0.74, 0);
      parts.push(paint(tank, color));
      parts.push(cyl(0.1, 0.1, 0.12, PALETTE.brass, [0, 1.12, 0])); // dome hatch
      break;
    }
    case 'flatbed':
      parts.push(box(0.86, 0.1, 1.44, PALETTE.wood, [0, 0.46, 0]));
      parts.push(box(0.06, 0.28, 0.06, PALETTE.steel, [0.4, 0.58, 0.6]));
      parts.push(box(0.06, 0.28, 0.06, PALETTE.steel, [-0.4, 0.58, 0.6]));
      parts.push(box(0.06, 0.28, 0.06, PALETTE.steel, [0.4, 0.58, -0.6]));
      parts.push(box(0.06, 0.28, 0.06, PALETTE.steel, [-0.4, 0.58, -0.6]));
      break;
  }
  return merge(parts);
}
