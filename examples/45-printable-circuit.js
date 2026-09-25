import { Text, CodeBlock, fadeIn, evaluateQubi, texToPaths, mergePaths } from '../src/index.js';
import { Scene3D, circuitMesh, circuitModel, create3D, orbitCamera } from '../src/three/index.js';

export const config = { theme: 'clean-light', posterTime: 8 };

// A Qubi program as a physical object: the same model exports to STL or
// 3MF for a printer (qgfx render ... --format stl).
const PROGRAM = 'H 0\nCX [0,1]\nT 2\nCX [1,2]\nSWAP [0,2]\nMEASURE (0,1,2)';

const label = (text) => {
  const r = texToPaths(`\\mathrm{${text}}`, { size: 1, display: false });
  return mergePaths(...r.paths.map((p) => p.path));
};

export default async function (scene) {
  const title = new Text('A circuit you can hold', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const code = new CodeBlock(PROGRAM, { size: 0.3 });
  code.moveTo([-7.3, 2.2], 'top-left');
  const note = new Text('Wires, gates, and connectors merge into one closed mesh, ready to print.', { size: 'label', color: 'muted', maxWidth: 4.2 });
  note.nextTo(code, 'down', 0.4, 'left');
  const model = circuitMesh(circuitModel(evaluateQubi(PROGRAM)), { labelFactory: label });
  const view = new Scene3D({ width: 10, height: 8, shadow: true, camera: { theta: -Math.PI / 2 + 0.45, phi: 0.9, distance: 28, fov: 26 } });
  view.moveTo([2.8, -0.4]);
  scene.add(view);
  await scene.play(fadeIn(title), fadeIn(code), { duration: 0.8 });
  view.add(model.group);
  await scene.play(create3D(model.group), fadeIn(note, { shift: 'up' }), { duration: 2.4 });
  await scene.play(orbitCamera(view.camera, { dTheta: -0.7, dPhi: 0.15 }), { duration: 6, ease: 'easeInOutSine' });
  await scene.wait(0.8);
}
