import { Rect, Text, fadeIn } from '../src/index.js';
import roses from './06-polar-roses.js';
import roots from './08-roots-of-unity.js';

export const config = { theme: 'clean-dark', posterTime: 13.2 };

// Scenes compose: two gallery scenes play side by side, each inside its own
// scaled group, on one shared timeline.
export default async function (scene) {
  const title = new Text('Two scenes, one timeline', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const frames = [-4.05, 4.05].map((x) => new Rect({ width: 16 * 0.48 + 0.08, height: 9 * 0.48 + 0.08, x, y: -0.3, radius: 0.06, stroke: 'faint', strokeWidth: 2, fill: null }));
  await scene.play(fadeIn(title), ...frames.map((f) => fadeIn(f)), { duration: 0.6 });
  const start = scene.clock;
  await scene.include(roses, { x: -4.05, y: -0.3, scale: 0.48 });
  scene.clock = start;
  await scene.include(roots, { x: 4.05, y: -0.3, scale: 0.48 });
  await scene.wait(1);
}
