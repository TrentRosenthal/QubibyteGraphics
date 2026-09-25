# Progress

Status against the definition of done, kept current with each commit batch. "Done" means built, tested, rendered where visual, and graded in `docs/QUALITY_LOG.md`.

## Definition of done

| Item | Status | Where |
| --- | --- | --- |
| Live Pages URL in the README | Written; the Pages workflow deploys the default branch on every push once Pages is enabled in the repository settings with GitHub Actions as the source | `README.md`, `.github/workflows/pages.yml` |
| `npm test` clean | 658 tests pass; 21 browser tests pass under `npm run test:e2e` in Chromium. Unit, parser, export, and golden suites pass (87% of lines and 84% of branches covered, excluding the browser UI); lint includes an unused-export check | `tests/` |
| Narrated Grover and QFT explainers | Done | `examples/20-grover-explainer.js`, `examples/21-qft-explainer.js`, `src/quantum/explainers.js` |
| Editor Qubi block wired to Bloch, state, and unitary views | Done: wires carry state and unitary out of a Qubi block; dragging the Bloch handle writes RY and RZ back into the program (covered by an e2e test) | `src/editor/blocks.js`, `src/editor/ui/`, `docs/renders/ui-editor-wires-*.png` |
| Single-expression math animations | Done: derivatives, integrals, equations, matrix products, eigenvectors | `src/explainers/derivation.js`, examples 11 to 14 and 18 |
| Clean, whiteboard, and chalkboard from one switch | Done | `examples/30-pythagoras-boards.js` with `--board` |
| 40 graded gallery examples | Done: 42 | `examples/`, `docs/renders/gallery/`, `docs/QUALITY_LOG.md` |
| Every theme renders five reference scenes, graded | Done: 19 themes | `tools/render-themes.js`, `docs/renders/themes/` |
| User images as object, texture, and background | Done | `examples/50-images.js`, `ImagePlane3D`, `imageBackground` |

## By area

| Area | Status |
| --- | --- |
| Core scene graph, timeline, easing, animations | Done, with scene composition (`scene.include`) and collision-aware label placement |
| Text, TeX, handwriting, code blocks | Done |
| Plots and coordinate systems | Done; tick labels draw on a halo above plots |
| Math engine | Done: symbolic algebra and calculus with steps, linear algebra, numerics, statistics, discrete math, physics, units |
| Qubi language | Done: parser, evaluator, standard library, scheduling, 244 parser tests |
| Quantum simulation and views | Done: statevector, density matrix, stabilizer, noise; circuit diagrams, amplitude views, Dirac notation, explainers |
| 3D | Done: exact-order projector, lighting, polyhedra, surfaces, textures, Bloch sphere, Q-sphere, printable circuits, mesh import and export |
| Themes and palette helper | Done: 19 themes |
| Boards | Done: chalkboard, whiteboard, paper, blueprint, erase, page turns |
| Export | Done in Node: MP4, HEVC, WebM with alpha, AV1, ProRes, MKV, GIF, APNG, WebP, sequences, PDF, animated SVG, Lottie, SRT, audio |
| Playground, visual editor, embed, browser export | Done: playground with Qubi diagnostics and permalinks, block editor with wires and timeline, `<qubibyte-scene>` element, and PNG, MP4, WebM (with alpha), GIF, and APNG export in the browser |
| Documentation site | Done: `tools/build-docs.js` builds overview, cookbook, gallery with open-in-playground links, API reference, Qubi, themes, and quality pages |

## Known gaps

- The editor's Bloch block draws in 2D; the 3D `BlochSphere` is available to code scenes but not yet to the editor.
- Browser export: WebM with alpha is VP8 (the bundled ffmpeg.wasm's VP9 encoder crashes at 640x360 and above), and the editor's video and font assets are stored but not yet rendered.
- Video files play in Node renders (`openVideo`); in the browser a VideoNode needs a frame source with a `frameAt` method.
