import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadDefaultFonts, getFont } from '../../src/text/fonts.js';
import { layoutText, textToPath } from '../../src/text/layout.js';
import { pathBounds } from '../../src/core/path.js';

before(() => loadDefaultFonts());

const PARA =
  'Knuth and Plass showed that breaking a paragraph into lines is best treated as a whole: a total-fit ' +
  'algorithm minimizes the badness of every line together, instead of filling each line greedily and ' +
  'leaving the last few lines to absorb whatever spacing remains at the end of the paragraph.';

test('glyphs are positioned left to right in world units, y up', () => {
  const L = layoutText('Hi', { size: 2 });
  const inter = getFont('Inter');
  assert.equal(L.paths.length, 2);
  const [h, i] = L.paths;
  assert.equal(h.char, 'H');
  assert.equal(h.x, 0);
  assert.ok(Math.abs(L.baseline + (inter.ascender / inter.unitsPerEm) * 2) < 1e-12);
  assert.equal(h.y, L.baseline);
  assert.ok(Math.abs(i.x - (inter.advance(h.glyphId) / inter.unitsPerEm) * 2) < 1e-9);
  const b = pathBounds(h.path);
  assert.ok(Math.abs(b.y - L.baseline) < 1e-6, 'H sits on the baseline');
  assert.ok(Math.abs(b.h - (inter.capHeight / inter.unitsPerEm) * 2) < 1e-6);
});

test('kerning tightens AV; letter spacing widens; kerning can be disabled', () => {
  const kern = layoutText('AV', { size: 1 });
  const flat = layoutText('AV', { size: 1, kerning: false });
  assert.ok(kern.paths[1].x < flat.paths[1].x);
  assert.ok(Math.abs(flat.paths[1].x - kern.paths[1].x - 140 / 2048) < 1e-9);
  const spaced = layoutText('AV', { size: 1, letterSpacing: 0.1 });
  assert.ok(Math.abs(spaced.paths[1].x - kern.paths[1].x - 0.1) < 1e-9);
});

test('whitespace makes no glyph entries but clusters index the source', () => {
  const L = layoutText('a bé', { size: 1 });
  assert.deepEqual(L.paths.map((p) => [p.char, p.cluster]), [['a', 0], ['b', 2], ['é', 3]]);
});

for (const breaking of ['greedy', 'optimal']) {
  test(`${breaking} breaking keeps every line inside maxWidth`, () => {
    const maxWidth = 6;
    const L = layoutText(PARA, { size: 0.3, maxWidth, breaking });
    assert.ok(L.lines.length >= 4);
    for (const line of L.lines) {
      assert.ok(line.width <= maxWidth + 1e-9, `line width ${line.width}`);
      for (const gi of line.glyphs) {
        const g = L.paths[gi];
        assert.ok(g.x + g.advance <= maxWidth + 0.3 * 0.1);
      }
    }
    const text = L.paths.map((p) => p.char).join('');
    assert.equal(text, PARA.replace(/ /g, ''), 'no characters lost or duplicated');
  });
}

test('an overlong word is broken between characters instead of overflowing', () => {
  const L = layoutText('Supercalifragilisticexpialidocious', { size: 1, maxWidth: 5 });
  assert.ok(L.lines.length > 1);
  for (const line of L.lines) assert.ok(line.width <= 5 + 1e-9);
});

test('justified paragraphs are flush on both edges except the last line', () => {
  const maxWidth = 6;
  const size = 0.3;
  const L = layoutText(PARA, { size, maxWidth, align: 'justify' });
  const inter = getFont('Inter');
  L.lines.forEach((line, li) => {
    const first = L.paths[line.glyphs[0]];
    const last = L.paths[line.glyphs[line.glyphs.length - 1]];
    assert.equal(first.x, 0);
    const right = last.x + (inter.advance(last.glyphId) / inter.unitsPerEm) * size;
    if (li < L.lines.length - 1) assert.ok(Math.abs(right - maxWidth) < 0.02 * size, `line ${li} ends at ${right}`);
    else assert.ok(right < maxWidth);
  });
});

test('Knuth-Plass spreads spacing more evenly than greedy', () => {
  const spread = (breaking) => {
    const L = layoutText(PARA, { size: 0.3, maxWidth: 6, breaking });
    const slack = L.lines.slice(0, -1).map((l) => 6 - l.width);
    return slack.reduce((s, v) => s + v * v, 0);
  };
  assert.ok(spread('optimal') <= spread('greedy'));
});

test('center and right alignment and line height', () => {
  const size = 0.5;
  const c = layoutText('one\nlonger line', { size, align: 'center', lineHeight: 1.5 });
  const r = layoutText('one\nlonger line', { size, align: 'right' });
  assert.equal(c.lines.length, 2);
  assert.ok(Math.abs(c.lines[1].y - c.lines[0].y + 1.5 * size) < 1e-9);
  assert.ok(Math.abs(c.lines[0].x - (c.width - c.lines[0].width) / 2) < 1e-9);
  assert.ok(Math.abs(r.lines[0].x + r.lines[0].width - r.width) < 1e-9);
  assert.equal(r.lines[1].x, 0);
});

test('textToPath merges glyphs and records each glyph subpath range', () => {
  const t = textToPath('Hé!', { size: 1 });
  assert.equal(t.glyphs.length, 3);
  let n = 0;
  for (const g of t.glyphs) {
    assert.equal(g.subpaths[0], n);
    assert.equal(g.subpaths[1] - g.subpaths[0], g.path.subpaths.length);
    assert.deepEqual(t.path.subpaths[g.subpaths[0]].points, g.path.subpaths[0].points);
    n = g.subpaths[1];
  }
  assert.equal(t.path.subpaths.length, n);
});

test('fallback fonts supply missing characters', () => {
  const inter = getFont('Inter');
  assert.equal(inter.glyphIndex(0x222e), 0);
  const L = layoutText('\u222e', { fallbacks: [getFont('KaTeX_Size1')] });
  assert.equal(L.paths.length, 1);
  assert.equal(L.paths[0].glyphId, getFont('KaTeX_Size1').glyphIndex(0x222e));
  assert.ok(L.paths[0].path.subpaths.length > 0);
});
