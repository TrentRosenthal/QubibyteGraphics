import { Text, Tex, Rect, CodeBlock, fadeIn, fadeOut, crossFade, evaluateQubi, quantum, quantumViews } from '../src/index.js';
import { Scene3D, BlochSphere, blochRotate, create3D } from '../src/three/index.js';

export const config = { theme: 'qubibyte', posterTime: 9 };

// Each single-qubit gate is a rotation of the Bloch sphere. The program on
// the left runs one line at a time; the state vector turns on the right.
const PROGRAM = 'H 0\nT 0\nH 0\nS 0';
const AXES = { H: [Math.SQRT1_2, 0, Math.SQRT1_2], T: [0, 0, 1], S: [0, 0, 1], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const ANGLES = { H: Math.PI, T: Math.PI / 4, S: Math.PI / 2, X: Math.PI, Y: Math.PI, Z: Math.PI };
const WHAT = {
  H: 'H turns the sphere half a turn about the axis between x and z.',
  T: 'T turns it an eighth of a turn about z. Only the phase changes.',
  S: 'S turns it a quarter turn about z.',
};

export default async function (scene) {
  const title = new Text('Gates are rotations', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const code = new CodeBlock(PROGRAM, { size: 0.42 });
  code.moveTo([-7.3, 2.1], 'top-left');
  const view = new Scene3D({ width: 8, height: 8, camera: { theta: -Math.PI / 3.2, phi: 1.2, distance: 12, fov: 30 } });
  view.moveTo([3.9, -0.45]);
  scene.add(view);
  const bloch = new BlochSphere({ theta: 0, phi: 0, radius: 1.85, trail: true, labelSize: 0.3 });
  const circuit = evaluateQubi(PROGRAM);
  const sim = new quantum.StatevectorSimulator(1);
  const ket = () => {
    const t = new Tex(quantumViews.diracLatex(sim), { size: 0.42 });
    if (t.width > 6.6) t.fitTo(6.6, t.height);
    t.moveTo([-7.3, -1.1], 'top-left');
    return t;
  };
  let state = ket();
  await scene.play(fadeIn(title), fadeIn(code), { duration: 0.8 });
  view.add(bloch);
  await scene.play(create3D(bloch), fadeIn(state), { duration: 1.4 });
  let note = null;
  let marker = null;
  for (let i = 0; i < circuit.ops.length; i++) {
    const op = circuit.ops[i];
    const line = code.line(i);
    const b = line.bounds();
    const nextMarker = new Rect({ x: b.x + b.w / 2, y: b.y + b.h / 2, width: b.w + 0.4, height: b.h + 0.2, radius: 0.06, stroke: 'accent', strokeWidth: 2, fill: 'accent', fillOpacity: 0.14 });
    const nextNote = new Text(WHAT[op.name], { size: 'label', color: 'muted', maxWidth: 6 });
    nextNote.moveTo([-7.3, -2.7], 'top-left');
    const out = [note, marker].filter(Boolean).map((n) => fadeOut(n));
    if (out.length) await scene.play(...out, { duration: 0.25 });
    await scene.play(fadeIn(nextMarker), fadeIn(nextNote, { shift: 'up' }), { duration: 0.4 });
    note = nextNote;
    marker = nextMarker;
    sim.applyOp(op);
    const next = ket();
    await scene.play(blochRotate(bloch, AXES[op.name], ANGLES[op.name]), crossFade(state, next), { duration: 1.8 });
    state = next;
    await scene.wait(0.5);
  }
  await scene.wait(1.2);
}
