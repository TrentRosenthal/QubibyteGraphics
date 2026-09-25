# Plan

Qubibyte Graphics is a programmatic animation engine written in plain JavaScript ES modules. It runs in the browser with no build step and in Node for headless rendering and export. Qubi is the quantum input format.

## Architecture

```
            scene document (JSON)
                   |
     +-------------+--------------+
     |                            |
 JS authoring API            visual editor
 (fluent, async)             (canvas + node graph)
     |                            |
     +-------------+--------------+
                   |
              scene graph  <---- themes (tokens) , board styles
                   |
               timeline  (tracks, labels, easing, updaters)
                   |
            frame sampler  (t -> resolved display list)
                   |
   +---------------+----------------+
   |               |                |
 Canvas2D        SVG            3D engine (own WebGL2 + software raster)
   |               |                |
   +------- export pipeline --------+
      PNG, SVG, PDF, Lottie, frames, FFmpeg (native in CLI, wasm in browser)
```

Every renderer consumes the same display list: a flat list of draw commands (paths with fill and stroke, images, text runs already converted to paths) produced by sampling the scene at time `t`. This is what makes frame N identical in preview and export.

## Package boundaries

| Directory | Responsibility | Depends on |
| --- | --- | --- |
| `src/core` | Vector math, paths (cubic Bezier), scene graph nodes, timeline, easing, interpolation, updaters, layout, seeded RNG, serialization | nothing |
| `src/text` | TrueType parser, glyph outlines to paths, text layout, KaTeX layout to paths, Hershey stroke fonts | core, vendor/katex |
| `src/math` | Expression parser, symbolic algebra, calculus, linear algebra, complex, numerics, statistics, graphs | nothing |
| `src/qubi` | Qubi lexer, grammar, evaluator, circuit model, scheduling | math (complex and matrix parsing) |
| `src/quantum` | Statevector, density matrix, stabilizer simulators, noise, analysis, importers and exporters, visualizations | qubi, math, core |
| `src/render` | Canvas2D renderer, SVG renderer, raster helpers | core |
| `src/three` | 3D scene, cameras, meshes, materials, WebGL2 and software rasterizers | core |
| `src/themes` | Theme token files, palette helper, contrast checks | core |
| `src/board` | Hand-drawn path transform, chalk, marker, paper, blueprint renderers, handwriting | core, text, render |
| `src/export` | Frame encoding, FFmpeg command builder, GIF quantizer, APNG, PDF, SVG, Lottie, 3MF, STL, SRT | core, render |
| `src/editor` | Visual editor: block library, canvas, node graph, inspector, timeline | everything |
| `src/embed` | `<qubibyte-scene>` custom element | core, render |
| `cli` | `qgfx` Node binary: render, export, gallery | everything |

## Build order

1. Scaffold: package.json, lints (ESLint, slop, vocabulary), CI, Pages deploy, planning docs.
2. Qubi parser and evaluator with a test for every construct and trap in the language reference.
3. Vertical slice: path, circle, timeline, Canvas2D render, PNG, MP4 through the CLI.
4. Text and math: TrueType parsing so text becomes real paths, KaTeX layout converted to paths so formulas morph and write on.
5. Quantum: simulators, circuit renderer, Bloch sphere, amplitude bars, explainers.
6. Math engine and derivation animations.
7. 3D engine, themes, board styles, handwriting.
8. Export matrix, playground, visual editor, embed, docs site, gallery and quality loop.

After each phase: a hostile self-review pass, then PROGRESS.md.

## Determinism

- Time is sampled as rational frame indices: `t = frame / fps`. No wall clock enters sampling.
- All randomness goes through `core/random.js` (a seeded xoshiro128** generator). Board styles derive per-object seeds from the scene seed and the object id.
- Text is converted to paths from bundled fonts, so rendering does not depend on system fonts.
- The Canvas2D backend is the reference; the SVG backend emits the same paths. Golden-image tests compare against expected PNGs with a small per-pixel tolerance for anti-aliasing differences.
