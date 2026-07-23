// The two shared materials for the whole game. Every body mesh (track, trains, structures)
// renders through ONE flat-shaded vertex-color MeshStandardMaterial — that single material is
// what lets every piece type be a single InstancedMesh draw call (docs/30 §9). Emissive glow
// uses one unlit MeshBasicMaterial on the bloom layer (docs/render/postfx).

import * as THREE from 'three';

export function bodyMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.0,
  });
}

export function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
}
