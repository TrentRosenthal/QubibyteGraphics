# Qubibyte Graphics

An animation engine for math and quantum computing. Write a scene in plain JavaScript, or a single line of math, or a Qubi program, and render it to video, stills, vector files, or an interactive web page.

**Live site:** https://trentrosenthal.github.io/QubibyteGraphics/ (the playground). Documentation, gallery, and API reference: https://trentrosenthal.github.io/QubibyteGraphics/docs/site/

![Grover search explainer](docs/renders/gallery/20-grover-explainer.png)

## What it does

- **Scenes in code.** Shapes, text, TeX, plots, coordinate systems, and 3D objects on one timeline. Every property can be animated, and sampling any frame is exact, so renders are deterministic and resumable.
- **Math from one line.** `explainMath('int_0^1 x e^x dx')` produces a narrated derivation from the built-in symbolic engine: derivatives, integrals, equations, matrix products, eigenvectors.
- **Quantum from Qubi.** `explainQubi('Grover(0b110)')` builds the circuit, simulates it, and animates the state column by column, with Grover geometry and QFT phase wheels. Bloch spheres, Q-spheres, density matrices, and printable 3D circuit models are all available.
- **Boards.** Any scene renders on a chalkboard, whiteboard, ruled paper, or a blueprint with one switch, with handwriting and hatching.
- **3D.** A vector projector with exact depth order, lighting, surfaces, polyhedra, textures from your own images, and STL, OBJ, glTF, and 3MF import and export.
- **Export.** MP4, HEVC, WebM with alpha, AV1, ProRes, MKV, GIF, APNG, WebP, image sequences, PDF, animated SVG, Lottie, and SRT captions.
- **Themes.** 19 built-in themes, from a 3Blue1Brown-style navy to high contrast, plus a palette helper that builds a theme from one color or a short description.

## Quick start

```sh
npm install
npx qgfx render examples/20-grover-explainer.js -o grover.mp4
npx qgfx still examples/09-taylor-series.js -o taylor.png --theme chalkboard
```

A scene is a module that exports an async function:

```js
import { Axes, Tex, create, write } from 'qubibyte-graphics';

export const config = { theme: 'navy-explainer' };

export default async function (scene) {
  const ax = new Axes({ x: [-4, 4], y: [-2, 2] });
  const graph = ax.plot((x) => Math.sin(x));
  const label = new Tex('y = \\sin x', { size: 0.6 });
  label.toEdge('top-left', 0.7);
  await scene.play(create(ax), write(label));
  await scene.play(create(graph), { duration: 2 });
}
```

Rendering needs Node 20 or newer and `ffmpeg` on the path for video formats. Everything else, including fonts, KaTeX, and the ffmpeg.wasm used by the browser exporter, is vendored.

## In the browser

Open `index.html` (or the live site) for the playground: edit code or Qubi on the left, scrub the timeline, and export from the page. The visual editor builds scenes from blocks without code, and the `<qubibyte-scene>` element embeds a scene in any page.

```html
<script type="module" src="https://trentrosenthal.github.io/QubibyteGraphics/qubibyte-scene.js"></script>
<qubibyte-scene src="my-scene.js" controls></qubibyte-scene>
```

## Documentation

- [Cookbook](docs/cookbook/01-first-scene.md): short recipes for common tasks
- [Qubi reference](docs/qubi-reference.md) and [standard library](docs/qubi-stdlib.md)
- [Quality rubric](docs/QUALITY.md) and [log](docs/QUALITY_LOG.md): every example is rendered, graded, and compared against a reference
- [Plan](docs/PLAN.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md)

## Development

```sh
npm test          # unit, parser, export, and golden tests
npm run lint      # ESLint plus the project's style and vocabulary checks
npm run gallery   # render every example's stills into docs/renders/gallery
npm run build     # optional bundles in dist/
npm run build:docs
```

## License

MIT. Vendored fonts and libraries keep their own licenses; see each folder under `vendor/`.
