import { Tex, Text, Group, backdrop, fadeIn, fadeOut } from '../src/index.js';
import { TransformPlane, applyMatrix } from '../src/explainers/linear.js';

export const config = { theme: 'navy-explainer', posterTime: 6.5 };

function caption(tex, text) {
  const m = new Tex(tex, { size: 0.55 });
  m.toEdge('top-left', 0.7);
  const t = new Text(text, { size: 'label', color: 'muted' });
  t.nextTo(m, 'down', 0.3, 'left');
  const g = new Group([m, t]);
  g.add(backdrop(g, { pad: 0.28 }));
  return g;
}

// A shear, then a quarter turn. Grid lines stay parallel and evenly spaced.
export default async function (scene) {
  const plane = scene.add(new TransformPlane({ range: [8, 5], unit: 1.5, square: true, x: 1.8, y: -0.9 }));
  const first = caption('A = \\begin{bmatrix} 1 & 1 \\\\ 0 & 1 \\end{bmatrix}', 'A shear keeps i-hat and slides j-hat along the x axis.');
  await scene.wait(0.6);
  await scene.play(fadeIn(first, { shift: 'down' }), { duration: 0.9 });
  await scene.play(applyMatrix(plane, [1, 1, 0, 1]), { duration: 2.2 });
  await scene.wait(0.8);
  const second = caption('R A = \\begin{bmatrix} 0 & -1 \\\\ 1 & 0 \\end{bmatrix}\\begin{bmatrix} 1 & 1 \\\\ 0 & 1 \\end{bmatrix}', 'Then a quarter turn. The unit square keeps area 1.');
  await scene.play(fadeOut(first), { duration: 0.4 });
  await scene.play(fadeIn(second, { shift: 'down' }), { duration: 0.9 });
  await scene.play(applyMatrix(plane, [0, -1, 1, 0], { mode: 'polar' }), { duration: 2.4 });
  await scene.wait(1.5);
}
