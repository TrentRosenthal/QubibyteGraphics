import { Axes, Tex, Text, DecimalNumber, create, write, fadeIn, fadeOut, countTo } from '../src/index.js';

export const config = { theme: 'qubibyte', posterTime: 9 };

const f = (x) => 0.25 * x * x * (4 - x) + 0.6;
// Exact area of f on [0, 4]: 0.25 (4^4/3 - 4^4/4) + 0.6 * 4.
const EXACT = 0.25 * (256 / 3 - 64) + 2.4;

// Left Riemann sums with 4, 8, 16, and 64 rectangles close in on the integral.
export default async function (scene) {
  const title = new Text('Rectangles approach the area', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const ax = new Axes({ x: [0, 4.4], y: [0, 3.2], width: 8.6, height: 5.4, style: 'box', grid: false });
  ax.moveTo([-2.2, -0.75]);
  const graph = ax.plot(f, { range: [0, 4] });
  const integral = new Tex('\\int_0^4 f(x)\\,dx = ' + EXACT.toFixed(3), { size: 0.5 });
  integral.moveTo([4.9, 1.9]);
  const label = new Tex('n =', { size: 0.5, color: 'muted' });
  label.moveTo([4.1, 0.5]);
  const nValue = new DecimalNumber(4, { decimals: 0, size: 0.5, align: 'left' });
  nValue.nextTo(label, 'right', 0.2);
  const sumLabel = new Tex('S_n =', { size: 0.5, color: 'muted' });
  sumLabel.moveTo([4.1, -0.4]);
  let rects = ax.riemann(f, [0, 4], { n: 4 });
  const sum = new DecimalNumber(rects.sum(), { decimals: 3, size: 0.5, color: 'accent', align: 'left' });
  sum.nextTo(sumLabel, 'right', 0.2);
  rects.set('visible', false);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(ax), { duration: 1.2 });
  await scene.play(create(graph), write(integral), { duration: 1.4 });
  rects.set('visible', true);
  await scene.play(fadeIn(rects), fadeIn(label), fadeIn(nValue), fadeIn(sumLabel), fadeIn(sum), { duration: 0.8 });
  for (const n of [8, 16, 64]) {
    await scene.wait(0.7);
    const next = ax.riemann(f, [0, 4], { n });
    next.set('visible', false);
    await scene.play(fadeOut(rects), { duration: 0.35 });
    next.set('visible', true);
    await scene.play(fadeIn(next), countTo(nValue, n), countTo(sum, next.sum()), { duration: 1 });
    rects = next;
  }
  await scene.wait(1.6);
}
