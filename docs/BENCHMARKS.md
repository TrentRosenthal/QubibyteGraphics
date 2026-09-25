# Benchmarks

Measured with `node tools/benchmark.js`. Sample is building the display list for a frame; raster is drawing it with the Canvas2D renderer. Encoding (PNG or video) is extra and runs in ffmpeg or worker threads, and `qgfx render --jobs n` splits frames across cores.

Node v22.22.2, Intel(R) Xeon(R) Processor @ 2.10GHz, 60 frames sampled evenly per scene, 1920x1080, one thread.

| Scene | Frames | Build (ms) | Sample (ms/frame) | Raster (ms/frame) | Frames per second |
| --- | --- | --- | --- | --- | --- |
| 09-taylor-series | 864 | 111 | 1.4 | 1.3 | 382 |
| 20-grover-explainer | 1488 | 89 | 1.9 | 2.8 | 214 |
| 07-phase-portrait | 690 | 22 | 1.5 | 1.7 | 306 |
| 40-platonic-solids | 636 | 15 | 1.7 | 1.1 | 352 |
| 41-surface-plot | 726 | 14 | 30.2 | 14.8 | 22 |
| 30-pythagoras-boards (chalkboard) | 942 | 15 | 1.3 | 195.0 | 5 |

## Reading the numbers

- Flat vector scenes, including explainers and 3D solids, sample and draw in a few milliseconds, well past real time.
- Dense 3D surfaces cost more because every face is depth-ordered exactly; 44 by 44 faces with axes take about 50 ms a frame.
- The chalkboard deposits chalk particle by particle and applies a grain mask. Particles are batched into eight opacity levels with one fill each, which halved its raster time (321 ms to about 170 ms a frame); it is still the slowest board. Whiteboard, paper, and blueprint are cheaper.
