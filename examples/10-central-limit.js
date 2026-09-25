import { Axes, Tex, Text, ValueTracker, create, fadeIn, replacementTransform, transformMatchingTex } from '../src/index.js';

export const config = { theme: 'scientific-paper', posterTime: 12 };

// Exact distribution of the average of k fair dice, by repeated convolution.
function averageOfDice(k) {
  let dist = [1];
  for (let i = 0; i < k; i++) {
    const next = new Array(dist.length + 6).fill(0);
    dist.forEach((p, s) => {
      for (let f = 1; f <= 6; f++) next[s + f] += p / 6;
    });
    dist = next;
  }
  const xs = [];
  const density = [];
  dist.forEach((p, s) => {
    if (s < k) return;
    xs.push(s / k);
    density.push(p * k);
  });
  return { xs, density };
}

const normal = (x, k) => {
  const v = 35 / 12 / k;
  return Math.exp(-((x - 3.5) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
};

// The average of more dice looks more and more like a bell curve.
export default async function (scene) {
  const title = new Text('Averages of dice become normal', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const ax = new Axes({ x: [0.5, 6.5], y: [0, 0.9], width: 10, height: 5.6, style: 'box', xTitle: '\\text{average}', yTitle: '\\text{density}' });
  ax.moveTo([-1.3, -0.85]);
  const k = scene.add(new ValueTracker(1));
  const bell = ax.plot((x) => normal(x, k.value), { color: 'accent2', strokeWidth: 3.5 });
  bell.set('visible', false);
  const chartFor = (n) => {
    const { xs, density } = averageOfDice(n);
    const c = ax.bars(density, { x: xs, width: (0.86 / n), color: 'accent', radius: 0 });
    return c;
  };
  const label = (n) => {
    const t = new Tex(`k = ${n}`, { size: 0.55 });
    t.moveTo([5.6, 1.9]);
    return t;
  };
  const formula = new Tex('\\bar X_k \\approx \\mathcal N\\!\\left(3.5,\\ \\tfrac{35}{12k}\\right)', { size: 0.42, color: 'accent2' });
  formula.moveTo([5.6, 0.7]);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(ax), { duration: 1 });
  let chart = chartFor(1);
  let kLabel = label(1);
  await scene.play(fadeIn(chart), fadeIn(kLabel), { duration: 0.8 });
  bell.set('visible', true);
  await scene.play(create(bell), fadeIn(formula), { duration: 1.2 });
  for (const n of [2, 3, 5, 8, 12]) {
    await scene.wait(0.6);
    const next = chartFor(n);
    next.set('visible', false);
    const nextLabel = label(n);
    await scene.play(replacementTransform(chart, next), transformMatchingTex(kLabel, nextLabel), k.to(n), { duration: 1.3 });
    chart = next;
    kLabel = nextLabel;
  }
  await scene.wait(2);
}
