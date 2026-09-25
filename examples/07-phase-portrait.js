import { Axes, Tex, Text, Dot, create, fadeIn, lagStart, moveAlongPath } from '../src/index.js';
import { streamline } from '../src/core/plots.js';

export const config = { theme: 'navy-explainer', posterTime: 9 };

// The damped pendulum: arrows show the flow, streamlines follow it, and one
// trajectory spirals into the resting state.
const F = (x, y) => [y, -Math.sin(x) - 0.25 * y];

export default async function (scene) {
  const title = new Text('A damped pendulum, as a flow', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const eq = new Tex("\\theta'' = -\\sin\\theta - 0.25\\,\\theta'", { size: 0.5 });
  eq.toEdge('top-right', 0.75);
  const ax = new Axes({ x: [-7, 7], y: [-3, 3], width: 14.4, height: 6.2, style: 'cross', xLabels: false, yLabels: false, tips: false });
  ax.moveTo([0, -0.95]);
  const field = ax.vectorField(F, { step: 0.7, scale: 0.45 });
  const flow = ax.streamLines(F, { density: 0.5, length: 120, color: 'accent2' });
  const pts = streamline(F, [-2.6, 2.2], { h: 0.02, steps: 1400, bounds: [-7, 7, -3, 3] });
  const path = ax.polyline(pts, { color: 'accent', strokeWidth: 5 });
  path.set('visible', false);
  const bob = new Dot({ radius: 0.12, fill: 'accent' });
  await scene.play(fadeIn(title), fadeIn(eq), { duration: 0.8 });
  await scene.play(create(ax), { duration: 1 });
  await scene.play(lagStart(field.children.map((a) => create(a)), { lag: 0.01 }), { duration: 2 });
  await scene.play(create(flow), { duration: 2.5 });
  path.set('visible', true);
  scene.add(bob);
  bob.moveTo(ax.c2p(pts[0][0], pts[0][1]));
  await scene.play(create(path), moveAlongPath(bob, path), { duration: 4, ease: 'linear' });
  await scene.wait(1.2);
}
