# Third-party software

Everything the project vendors or depends on, with its license. Runtime code in `vendor/` is copied unmodified from the published package.

| Component | Version | Where | Used for | License |
| --- | --- | --- | --- | --- |
| Inter | 4.001 (TTF) | `vendor/fonts/inter/` | UI face and the default text face in scenes | SIL Open Font License 1.1 (`vendor/fonts/inter/LICENSE.txt`) |
| KaTeX | 0.16.47 | `vendor/katex/katex.mjs` | Math layout | MIT (`vendor/katex/LICENSE`) |
| KaTeX fonts | 0.16.47 | `vendor/fonts/katex/` | Math glyphs; `KaTeX_Typewriter-Regular.ttf` is also the code face in the editor's code fields | SIL Open Font License 1.1 (`vendor/fonts/katex/LICENSE`) |
| Hershey fonts | kamalmostafa/hershey-fonts | `vendor/fonts/hershey/` | Single-stroke handwriting | Public domain derived data, distributed under the notice below |
| mp4-muxer | 5.2.2 | `vendor/mp4-muxer/mp4-muxer.mjs` | MP4 container for WebCodecs video and audio in the browser export | MIT (`vendor/mp4-muxer/LICENSE`) |
| webm-muxer | 5.1.4 | `vendor/webm-muxer/webm-muxer.mjs` | WebM container for opaque WebCodecs video and Opus in the browser export | MIT (`vendor/webm-muxer/LICENSE`) |
| @napi-rs/canvas | 0.1.100 | npm dependency | Canvas2D in Node for the CLI and tests (not used in the browser) | MIT |
| esbuild | 0.28.2 | dev dependency | Single-file bundle | MIT |
| eslint and @eslint/js | 10.x | dev dependency | Lint | MIT |
| c8 | 12.0.0 | dev dependency | Coverage | ISC |
| playwright-core | 1.63.0 | dev dependency | End-to-end tests and UI screenshots | Apache-2.0 |

## Notes

- The browser export encodes with WebCodecs only. mp4-muxer and webm-muxer are the published `build/*.mjs` files, fetched with `npm pack`; both packages are marked deprecated upstream in favor of Mediabunny, by the same author, and still work as vendored. Transparent WebM, the GIF and APNG encoders, and `src/playground/export/webm.js` (which writes alpha as BlockAdditions, a feature webm-muxer lacks for video) are our own code under the project license.
- The CLI uses the FFmpeg installed on the system; nothing from FFmpeg is vendored.

## Hershey fonts notice

The Hershey font data in `vendor/fonts/hershey/` comes from https://github.com/kamalmostafa/hershey-fonts, which redistributes the USENET distribution of the U.S. National Bureau of Standards data. That distribution carries this notice, reproduced as required:

> USE RESTRICTION: This distribution of the Hershey Fonts may be used by anyone for any purpose, commercial or otherwise, providing that:
>
> 1. The following acknowledgements must be distributed with the font data:
>    - The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.
>    - The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).
> 2. The font data in this distribution may be converted into any other format *EXCEPT* the format distributed by the U.S. NTIS (which organization holds the rights to the distribution and use of the font data in that particular format).
