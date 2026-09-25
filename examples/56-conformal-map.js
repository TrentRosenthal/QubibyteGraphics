import { ComplexPlane, Tex, Text, ValueTracker, create, fadeIn, lagStart, transformMatchingTex } from '../src/index.js';

export const config = { theme: 'navy-explainer', posterTime: 8 };

// The grid of the right half-plane pushed through z -> z^2: straight lines
// become parabolas, and every crossing stays a right angle.
const square = ([x, y]) => [x * x - y * y, 2 * x * y];

export default async function (scene) {
  const title = new Text('A map that keeps right angles', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const plane = new ComplexPlane({ x: [-2.2, 4.2], y: [-2.4, 2.4], width: 9.6, height: 7.2, grid: true, xLabels: false, yLabels: false, tips: false, gridColor: 'faint' });
  plane.moveTo([0.9, -0.55]);
  const k = scene.add(new ValueTracker(0));
  const warp = (p) => {
    const q = square(p);
    const u = k.value;
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  };
  const curves = [];
  for (let c = 0.25; c <= 1.51; c += 0.25) curves.push(plane.plotParametric((t) => warp([c, t]), { range: [-0.8, 0.8], samples: 160, color: 'accent', strokeWidth: 2.5 }));
  for (let c = -0.8; c <= 0.81; c += 0.2) curves.push(plane.plotParametric((t) => warp([t, c]), { range: [0.25, 1.5], samples: 160, color: 'accent2', strokeWidth: 2.5 }));
  curves.forEach((cv) => cv.set('visible', false));
  const eq = new Tex('w = z', { size: 0.6 });
  eq.toEdge('top-right', 0.75);
  const eq2 = new Tex('w = z^{2}', { size: 0.6 });
  eq2.toEdge('top-right', 0.75);
  await scene.play(fadeIn(title), fadeIn(eq), { duration: 0.7 });
  await scene.play(create(plane), { duration: 1 });
  curves.forEach((cv) => cv.set('visible', true));
  await scene.play(lagStart(curves.map((cv) => create(cv)), { lag: 0.04 }), { duration: 2 });
  await scene.wait(0.4);
  await scene.play(k.to(1), transformMatchingTex(eq, eq2), { duration: 3.2, ease: 'easeInOutCubic' });
  await scene.wait(1.6);
}
