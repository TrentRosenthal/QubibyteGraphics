import { Axes, Tex, Text, Dot, create, fadeIn, lagStart, moveAlongPath, DecimalNumber, countTo } from '../src/index.js';

export const config = { theme: 'clean-dark', posterTime: 10 };

// A tilted valley: gradient descent zigzags across the narrow direction
// while it creeps along the long one.
const f = (x, y) => 0.5 * (x * x) / 9 + 2 * (y - 0.3 * x) ** 2;
const grad = (x, y) => [x / 9 - 1.2 * (y - 0.3 * x), 4 * (y - 0.3 * x)];

export default async function (scene) {
  const title = new Text('Gradient descent in a narrow valley', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const ax = new Axes({ x: [-6, 6], y: [-3, 3], width: 10, height: 5.5, style: 'box', xLabels: false, yLabels: false });
  ax.moveTo([-1.9, -0.8]);
  const heat = ax.heatmap(f, { cells: 90, range: [0, 22] });
  const lines = ax.contours(f, { levels: [0.05, 0.2, 0.5, 1, 2, 3.5, 5.5, 8], color: 'ink', resolution: 220 });
  // Plain steps with a fixed rate.
  const eta = 0.36;
  const pts = [[-5.4, -0.3]];
  for (let i = 0; i < 40; i++) {
    const [x, y] = pts[pts.length - 1];
    const [gx, gy] = grad(x, y);
    pts.push([x - eta * gx, y - eta * gy]);
  }
  const path = ax.polyline(pts, { color: 'accent2', strokeWidth: 3.5 });
  path.set('visible', false);
  const stepDots = pts.map(([x, y]) => ax.dot(x, y, { radius: 0.06, color: 'accent2' }));
  stepDots.forEach((d) => d.set('visible', false));
  const ball = new Dot({ radius: 0.13, fill: 'accent2' });
  const rule = new Tex('x_{k+1} = x_k - \\eta\\,\\nabla f(x_k)', { size: 0.44 });
  rule.moveTo([5.3, 1.4]);
  const etaTex = new Tex('\\eta = 0.36', { size: 0.42, color: 'muted' });
  etaTex.nextTo(rule, 'down', 0.3);
  const fLabel = new Tex('f =', { size: 0.46, color: 'muted' });
  fLabel.moveTo([5.1, -0.6]);
  const fValue = new DecimalNumber(f(...pts[0]), { decimals: 3, size: 0.46, color: 'accent2', align: 'left' });
  fValue.nextTo(fLabel, 'right', 0.18);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(ax), fadeIn(heat), { duration: 1.2 });
  await scene.play(lagStart(lines.children.map((l) => create(l)), { lag: 0.08 }), { duration: 1.6 });
  await scene.play(fadeIn(rule), fadeIn(etaTex), fadeIn(fLabel), fadeIn(fValue), { duration: 0.8 });
  scene.add(ball);
  ball.moveTo(ax.c2p(...pts[0]));
  path.set('visible', true);
  await scene.play(create(path), moveAlongPath(ball, path), countTo(fValue, f(...pts[pts.length - 1])), { duration: 5, ease: 'easeOutCubic' });
  stepDots.forEach((d) => d.set('visible', true));
  await scene.play(lagStart(stepDots.map((d) => fadeIn(d)), { lag: 0.02 }), { duration: 0.8 });
  await scene.wait(1.5);
}
