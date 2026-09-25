import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERSHEY_FONTS, parseJHF, buildFont, loadHershey, loadHersheyFonts, strokeText } from '../../src/text/hershey.js';

const jhf = (name) => readFileSync(new URL(`../../vendor/fonts/hershey/${name}.jhf`, import.meta.url), 'utf8');

before(() => loadHersheyFonts());

test('every bundled font has 96 records covering ASCII 32 to 127', () => {
  for (const name of HERSHEY_FONTS) assert.equal(parseJHF(jhf(name)).length, 96, name);
  const space = parseJHF(jhf('futural'))[0];
  assert.deepEqual(space.strokes, []);
  assert.equal(space.advance, 16);
});

test('pen order is preserved: futural A draws left leg, right leg, then the bar', () => {
  const A = buildFont('futural', jhf('futural')).glyphs.get(65);
  assert.equal(A.advance, 18);
  assert.deepEqual(A.strokes, [
    [[9, 21], [1, 0]],
    [[9, 21], [17, 0]],
    [[4, 7], [14, 7]],
  ]);
});

test('pen-up markers split strokes and records may span lines', () => {
  const glyphs = parseJHF('12345  6JZNFNM RVFVM\n12345  3JZNF\nNM\n');
  assert.equal(glyphs.length, 2);
  assert.equal(glyphs[0].strokes.length, 2);
  assert.deepEqual(glyphs[1].strokes, [[[4, 21], [4, 14]]]);
});

test('Greek fonts map letter slots to Greek code points', () => {
  const g = buildFont('greek', jhf('greek'));
  for (const ch of 'αβγδπθωΣΩΔ') assert.ok(g.glyphs.has(ch.codePointAt(0)), ch);
  assert.ok(!g.glyphs.has('a'.codePointAt(0)));
  assert.equal(g.glyphs.get('ϕ'.codePointAt(0)), g.glyphs.get('φ'.codePointAt(0)));
});

test('strokeText scales to cap height, advances glyphs and numbers strokes', () => {
  const r = strokeText('AA', { font: 'futural', size: 2.1 });
  assert.equal(r.strokes.length, 6);
  assert.deepEqual(r.strokes.map((s) => [s.glyphIndex, s.strokeIndex]), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  assert.deepEqual(r.strokes[0].points, [[0.9, 2.1], [0.1, 0]]);
  assert.ok(Math.abs(r.strokes[3].points[0][0] - 2.7) < 1e-12, 'second A starts one advance later');
  assert.ok(Math.abs(r.width - 3.6) < 1e-12);
});

test('math text falls back to the Greek font for Greek letters', async () => {
  const r = strokeText('x=π', { font: await loadHershey('timesi'), size: 1 });
  assert.deepEqual([...new Set(r.strokes.map((s) => s.glyphIndex))], [0, 1, 2]);
  assert.throws(() => strokeText('a', { font: 'nope' }), /not loaded/);
  assert.throws(() => loadHershey('nope'), /unknown font/);
});
