import { Circle, Rect, RegularPolygon, Star, Text, create, transform, fadeIn, fadeOut } from '../src/index.js';

export const config = { theme: 'qubibyte', posterTime: 5.4 };

// Any path morphs into any other: the engine aligns their points, so a
// circle can become a square, a hexagon, and a star without a seam.
export default async function (scene) {
  const title = new Text('Every shape is a path', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const shapes = [
    [new Circle({ radius: 1.6, stroke: 'accent', strokeWidth: 5, fill: 'accent', fillOpacity: 0.12 }), 'Circle'],
    [new Rect({ width: 3, height: 3, radius: 0.12, stroke: 'accent', strokeWidth: 5, fill: 'accent', fillOpacity: 0.12 }), 'Square'],
    [new RegularPolygon({ sides: 6, radius: 1.75, stroke: 'accent2', strokeWidth: 5, fill: 'accent2', fillOpacity: 0.12 }), 'Hexagon'],
    [new Star({ points: 5, outerRadius: 1.9, innerRadius: 0.8, stroke: 'accent2', strokeWidth: 5, fill: 'accent2', fillOpacity: 0.16 }), 'Star'],
  ];
  const shape = shapes[0][0];
  shape.moveTo([0, -0.3]);
  const label = (text) => {
    const t = new Text(text, { size: 'label', color: 'muted' });
    t.moveTo([0, -2.8]);
    return t;
  };
  let name = label(shapes[0][1]);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(shape), fadeIn(name), { duration: 1.2 });
  for (const [target, text] of shapes.slice(1)) {
    await scene.wait(0.4);
    target.moveTo([0, -0.3]);
    const next = label(text);
    await scene.play(transform(shape, target), fadeOut(name, { duration: 0.3 }), fadeIn(next, { delay: 0.5 }), { duration: 1.2 });
    name = next;
  }
  await scene.wait(1.2);
}
