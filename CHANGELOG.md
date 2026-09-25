# Changelog

## 0.1.0 (unreleased)

First release.

### Engine
- Scene graph with per-property timelines: exact sampling at any time, deterministic and resumable renders.
- Shapes, arrows (straight and bent), braces, splines, images, video nodes, and layers.
- `scene.include` composes scenes: another scene's build runs in its own group on the same timeline.
- `placeLabels` puts labels beside their anchors without covering each other, obstacles, or the frame edge.
- Animations: create, write, fade, grow, transform (with matching by key or TeX token), indicate, flash, circumscribe, move along a path, rotate, updaters, lag and succession.
- Text and TeX typeset to outlines (TTF parser and KaTeX layout, vendored), with font fallback for Greek and math symbols; code blocks with Qubi highlighting.
- Plots and coordinate systems: axes, number lines, complex and polar planes, adaptive function sampling, parametric and implicit curves, contours, vector fields, streamlines, heatmaps, Riemann sums, bar charts, histograms. Tick labels draw on a halo above plots.

### Math
- Symbolic engine with step-by-step derivatives, integrals, limits, series, equation solving, and simplification.
- Exact linear algebra, numerics, statistics, discrete math, complex analysis helpers, physics, and units.
- `explainMath` turns one expression into a narrated animation.

### Quantum
- The Qubi language: parser, evaluator, standard library, and scheduler.
- Statevector, density-matrix, stabilizer, and noisy simulators; OpenQASM, Qiskit, and Cirq import and export.
- Circuit diagrams, amplitude bars, phase disks, Dirac notation, Hinton diagrams, entanglement graphs, and `explainQubi` narrated explainers (Grover geometry, QFT phase wheels).

### 3D
- Vector projector with exact depth ordering, lighting in OKLab, and shadows.
- Polyhedra, surfaces, extrusion, marching cubes, image textures, Bloch sphere, Q-sphere, density-matrix city plots, printable circuit models; OBJ, STL, glTF, and 3MF import and export.

### Look
- 19 themes and a palette helper.
- Chalkboard, whiteboard, paper, and blueprint boards with handwriting, hatching, erasing, and page turns, all from one switch.

### Output
- `qgfx` CLI: MP4, HEVC, WebM with alpha, AV1, ProRes, MKV, GIF, APNG, WebP, image sequences, PDF, animated SVG, Lottie, SRT captions, and audio; chunked renders that resume.
- 42 graded gallery examples, theme sheets, golden-image tests, and a static documentation site.
