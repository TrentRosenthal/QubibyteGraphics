import { Text, fadeIn } from '../src/index.js';
import { Scene3D, Mesh3D, torusKnot, torus, crossSection, create3D, rotate3D } from '../src/three/index.js';

export const config = { theme: 'qubibyte', posterTime: 8.5 };

// A trefoil knot turning in place beside a torus that a plane slices open,
// showing the circular cross-section of its tube.
const THETA = -Math.PI / 2 + 0.55;
// Side by side as seen by the camera: along its right vector.
const RIGHT = [-Math.sin(THETA), Math.cos(THETA), 0];
const at = (d) => [RIGHT[0] * d, RIGHT[1] * d, 0];

export default async function (scene) {
  const title = new Text('Knots and slices', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const view = new Scene3D({ width: 16, height: 8, shadow: true, camera: { theta: THETA, phi: 1.1, distance: 17, fov: 30 } });
  view.moveTo([0, -0.5]);
  scene.add(view);
  const knot = new Mesh3D(torusKnot(2, 3, { R: 1.25, r: 0.5, tube: 0.26, segments: 220, tubeSegments: 18 }), { position: at(-3.4), color: 'accent' });
  const ring = new Mesh3D(torus(1.35, 0.5, 72, 28), { position: at(3.4), color: 'accent2', capColor: 'accent' });
  ring.set('rotX', 0.5);
  const under = (x) => {
    const [px, py] = view.project([...at(x).slice(0, 2), -2.3]);
    return [px, py - 0.5];
  };
  const l1 = new Text('Trefoil knot', { size: 'label', color: 'muted' });
  l1.moveTo(under(-3.4));
  const l2 = new Text('Torus, cut by a plane', { size: 'label', color: 'muted' });
  l2.moveTo(under(3.4));
  await scene.play(fadeIn(title), { duration: 0.6 });
  view.add(knot, ring);
  await scene.play(create3D(knot), create3D(ring), fadeIn(l1), fadeIn(l2), { duration: 2 });
  await scene.play(rotate3D(knot, [0, 0, 1], Math.PI, { ease: 'linear' }), crossSection(ring, { normal: [1, 0, 0], to: at(3.4)[0] }), { duration: 4 });
  await scene.play(rotate3D(knot, [0, 0, 1], Math.PI / 2, { ease: 'easeOutSine' }), { duration: 2 });
  await scene.wait(0.8);
}
