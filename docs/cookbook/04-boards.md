# Chalkboard, whiteboard, paper, and blueprint

Any scene renders on a board with one switch. Text becomes handwriting, strokes get the medium's texture, and fills become hatching.

```sh
qgfx render proof.js --board chalkboard -o proof-chalk.mp4
qgfx render proof.js --board whiteboard -o proof-white.mp4
```

Or set it in the scene config:

```js
export const config = { theme: 'qubibyte', board: 'blueprint' };
```

The boards are `chalkboard`, `whiteboard`, `paper`, and `blueprint`; `clean` turns a board theme back into plain vector output. The `erase` animation wipes part of a board with an eraser that leaves a faint smudge.
