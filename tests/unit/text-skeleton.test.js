import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadDefaultFonts } from '../../src/text/fonts.js';
import { texToPaths } from '../../src/text/tex.js';
import { rasterizePath, thin, skeletonize, outlineStrokes } from '../../src/text/skeleton.js';
import { rectPath, mergePaths } from '../../src/core/path.js';

before(() => loadDefaultFonts());

const glyphPath = (tex) => texToPaths(tex, { size: 1, display: true }).paths[0].path;

/** Fraction of stroke sample points that land on filled pixels (with a one-pixel margin). */
function inside(bm, strokes) {
  let hit = 0;
  let n = 0;
  for (const s of strokes) {
    for (const [x, y] of s.points) {
      n++;
      const cx = Math.floor((x - bm.x0) / bm.px);
      const cy = Math.floor((bm.y1 - y) / bm.px);
      let ok = false;
      for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) ok = bm.data[(cy + dy) * bm.w + cx + dx] === 1;
      if (ok) hit++;
    }
  }
  return hit / n;
}

/** Fraction of filled pixels within `r` pixels of some stroke segment. */
function coverage(bm, strokes, r) {
  const segs = [];
  for (const s of strokes) {
    for (let i = 1; i < s.points.length; i++) segs.push([s.points[i - 1], s.points[i]]);
  }
  let filled = 0;
  let near = 0;
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) {
      if (!bm.data[y * bm.w + x]) continue;
      filled++;
      const px = bm.x0 + (x + 0.5) * bm.px;
      const py = bm.y1 - (y + 0.5) * bm.px;
      const lim = r * bm.px;
      const hit = segs.some(([a, b]) => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py) <= lim;
      });
      if (hit) near++;
    }
  }
  return near / filled;
}

test('scanline fill: nonzero keeps overlaps solid, even-odd punches them out', () => {
  const p = mergePaths(rectPath(0, 0, 2, 2), rectPath(0, 0, 1, 1));
  const nz = rasterizePath(p, { resolution: 40 });
  const eo = rasterizePath(p, { resolution: 40, fillRule: 'evenodd' });
  const centre = (bm) => bm.data[Math.floor(bm.h / 2) * bm.w + Math.floor(bm.w / 2)];
  assert.equal(centre(nz), 1);
  assert.equal(centre(eo), 0);
  const count = (bm) => bm.data.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(count(nz) - 40 * 40) <= 2 * 41);
  assert.ok(Math.abs(count(eo) - 0.75 * 40 * 40) <= 4 * 41);
});

test('Zhang-Suen thins a thick bar to a one-pixel line', () => {
  const bm = thin(rasterizePath(rectPath(0, 0, 10, 1), { resolution: 100 }));
  for (let x = 20; x < 80; x++) {
    let col = 0;
    for (let y = 0; y < bm.h; y++) col += bm.data[y * bm.w + x];
    assert.equal(col, 1, `column ${x}`);
  }
});

for (const [tex, expect] of [
  ['x', { min: 2, max: 4 }],
  ['2', { min: 1, max: 1 }],
  ['\\int', { min: 1, max: 1 }],
]) {
  test(`skeleton of ${tex} lies inside the outline and covers it`, () => {
    const path = glyphPath(tex);
    const strokes = skeletonize(path, { resolution: 96 });
    assert.ok(strokes.length >= expect.min && strokes.length <= expect.max, `${strokes.length} strokes`);
    strokes.forEach((s, i) => {
      assert.equal(s.strokeIndex, i);
      assert.ok(s.points.length >= 2);
    });
    const bm = rasterizePath(path, { resolution: 96 });
    assert.ok(inside(bm, strokes) > 0.97, 'strokes stay inside the ink');
    assert.ok(coverage(bm, strokes, 9) > 0.97, 'every inked pixel is near a stroke');
  });
}

test('pen direction: the integral is drawn from its top hook down', () => {
  const [s] = skeletonize(glyphPath('\\int'));
  assert.ok(s.points[0][1] > s.points[s.points.length - 1][1]);
  const [bar] = skeletonize(rectPath(0, 0, 4, 0.3));
  assert.ok(bar.points[0][0] < bar.points[bar.points.length - 1][0], 'horizontal strokes run left to right');
});

test('outlineStrokes keeps glyph order and numbering', () => {
  const r = texToPaths('a+b', { size: 1 });
  const strokes = outlineStrokes(r.paths);
  const glyphs = [...new Set(strokes.map((s) => s.glyphIndex))];
  assert.deepEqual(glyphs, [0, 1, 2]);
  const plus = strokes.filter((s) => s.glyphIndex === 1);
  assert.equal(plus.length, 2, 'the plus sign is two strokes');
  assert.ok(Math.abs(plus[0].points[0][1] - plus[0].points[plus[0].points.length - 1][1]) > 0.3 || plus[0].points[0][0] < plus[0].points[plus[0].points.length - 1][0]);
});
