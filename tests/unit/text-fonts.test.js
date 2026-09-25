import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { parseFont, unwrapFont } from '../../src/text/ttf.js';
import { loadDefaultFonts, getFont, hasFont, registerFont } from '../../src/text/fonts.js';
import { loadBinary, registerFontBytes } from '../../src/text/assets.js';
import { pathBounds } from '../../src/core/path.js';

const root = new URL('../../', import.meta.url);
const bytes = (rel) => {
  const b = readFileSync(new URL(rel, root));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const inter = parseFont(bytes('vendor/fonts/inter/Inter-Regular.ttf'));
const cp = (s) => s.codePointAt(0);

/** Wrap sfnt bytes as WOFF 1.0 with zlib-compressed tables. */
function toWoff1(sfnt) {
  const dv = new DataView(sfnt);
  const n = dv.getUint16(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const off = dv.getUint32(r + 8);
    const len = dv.getUint32(r + 12);
    const raw = new Uint8Array(sfnt, off, len);
    const comp = deflateSync(raw);
    tables.push({ tag: new Uint8Array(sfnt, r, 4), raw, data: comp.length < len ? comp : raw, check: dv.getUint32(r + 4) });
  }
  let size = 44 + 20 * n;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]);
  o.setUint32(4, dv.getUint32(0));
  o.setUint32(8, size);
  o.setUint16(12, n);
  let p = 44 + 20 * n;
  tables.forEach((t, i) => {
    const r = 44 + i * 20;
    out.set(t.tag, r);
    o.setUint32(r + 4, p);
    o.setUint32(r + 8, t.data.length);
    o.setUint32(r + 12, t.raw.length);
    o.setUint32(r + 16, t.check);
    out.set(t.data, p);
    p += (t.data.length + 3) & ~3;
  });
  return out.buffer;
}

test('Inter metrics and names come from head, hhea, OS/2 and name', () => {
  assert.equal(inter.unitsPerEm, 2048);
  assert.equal(inter.familyName, 'Inter');
  assert.equal(inter.ascender, 1984);
  assert.equal(inter.descender, -494);
  assert.equal(inter.capHeight, 1490);
  assert.equal(inter.xHeight, 1118);
  assert.equal(inter.outlineFormat, 'truetype');
});

test('cmap maps ASCII and Greek; advances match hmtx', () => {
  assert.equal(inter.glyphIndex(cp('A')), 2);
  assert.equal(inter.advance(2), 1413);
  assert.equal(inter.advance(inter.glyphIndex(cp('H'))), 1522);
  assert.equal(inter.advance(inter.glyphIndex(cp('a'))), 1150);
  const alpha = inter.glyphIndex(cp('α'));
  assert.equal(alpha, 1110);
  assert.equal(inter.advance(alpha), 1360);
  assert.notEqual(inter.glyphIndex(cp('Ω')), 0);
  assert.equal(inter.glyphIndex(0x10ffff), 0);
  const math = parseFont(bytes('vendor/fonts/katex/KaTeX_Math-Italic.ttf'));
  assert.notEqual(math.glyphIndex(cp('π')), 0);
  assert.equal(math.familyName, 'KaTeX_Math');
});

test('GPOS pair kerning: AV and To are negative, HH is zero', () => {
  const g = (c) => inter.glyphIndex(cp(c));
  assert.equal(inter.kerning(g('A'), g('V')), -140);
  assert.ok(inter.kerning(g('T'), g('o')) < 0);
  assert.equal(inter.kerning(g('H'), g('H')), 0);
});

test('glyph paths are closed, cubic and inside sane bounds', () => {
  const p = inter.glyphPath(inter.glyphIndex(cp('a')));
  assert.equal(p.subpaths.length, 2);
  for (const s of p.subpaths) {
    assert.ok(s.closed);
    assert.equal((s.points.length - 2) % 6, 0);
  }
  const b = pathBounds(p);
  assert.ok(b.x > 0 && b.x < 200);
  assert.ok(b.y < 0 && b.y > -60, 'overshoot below the baseline');
  assert.ok(Math.abs(b.y + b.h - inter.xHeight) < 60, 'top near x-height');
  assert.equal(inter.glyphPath(inter.glyphIndex(cp('a'))), p, 'paths are cached');
  assert.equal(inter.glyphPath(inter.glyphIndex(cp(' '))).subpaths.length, 0);
});

test('composite glyphs resolve their components (e acute)', () => {
  const gid = inter.glyphIndex(cp('é'));
  const [off] = inter._locaRange(gid);
  assert.equal(inter.dv.getInt16(off), -1, 'é is stored as a composite');
  const e = pathBounds(inter.glyphPath(inter.glyphIndex(cp('e'))));
  const eAcute = inter.glyphPath(gid);
  const b = pathBounds(eAcute);
  assert.equal(eAcute.subpaths.length, 3);
  assert.ok(Math.abs(b.y - e.y) < 1, 'base letter at the same place');
  assert.ok(b.y + b.h > inter.capHeight, 'accent above the x-height');
});

test('CFF (Type 2 charstring) outlines parse from an OTF', () => {
  const f = parseFont(bytes('tests/unit/fixtures/text/katex-extra.otf'));
  assert.equal(f.outlineFormat, 'cff');
  const gid = f.glyphIndex(0x5f);
  assert.equal(gid, 1);
  const b = pathBounds(f.glyphPath(gid));
  assert.deepEqual([b.x, b.y, b.w, b.h], [-10, 0, 420, 120]);
  assert.equal(f.advance(gid), 400);
});

test('WOFF 1.0 unwraps to the same outlines as the TTF', async () => {
  const w = parseFont(await unwrapFont(toWoff1(bytes('vendor/fonts/inter/Inter-Regular.ttf'))));
  for (const c of 'Aé€g') {
    const g = inter.glyphIndex(cp(c));
    assert.equal(w.glyphIndex(cp(c)), g);
    assert.deepEqual(w.glyphPath(g), inter.glyphPath(g));
  }
  assert.equal(w.kerning(2, inter.glyphIndex(cp('V'))), -140);
});

test('WOFF 2.0 (Brotli, transformed glyf/loca/hmtx) matches the TTF', async () => {
  const w = parseFont(await unwrapFont(bytes('tests/unit/fixtures/text/katex-size3.woff2')));
  const t = parseFont(bytes('vendor/fonts/katex/KaTeX_Size3-Regular.ttf'));
  assert.equal(w.numGlyphs, t.numGlyphs);
  for (let g = 0; g < t.numGlyphs; g++) {
    assert.deepEqual(w.glyphPath(g), t.glyphPath(g));
    assert.equal(w.advance(g), t.advance(g));
  }
});

test('parseFont rejects wrapped and unknown data with a clear message', () => {
  assert.throws(() => parseFont(toWoff1(bytes('vendor/fonts/inter/Inter-Regular.ttf'))), /unwrapFont/);
  assert.throws(() => parseFont(new Uint8Array(64).buffer), /unrecognized font signature/);
});

test('registry: defaults, lookup errors, user fonts and asset overrides', async () => {
  await loadDefaultFonts();
  assert.equal(getFont('Inter', 'SemiBold').familyName, 'Inter');
  assert.ok(hasFont('KaTeX_Size4'));
  assert.ok(hasFont('KaTeX_Math', 'italic'));
  assert.throws(() => getFont('Inter', 'black'), /no style "black"/);
  assert.throws(() => getFont('Nope'), /not loaded/);
  const f = await registerFont('Extra', bytes('tests/unit/fixtures/text/katex-extra.otf'));
  assert.equal(getFont('Extra'), f);
  const fake = new ArrayBuffer(8);
  registerFontBytes('custom/font.ttf', fake);
  assert.equal(await loadBinary('custom/font.ttf'), fake);
  assert.throws(() => registerFontBytes('x', 'nope'), TypeError);
});
