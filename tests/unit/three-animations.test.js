import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from '../../src/core/scene.js';
import { sampleFrame } from '../../src/core/sampler.js';
import { getTheme } from '../../src/themes/index.js';
import {
  Scene3D, Camera3D, Mesh3D, Group3D, Surface3D, Lines3D, box, polyhedron, uvSphere, torus, rotate3D, morphMesh, surfaceSweep,
  unfold, explode, crossSection, orbitCamera, flyThrough, cameraTo, create3D, quat, faceNormals, meshArea, isClosed, vec3,
} from '../../src/three/index.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const theme = getTheme('qubibyte');

async function build(fn) {
  let ref = null;
  const scene = await buildScene(async (sc) => {
    ref = await fn(sc);
  }, { width: 320, height: 180 });
  return { scene, ref };
}

function at(scene, t, fn) {
  return scene.evaluateAt(t, fn);
}

test('rotate3D follows the true rotation, including more than half a turn', async () => {
  const { scene, ref: m } = await build(async (sc) => {
    const s = new Scene3D();
    const obj = new Mesh3D(box(1, 2, 3));
    s.add(obj);
    sc.add(s);
    await sc.play(rotate3D(obj, [1, 1, 0], (3 * Math.PI) / 2, { ease: 'linear' }), { duration: 2 });
    return obj;
  });
  const axis = vec3.normalize([1, 1, 0]);
  for (const [t, ang] of [[0.5, (3 * Math.PI) / 8], [1, (3 * Math.PI) / 4], [2, (3 * Math.PI) / 2]]) {
    const q = at(scene, t, () => m.get('quat'));
    const v = [0.3, -0.2, 1];
    const got = quat.rotate(q, v);
    const want = vec3.rotateAxis(v, axis, ang);
    got.forEach((x, i) => close(x, want[i], 1e-9));
  }
});

test('rotate3D about a pivot moves the position along the circle', async () => {
  const { scene, ref: m } = await build(async (sc) => {
    const s = new Scene3D();
    const obj = new Mesh3D(box(0.2, 0.2, 0.2), { position: [2, 0, 0] });
    s.add(obj);
    sc.add(s);
    await sc.play(rotate3D(obj, [0, 0, 1], Math.PI / 2, { about: [0, 0, 0] }), { duration: 1 });
    return obj;
  });
  const p = at(scene, 0.5, () => [m.get('x'), m.get('y'), m.get('z')]);
  close(Math.hypot(p[0], p[1]), 2, 1e-9);
  const end = at(scene, 1, () => [m.get('x'), m.get('y')]);
  close(end[0], 0, 1e-9);
  close(end[1], 2, 1e-9);
});

test('a cube morphs smoothly into a sphere through a shared topology', async () => {
  const { scene, ref: m } = await build(async (sc) => {
    const s = new Scene3D();
    const obj = new Mesh3D(box(2, 2, 2));
    s.add(obj);
    sc.add(s);
    await sc.play(morphMesh(obj, uvSphere(1.2, 48, 24), { resolution: 8 }), { duration: 1 });
    return obj;
  });
  const meshAt = (t) => at(scene, t, () => m.currentMesh(m.worldMatrix3D()).mesh);
  const mid = meshAt(0.5);
  const end = meshAt(1);
  assert.equal(mid.faces.length, end.faces.length);
  assert.ok(isClosed(mid));
  let maxR = 0;
  let minR = Infinity;
  for (let i = 0; i < mid.positions.length; i += 3) {
    const r = Math.hypot(mid.positions[i], mid.positions[i + 1], mid.positions[i + 2]);
    maxR = Math.max(maxR, r);
    minR = Math.min(minR, r);
  }
  assert.ok(minR > 1.05 && maxR < Math.sqrt(3) - 0.05, `${minR} ${maxR}`);
  for (let i = 0; i < end.positions.length; i += 3) close(Math.hypot(end.positions[i], end.positions[i + 1], end.positions[i + 2]), 1.2, 0.01);
  const a = meshArea(meshAt(0.49));
  const b = meshArea(meshAt(0.51));
  assert.ok(Math.abs(a - b) / a < 0.02, 'no jumps between nearby frames');
});

test('surface sweep draws a parametric surface in along u', async () => {
  const { scene, ref: s3 } = await build(async (sc) => {
    const s = new Scene3D();
    const surf = new Surface3D((u, v) => [u, v, Math.sin(u) * Math.cos(v)], { u: [-2, 2], v: [-2, 2], nu: 20, nv: 20 });
    s.add(surf);
    sc.add(s);
    await sc.play(surfaceSweep(surf, { axis: 'u' }), { duration: 1 });
    return surf;
  });
  const extent = (t) => at(scene, t, () => {
    const m = s3.currentMesh(s3.worldMatrix3D()).mesh;
    let x = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) x = Math.max(x, m.positions[i]);
    return x;
  });
  assert.ok(extent(0.25) < extent(0.5) && extent(0.5) < extent(0.9));
  close(extent(1), 2, 1e-9);
});

test('unfold lays a cube flat into its net', async () => {
  const { scene, ref: m } = await build(async (sc) => {
    const s = new Scene3D();
    const obj = new Mesh3D(box(1, 1, 1));
    s.add(obj);
    sc.add(s);
    await sc.play(unfold(obj), { duration: 1 });
    return obj;
  });
  const net = at(scene, 1, () => m.currentMesh(m.worldMatrix3D()).mesh);
  const N = faceNormals(net);
  for (let i = 0; i < net.faces.length; i++) close(Math.abs(N[i * 3 + 2]), 1, 1e-9);
  const f = sampleFrame(scene, 0.5, theme);
  assert.ok(f.items.filter((i) => i.meta.role === 'face').length >= 6, 'the unfolding net shows faces from both sides');
});

test('exploded view moves parts outward from the center', async () => {
  const { scene, ref: g } = await build(async (sc) => {
    const s = new Scene3D();
    const grp = new Group3D();
    for (const x of [-0.5, 0.5]) grp.add(new Mesh3D(box(1, 1, 1), { position: [x, 0, 0] }));
    s.add(grp);
    sc.add(s);
    await sc.play(explode(grp, { distance: 1 }), { duration: 1 });
    return grp;
  });
  const xs = at(scene, 1, () => g.children.map((c) => c.get('x')));
  close(xs[0], -1.5);
  close(xs[1], 1.5);
});

test('cross section clips with a moving plane and caps the cut', async () => {
  const { scene, ref: m } = await build(async (sc) => {
    const s = new Scene3D();
    const obj = new Mesh3D(torus(1, 0.4, 32, 16));
    s.add(obj);
    sc.add(s);
    await sc.play(crossSection(obj, { normal: [1, 0, 0], from: 1.5, to: 0 }), { duration: 1 });
    return obj;
  });
  const r = at(scene, 1, () => m.currentMesh(m.worldMatrix3D()));
  assert.ok(r.capFaces > 0);
  assert.ok(isClosed(r.mesh));
  const f = sampleFrame(scene, 1, theme);
  const accent = f.items.filter((i) => i.meta.role === 'face' && i.fill && Math.abs(i.fill.b - 0.87) < 0.2);
  assert.ok(accent.length > 0);
  const early = at(scene, 0.1, () => m.currentMesh(m.worldMatrix3D()));
  assert.equal(early.capFaces, 0);
});

test('camera orbit, fly-through, and slerped camera moves', async () => {
  const { scene, ref } = await build(async (sc) => {
    const s = new Scene3D();
    const cam = s.camera;
    s.add(new Mesh3D(box(1, 1, 1)));
    sc.add(s);
    await sc.play(orbitCamera(cam, { dTheta: Math.PI / 2 }), { duration: 1 });
    const cam2 = new Camera3D();
    s.addCamera(cam2);
    await sc.play(flyThrough(cam2, [[6, 0, 1], [0, 6, 2], [-6, 0, 3]], { lookAt: [0, 0, 0] }), { duration: 1 });
    const cam3 = new Camera3D({ position: [5, 0, 0], target: [0, 0, 0] });
    s.addCamera(cam3);
    await sc.play(cameraTo(cam3, { position: [0, 0, 5], target: [0, 0, 0] }), { duration: 1 });
    return { cam, cam2, cam3, theta0: new Camera3D().get('theta') };
  });
  const th = at(scene, 1, () => ref.cam.get('theta'));
  close(th, ref.theta0 + Math.PI / 2, 1e-9);
  const eyeEnd = at(scene, 2, () => ref.cam2.eye());
  [-6, 0, 3].forEach((v, i) => close(eyeEnd[i], v, 1e-9));
  const fwd = at(scene, 1.5, () => {
    const b = ref.cam2.basis();
    const toC = vec3.normalize(vec3.sub([0, 0, 0], b.eye));
    return vec3.dot(b.forward, toC);
  });
  close(fwd, 1, 1e-9);
  const mid = at(scene, 2.5, () => ref.cam3.get('orient'));
  close(Math.hypot(...mid), 1, 1e-12);
  const q0 = quat.lookRotation([5, 0, 0], [0, 0, 0]);
  const q1 = quat.lookRotation([0, 0, 5], [0, 0, 0]);
  const half = quat.slerp(q0, q1, at(scene, 2.5, () => 0.5));
  const angleFromStart = quat.angle(quat.multiply(mid, quat.conjugate(q0)));
  assert.ok(angleFromStart > 0.1 && angleFromStart < quat.angle(quat.multiply(q1, quat.conjugate(q0))));
  assert.ok(Math.abs(quat.dot(half, half) - 1) < 1e-12);
});

test('projection morph animates from perspective to orthographic', async () => {
  const { scene, ref: cam } = await build(async (sc) => {
    const s = new Scene3D();
    s.add(new Mesh3D(box(1, 1, 1)));
    sc.add(s);
    await sc.play(s.camera.animate.set('ortho', 1), { duration: 1 });
    return s.camera;
  });
  assert.equal(at(scene, 0, () => cam.state(1).orthographic), false);
  assert.equal(at(scene, 1, () => cam.state(1).orthographic), true);
  const size = (t) => at(scene, t, () => {
    const st = cam.state(1);
    const T = cam.target();
    const b = cam.basis();
    const p = [T[0] + b.up[0], T[1] + b.up[1], T[2] + b.up[2]];
    const m = st.viewProj;
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w;
  });
  close(size(0), size(0.5), 1e-9);
  close(size(0.5), size(1), 1e-9);
});

test('create3D draws wireframes on, then fades faces in', async () => {
  const { scene } = await build(async (sc) => {
    const s = new Scene3D();
    const g = new Group3D([new Mesh3D(polyhedron('icosahedron')), new Lines3D([[[-2, 0, 0], [2, 0, 0]]])]);
    s.add(g);
    sc.add(s);
    await sc.play(create3D(g, { lagRatio: 0 }), { duration: 1 });
  });
  const faces = (t) => sampleFrame(scene, t, theme).items.filter((i) => i.meta.role === 'face');
  assert.equal(faces(0.2).length, 0);
  assert.ok(faces(0.7).length > 0);
  const alphaMid = Math.max(...faces(0.7).map((i) => i.fill.a));
  const alphaEnd = Math.max(...faces(1).map((i) => i.fill.a));
  assert.ok(alphaMid < alphaEnd);
  const lines = (t) => sampleFrame(scene, t, theme).items.filter((i) => i.nodeType === 'lines3d').length;
  assert.ok(lines(0.2) > 0);
});
