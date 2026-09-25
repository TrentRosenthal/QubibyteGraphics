import { ComplexPlane, Circle, Dot, Polygon, Line, Tex, Text, create, write, fadeIn, lagStart, growFromCenter, rotate, Group } from '../src/index.js';

export const config = { theme: 'qubibyte', posterTime: 8 };

const N = 7;

// The seven solutions of z^7 = 1 sit evenly on the unit circle, and
// multiplying by the first root turns the whole set onto itself.
export default async function (scene) {
  const title = new Text('Seven roots of one', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const plane = new ComplexPlane({ x: [-1.6, 1.6], y: [-1.6, 1.6], width: 7, height: 7, style: 'cross', xLabels: false, yLabels: false, tips: false });
  plane.moveTo([3.3, -0.4]);
  const [cx, cy] = plane.c2p(0, 0);
  const R = plane.c2p(1, 0)[0] - cx;
  const circle = new Circle({ radius: R, x: cx, y: cy, stroke: 'muted', strokeWidth: 2.5 });
  const pts = Array.from({ length: N }, (_, k) => plane.c2p(Math.cos((2 * Math.PI * k) / N), Math.sin((2 * Math.PI * k) / N)));
  const poly = new Polygon(pts, { stroke: 'accent', strokeWidth: 3, fill: 'accent', fillOpacity: 0.1 });
  const spokes = pts.map((p) => new Line([cx, cy], p, { stroke: 'grid', strokeWidth: 2 }));
  const dots = pts.map((p, k) => new Dot({ radius: 0.12, x: p[0], y: p[1], fill: k === 0 ? 'accent2' : 'accent' }));
  const labels = pts.map((p, k) => {
    const t = new Tex(k === 0 ? '1' : k === 1 ? '\\omega' : `\\omega^{${k}}`, { size: 0.36, color: k === 0 ? 'accent2' : 'ink' });
    const ang = (2 * Math.PI * k) / N;
    t.moveTo([p[0] + 0.5 * Math.cos(ang), p[1] + 0.5 * Math.sin(ang)]);
    return t;
  });
  const eq = new Tex('z^{7} = 1', { size: 0.8 });
  eq.moveTo([-4.4, 1.5]);
  const omega = new Tex('\\omega = e^{2\\pi i/7}', { size: 0.6 });
  omega.moveTo([-4.4, 0.2]);
  const note = new Text('Multiplying by ω turns every root to the next one.', { size: 'label', color: 'muted', maxWidth: 5.2, align: 'center' });
  note.moveTo([-4.4, -1.1]);
  const star = new Group([poly, ...spokes, ...dots]);
  await scene.play(fadeIn(title), write(eq), { duration: 1 });
  await scene.play(create(plane), create(circle), { duration: 1.2 });
  await scene.play(lagStart(dots.map((d) => growFromCenter(d)), { lag: 0.12 }), lagStart(labels.map((l) => fadeIn(l)), { lag: 0.12 }), { duration: 1.6 });
  await scene.play(lagStart(spokes.map((s) => create(s)), { lag: 0.08 }), create(poly), { duration: 1.4 });
  await scene.play(write(omega), { duration: 1 });
  await scene.play(fadeIn(note, { shift: 'up' }), { duration: 0.6 });
  await scene.play(rotate(star, (2 * Math.PI) / N, { about: [cx, cy] }), { duration: 1.6 });
  await scene.play(rotate(star, (2 * Math.PI) / N, { about: [cx, cy] }), { duration: 1.6 });
  await scene.wait(1.2);
}
