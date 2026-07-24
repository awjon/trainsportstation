// Selective bloom: only meshes on the BLOOM_LAYER glow. Because glow geometry is kept in a
// separate mesh (see meshgen/asset.ts), we isolate it by camera layers in a first pass —
// no material-darkening hack, and bright *surfaces* (white carriages, signs) never bloom.
// Uses only three/examples/jsm modules — no new dependency.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const BLOOM_LAYER = 1;

export interface BloomPipeline {
  render(): void;
  setSize(w: number, h: number): void;
}

export function makeBloom(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: { strength?: number; radius?: number } = {},
): BloomPipeline {
  const size = new THREE.Vector2();
  renderer.getSize(size);

  const renderScene = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(
    size.clone(),
    opts.strength ?? 0.45,
    opts.radius ?? 0.3,
    0.0, // threshold 0 — the layer already isolates emissive geometry
  );

  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv);
        }`,
      defines: {},
    }),
    'baseTexture',
  );
  mixPass.needsSwap = true;

  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(renderScene);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  const black = new THREE.Color(0, 0, 0);

  return {
    render() {
      // pass 1: render ONLY the bloom layer against a black background, then blur it.
      // (Black background + layer isolation is what keeps the sky/surfaces from blooming.)
      const prevBg = scene.background;
      scene.background = black;
      camera.layers.set(BLOOM_LAYER);
      bloomComposer.render();
      // pass 2: restore the real scene and add the bloom on top
      scene.background = prevBg;
      camera.layers.enableAll();
      finalComposer.render();
    },
    setSize(w: number, h: number) {
      bloomComposer.setSize(w, h);
      finalComposer.setSize(w, h);
    },
  };
}
