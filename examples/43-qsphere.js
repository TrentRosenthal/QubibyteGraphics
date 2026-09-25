import { Text, CodeBlock, fadeIn, evaluateQubi, quantum } from '../src/index.js';
import { Scene3D, qSphere, create3D, orbitCamera } from '../src/three/index.js';

export const config = { theme: 'navy-explainer', posterTime: 7 };

// The Q-sphere of a three-qubit state: basis states sit by Hamming weight
// from |000> at the north pole to |111> at the south; dot size is the
// amplitude and color the phase.
const PROGRAM = 'H (0,1,2)\nCZ [0,2]\nT 1\nS 0';

export default async function (scene) {
  const title = new Text('Where a state lives on the Q-sphere', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const code = new CodeBlock(PROGRAM, { size: 0.36 });
  code.moveTo([-7.3, 2.0], 'top-left');
  const note = new Text('Latitude is the number of ones. Dot size is the amplitude; color is its phase.', { size: 'label', color: 'muted', maxWidth: 5.4 });
  note.nextTo(code, 'down', 0.45, 'left');
  const sim = new quantum.StatevectorSimulator(3);
  for (const op of evaluateQubi(PROGRAM).ops) sim.applyOp(op);
  const pts = quantum.qsphere(sim);
  const nodes = pts.map((p) => ({ polar: p.theta, longitude: p.phi, magnitude: Math.sqrt(p.probability), phase: p.phase, label: `\\lvert ${p.bitstring}\\rangle` }));
  const view = new Scene3D({ width: 9, height: 8.4, camera: { theta: -Math.PI / 3, phi: 1.2, distance: 11, fov: 30 } });
  view.moveTo([3.4, -0.7]);
  scene.add(view);
  const sphere = qSphere(nodes, { radius: 2.0, labelSize: 0.28, maxDot: 0.34 });
  await scene.play(fadeIn(title), fadeIn(code), { duration: 0.8 });
  view.add(sphere);
  await scene.play(create3D(sphere), fadeIn(note, { shift: 'up' }), { duration: 2 });
  await scene.play(orbitCamera(view.camera, { dTheta: Math.PI / 5, dPhi: -0.12 }), { duration: 7 });
  await scene.wait(0.6);
}
