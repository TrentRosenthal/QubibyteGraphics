/**
 * First scene: a formula writes on, its graph draws on a pair of axes, and a
 * three-qubit circuit builds column by column. Seven seconds, one timeline.
 */
import {
  Text, Tex, Axes, evaluateQubi, quantumViews, write, create, fadeIn, indicate, lagStart,
} from '../src/index.js';

export const config = { theme: 'qubibyte', fps: 60 };

const PROGRAM = `H 0
CX [0,1]
RY(0.25) 2
CZ [1,2]
H (0..2)`;

export default async function build(scene) {
  const title = new Text('Qubibyte Graphics', { size: 'heading', weight: 'semibold' });
  title.moveTo([-7.3, 3.85], 'top-left');
  const subtitle = new Text('Typeset math, plots, and circuits on one timeline', { size: 'caption', color: 'muted' });
  subtitle.nextTo(title, 'down', 0.16, 'left');

  const formula = new Tex('f(x) = \\sin x + \\tfrac{1}{3}\\sin 3x', { size: 0.62 });
  formula.moveTo([-7.3, 1.2], 'left');
  const note = new Text('the first two terms of a square wave', { size: 'caption', color: 'muted' });
  note.nextTo(formula, 'down', 0.3, 'left');

  const axes = new Axes({ x: [-3.5, 3.5], y: [-2, 2], width: 6.8, height: 5.6, grid: true, xTitle: 'x', yTitle: 'f(x)' });
  axes.moveTo([3.9, -0.3]);
  const graph = axes.plot((x) => Math.sin(x) + Math.sin(3 * x) / 3, { color: 'accent', range: [-3.2, 3.2] });

  const circuit = new quantumViews.CircuitDiagram(evaluateQubi(PROGRAM));
  circuit.fitTo(6.2, 2.3);
  circuit.moveTo([-7.3, -2.2], 'left');
  const caption = new Text('H, CX, RY, CZ on three qubits', { size: 'caption', color: 'muted' });
  caption.nextTo(circuit, 'down', 0.28, 'left');

  scene.label('title');
  await scene.play(write(title), fadeIn(subtitle, { shift: 'up' }), { duration: 0.9 });
  scene.label('formula');
  await scene.play(lagStart([write(formula, { duration: 1.3 }), fadeIn(note, { shift: 'up' })], { lagRatio: 0.3 }));
  scene.label('plot');
  await scene.play(create(axes), { duration: 0.9 });
  await scene.play(create(graph), { duration: 1.3 });
  scene.label('circuit');
  await scene.play(circuit.build({ duration: 1.8 }), fadeIn(caption, { shift: 'up' }));
  await scene.play(indicate(graph), { duration: 0.7 });
  await scene.wait(0.6);
}
