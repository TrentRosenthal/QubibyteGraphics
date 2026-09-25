# Benchmarks

Measured with `node tools/benchmark.js`. Sample is building the display list for a frame; raster is drawing it with the Canvas2D renderer. Encoding (PNG or video) is extra and runs in ffmpeg or worker threads, and `qgfx render --jobs n` splits frames across cores.

Node v22.22.2, Intel(R) Xeon(R) Processor @ 2.10GHz, 60 frames sampled evenly per scene, 1920x1080, one thread.

| Scene | Frames | Build (ms) | Sample (ms/frame) | Raster (ms/frame) | Frames per second |
| --- | --- | --- | --- | --- | --- |
| 09-taylor-series | 864 | 191 | 2.7 | 1.7 | 229 |
| 22-bell-state | 906 | 29 | 0.9 | 2.4 | 300 |
| 40-platonic-solids | 636 | 12 | 2.0 | 1.5 | 287 |
| 30-pythagoras-boards (chalkboard) | 942 | 16 | 1.4 | 298.9 | 3 |

## Reading the numbers

- Flat vector scenes, including explainers and 3D solids, sample and draw in a few milliseconds, well past real time.
- The chalkboard deposits chalk particle by particle and applies a grain mask. Particles are batched into eight opacity levels with one fill each, which halved its raster time; writing also gets its own lighter grain pass so small text reads, and at about 300 ms a frame it is still the slowest board. Whiteboard, paper, and blueprint are cheaper.
