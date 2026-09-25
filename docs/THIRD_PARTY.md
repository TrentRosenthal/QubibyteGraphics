# Third-party software

Everything the project vendors or depends on, with its license. Runtime code in `vendor/` is copied unmodified from the published package.

| Component | Version | Where | Used for | License |
| --- | --- | --- | --- | --- |
| Inter | 4.001 (TTF) | `vendor/fonts/inter/` | UI face and the default text face in scenes | SIL Open Font License 1.1 (`vendor/fonts/inter/LICENSE.txt`) |
| KaTeX | 0.16.47 | `vendor/katex/katex.mjs` | Math layout | MIT (`vendor/katex/LICENSE`) |
| KaTeX fonts | 0.16.47 | `vendor/fonts/katex/` | Math glyphs; `KaTeX_Typewriter-Regular.ttf` is also the code face in the playground | SIL Open Font License 1.1 (`vendor/fonts/katex/LICENSE`) |
| Hershey fonts | kamalmostafa/hershey-fonts | `vendor/fonts/hershey/` | Single-stroke handwriting | Public domain derived data, distributed under the notice below |
| @ffmpeg/ffmpeg | 0.12.15 | `vendor/ffmpeg/ffmpeg/` | Worker client for ffmpeg.wasm (browser export fallback) | MIT |
| @ffmpeg/util | 0.12.2 | `vendor/ffmpeg/util/` | Helpers shipped with the client | MIT |
| @ffmpeg/core | 0.12.10 | `vendor/ffmpeg/core/` (`ffmpeg-core.js`, `ffmpeg-core.wasm`, ESM) | Encoders WebCodecs lacks in a given browser: H.264 (x264) for MP4, VP8 with alpha for WebM; loaded only when an export needs it | GPL-2.0-or-later |
| @napi-rs/canvas | 0.1.100 | npm dependency | Canvas2D in Node for the CLI and tests (not used in the browser) | MIT |
| esbuild | 0.28.2 | dev dependency | Single-file bundle | MIT |
| eslint and @eslint/js | 10.x | dev dependency | Lint | MIT |
| c8 | 12.0.0 | dev dependency | Coverage | ISC |
| playwright-core | 1.63.0 | dev dependency | End-to-end tests and UI screenshots | Apache-2.0 |

## Notes

- ffmpeg.wasm is never part of the playground's initial load. `src/playground/export/ffmpeg.js` imports it from `vendor/ffmpeg/` inside the scene worker the first time an export needs it, and the GPL core runs in its own worker. The WebCodecs path, the muxers (`src/playground/export/mp4.js`, `webm.js`), and the GIF and APNG encoders are our own code under the project license.
- The versions of the ffmpeg.wasm packages are also recorded in `vendor/ffmpeg/VERSIONS.txt`.

## Hershey fonts notice

The Hershey font data in `vendor/fonts/hershey/` comes from https://github.com/kamalmostafa/hershey-fonts, which redistributes the USENET distribution of the U.S. National Bureau of Standards data. That distribution carries this notice, reproduced as required:

> USE RESTRICTION: This distribution of the Hershey Fonts may be used by anyone for any purpose, commercial or otherwise, providing that:
>
> 1. The following acknowledgements must be distributed with the font data:
>    - The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.
>    - The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).
> 2. The font data in this distribution may be converted into any other format *EXCEPT* the format distributed by the U.S. NTIS (which organization holds the rights to the distribution and use of the font data in that particular format).
