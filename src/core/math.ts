// Dependency-free vector math for the headless zone (no three.js).
// docs/30 §2.1 — core/ imports nothing; these helpers are shared by the
// simulation and by the render-side mesh generators.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : vec(0, 0, 1);
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Rotate a point about the Y axis by `turns` quarter-turns (0..3), clockwise looking down. */
export function rotateYQuarter(p: Vec3, turns: number): Vec3 {
  let { x, z } = p;
  const n = ((turns % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    // clockwise (x,z) -> (z, -x) for a top-down +Y view with x east, z south
    const nx = z;
    const nz = -x;
    x = nx;
    z = nz;
  }
  return { x, y: p.y, z };
}
