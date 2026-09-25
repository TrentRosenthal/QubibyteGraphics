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
