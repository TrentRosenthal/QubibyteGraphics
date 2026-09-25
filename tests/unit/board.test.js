import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { setPlatform } from '../../src/core/platform.js';
import { handStrokes, hatchPath, pathArea, zigzag, erase, pageFlip, pageScroll, DimensionLine } from '../../src/board/index.js';
import { circlePath, polyPath, rectPath, pathBounds } from '../../src/core/path.js';
import { buildScene } from '../../src/core/scene.js';
import { Circle, Rect } from '../../src/core/shapes.js';
import { create } from '../../src/core/animations.js';
import { sampleFrame } from '../../src/core/sampler.js';
import { renderFrame } from '../../src/render/canvas.js';
import { renderSVG } from '../../src/render/svg.js';
import { getTheme } from '../../src/themes/index.js';

setPlatform({ createCanvas });

test('hand strokes are deterministic for a seed and differ between seeds', () => {
  const p = circlePath(0, 0, 1);
  const a = handStrokes(p, 5);
  const b = handStrokes(p, 5);
  const c = handStrokes(p, 6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a[0].pts.map((q) => q.x), c[0].pts.map((q) => q.x));
});

test('a closed loop overshoots past its start instead of closing exactly', () => {
  const [s] = handStrokes(circlePath(0, 0, 1), 3, { overshoot: 0.08, wobble: 0 });
  const L = s.pts[s.pts.length - 1].s;
  assert.ok(L > 2 * Math.PI * 1.04, `length ${L}`);
  assert.equal(s.closed, false);
});

test('a partially drawn stroke is a prefix of the full stroke', () => {
  const full = polyPath([[0, 0], [4, 0], [4, 3]]);
  const half = polyPath([[0, 0], [4, 0]]);
  const style = { endJitter: 0, taper: 0, bow: 0 };
  const A = handStrokes(full, 9, style)[0].pts;
  const B = handStrokes(half, 9, style)[0].pts;
  for (let i = 1; i < B.length - 1; i++) {
    assert.ok(Math.abs(A[i].x - B[i].x) < 1e-9 && Math.abs(A[i].y - B[i].y) < 1e-9, `point ${i} differs`);
  }
});

test('wobble stays within its amplitude budget', () => {
  const [s] = handStrokes(polyPath([[0, 0], [10, 0]]), 1, { wobble: 0.02, bow: 0, endJitter: 0 });
  for (const p of s.pts) assert.ok(Math.abs(p.y) <= 0.02 * 1.4 + 1e-9);
});

test('hatching stays inside the region and covers it', () => {
  const region = rectPath(0, 0, 4, 2);
  const h = hatchPath(region, 0.2, Math.PI / 4, 1);
  assert.ok(h.subpaths.length > 10);
  const b = pathBounds(h);
  assert.ok(b.x >= -2 - 1e-6 && b.x + b.w <= 2 + 1e-6 && b.y >= -1 - 1e-6 && b.y + b.h <= 1 + 1e-6);
  assert.ok(Math.abs(pathArea(region) - 8) < 1e-6);
});

test('zigzag covers the bounds', () => {
  const z = zigzag({ x: 0, y: 0, w: 4, h: 2 }, 0.5);
  const ys = z.map((p) => p[1]);
  assert.equal(Math.max(...ys), 2);
  assert.equal(Math.min(...ys), 0);
});

async function renderAt(scene, t, themeId) {
  const cv = createCanvas(320, 180);
  renderFrame(cv.getContext('2d'), sampleFrame(scene, t, getTheme(themeId)));
  return cv.getContext('2d').getImageData(0, 0, 320, 180).data;
}

function inkPixels(data, bg) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 90) n++;
  return n;
}

test('every board style renders marks, and erasing removes them', async () => {
  let c;
  const scene = await buildScene(async (s) => {
    c = new Circle({ radius: 2 });
    await s.play(create(c), { duration: 1 });
    await s.play(erase(c, { showEraser: false }), { duration: 1 });
    await s.wait(0.2);
  }, { width: 320, height: 180 });
  for (const id of ['chalkboard', 'whiteboard', 'paper', 'board-blueprint', 'qubibyte']) {
    const before = await renderAt(scene, 1, id);
    const after = await renderAt(scene, 2.1, id);
    const bg = [before[4 * (5 * 320 + 160)], before[4 * (5 * 320 + 160) + 1], before[4 * (5 * 320 + 160) + 2]];
    const nb = inkPixels(before, bg);
    const na = inkPixels(after, bg);
    assert.ok(nb > 150, `${id}: expected marks, got ${nb}`);
    assert.ok(na < nb * 0.2, `${id}: erase left ${na} of ${nb} marked pixels`);
  }
});

test('board SVG output is a valid document with hand-drawn paths', async () => {
  const scene = await buildScene(async (s) => {
    s.add(new Rect({ width: 3, height: 2 }));
  }, { width: 320, height: 180 });
  for (const id of ['chalkboard', 'whiteboard', 'paper', 'board-blueprint']) {
    const svg = renderSVG(sampleFrame(scene, 0, getTheme(id)));
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.ok((svg.match(/<path /g) || []).length >= 1, id);
  }
});

test('page flip hides the outgoing page and page scroll moves the camera', async () => {
  const r = new Rect({ width: 2, height: 1 });
  let cam;
  const scene = await buildScene(async (s) => {
    s.add(r);
    await s.play(pageFlip(r), { duration: 1 });
    await s.play(pageScroll(3), { duration: 1 });
    cam = s.camera;
  });
  assert.equal(scene.evaluateAt(1.5, () => r.visible), false);
  assert.ok(Math.abs(scene.evaluateAt(2, () => cam.y) + 3) < 1e-9);
});

test('dimension line places extension lines, arrowheads, and a midpoint', () => {
  const d = new DimensionLine([0, 0], [4, 0], { offset: -0.6 });
  assert.equal(d.children.length, 5);
  assert.ok(Math.abs(d.midpoint[0] - 2) < 1e-9);
  assert.ok(d.midpoint[1] < -0.6);
});
