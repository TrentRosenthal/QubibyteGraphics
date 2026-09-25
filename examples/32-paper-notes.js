import { Axes, Tex, Text, Arrow, create, write, fadeIn } from '../src/index.js';

export const config = { theme: 'qubibyte', board: 'paper', posterTime: 10 };

// Study notes on ruled paper: the derivative as a limit of secant slopes,
// drawn and annotated by hand.
export default async function (scene) {
  const title = new Text('The slope of a parabola, by hand', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const ax = new Axes({ x: [-0.5, 3], y: [-0.5, 6], width: 6.2, height: 5.6, style: 'cross', tips: true });
  ax.moveTo([-3.6, -0.9]);
  const f = (x) => x * x;
  const graph = ax.plot(f, { range: [-0.3, 2.45] });
  graph.set('visible', false);
  const x0 = 1;
  const secant = (h) => ax.line([[x0 - 0.6, f(x0) - 0.6 * ((f(x0 + h) - f(x0)) / h)], [x0 + h + 0.4, f(x0 + h) + 0.4 * ((f(x0 + h) - f(x0)) / h)]], { color: 'accent2' });
  const lines = [
    '\\frac{(x+h)^2 - x^2}{h}',
    '= \\frac{2xh + h^2}{h}',
    '= 2x + h',
    '\\to 2x \\text{ as } h \\to 0',
  ].map((tex) => new Tex(tex, { size: 0.55 }));
  // Stack the lines top to bottom by their ink, a fixed gap apart.
  let top = 2.6;
  for (const t of lines) {
    const b = t.bounds();
    t.shift(1.4 - b.x, top - (b.y + b.h));
    top -= b.h + 0.45;
  }
  const note = new Text('secant through x = 1 and x = 1 + h', { size: 'caption', color: 'muted' });
  note.moveTo([-1.9, 2.2]);
  const tip = ax.c2p(1.55, f(1) + 0.55 * 2.2);
  const pointer = new Arrow([-2.2, 1.95], [tip[0] - 0.1, tip[1] + 0.15], { color: 'muted', strokeWidth: 2.5 });
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(ax), { duration: 1.2 });
  graph.set('visible', true);
  await scene.play(create(graph), { duration: 1.4 });
  let s = secant(1.2);
  s.set('visible', false);
  s.set('visible', true);
  await scene.play(create(s), write(note), create(pointer), { duration: 1.4 });
  await scene.play(write(lines[0]), { duration: 1.2 });
  for (const [k, h] of [[1, 0.6], [2, 0.25], [3, 0.02]]) {
    const next = secant(h);
    next.set('visible', false);
    next.set('visible', true);
    s.set('visible', false);
    await scene.play(create(next), write(lines[k]), { duration: 1.3 });
    s = next;
  }
  await scene.wait(1.5);
}
