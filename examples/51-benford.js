import { Axes, Tex, Text, DecimalNumber, create, fadeIn, lagStart, countTo } from '../src/index.js';

export const config = { theme: 'scientific-paper', posterTime: 9 };

// Leading digits of 2^1 ... 2^1000, counted exactly with BigInt, against
// Benford's law log10(1 + 1/d).
const N = 1000;
function leadingDigits() {
  const counts = new Array(10).fill(0);
  let p = 1n;
  for (let n = 1; n <= N; n++) {
    p *= 2n;
    counts[Number(p.toString()[0])]++;
  }
  return counts.slice(1).map((c) => c / N);
}

export default async function (scene) {
  const title = new Text('Why so many powers of two start with 1', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const shares = leadingDigits();
  const ax = new Axes({ x: [0.3, 9.7], y: [0, 0.35], width: 9, height: 5.2, style: 'box', xTicks: [1, 2, 3, 4, 5, 6, 7, 8, 9], yTicks: [0, 0.1, 0.2, 0.3], xTitle: '\\text{leading digit}' });
  ax.moveTo([-2.3, -0.9]);
  const bars = ax.bars(shares.map(() => 0), { x: [1, 2, 3, 4, 5, 6, 7, 8, 9], width: 0.62, color: 'accent' });
  const law = ax.plot((d) => Math.log10(1 + 1 / d), { range: [0.75, 9.25], color: 'accent2', strokeWidth: 3.5 });
  law.set('visible', false);
  const formula = new Tex('P(d) = \\log_{10}\\!\\left(1 + \\tfrac{1}{d}\\right)', { size: 0.44, color: 'accent2' });
  formula.moveTo([5.2, 1.3]);
  const share1 = new DecimalNumber(0, { decimals: 1, size: 0.5, suffix: '\\%', align: 'left' });
  const lbl = new Text('start with 1', { size: 'label', color: 'muted' });
  share1.moveTo([3.4, 0.2], 'left');
  lbl.moveTo([5.05, 0.2], 'left');
  const note = new Text(`${N} powers of two, counted exactly.`, { size: 'caption', color: 'muted' });
  note.moveTo([3.4, -0.6], 'left');
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(ax), fadeIn(note), { duration: 1 });
  await scene.play(lagStart(bars.bars().map((b, i) => b.animate.set('value', shares[i])), { lag: 0.08 }), fadeIn(share1), fadeIn(lbl), countTo(share1, shares[0] * 100), { duration: 2.4 });
  law.set('visible', true);
  await scene.play(create(law), fadeIn(formula, { shift: 'up' }), { duration: 1.6 });
  await scene.wait(1.6);
}
