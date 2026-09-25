import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../src/index.js';
import { frameToPDF } from '../../src/export/pdf.js';
import { toLottie, toAnimatedSVG, lottieShape } from '../../src/export/animated.js';
import { frameToVector } from '../../src/render/vector.js';
import { circlePath } from '../../src/core/path.js';

async function scene() {
  return Q.buildScene(async (s) => {
    const c = new Q.Circle({ radius: 1, fill: 'accent', stroke: null });
    s.add(new Q.Rect({ width: 2, height: 1, x: -3, stroke: 'ink', dash: [0.1, 0.1] }));
    await s.play(Q.fadeIn(c), { duration: 0.5 });
    await s.play(c.animate.shift([2, 0]), { duration: 0.5 });
  }, { width: 320, height: 180, fps: 10 });
}

test('PDF output has a valid cross-reference table and draws every path', async () => {
  const s = await scene();
  const { bytes } = frameToPDF(Q.sampleFrame(s, 1, Q.getTheme('qubibyte')));
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  // Every object offset in the table points at "N 0 obj".
  const table = text.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
  table.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
  assert.ok((text.match(/ c\n?/g) || []).length > 4, 'curves are written');
  assert.match(text, /\] 0 d/);
});

test('board themes export as hand-drawn vector ribbons', async () => {
  const s = await scene();
  const v = frameToVector(Q.sampleFrame(s, 1, Q.getTheme('chalkboard')));
  assert.ok(v.ops.length >= 2);
  assert.ok(v.ops.every((o) => o.kind !== 'path' || !o.stroke), 'strokes become filled ribbons');
  assert.ok(v.rasterized.some((r) => /chalkboard/.test(r)));
});

test('Lottie JSON has one shape layer per path with hold keyframes and a report', async () => {
  const s = await scene();
  const { json, report } = toLottie(s, Q.getTheme('qubibyte'));
  assert.equal(json.w, 320);
  assert.equal(json.op, 10);
  const shapes = json.layers.filter((l) => l.ty === 4);
  assert.equal(shapes.length, 2);
  const moving = shapes.find((l) => l.shapes[0].it[0].ks.a === 1);
  assert.ok(moving, 'the moving circle has animated path keyframes');
  assert.ok(moving.shapes[0].it[0].ks.k.every((k) => k.h === 1));
  assert.match(report, /Converted 2 paths/);
});

test('Lottie shapes convert closed cubic subpaths to vertices with tangents', () => {
  const sh = lottieShape(circlePath(0, 0, 1).subpaths[0]);
  assert.equal(sh.c, true);
  assert.equal(sh.v.length, 4);
  assert.ok(Math.abs(sh.o[0][1] - 0.552) < 0.01);
});

test('animated SVG uses discrete SMIL animations', async () => {
  const s = await scene();
  const { svg } = toAnimatedSVG(s, Q.getTheme('qubibyte'), { fps: 10 });
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /<animate attributeName="d"[^>]*calcMode="discrete"/);
});
