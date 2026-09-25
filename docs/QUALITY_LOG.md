# Quality log

Every rendered visual is graded against `docs/QUALITY.md` (criteria a to g, 1 to 5; nothing ships under 4) and compared with the references in `docs/references.md`. Newest entries at the bottom. The example gallery and theme sheets were retired to keep the project focused on the editor and quantum views; their grades live in the git history.

## Interface

Editor (dark and light), wire view, export panel, theme panel, and embed demo, captured by `tests/e2e/ui-screenshots.test.js` (`QGFX_E2E=1 QGFX_SHOTS=1`). For interface screens, criterion f grades interface motion (eased 120 to 280 ms transitions, no bounce) and the playback of the scene shown. References: Linear issue view, Vercel docs, Observable, Figma editor (`docs/references.md`). First pass fixes: straight quotes in the code face, a wider preview below 1440 px, port labels with halos inside wire cards, a muted mode hint instead of the accent, grouped theme tokens, and a stacked top bar below 900 px.

| Render | a | b | c | d | e | f | g | Gap vs reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs/renders/ui-editor-dark-1920x1080.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Figma editor: one top bar, library left with Quantum first, inspector right, timeline under the canvas; with the Code tab gone the top bar holds only scene options and Export. |
| docs/renders/ui-editor-dark-1280x800.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | The canvas keeps the focus at 1280; the unitary matrix in the starter document sits close to the right edge of the frame. |
| docs/renders/ui-editor-light-1920x1080.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Vercel docs light: warm off-white chrome around the dark scene frame, which reads first by design. |
| docs/renders/ui-editor-light-1280x800.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Same as 1920; timeline labels and readouts keep tabular numerals. |
| docs/renders/ui-editor-wires-1920x1080.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Figma editor: library left, inspector right, canvas on a neutral surround; the wire overlay dims the scene to 40% so ports and wires read first, and Figma packs inspector fields more tightly. |
| docs/renders/ui-editor-wires-1280x800.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Port labels sit inside cards with a halo and no longer collide; the six Qubi outputs crowd a small card at this size. |
| docs/renders/ui-export-1920x1080.png | 5 | 5 | 4 | 4 | 5 | 4 | 4 | Linear command panels: an inline panel with one primary action, no modal; format descriptions are as terse as Linear's. |
| docs/renders/ui-export-1280x800.png | 5 | 5 | 4 | 4 | 5 | 4 | 4 | Same panel anchored under Export; it covers the inspector, as Linear's popovers cover the list. MP4 says it falls back to AV1 where the browser has no H.264 encoder. |
| docs/renders/ui-theme-1920x1080.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Figma color styles: the pastel green palette previews live on the canvas and tokens group into three sections; Figma shows swatches in a denser grid. |
| docs/renders/ui-theme-1280x800.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Contrast readouts sit below the fold at 800 px high; the canvas preview carries the change. |
| docs/renders/ui-embed-1920x1080.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Vercel docs column: 64 character measure, code block on a subtle surface; the embed frame edge is a hairline that is faint on the dark page. |
| docs/renders/ui-embed-1280x800.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Same layout; the control bar is one quiet row like a docs video player. |
