import { Tex, Text, Group, Line, backdrop, fadeIn, create } from '../src/index.js';
import { TransformPlane, applyMatrix } from '../src/explainers/linear.js';

export const config = { theme: 'navy-explainer', posterTime: 7 };

// Most vectors get knocked off their span; eigenvectors only stretch.
export default async function (scene) {
  const A = [3, 1, 0, 2];
  const plane = scene.add(new TransformPlane({ range: [8, 5], unit: 0.9, basis: false, x: 1.8, y: -1.3, vectors: [[1, 0, 'accent2'], [-0.6, 0.6, 'accent2'], [1, 1, 'ink'], [0.5, 1, 'ink']] }));
  const [ox, oy] = [1.8, -1.3];
  const u = 0.9;
  // Spans of the two eigenvectors, drawn in world space before the transform.
  const span1 = new Line([ox - 9, oy], [ox + 9, oy], { stroke: 'accent2', strokeWidth: 3, strokeOpacity: 0.75, dash: [0.15, 0.12] });
  const span2 = new Line([ox + 6 * u, oy - 6 * u], [ox - 6 * u, oy + 6 * u], { stroke: 'accent2', strokeWidth: 3, strokeOpacity: 0.75, dash: [0.15, 0.12] });
  const m = new Tex('A = \\begin{bmatrix} 3 & 1 \\\\ 0 & 2 \\end{bmatrix}', { size: 0.55 });
  m.toEdge('top-left', 0.7);
  const eig = new Tex('A\\vec v = \\lambda \\vec v:\\quad \\lambda_1 = 3,\\ \\lambda_2 = 2', { size: 0.42, color: 'accent2' });
  eig.nextTo(m, 'down', 0.3, 'left');
  const note = new Text('The colored vectors stay on their dashed lines. The white ones turn.', { size: 'label', color: 'muted' });
  note.nextTo(eig, 'down', 0.28, 'left');
  const panel = new Group([m, eig, note]);
  panel.add(backdrop(panel, { pad: 0.28 }));
  panel.set('zIndex', 10);
  await scene.wait(0.4);
  await scene.play(fadeIn(panel, { shift: 'down' }), { duration: 0.9 });
  await scene.play(create(span1), create(span2), { duration: 1 });
  await scene.play(applyMatrix(plane, A), { duration: 3 });
  await scene.wait(2);
}
