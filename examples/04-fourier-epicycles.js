import { Text, Tex, fadeIn, write, texToPaths, pathBounds, transformPath } from '../src/index.js';
import { Epicycles } from '../src/explainers/fourier.js';

export const config = { theme: 'qubibyte', posterTime: 7.2 };

// The outline of an integral sign, traced by eighty rotating arrows.
export default async function (scene) {
  const glyph = texToPaths('\\displaystyle\\int', { size: 1 }).paths[0].path;
  const b = pathBounds(glyph);
  // Fit the glyph to a height of 6.6 world units, centered on the origin.
  const k = 6.6 / b.h;
  const outline = { subpaths: [transformPath(glyph, [k, 0, 0, k, -k * (b.x + b.w / 2), -k * (b.y + b.h / 2)]).subpaths[0]] };
  const title = new Text('Eighty circles draw one curve', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const sub = new Text('Each arrow turns at a whole-number speed. Their sum traces the outline.', { size: 'label', color: 'muted', maxWidth: 6.5 });
  sub.nextTo(title, 'down', 0.2, 'left');
  const formula = new Tex('f(t) = \\sum_{n=-40}^{39} c_n\\, e^{2\\pi i n t}', { size: 0.62 });
  formula.moveTo([-4.3, -0.6]);
  const epi = new Epicycles(outline, { terms: 80, x: 3.4, y: -0.25 });
  await scene.play(fadeIn(title), fadeIn(sub, { shift: 'up' }), { duration: 0.8 });
  await scene.play(write(formula), { duration: 1.2 });
  scene.add(epi);
  await scene.play(epi.animate.set('time', 1), { duration: 8, ease: 'linear' });
  await scene.wait(1.2);
}
