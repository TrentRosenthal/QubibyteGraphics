import { Circle, CurvedArrow, Tex, Text, Axes, create, fadeIn, lagStart, transformMatchingTex } from '../src/index.js';

export const config = { theme: 'clean-dark', posterTime: 12 };

// A three-state weather chain. Whatever the first day, the distribution
// settles into the same stationary mix.
const NAMES = ['Sun', 'Cloud', 'Rain'];
const P = [
  [0.6, 0.3, 0.1],
  [0.3, 0.4, 0.3],
  [0.2, 0.4, 0.4],
];
const POS = [[-4.8, 1.2], [-2.0, 1.2], [-3.4, -1.4]];

const step = (d) => d.map((_, j) => d.reduce((s, di, i) => s + di * P[i][j], 0));

export default async function (scene) {
  const title = new Text('A chain forgets where it started', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const R = 0.55;
  const nodes = POS.map(([x, y], i) => {
    const c = new Circle({ radius: R, x, y, stroke: 'accent', strokeWidth: 3, fill: 'accent', fillOpacity: 0.12 });
    const t = new Text(NAMES[i], { size: 'caption' });
    t.moveTo([x, y]);
    return [c, t];
  });
  const arrows = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const [a, b] = [POS[i], POS[j]];
      const arr = new CurvedArrow(a, b, { bend: 0.5, buff: R + 0.08, color: 'muted', strokeWidth: 2.5, headLength: 0.2, headWidth: 0.16 });
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const L = Math.hypot(dx, dy);
      const label = new Tex(String(P[i][j]), { size: 0.3, color: 'muted' });
      // The arc bulges to the right of travel by its sagitta; the label sits just beyond it.
      const r = L / 2 / Math.sin(0.25);
      const off = r * (1 - Math.cos(0.25)) + 0.2;
      label.moveTo([mx + (dy / L) * off, my - (dx / L) * off]);
      arrows.push(arr, label);
    }
  }
  const ax = new Axes({ x: [0, 4], y: [0, 1], width: 5.4, height: 4.2, style: 'box', xLabels: false, yTicks: [0, 0.5, 1] });
  ax.moveTo([3.9, -0.6]);
  let dist = [0, 0, 1];
  const bars = ax.bars(dist, { x: [1, 2, 3], width: 0.62, colors: ['accent', 'muted', 'accent2'] });
  const names = NAMES.map((n, i) => {
    const t = new Text(n, { size: 'caption', color: 'muted' });
    const [x, y] = ax.c2p(i + 1, 0);
    t.moveTo([x, y - 0.3]);
    return t;
  });
  const dayTex = (d) => {
    const t = new Tex(`\\text{day } ${d}`, { size: 0.5 });
    t.moveTo([3.9, 2.25]);
    return t;
  };
  let day = dayTex(0);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(lagStart(nodes.flat().map((n) => fadeIn(n)), { lag: 0.05 }), { duration: 1 });
  await scene.play(lagStart(arrows.map((a) => fadeIn(a)), { lag: 0.04 }), { duration: 1.4 });
  await scene.play(create(ax), fadeIn(day), lagStart(names.map((n) => fadeIn(n)), { lag: 0.1 }), { duration: 1 });
  for (let d = 1; d <= 8; d++) {
    dist = step(dist);
    const next = dayTex(d);
    await scene.play(...bars.bars().map((b, i) => b.animate.set('value', dist[i])), transformMatchingTex(day, next), { duration: d < 3 ? 0.9 : 0.5 });
    day = next;
  }
  const pi = new Tex(`\\pi \\approx (${dist.map((v) => v.toFixed(2)).join(',\\ ')})`, { size: 0.46, color: 'accent2' });
  pi.moveTo([3.9, -3.55]);
  await scene.play(fadeIn(pi, { shift: 'up' }), { duration: 0.8 });
  await scene.wait(1.5);
}
