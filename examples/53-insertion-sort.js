import { Rect, Text, Tex, DecimalNumber, fadeIn, lagStart, countTo } from '../src/index.js';

export const config = { theme: 'qubibyte', posterTime: 9 };

const VALUES = [7, 3, 11, 1, 9, 5, 12, 2, 8, 4, 10, 6];

// Insertion sort: each new bar slides left past every taller bar before it.
export default async function (scene) {
  const title = new Text('Insertion sort', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const sub = new Text('Each bar slides left past every taller bar before it.', { size: 'label', color: 'muted' });
  sub.nextTo(title, 'down', 0.15, 'left');
  const slot = 0.95;
  const x0 = -((VALUES.length - 1) * slot) / 2;
  const base = -3.2;
  const unit = 0.42;
  const bars = VALUES.map((v, i) => new Rect({ width: 0.7, height: v * unit, radius: 0.05, x: x0 + i * slot, y: base + (v * unit) / 2, fill: 'accent', fillOpacity: 0.85, stroke: null }));
  const labels = VALUES.map((v, i) => {
    const t = new Tex(String(v), { size: 0.34, color: 'muted' });
    t.moveTo([x0 + i * slot, base - 0.3]);
    return t;
  });
  const counter = new DecimalNumber(0, { decimals: 0, size: 0.44, prefix: '\\text{swaps } ', align: 'left' });
  counter.moveTo([4.2, 2.6], 'left');
  await scene.play(fadeIn(title), fadeIn(sub), { duration: 0.8 });
  await scene.play(lagStart(bars.map((b, i) => [fadeIn(b, { shift: 'up' }), fadeIn(labels[i])]).flat(), { lag: 0.04 }), fadeIn(counter), { duration: 1.4 });
  const order = VALUES.map((_, i) => i);
  let swaps = 0;
  for (let i = 1; i < order.length; i++) {
    const key = order[i];
    await scene.play(bars[key].animate.set('fill', 'accent2'), { duration: 0.2 });
    let j = i;
    while (j > 0 && VALUES[order[j - 1]] > VALUES[key]) {
      const other = order[j - 1];
      order[j] = other;
      order[j - 1] = key;
      swaps++;
      const xa = x0 + (j - 1) * slot;
      const xb = x0 + j * slot;
      await scene.play(bars[key].animate.set('x', xa), labels[key].animate.set('x', xa), bars[other].animate.set('x', xb), labels[other].animate.set('x', xb), countTo(counter, swaps), { duration: 0.22 });
      j--;
    }
    await scene.play(bars[key].animate.set('fill', 'accent'), { duration: 0.15 });
  }
  const done = new Text(`${VALUES.length} bars, ${swaps} swaps: one for each out-of-order pair.`, { size: 'label', color: 'muted' });
  done.moveTo([0, 2.1]);
  await scene.play(fadeIn(done, { shift: 'up' }), { duration: 0.6 });
  await scene.wait(1.4);
}
