import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, logTicks, formatTick, cleanFloat } from '../../src/core/ticks.js';
import { sampleFunction, marchingSquares, streamline, histogram } from '../../src/core/plots.js';
import * as Q from '../../src/index.js';
import { Random } from '../../src/core/random.js';

test('nice ticks land on round numbers and cover the range', () => {
  assert.deepEqual(niceTicks(0, 10, 6).ticks, [0, 2, 4, 6, 8, 10]);
  const r = niceTicks(-3.7, 4.2, 5, true);
  for (const t of r.ticks) assert.ok(t >= -3.7 && t <= 4.2);
  assert.ok(r.ticks.includes(0));
  const small = niceTicks(0.0012, 0.0087, 5);
  assert.ok(small.ticks.every((t) => Math.abs(t / small.step - Math.round(t / small.step)) < 1e-6));
});

test('property: ticks are evenly spaced and increasing for random ranges', () => {
  const rng = new Random(3);
  for (let i = 0; i < 200; i++) {
    const a = rng.range(-1e3, 1e3);
    const b = a + 10 ** rng.range(-3, 4);
    const { ticks, step } = niceTicks(a, b, rng.int(3, 9), true);
    assert.ok(ticks.length >= 2, `${a}..${b}`);
    for (let k = 1; k < ticks.length; k++) assert.ok(Math.abs(ticks[k] - ticks[k - 1] - step) < step * 1e-6);
  }
});

test('log ticks and tick formatting', () => {
  assert.deepEqual(logTicks(1, 1000).major, [1, 10, 100, 1000]);
  assert.equal(formatTick(0.5, 0.1), '0.5');
  assert.equal(formatTick(3, 1), '3');
  assert.equal(formatTick(100000, 100000), '10^{5}');
  assert.equal(cleanFloat(0.1 + 0.2, 0.1), 0.3);
});

test('adaptive sampling breaks at poles and clips to the range', () => {
  const lines = sampleFunction((x) => 1 / x, -2, 2, (x, y) => [x, y], { yMin: -3, yMax: 3 });
  assert.equal(lines.length, 2);
  for (const l of lines) for (const [, y] of l) assert.ok(y >= -3 - 1e-9 && y <= 3 + 1e-9);
  const smooth = sampleFunction(Math.sin, 0, 6, (x, y) => [x, y], { yMin: -2, yMax: 2, tol: 0.001 });
  assert.equal(smooth.length, 1);
  for (const [x, y] of smooth[0]) assert.ok(Math.abs(Math.sin(x) - y) < 1e-12);
});

test('marching squares traces a circle as one closed loop near the radius', () => {
  const lines = marchingSquares((x, y) => x * x + y * y - 4, [-3, 3], [-3, 3], 60, 60);
  assert.equal(lines.length, 1);
  for (const [x, y] of lines[0]) assert.ok(Math.abs(Math.hypot(x, y) - 2) < 0.02);
});

test('streamlines of a rotation field stay on circles', () => {
  const pts = streamline((x, y) => [-y, x], [1, 0], { h: 0.01, steps: 300, bounds: [-2, 2, -2, 2] });
  for (const [x, y] of pts) assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-6);
});

test('histogram counts every sample', () => {
  const rng = new Random(1);
  const data = Array.from({ length: 500 }, () => rng.normal());
  const h = histogram(data);
  assert.equal(h.counts.reduce((a, b) => a + b, 0), 500);
});

test('axes map data to world points and back, and plots follow zooms', async () => {
  let ax;
  let g;
  const scene = await Q.buildScene(async (s) => {
    ax = s.add(new Q.Axes({ x: [0, 10], y: [0, 5], width: 10, height: 5 }));
    g = ax.plot((x) => x / 2);
    await s.play(ax.animate.zoomTo([0, 5], [0, 2.5]), { duration: 1 });
  });
  const [px, py] = scene.evaluateAt(0, () => ax.c2p(10, 5));
  assert.ok(Math.abs(px - 5) < 1e-9 && Math.abs(py - 2.5) < 1e-9);
  const [x, y] = scene.evaluateAt(0, () => ax.p2c(0, 0));
  assert.ok(Math.abs(x - 5) < 1e-9 && Math.abs(y - 2.5) < 1e-9);
  const end = scene.evaluateAt(1, () => g.pointAt(5));
  assert.ok(Math.abs(end[0] - 5) < 1e-9 && Math.abs(end[1] - 2.5) < 1e-9);
  const frame = Q.sampleFrame(scene, 0.5, Q.getTheme('qubibyte'));
  assert.ok(frame.items.some((i) => i.nodeType === 'axesLabel'));
});

test('Riemann sums converge to the integral', () => {
  const ax = new Q.Axes({ x: [0, 1], y: [0, 1] });
  const coarse = ax.riemann((x) => x * x, [0, 1], { n: 10, method: 'midpoint' }).sum();
  const fine = ax.riemann((x) => x * x, [0, 1], { n: 400, method: 'midpoint' }).sum();
  assert.ok(Math.abs(fine - 1 / 3) < Math.abs(coarse - 1 / 3));
  assert.ok(Math.abs(fine - 1 / 3) < 1e-5);
});
