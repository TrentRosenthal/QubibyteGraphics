import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from '../../src/core/scene.js';
import { Circle, Rect, Arrow, Dot } from '../../src/core/shapes.js';
import { ValueTracker, Group } from '../../src/core/node.js';
import {
  create, fadeIn, fadeOut, transform, replacementTransform, rotate, lagStart, succession, stagger, indicate,
  moveAlongPath, orbit, matchByKeys, growArrow, typewriter, animateWith,
} from '../../src/core/animations.js';
import { sampleFrame } from '../../src/core/sampler.js';
import { getTheme } from '../../src/themes/index.js';
import { linear } from '../../src/core/easing.js';
import { circlePath } from '../../src/core/path.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('play advances the clock and records tweens that sample correctly at any time', async () => {
  let c;
  const scene = await buildScene(async (s) => {
    c = s.add(new Circle({ radius: 1 }));
    await s.play(c.animate.shift([4, 0]), { duration: 2, ease: linear });
    await s.wait(1);
  });
  assert.equal(scene.duration, 3);
  close(scene.evaluateAt(0, () => c.x), 0);
  close(scene.evaluateAt(1, () => c.x), 2);
  close(scene.evaluateAt(2.5, () => c.x), 4);
  // Sampling out of order gives identical results.
  close(scene.evaluateAt(1, () => c.x), 2);
  // Outside sampling, reads return the build-time final value.
  close(c.x, 4);
});

test('nodes added later are invisible before they appear', async () => {
  let d;
  const scene = await buildScene(async (s) => {
    await s.wait(1);
    d = s.add(new Dot());
    await s.wait(1);
  });
  assert.equal(scene.evaluateAt(0.5, () => d.visible), false);
  assert.equal(scene.evaluateAt(1.5, () => d.visible), true);
});

test('create draws the stroke from 0 to 1', async () => {
  let c;
  const scene = await buildScene(async (s) => {
    c = new Circle();
    await s.play(create(c), { duration: 1, ease: linear });
  });
  close(scene.evaluateAt(0.5, () => c.get('draw')), 0.5);
  close(scene.evaluateAt(1, () => c.get('draw')), 1);
  const theme = getTheme('qubibyte');
  const f = sampleFrame(scene, 0.5, theme);
  assert.equal(f.items.length, 1);
});

test('fadeOut hides at the end and restores opacity for later reuse', async () => {
  let c;
  const scene = await buildScene(async (s) => {
    c = s.add(new Circle());
    await s.play(fadeOut(c), { duration: 1, ease: linear });
  });
  close(scene.evaluateAt(0.5, () => c.opacity), 0.5);
  assert.equal(scene.evaluateAt(1.2, () => c.visible), false);
  close(scene.evaluateAt(1.2, () => c.opacity), 1);
});

test('rotate moves along a circle, not a chord', async () => {
  let r;
  const scene = await buildScene(async (s) => {
    r = s.add(new Rect({ width: 0.2, height: 0.2, x: 2 }));
    await s.play(rotate(r, Math.PI, { about: [0, 0] }), { duration: 1, ease: linear });
  });
  const [x, y] = scene.evaluateAt(0.5, () => [r.x, r.y]);
  close(Math.hypot(x, y), 2, 1e-9);
  close(x, 0, 1e-9);
});

test('stagger fits the whole group in the requested duration', () => {
  const t = stagger(5, 0, 2, 0.5);
  close(t[4][1], 2, 1e-12);
  close(t[1][0] - t[0][0], 0.5 * (t[0][1] - t[0][0]), 1e-12);
});

test('lagStart and succession timing', async () => {
  const a = new Circle();
  const b = new Circle();
  const scene = await buildScene(async (s) => {
    await s.play(succession([fadeIn(a, { duration: 1 }), fadeIn(b, { duration: 2 })]));
  });
  close(scene.duration, 3);
  assert.equal(scene.evaluateAt(0.5, () => b.visible), false);
  const scene2 = await buildScene(async (s) => {
    await s.play(lagStart([fadeIn(new Circle()), fadeIn(new Circle()), fadeIn(new Circle())], { duration: 2 }));
  });
  close(scene2.duration, 2);
});

test('transform morphs geometry and ends matching the target shape', async () => {
  let a;
  const target = new Rect({ width: 2, height: 2, x: 3, stroke: 'accent' });
  const scene = await buildScene(async (s) => {
    a = s.add(new Circle({ radius: 1 }));
    await s.play(transform(a, target), { duration: 1 });
  });
  const b = scene.evaluateAt(1, () => a.bounds());
  close(b.x, 2, 1e-6);
  close(b.w, 2, 1e-6);
  assert.equal(scene.evaluateAt(1, () => a.stroke), 'accent');
});

test('replacementTransform swaps visibility at the end', async () => {
  let a;
  const b = new Circle({ radius: 0.5, x: 2 });
  const scene = await buildScene(async (s) => {
    a = s.add(new Circle());
    await s.play(replacementTransform(a, b), { duration: 1 });
    await s.wait(0.5);
  });
  assert.equal(scene.evaluateAt(1.2, () => a.visible), false);
  assert.equal(scene.evaluateAt(1.2, () => b.visible), true);
  assert.equal(scene.evaluateAt(0.5, () => b.visible), false);
});

test('value trackers drive updaters (always)', async () => {
  let t;
  let d;
  const scene = await buildScene(async (s) => {
    t = new ValueTracker(0);
    s.add(t);
    d = s.add(new Dot());
    s.always(() => {
      d.x = t.value * 2;
    });
    await s.play(t.to(3), { duration: 1, ease: linear });
  });
  const theme = getTheme('qubibyte');
  const f = sampleFrame(scene, 0.5, theme);
  const item = f.items.find((i) => i.id === d.id);
  const xs = item.path.subpaths[0].points.filter((_, i) => i % 2 === 0);
  close((Math.max(...xs) + Math.min(...xs)) / 2, 3, 1e-9);
});

test('labels, waitUntil, at, and parallel', async () => {
  const scene = await buildScene(async (s) => {
    s.markers({ beat: 2.5 });
    await s.wait(1);
    s.label('one');
    await s.waitUntil('beat');
    assert.equal(s.clock, 2.5);
    await s.at(10, async () => {
      await s.wait(1);
    });
    assert.equal(s.clock, 2.5);
    await s.parallel(async () => s.wait(1), async () => s.wait(3));
    assert.equal(s.clock, 5.5);
  });
  assert.equal(scene.labels.get('one'), 1);
  close(scene.sceneDuration, 11);
});

test('speed changes and holds remap time', async () => {
  const scene = await buildScene(async (s) => {
    s.add(new Circle());
    await s.wait(2);
    s.setSpeed(2);
    await s.wait(2);
    s.hold(1);
    await s.wait(1);
  });
  close(scene.sceneToOutputTime(2), 2);
  close(scene.sceneToOutputTime(4), 3);
  close(scene.duration, 2 + 1 + 1 + 0.5);
  close(scene.outputToSceneTime(3.5), 4, 1e-6);
  close(scene.outputToSceneTime(4.25), 4.5, 1e-6);
});

test('move along path and orbit keep the expected geometry', async () => {
  let d;
  let e;
  const scene = await buildScene(async (s) => {
    d = s.add(new Dot({ x: 1 }));
    e = s.add(new Dot({ x: 3 }));
    await s.play(moveAlongPath(d, circlePath(0, 0, 1)), orbit(e, [0, 0]), { duration: 1, ease: linear });
  });
  for (const t of [0.1, 0.33, 0.8]) {
    const [x, y] = scene.evaluateAt(t, () => d.center());
    close(Math.hypot(x, y), 1, 5e-3);
    const [ex, ey] = scene.evaluateAt(t, () => e.center());
    close(Math.hypot(ex, ey), 3, 1e-9);
  }
});

test('matchByKeys finds the longest common subsequence', () => {
  assert.deepEqual(matchByKeys(['x', '^2', '+', '2', 'x'], ['x', '^2', '+', '2', 'x', '+', '1']), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  const m = matchByKeys(['a', null, 'b'], ['b', 'a']);
  assert.equal(m.length, 1);
  assert.ok((m[0][0] === 0 && m[0][1] === 1) || (m[0][0] === 2 && m[0][1] === 0));
});

test('indicate returns to the original scale', async () => {
  let c;
  const scene = await buildScene(async (s) => {
    c = s.add(new Circle({ x: 2 }));
    await s.play(indicate(c));
  });
  close(scene.evaluateAt(0.5, () => c.get('scaleX')), 1.2, 1e-9);
  close(scene.evaluateAt(1, () => c.get('scaleX')), 1, 1e-9);
  close(scene.evaluateAt(0.5, () => c.center()[0]), 2, 1e-9);
});

test('growArrow extends the end point from the start', async () => {
  let a;
  const scene = await buildScene(async (s) => {
    a = new Arrow([0, 0], [4, 0]);
    await s.play(growArrow(a), { duration: 1, ease: linear });
  });
  close(scene.evaluateAt(0.5, () => a.get('x2')), 2, 1e-2);
});

test('typewriter reveals leaves in order', async () => {
  const g = new Group([new Dot(), new Dot({ x: 1 }), new Dot({ x: 2 })]);
  const scene = await buildScene(async (s) => {
    await s.play(typewriter(g), { duration: 3 });
  });
  const vis = (t) => scene.evaluateAt(t, () => g.children.map((c) => c.opacity));
  assert.deepEqual(vis(0.5), [1, 0, 0]);
  assert.deepEqual(vis(2.5), [1, 1, 1]);
});

test('animateWith runs during the animation and bakes the final state', async () => {
  let c;
  const scene = await buildScene(async (s) => {
    c = s.add(new Circle());
    await s.play(animateWith((u) => c.set('radius', 1 + u), { duration: 1, ease: linear }));
    await s.wait(1);
  });
  const theme = getTheme('qubibyte');
  const r = (t) => {
    const f = sampleFrame(scene, t, theme);
    const xs = f.items[0].path.subpaths[0].points.filter((_, i) => i % 2 === 0);
    return (Math.max(...xs) - Math.min(...xs)) / 2;
  };
  close(r(0.5), 1.5, 1e-9);
  close(r(1.5), 2, 1e-9);
});

test('scene.include runs a sub-scene inside one transformed group on the same timeline', async () => {
  const Q = await import('../../src/index.js');
  let inner;
  let box;
  const sub = async (s) => {
    inner = s.add(new Q.Circle({ radius: 1, x: 2 }));
    await s.play(inner.animate.set('x', 4), { duration: 1 });
  };
  const scene = await Q.buildScene(async (s) => {
    await s.wait(0.5);
    box = await s.include(sub, { x: -1, scale: 0.5 });
    s.add(new Q.Dot());
  });
  assert.equal(inner.parent, box);
  assert.equal(box.parent, scene.root);
  assert.equal(scene.root.children.at(-1).type, 'dot', 'adds after include go back to the root');
  assert.ok(Math.abs(scene.duration - 1.5) < 1e-9);
  const [x] = scene.evaluateAt(1.5, () => inner.center());
  assert.ok(Math.abs(x - (-1 + 0.5 * 4)) < 1e-9, `center x ${x}`);
  assert.equal(scene.evaluateAt(0.25, () => inner.get('visible')) && scene.evaluateAt(0.25, () => box.get('visible')), false, 'the included group appears when it is included');
});
