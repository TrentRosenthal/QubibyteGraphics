import { Circle, Rect, RegularPolygon, create, transform, fadeIn, lagStart } from '../src/index.js';

export const config = { theme: 'qubibyte' };

export default async function build(scene) {
  const c = new Circle({ radius: 1.2, x: -4 });
  const sq = new Rect({ width: 2.2, height: 2.2, radius: 0.1, stroke: 'accent' });
  const hex = new RegularPolygon({ radius: 1.25, x: 4, stroke: 'accent2' });
  await scene.play(lagStart([create(c), create(sq), create(hex)]));
  await scene.play(transform(c, new Circle({ radius: 0.6, x: -4, fill: 'accent', stroke: null })));
  await scene.play(fadeIn(new RegularPolygon({ sides: 3, radius: 0.5, fill: 'accent2', stroke: null, y: -2.5 }), { shift: 'up' }));
  await scene.wait(0.5);
}
