import { Circle, Line, Dot, Polygon, Tex, Text, create, write, fadeIn, lagStart } from '../src/index.js';

export const config = { theme: 'qubibyte', board: 'blueprint', posterTime: 11 };

// Euclid, Elements I.1: an equilateral triangle on a given segment, with
// nothing but a compass and a straightedge.
export default async function (scene) {
  const title = new Text('Elements I.1', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const sub = new Text('An equilateral triangle on a given segment', { size: 'label', color: 'muted' });
  sub.nextTo(title, 'down', 0.15, 'left');
  const r = 3;
  const A = [-3.6, -1.1];
  const B = [-0.6, -1.1];
  const C = [-2.1, -1.1 + r * Math.sqrt(3) / 2];
  const ab = new Line(A, B, { stroke: 'ink', strokeWidth: 3.5 });
  const dots = [A, B].map((p) => new Dot({ x: p[0], y: p[1], radius: 0.08 }));
  const la = new Tex('A', { size: 0.5 });
  la.moveTo([A[0] - 0.35, A[1] - 0.3]);
  const lb = new Tex('B', { size: 0.5 });
  lb.moveTo([B[0] + 0.35, B[1] - 0.3]);
  const ca = new Circle({ radius: r, x: A[0], y: A[1], stroke: 'accent', strokeWidth: 2.5 });
  const cb = new Circle({ radius: r, x: B[0], y: B[1], stroke: 'accent', strokeWidth: 2.5 });
  const cDot = new Dot({ x: C[0], y: C[1], radius: 0.09, fill: 'accent2' });
  const lc = new Tex('C', { size: 0.5, color: 'accent2' });
  lc.moveTo([C[0], C[1] + 0.4]);
  const tri = new Polygon([A, B, C], { stroke: 'accent2', strokeWidth: 4, fill: 'accent2', fillOpacity: 0.12 });
  const steps = [
    'Draw the circle about A through B.',
    'Draw the circle about B through A.',
    'They meet at C. Join CA and CB.',
    'CA = AB and CB = AB: all three sides are equal.',
  ].map((t, i) => {
    const n = new Text(`${i + 1}. ${t}`, { size: 'label', maxWidth: 4.6 });
    n.moveTo([3.0, 1.5 - i * 1.0], 'left');
    return n;
  });
  await scene.play(fadeIn(title), fadeIn(sub), { duration: 0.8 });
  await scene.play(create(ab), lagStart(dots.map((d) => fadeIn(d)), { lag: 0.1 }), write(la), write(lb), { duration: 1.4 });
  await scene.play(write(steps[0]), { duration: 1 });
  await scene.play(create(ca), { duration: 2 });
  await scene.play(write(steps[1]), { duration: 1 });
  await scene.play(create(cb), { duration: 2 });
  await scene.play(write(steps[2]), fadeIn(cDot), write(lc), { duration: 1.2 });
  await scene.play(create(tri), { duration: 1.6 });
  await scene.play(write(steps[3]), { duration: 1.2 });
  await scene.wait(1.5);
}
