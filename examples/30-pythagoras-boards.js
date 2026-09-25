import { Polygon, Tex, Text, create, write, fadeIn, fadeOut, transform, lagStart } from '../src/index.js';

export const config = { theme: 'qubibyte', posterTime: 11 };

// The rearrangement proof: four copies of a right triangle inside a square
// of side a + b leave c^2 uncovered, and after sliding them, a^2 + b^2.
// Render with --board chalkboard or --board whiteboard to see it on a board.
const a = 1.5;
const b = 2.7;
const s = a + b;
const O = [-5.3, -2.55];
const P = ([x, y]) => [O[0] + x, O[1] + y];

const triangle = (pts) => new Polygon(pts.map(P), { fill: 'accent', fillOpacity: 0.28, stroke: 'accent', strokeWidth: 3.5 });
const square = (pts, color) => new Polygon(pts.map(P), { fill: color, fillOpacity: 0.18, stroke: color, strokeWidth: 3.5 });
const labelAt = (tex, [x, y], size = 0.55, color = 'ink') => {
  const t = new Tex(tex, { size, color });
  t.moveTo(P([x, y]));
  return t;
};

export default async function (scene) {
  const title = new Text('A proof you can watch', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const frame = new Polygon([[0, 0], [s, 0], [s, s], [0, s]].map(P), { stroke: 'ink', strokeWidth: 3, fill: null });
  const before = [
    [[0, 0], [a, 0], [0, b]],
    [[s, 0], [s, a], [a, 0]],
    [[s, s], [b, s], [s, a]],
    [[0, s], [0, b], [b, s]],
  ];
  const after = [
    [[a, a], [a, 0], [s, a]],
    [[s, 0], [s, a], [a, 0]],
    [[a, a], [0, a], [a, s]],
    [[0, s], [a, s], [0, a]],
  ];
  const tris = before.map(triangle);
  const inner = square([[a, 0], [s, a], [b, s], [0, b]], 'accent2');
  const sideLabels = [labelAt('a', [a / 2, -0.35], 0.45, 'muted'), labelAt('b', [a + b / 2, -0.35], 0.45, 'muted'), labelAt('b', [-0.35, b / 2], 0.45, 'muted'), labelAt('a', [-0.35, b + a / 2], 0.45, 'muted')];
  const c2 = labelAt('c^2', [s / 2, s / 2], 0.9);
  const eq1 = new Tex('(a+b)^2 = c^2 + 4\\cdot\\tfrac12 ab', { size: 0.56 });
  eq1.moveTo([3.2, 1.3]);
  const note = new Text('Slide the four triangles. The square they sit in does not change.', { size: 'label', color: 'muted', maxWidth: 6.2, align: 'center' });
  note.moveTo([3.2, 0]);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(frame), lagStart(sideLabels.map((l) => fadeIn(l)), { lag: 0.1 }), { duration: 1.2 });
  await scene.play(lagStart(tris.map((t) => create(t)), { lag: 0.2 }), { duration: 1.8 });
  await scene.play(create(inner), write(c2), { duration: 1.2 });
  await scene.play(write(eq1), { duration: 1.4 });
  await scene.play(fadeIn(note, { shift: 'up' }), { duration: 0.6 });
  await scene.wait(0.6);
  const sqA = square([[0, 0], [a, 0], [a, a], [0, a]], 'accent2');
  const sqB = square([[a, a], [s, a], [s, s], [a, s]], 'accent2');
  const a2 = labelAt('a^2', [a / 2, a / 2], 0.72);
  const b2 = labelAt('b^2', [a + b / 2, a + b / 2], 0.9);
  await scene.play(fadeOut(inner), fadeOut(c2), { duration: 0.5 });
  await scene.play(...tris.map((t, i) => transform(t, triangle(after[i]))), { duration: 2 });
  await scene.play(create(sqA), create(sqB), write(a2), write(b2), { duration: 1.2 });
  const eq2 = new Tex('(a+b)^2 = a^2 + b^2 + 4\\cdot\\tfrac12 ab', { size: 0.56 });
  eq2.moveTo([3.2, -1.3]);
  const result = new Tex('a^2 + b^2 = c^2', { size: 0.95, color: 'accent2' });
  result.moveTo([3.2, -2.7]);
  await scene.play(write(eq2), { duration: 1.4 });
  await scene.play(write(result), { duration: 1.2 });
  await scene.wait(2);
}
