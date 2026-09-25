import { Text, Tex, fadeIn, write } from '../src/index.js';
import { Scene3D, Axes3D, surfaceSweep, orbitCamera, create3D } from '../src/three/index.js';

export const config = { theme: 'clean-dark', posterTime: 8 };

// A surface drawn in along x, then seen from a slowly turning camera.
const f = (x, y) => Math.sin(x) * Math.cos(y) * 0.9;

export default async function (scene) {
  const title = new Text('A surface, from every side', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const eq = new Tex('z = \\sin x \\cos y', { size: 0.5 });
  eq.toEdge('top-right', 0.75);
  const view = new Scene3D({ width: 16, height: 9, camera: { theta: -Math.PI / 3.4, phi: 1.05, distance: 15, fov: 32, target: [0, 0, -0.3] } });
  view.moveTo([0, -0.4]);
  scene.add(view);
  const ax = new Axes3D({ x: [-3, 3, 1], y: [-3, 3, 1], z: [-1, 1, 1], lengths: [6, 6, 2.2] });
  await scene.play(fadeIn(title), write(eq), { duration: 0.9 });
  view.add(ax);
  await scene.play(create3D(ax), { duration: 1.2 });
  const surf = ax.plotSurface(f, { nx: 44, ny: 44 });
  await scene.play(surfaceSweep(surf, { axis: 'u' }), { duration: 2.4 });
  await scene.play(orbitCamera(view.camera, { dTheta: Math.PI * 0.9, dPhi: -0.25 }), { duration: 7 });
  await scene.wait(0.6);
}
