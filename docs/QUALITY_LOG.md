# Quality log

Every rendered visual is graded against `docs/QUALITY.md` (criteria a to g, 1 to 5; nothing ships under 4) and compared with the references in `docs/references.md`. Newest entries at the bottom of each section.

## Gallery

| Example | Frame | a | b | c | d | e | f | g | Reference and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 17-linear-transformation | 50, 75 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | 3Blue1Brown, Essence of Linear Algebra ch. 3: grid, basis colors, and unit square match the convention; the reference labels axis ticks, ours leaves the grid unnumbered. |
| 04-fourier-epicycles | 50, 75 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3Blue1Brown, "But what is a Fourier series?": trail, arms, and faint circles read the same; the reference fades the trail tail, ours keeps it at full strength. |
| 20-grover-explainer | 50, 75, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Qiskit textbook Grover chapter: same bars-plus-geometry pairing; our circuit gets small at 35 operations, the reference splits oracle and diffuser into separate figures. |
| 21-qft-explainer | 75 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 3Blue1Brown-style phase wheels next to the Qiskit QFT figure: fractions read exactly; the two-line narration sits close to the Dirac line. |
| 22-bell-state | 75, 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Quirk and the Qiskit Bell example: magnitude bars, meters, and the classical wire are clearer than Quirk's; the reference shows measured counts, ours shows the pre-measurement state. |
| 23-ghz-state | 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Qiskit GHZ figure: same ladder; tie narration now names both outcomes. |
| 05-riemann-sums | 75, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 3Blue1Brown, Essence of Calculus ch. 8: same rectangles-to-area story with a live sum; the reference morphs each rectangle into its halves, ours fades between counts. |
| 06-polar-roses | 100 | 5 | 4 | 4 | 4 | 5 | 4 | 4 | Desmos polar rose demos: equal clarity; the reference shows the angle sweep, ours shows the equation morph. |
| 07-phase-portrait | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 3Blue1Brown, differential equations ch. 1 pendulum field: same field, streamlines, and spiral; the reference colors arrows by speed on a continuous scale, ours fades short arrows. |
| 08-roots-of-unity | 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Standard textbook roots-of-unity figure: the rotation by omega is animated, which the static reference cannot show. |
| 09-taylor-series | 100 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 3Blue1Brown, Taylor series: same growing partial sums; tick labels now sit on a background halo above the curves, as in the reference. |
| 10-central-limit | 50, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 3Blue1Brown, "But what is the Central Limit Theorem?": exact dice distributions converge on a live bell curve; the reference animates sampling, ours morphs exact distributions. |
| 15-gradient-descent | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Distill "Why Momentum Really Works": same zigzag in a narrow valley; heatmap cells no longer show seams at 1080p, a faint cell texture remains visible up close. |
| 16-eigenvectors | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 3Blue1Brown, Essence of Linear Algebra ch. 14: eigenvectors stay on dashed spans while others turn; the reference also labels the stretch factors on the vectors. |
| 30-pythagoras-boards (clean) | 50, 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Classic rearrangement proof figure (Wikipedia, Pythagorean theorem): same two panels, animated between them. |
| 30-pythagoras-boards (chalkboard) | 50, 100 | 4 | 5 | 4 | 5 | 5 | 4 | 4 | A lecture chalkboard photo: hatching and grain read as chalk; labels now wipe a band of hatching so they stay legible. |
| 30-pythagoras-boards (whiteboard) | 75, 100 | 4 | 5 | 4 | 5 | 5 | 4 | 4 | Marker whiteboard: same scene from the one --board switch; a faint surface halo under writing keeps labels clear of hatching. |
| 11-derivative | 100 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 3Blue1Brown calculus derivations: steps morph token by token with the rule narrated; the reference color-codes the factors of the product rule, ours keeps one ink color. |
| 12-definite-integral | 100 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | Textbook integration by parts: the problem stays pinned while later steps scroll; substituted values now print with explicit coefficients. |
| 13-matrix-product | 25, 100 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | Khan Academy matrix multiplication walkthrough: same row and column highlighting with the dot product written out below. |
| 14-eigenvectors-solved | 100 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 3Blue1Brown eigenvectors chapter plus the algebra beside it; the plane now clips its transformed grid to its own box. |
| 18-quadratic | 100 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | Textbook quadratic formula solution; each line is written, not chained with equals signs, since each is an equation. |
| 40-platonic-solids | 75 | 5 | 5 | 4 | 4 | 5 | 4 | 4 | Wikipedia Platonic solid renders: exact depth order, key/fill/rim light, and contact shadows match a raytraced look without a raytracer. |
| 41-surface-plot | 50, 75 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Manim ThreeDScene surface demos: height-shaded surface and orbiting camera; axis lines that pass behind the surface stay faintly visible. |
| 42-bloch-gates | 75, 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Qiskit Bloch sphere plots: the trail shows each gate's rotation, which the static reference cannot; kets now typeset with KaTeX. |
| 43-qsphere | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Qiskit plot_state_qsphere: same Hamming-weight latitudes and phase colors; labels now step away from the equator so none sits on its dot. |
| 50-images | 50, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Keynote image placement and a textured plane in Blender: the 3D texture keeps perspective with per-face affine pieces and no seams; the sample image is saturated by design, the dimmed background keeps text readable. |
| 44-cross-section | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Blender cutaway renders: the cut through the torus axis shows both circular tube sections as caps; the knot shows slight faceting on its tube. |
| 45-printable-circuit | 75, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 3D-printed circuit models shared by quantum educators: same wires, gates, and connectors on a base plate, generated from the Qubi program. |
| 24-teleportation | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Qiskit textbook teleportation: deferred-measurement corrections, the group box now starts after the state preparation, and the closing line states the teleported probability. |
| 25-bernstein-vazirani | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Qiskit textbook Bernstein-Vazirani: the single bar at the secret is the whole point; sixteen labels sit a little small. |
| 26-phase-estimation | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Qiskit textbook QPE: controlled phases then the inverse QFT inside one group box; the result bar reads 011 on the counting register. |
| 31-blueprint-construction | 100 | 4 | 5 | 4 | 5 | 5 | 4 | 4 | Drafting-style construction sheets (Byrne's Euclid for the idea, blueprint for the look): construction lines overshoot at corners, lettering no longer does, and periods draw as dots. |
| 01-shapes | 50, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Manim's Transform demos: point alignment keeps each morph free of jumps; the reference also rotates to the nearest correspondence, ours starts from the top point. |
| 32-paper-notes | 75, 100 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Handwritten study notes on ruled paper: secants close on the tangent while the algebra is written beside them; commas keep their tails in the hand font now. |
| 52-dijkstra | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Textbook Dijkstra figures (CLRS 24.6): the settled set, running distances, and final path appear in order from the engine's recorded steps; edges stop at node rims. |
| 53-insertion-sort | 50 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Sorting visualizers (visualgo): bars slide as pairs swap with a live swap count; the count's serif face differs from the title face. |
| 55-pendulum | 50 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Physics lecture demos: the bob and the trace are driven by one RK4 solution, so the angle on the left always matches the pen on the right. |
| 56-conformal-map | 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Needham, Visual Complex Analysis: the grid morphs into orthogonal parabolas at equal x and y scale; parametric curves now clip to their axes. |
| 54-markov-chain | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Setosa's Markov chain explainer: the distribution settles to the stationary mix from a rainy start; curved arrows now sweep their stated angle (a sign error had drawn near-full circles). |
| 19-typography | 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Kinetic type demos (Manim TransformMatchingShapes): anagram letters fly to their new places; the weight samples sit slightly unevenly spaced. |
| 51-benford | 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Benford's law figures in statistics texts: the leading digits of 2^1 to 2^1000, counted exactly, sit on log10(1 + 1/d); the caption starts a hair right of the percentage above it. |
| 00-first-scene | 75, 100 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | The playground's opening scene: formula, graph, and circuit share one timeline; the small caption text sits near the lower size limit at 1080p. |
| 57-composition | 75 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Picture-in-picture layouts in explainer videos: two gallery scenes play side by side, each scaled in its own group; the panels leave the lower quarter of the frame empty. |
| 58-palette-helper | 100 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Coolors-style palette previews: four themes from four phrases, each drawn in its own tokens; building it showed that color nouns like terracotta and forest were ignored, now fixed. |

## Themes

Each built-in theme renders the five reference scenes (Taylor series, roots of unity, derivative, Bell pair, Platonic solids) on one contact sheet in `docs/renders/themes/<theme>.png` (`node tools/render-themes.js`). Grades are for the sheet as a whole.

| Theme | a | b | c | d | e | f | g | Notes and fixes from this pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qubibyte | 4 | 5 | 4 | 4 | 5 | 4 | 4 | House theme; the reference look for the gallery. |
| clean-light | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Matches a textbook page. |
| clean-dark | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Neutral dark with teal and amber. |
| pastel | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Low contrast by design; body text stays above 4.5:1. |
| neon | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Glow stays on strokes only; text is not blurred. |
| mono-ink | 4 | 5 | 4 | 4 | 5 | 4 | 4 | 3D faces with a near-black base are lifted to mid gray so shading shows form (they rendered solid black before). |
| blueprint | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Clean vector blueprint; 3D solids draw as line work with dashed hidden edges. |
| scientific-paper | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Serif throughout, like a journal figure. |
| navy-explainer | 4 | 5 | 4 | 4 | 5 | 4 | 4 | The 3Blue1Brown-style reference theme. |
| retro-terminal | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Stroke-font text; a cache keyed by node id leaked text between scenes and is now keyed by node object. |
| sepia-notebook | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Text now falls back to KaTeX_Math for Greek letters the serif lacks (omega had dropped out). |
| corporate-slide | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Keynote-like blue and amber. |
| high-contrast | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Pure black with yellow and cyan; every label above 7:1. |
| chalkboard | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Chalk grain, hatching, and tray; handwriting from one switch. |
| chalkboard-slate | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Same board on slate black. |
| whiteboard | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Marker ink with a soft halo; writing wipes hatching beneath it. |
| whiteboard-gray | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Whiteboard on a gray surface. |
| paper | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Ruled notebook with pencil; accent2 deepened to amber so small text in it reads. |
| board-blueprint | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Drafting lines with corner overshoot on construction lines only. |

## Interface

Playground, visual editor, export panel, theme panel, and embed demo, captured by `tests/e2e/ui-screenshots.test.js` (`QGFX_E2E=1 QGFX_SHOTS=1`). For interface screens, criterion f grades interface motion (eased 120 to 280 ms transitions, no bounce) and the playback of the scene shown. References: Linear issue view, Vercel docs, Observable, Figma editor (`docs/references.md`). First pass fixes: straight quotes in the code face, a wider preview below 1440 px, port labels with halos inside wire cards, a muted mode hint instead of the accent, grouped theme tokens, and a stacked top bar below 900 px.

| Render | a | b | c | d | e | f | g | Gap vs reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs/renders/ui-code-dark-1920x1080.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Linear and Observable: one neutral ground, hairlines, accent only on Export and the plotted curve; Observable gives output more width than our 38% code column. |
| docs/renders/ui-code-dark-1280x800.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Preview stays the focal point after narrowing the side panels; gallery summaries clip at two lines where Vercel shows full descriptions. |
| docs/renders/ui-code-light-1920x1080.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Vercel docs light: warm off-white neutrals and quiet syntax colors; the dark scene frame on the light stage reads first by design. |
| docs/renders/ui-code-light-1280x800.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Same as 1920; transport and scrubber keep 13 px readouts and tabular numerals. |
| docs/renders/ui-editor-wires-1920x1080.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Figma editor: library left, inspector right, canvas on a neutral surround; the wire overlay dims the scene to 40% so ports and wires read first, and Figma packs inspector fields more tightly. |
| docs/renders/ui-editor-wires-1280x800.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Port labels sit inside cards with a halo and no longer collide; the six Qubi outputs crowd a small card at this size. |
| docs/renders/ui-export-1920x1080.png | 5 | 5 | 4 | 4 | 5 | 4 | 4 | Linear command panels: an inline panel with one primary action, no modal; format descriptions are as terse as Linear's. |
| docs/renders/ui-export-1280x800.png | 5 | 5 | 4 | 4 | 5 | 4 | 4 | Same panel anchored under Export; it covers part of the gallery, as Linear's popovers cover the list. |
| docs/renders/ui-theme-1920x1080.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Figma color styles: the pastel green palette previews live on the canvas and tokens group into three sections; Figma shows swatches in a denser grid. |
| docs/renders/ui-theme-1280x800.png | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Contrast readouts sit below the fold at 800 px high; the canvas preview carries the change. |
| docs/renders/ui-embed-1920x1080.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Vercel docs column: 64 character measure, code block on a subtle surface; the embed frame edge is a hairline that is faint on the dark page. |
| docs/renders/ui-embed-1280x800.png | 4 | 5 | 4 | 4 | 5 | 4 | 4 | Same layout; the control bar is one quiet row like a docs video player. |
