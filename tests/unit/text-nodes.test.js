import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../src/index.js';
import { dwellStrokes } from '../../src/text/nodes.js';
import { pathLength } from '../../src/core/path.js';

await Q.preload();

test('Text is a group of glyph nodes centered on its position', () => {
  const t = new Q.Text('Hello', { size: 0.5, x: 2, y: 1 });
  assert.equal(t.glyphs.length, 5);
  const [cx, cy] = t.center();
  assert.ok(Math.abs(cx - 2) < 1e-9 && Math.abs(cy - 1) < 1e-9);
});

test('Tex parts address glyphs by token and color by token', () => {
  const t = new Q.Tex('x^2 + 2x + 1');
  const p = t.part('x^2');
  assert.equal(p.children.length, 2);
  t.colorTokens({ 1: 'accent' });
  assert.equal(t.glyphs[t.glyphs.length - 1].fill, 'accent');
  assert.throws(() => t.part('y'), /does not appear/);
});

test('transformMatchingTex keeps matching tokens and fades the rest', async () => {
  const a = new Q.Tex('x^2 + 2x');
  const b = new Q.Tex('x^2 + 2x + 1', { y: -1 });
  const scene = await Q.buildScene(async (s) => {
    s.add(a);
    await s.play(Q.transformMatchingTex(a, b), { duration: 1 });
  });
  assert.equal(scene.evaluateAt(1.01, () => a.visible), false);
  assert.equal(scene.evaluateAt(1.01, () => b.visible), true);
});

test('DecimalNumber re-typesets as its value animates', async () => {
  const n = new Q.DecimalNumber(0, { decimals: 1 });
  const scene = await Q.buildScene(async (s) => {
    s.add(n);
    await s.play(Q.countTo(n, 10), { duration: 1, ease: 'linear' });
  });
  const w0 = scene.evaluateAt(0, () => n.bounds().w);
  const w1 = scene.evaluateAt(1, () => n.bounds().w);
  assert.ok(w1 > w0);
  assert.equal(n.texFor(3.14159), '3.1');
});

test('board styles write text as strokes; clean themes fill outlines', async () => {
  let t;
  const scene = await Q.buildScene(async (s) => {
    t = s.add(new Q.Text('ab', { size: 0.6 }));
  });
  const clean = Q.sampleFrame(scene, 0, Q.getTheme('qubibyte')).items;
  const board = Q.sampleFrame(scene, 0, Q.getTheme('chalkboard')).items;
  assert.ok(clean.every((i) => i.fill && !i.stroke));
  assert.ok(board.every((i) => !i.fill && i.stroke && i.meta.handwriting));
  assert.equal(t.glyphs.length, 2);
});

test('dwell strokes pause between strokes and end complete', () => {
  const strokes = [[[0, 0], [1, 0]], [[0, 1], [1, 1]]];
  const half = dwellStrokes(strokes, 0.5);
  assert.ok(pathLength(half) < 1.01 && pathLength(half) > 0.9);
  assert.ok(Math.abs(pathLength(dwellStrokes(strokes, 1)) - 2) < 1e-9);
});
