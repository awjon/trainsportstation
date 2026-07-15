// M0.1 hello-cube. This is intentionally minimal render-side bootstrap (app/ + three are
// allowed outside the headless zone). M1.2 rewires this cube onto the fixed-timestep loop.
import * as THREE from 'three';

const canvas = document.getElementById('app') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1b2a);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(2.5, 2.5, 3.5);
camera.lookAt(0, 0, 0);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xffb703, flatShading: true }),
);
scene.add(cube);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 5, 2);
scene.add(sun);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((time: number) => {
  const t = time * 0.001;
  cube.rotation.x = t * 0.7;
  cube.rotation.y = t * 1.1;
  renderer.render(scene, camera);
});
