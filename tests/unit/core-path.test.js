import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PathBuilder, circlePath, rectPath, polyPath, parseSVGPath, toSVGPath, pathBounds, pathLength, partialPath,
  alignPaths, lerpAligned, subdivideTo, segmentCount, pointAtFraction, transformPath, flattenPath, splitCubic,
} from '../../src/core/path.js';
import { Random } from '../../src/core/random.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('circle length is close to 2 pi r', () => {
  close(pathLength(circlePath(0, 0, 2)), 4 * Math.PI, 2e-3);
});

test('rect bounds and rounded rect bounds', () => {
  const b = pathBounds(rectPath(1, 2, 4, 2));
  close(b.x, -1);
  close(b.y, 1);
  close(b.w, 4);
  close(b.h, 2);
  const r = pathBounds(rectPath(0, 0, 4, 2, 0.5));
  close(r.w, 4, 1e-3);
  close(r.h, 2, 1e-3);
});

test('lineTo produces straight cubic segments with thirds as handles', () => {
  const p = new PathBuilder().moveTo(0, 0).lineTo(3, 0).build();
  assert.deepEqual(p.subpaths[0].points, [0, 0, 1, 0, 2, 0, 3, 0]);
});

test('SVG path parsing handles relative, smooth, and arc commands', () => {
  const p = parseSVGPath('M10 10 h20 v20 h-20 z m40 0 c0 10 10 10 10 0 s10 -10 10 0 Q 90 30 100 10 T 120 10 A 10 10 0 0 1 140 10');
  assert.equal(p.subpaths.length, 2);
  assert.equal(p.subpaths[0].closed, true);
  const b = pathBounds(p);
  close(b.x, 10, 1e-9);
  const last = p.subpaths[1].points;
  close(last[last.length - 2], 140, 1e-6);
  close(last[last.length - 1], 10, 1e-6);
});

test('SVG round trip preserves geometry', () => {
  const p = circlePath(1, 1, 3);
  const q = parseSVGPath(toSVGPath(p, 6));
  assert.equal(q.subpaths[0].points.length, p.subpaths[0].points.length);
  p.subpaths[0].points.forEach((v, i) => close(v, q.subpaths[0].points[i], 1e-5));
});

test('partialPath lengths are proportional', () => {
  const p = polyPath([[0, 0], [10, 0], [10, 10]]);
  close(pathLength(partialPath(p, 0, 0.5)), 10, 1e-6);
  close(pathLength(partialPath(p, 0.25, 0.75)), 10, 1e-6);
  assert.equal(partialPath(p, 0.6, 0.4).subpaths.length, 0);
});

test('subdivideTo keeps the shape exactly and reaches the requested count', () => {
  const s = circlePath(0, 0, 1).subpaths[0];
  const d = subdivideTo(s, 11);
  assert.equal(segmentCount(d), 11);
  for (let i = 0; i < d.points.length; i += 6) close(Math.hypot(d.points[i], d.points[i + 1]), 1, 3e-3);
});

test('splitCubic halves meet at the split point', () => {
  const c = [0, 0, 1, 2, 3, 2, 4, 0];
  const [l, r] = splitCubic(c, 0.3);
  assert.equal(l[6], r[0]);
  assert.equal(l[7], r[1]);
});

test('property: alignPaths produces compatible paths and lerp endpoints match inputs', () => {
  const rng = new Random(7);
  for (let trial = 0; trial < 60; trial++) {
    const randomPath = () => {
      const b = new PathBuilder();
      const subs = rng.int(1, 3);
      for (let s = 0; s < subs; s++) {
        b.moveTo(rng.range(-5, 5), rng.range(-5, 5));
        const n = rng.int(1, 6);
        for (let k = 0; k < n; k++) b.lineTo(rng.range(-5, 5), rng.range(-5, 5));
        if (rng.next() < 0.5) b.close();
      }
      return b.build();
    };
    const a = randomPath();
    const b = randomPath();
    const [A, B] = alignPaths(a, b);
    assert.equal(A.subpaths.length, B.subpaths.length);
    A.subpaths.forEach((s, i) => assert.equal(s.points.length, B.subpaths[i].points.length));
    const sameBounds = (p, q) => {
      const x = pathBounds(p);
      const y = pathBounds(q);
      for (const k of ['x', 'y', 'w', 'h']) close(x[k], y[k], 1e-6);
    };
    sameBounds(lerpAligned(A, B, 0), a);
    sameBounds(lerpAligned(A, B, 1), b);
    close(pathLength(lerpAligned(A, B, 0)), pathLength(a), 1e-6);
    close(pathLength(lerpAligned(A, B, 1)), pathLength(b), 1e-6);
  }
});

test('property: interpolation is continuous in t', () => {
  const [A, B] = alignPaths(circlePath(0, 0, 1), rectPath(3, 0, 2, 1));
  let prev = lerpAligned(A, B, 0);
  for (let i = 1; i <= 50; i++) {
    const cur = lerpAligned(A, B, i / 50);
    let maxd = 0;
    cur.subpaths[0].points.forEach((v, k) => (maxd = Math.max(maxd, Math.abs(v - prev.subpaths[0].points[k]))));
    assert.ok(maxd < 0.2, `jump of ${maxd} at step ${i}`);
    prev = cur;
  }
});

test('pointAtFraction walks arc length uniformly on a polyline', () => {
  const p = polyPath([[0, 0], [4, 0], [4, 4]]);
  const [x, y] = pointAtFraction(p, 0.75);
  close(x, 4, 1e-6);
  close(y, 2, 1e-4);
});

test('transformPath applies the affine matrix', () => {
  const p = transformPath(polyPath([[1, 0]]), [0, 1, -1, 0, 5, 5]);
  assert.deepEqual(p.subpaths[0].points.slice(0, 2), [5, 6]);
});

test('flattenPath approximates a circle within tolerance', () => {
  const [poly] = flattenPath(circlePath(0, 0, 10), 0.01);
  for (const [x, y] of poly.pts) close(Math.hypot(x, y), 10, 0.02);
});
