# Your first scene

A scene is a module that exports an async function. It receives the scene, adds objects, and plays animations; `await` on each `play` advances the clock.

```js
import { Circle, Text, create, fadeIn, transform, Rect } from 'qubibyte-graphics';

export const config = { theme: 'qubibyte' };

export default async function (scene) {
  const title = new Text('Hello, shapes', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const c = new Circle({ radius: 1.5, stroke: 'accent', strokeWidth: 5 });
  await scene.play(fadeIn(title), create(c), { duration: 1.2 });
  await scene.play(transform(c, new Rect({ width: 3, height: 3, stroke: 'accent2', strokeWidth: 5 })));
  await scene.wait(1);
}
```

Render it:

```sh
qgfx render scene.js -o hello.mp4
qgfx still scene.js -o hello.png --time 2
```

Colors are theme tokens (`accent`, `accent2`, `ink`, `muted`), so the same scene works in every theme. Pass `--theme chalkboard` or `--board whiteboard` to see it on a board.
