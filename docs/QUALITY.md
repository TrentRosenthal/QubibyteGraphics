# Visual quality rubric

Every rendered visual is graded on these criteria, 1 to 5. Anything under 4 is fixed and re-rendered. Scores and the PNG path go in `QUALITY_LOG.md`.

| Code | Criterion | 5 means | 3 means |
| --- | --- | --- | --- |
| a | Focal point | One element reads first at a glance; everything else is visibly secondary (smaller, lower contrast, or muted). | Two or more elements compete; the eye has no entry point. |
| b | Palette | Background, ink, muted ink, and one accent. Any second hue is semantic (quantum phase, |0> vs |1>) and documented in the theme. | A third unrelated hue, a saturated primary, or colors that do not come from the theme. |
| c | Type | At most two families (text, math). Sizes come from the theme scale. Labels are smaller and muted relative to titles. | Sizes chosen ad hoc; three weights fighting; labels as loud as titles. |
| d | Spacing | Margins at least 6% of the short side. Elements snap to a spacing scale; baselines and edges align. | Content touching edges, uneven gaps, near-miss alignments. |
| e | No default artifacts | No pure #ff0000 or #0000ff, no stock gray 3D, no single harsh light, no default 16px sans, no drop shadows, no gradient backgrounds unless the theme calls for one. | Any of those present. |
| f | Motion | Every animation eases. Staggered starts (lag ratio 0.05 to 0.3) instead of everything at once. Holds between beats. | Linear motion, simultaneous starts, no holds. |
| g | Ship test | A designer at Linear, Stripe, or 3Blue1Brown would ship the frame unchanged. | Needs one more pass. |

## How a visual is checked

1. Render the PNG at final resolution (1920x1080 unless the piece has another aspect ratio).
2. For animations: first frame, a frame 25% in, the middle, a frame 75% in, and the last frame. At least two of those land mid-transition.
3. Open every PNG and look at it at 100%.
4. Score a through g. Compare against the matching entry in `references.md` and write one line on the remaining gap.
5. Fix anything under 4 and repeat.

## House rules that fall out of the rubric

- Stroke widths: 2 px hairline for axes and grids, 3 px for curves, 4 px for emphasis, at 1080p. Scale with resolution.
- Grid lines at 12% to 18% ink opacity. Axes at 60%. Curves at 100%.
- Labels use the muted ink color and the `caption` size step.
- Titles are optional. When present: top left, `title` size, never centered over a plot.
- An accent color marks one thing per frame: the object the narration is about.
- Easing default is `smooth` (a cubic with gentle ends). Linear is only for continuous processes (a rotating phase, a cursor sweeping at constant speed).
