import { Axes, Tex, Text, create, write, fadeIn, replacementTransform, transformMatchingTex } from '../src/index.js';

export const config = { theme: 'clean-light', posterTime: 9.5 };

// Partial sums of the sine series hug the curve over a wider and wider
// stretch as terms are added.
function partial(order) {
  return (x) => {
    let s = 0;
    let term = x;
    for (let k = 1; k <= order; k += 2) {
      s += term;
      term *= (-x * x) / ((k + 1) * (k + 2));
    }
    return s;
  };
}

function texFor(order) {
  const terms = [];
  for (let k = 1; k <= order; k += 2) {
    const sign = ((k - 1) / 2) % 2 === 0 ? '+' : '-';
    const body = k === 1 ? 'x' : `\\frac{x^{${k}}}{${k}!}`;
    terms.push(terms.length === 0 ? body : `${sign} ${body}`);
  }
  return `\\sin x \\approx ${terms.join(' ')}`;
}

export default async function (scene) {
  const title = new Text('Taylor polynomials of sine', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const ax = new Axes({ x: [-9, 9], y: [-2.5, 2.5], width: 14, height: 5.2, style: 'cross', tips: false });
  ax.moveTo([0, -1.1]);
  const sine = ax.plot(Math.sin, { color: 'ink', strokeWidth: 3.5 });
  sine.set('visible', false);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(ax), { duration: 1 });
  sine.set('visible', true);
  await scene.play(create(sine), { duration: 1.4 });
  let eq = new Tex(texFor(1), { size: 0.56 });
  eq.moveTo([0, 2.35]);
  let approx = ax.plot(partial(1), { color: 'accent', strokeWidth: 5 });
  approx.set('visible', false);
  approx.set('visible', true);
  await scene.play(create(approx), write(eq), { duration: 1.4 });
  for (const order of [3, 5, 7, 9, 11]) {
    await scene.wait(0.5);
    const nextEq = new Tex(texFor(order), { size: 0.56 });
    nextEq.moveTo([0, 2.35]);
    if (nextEq.width > 14) nextEq.fitTo(14, 1);
    const next = ax.plot(partial(order), { color: 'accent', strokeWidth: 5 });
    next.set('visible', false);
    await scene.play(replacementTransform(approx, next), transformMatchingTex(eq, nextEq), { duration: 1.2 });
    approx = next;
    eq = nextEq;
  }
  await scene.wait(1.5);
}
