import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../src/index.js';

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

test('labels around crowded points do not overlap each other or the obstacle', async () => {
  await Q.preload();
  const anchors = [[0, 0], [0.3, 0.1], [0.6, 0], [0.2, -0.3], [-0.2, 0.25], [0.45, 0.35]];
  const obstacle = { x: -0.1, y: -0.1, w: 0.8, h: 0.2 };
  const items = anchors.map((a, i) => ({ label: new Q.Tex(`p_{${i}}`, { size: 0.4 }), anchor: a }));
  const placed = Q.placeLabels(items, { obstacles: [obstacle] });
  assert.equal(placed.length, anchors.length);
  for (let i = 0; i < placed.length; i++) {
    assert.ok(overlap(placed[i].box, obstacle) < 1e-9, `label ${i} covers the obstacle`);
    for (let j = 0; j < i; j++) assert.ok(overlap(placed[i].box, placed[j].box) < 1e-9, `labels ${i} and ${j} overlap`);
    const b = items[i].label.bounds();
    assert.ok(Math.abs(b.x - placed[i].box.x) < 1e-9 && Math.abs(b.y - placed[i].box.y) < 1e-9, 'the label moved to its box');
  }
});

test('a lone label goes to the right of its anchor, and stays inside the frame at the edge', async () => {
  await Q.preload();
  const t = new Q.Text('A', { size: 0.4 });
  const [p] = Q.placeLabels([{ label: t, anchor: [0, 0] }]);
  assert.ok(p.box.x > 0 && Math.abs(p.box.y + p.box.h / 2) < 1e-9);
  const e = new Q.Text('edge', { size: 0.4 });
  const [q] = Q.placeLabels([{ label: e, anchor: [7.9, 0] }]);
  assert.ok(q.box.x + q.box.w <= 8 + 1e-9, 'flips left at the right edge');
});
