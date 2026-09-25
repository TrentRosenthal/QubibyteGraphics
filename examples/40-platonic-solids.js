import { Text, fadeIn, lagStart } from '../src/index.js';
import { Scene3D, Mesh3D, polyhedron, rotate3D, create3D } from '../src/three/index.js';

export const config = { theme: 'qubibyte', posterTime: 6 };

const SOLIDS = [
  ['tetrahedron', 'Tetrahedron', '4 faces'],
  ['cube', 'Cube', '6 faces'],
  ['octahedron', 'Octahedron', '8 faces'],
  ['dodecahedron', 'Dodecahedron', '12 faces'],
  ['icosahedron', 'Icosahedron', '20 faces'],
];

// The five Platonic solids, turning in place under key, fill, and rim light.
export default async function (scene) {
  const title = new Text('The five Platonic solids', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const view = new Scene3D({ width: 16, height: 9, shadow: true, camera: { theta: -Math.PI / 2, phi: 1.25, distance: 16, fov: 30 } });
  scene.add(view);
  const meshes = SOLIDS.map(([id], i) => new Mesh3D(polyhedron(id, 1.05), { position: [(i - 2) * 2.9, 0, 0], color: 'accent' }));
  meshes.forEach((m) => view.add(m));
  const labels = SOLIDS.map(([, name, faces], i) => {
    const p = view.project([(i - 2) * 2.9, 0, -1.3]);
    const t = new Text(name, { size: 'label', weight: 'medium' });
    t.moveTo([p[0], p[1] - 0.35]);
    const f = new Text(faces, { size: 'caption', color: 'muted' });
    f.nextTo(t, 'down', 0.1);
    return [t, f];
  });
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(lagStart(meshes.map((m) => create3D(m)), { lag: 0.15 }), { duration: 2.2 });
  await scene.play(lagStart(labels.flat().map((l) => fadeIn(l, { shift: 'up' })), { lag: 0.06 }), { duration: 1 });
  await scene.play(...meshes.map((m, i) => rotate3D(m, [0.2 * (i % 2 ? 1 : -1), 0.3, 1], 2 * Math.PI, { ease: 'linear' })), { duration: 6 });
  await scene.wait(0.8);
}
