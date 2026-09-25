import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from '../../src/core/scene.js';
import { sampleFrame } from '../../src/core/sampler.js';
import { create } from '../../src/core/animations.js';
import { PathNode } from '../../src/core/node.js';
import { rectPath } from '../../src/core/path.js';
import { getTheme } from '../../src/themes/index.js';
import {
  Scene3D, Camera3D, Mesh3D, Lines3D, Points3D, Label3D, Axes3D, polyhedron, uvSphere, box, torusKnot, torus, orderScene,
  planeOf, POLY, SEG, PT, mat4, resolveLightPreset, shade, diffuseAt, LIGHT_PRESETS, worldLights, softenColor, material,
  presetMaterial, faceNormals, faceCentroids,
} from '../../src/three/index.js';
import { parseColor, rgbToOklch } from '../../src/core/color.js';
import { Random } from '../../src/core/random.js';

const theme = getTheme('qubibyte');

function camState(opts) {
  return new Camera3D(opts).state(16 / 9);
}

function poly(points, tag) {
  const p = points.flat();
  return { k: POLY, p, u: null, f: -1, pl: planeOf(p), whole: true, s: { tag } };
}

function seg(a, b, tag) {
  return { k: SEG, p: [...a, ...b], u: null, f: -1, pl: null, whole: true, s: { tag } };
}

/**
 * Check painter's correctness: at random screen points, among the polygon
 * fragments covering the point, the nearest must come last in the order.
 */
function checkOrder(ordered, cam, samples = 3000) {
  const P = cam.viewProj;
  const frags = ordered.map((x, i) => {
    if (x.k !== POLY) return null;
    const pts = [];
    for (let k = 0; k < x.p.length; k += 3) {
      const [X, Y, Z] = [x.p[k], x.p[k + 1], x.p[k + 2]];
      const w = P[3] * X + P[7] * Y + P[11] * Z + P[15];
      pts.push([(P[0] * X + P[4] * Y + P[8] * Z + P[12]) / w, (P[1] * X + P[5] * Y + P[9] * Z + P[13]) / w]);
    }
    return { i, pts, pl: planeOf(x.p) };
  }).filter(Boolean);
  const inv = mat4.invert(P);
  const rng = new Random(7);
  let checked = 0;
  for (let s = 0; s < samples; s++) {
    const sx = rng.next() * 2 - 1;
    const sy = rng.next() * 2 - 1;
    const near = mat4.transformPoint(inv, [sx, sy, -1]);
    const far = mat4.transformPoint(inv, [sx, sy, 1]);
    const d = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const hits = [];
    for (const f of frags) {
      if (!inside(f.pts, sx, sy)) continue;
      const [nx, ny, nz, dd] = f.pl;
      const den = nx * d[0] + ny * d[1] + nz * d[2];
      if (Math.abs(den) < 1e-12) continue;
      const t = (dd - (nx * near[0] + ny * near[1] + nz * near[2])) / den;
      hits.push({ i: f.i, t });
    }
    if (hits.length < 2) continue;
    checked++;
    hits.sort((a, b) => a.t - b.t);
    const nearest = hits[0];
    const last = hits.reduce((m, h) => (h.i > m.i ? h : m), hits[0]);
    if (last.i !== nearest.i) assert.ok(Math.abs(last.t - nearest.t) < 1e-6, `fragment ${nearest.i} is nearest but ${last.i} is drawn later`);
  }
  return checked;
}

function inside(pts, x, y) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

const quad = (cx, cy, cz, w, h, axis = 'z') => {
  const pts = axis === 'z'
    ? [[cx - w, cy - h, cz], [cx + w, cy - h, cz], [cx + w, cy + h, cz], [cx - w, cy + h, cz]]
    : axis === 'x' ? [[cx, cy - w, cz - h], [cx, cy + w, cz - h], [cx, cy + w, cz + h], [cx, cy - w, cz + h]]
      : [[cx - w, cy, cz - h], [cx + w, cy, cz - h], [cx + w, cy, cz + h], [cx - w, cy, cz + h]];
  return pts;
};

test('a face in front is drawn after the face behind it', () => {
  const cam = camState({ theta: -Math.PI / 2, phi: 1.2, distance: 10 });
  const back = poly(quad(0, 1, 0, 1, 1, 'y'), 'back');
  const front = poly(quad(0.3, -1, 0.2, 1, 1, 'y'), 'front');
  for (const list of [[back, front], [front, back]]) {
    const out = orderScene(list, cam, { items: list.map((x) => [x]) });
    assert.deepEqual(out.map((x) => x.s.tag), ['back', 'front']);
  }
});

test('intersecting faces are split and ordered correctly', () => {
  const cam = camState({ theta: -1.1, phi: 1.1, distance: 8 });
  const a = poly(quad(0, 0, 0, 1.5, 1.5, 'x'), 'a');
  const b = poly(quad(0, 0, 0, 1.5, 1.5, 'y'), 'b');
  const c = poly(quad(0, 0, 0, 1.5, 1.5, 'z'), 'c');
  const out = orderScene([a, b, c], cam, { items: [[a], [b], [c]] });
  assert.ok(out.length > 3);
  assert.ok(checkOrder(out, cam) > 100);
});

test('three cyclically overlapping faces are resolved by splitting', () => {
  const cam = camState({ theta: -Math.PI / 2, phi: 0.001, distance: 10, ortho: 1 });
  const bars = [];
  for (let k = 0; k < 3; k++) {
    const ang = (k * 2 * Math.PI) / 3;
    const dir = [Math.cos(ang), Math.sin(ang)];
    const nrm = [-dir[1], dir[0]];
    const p0 = [-dir[0] * 2, -dir[1] * 2];
    const p1 = [dir[0] * 2, dir[1] * 2];
    const z0 = 0.5;
    const z1 = -0.5;
    bars.push(poly([
      [p0[0] - nrm[0] * 0.3, p0[1] - nrm[1] * 0.3, z0],
      [p1[0] - nrm[0] * 0.3, p1[1] - nrm[1] * 0.3, z1],
      [p1[0] + nrm[0] * 0.3, p1[1] + nrm[1] * 0.3, z1],
      [p0[0] + nrm[0] * 0.3, p0[1] + nrm[1] * 0.3, z0],
    ], `bar${k}`));
  }
  const out = orderScene(bars, cam, { items: [bars] });
  assert.ok(out.length > 3, 'the cycle forces a split');
  assert.ok(checkOrder(out, cam, 20000) > 30);
});

test('mesh faces of several objects order correctly in perspective', () => {
  const cam = camState({ theta: -0.8, phi: 1.0, distance: 9 });
  const prims = [];
  const items = [];
  const meshes = [[polyhedron('icosahedron', 1), [0, 0, 0]], [box(1.5, 1.5, 1.5), [0.9, 0.4, 0.3]], [torus(1.2, 0.3, 24, 12), [0.2, -0.5, 0]]];
  meshes.forEach(([m, [dx, dy, dz]], mi) => {
    const list = m.faces.map((f, fi) => {
      const pts = f.map((v) => [m.positions[v * 3] + dx, m.positions[v * 3 + 1] + dy, m.positions[v * 3 + 2] + dz]);
      return { ...poly(pts, `m${mi}f${fi}`), f: fi };
    });
    for (const x of list) prims.push(x);
    items.push(list);
  });
  const out = orderScene(prims, cam, { items });
  assert.ok(checkOrder(out, cam, 4000) > 300);
});

test('a line through a face is split: the part behind comes first', () => {
  const cam = camState({ theta: -Math.PI / 2, phi: Math.PI / 2, distance: 10 });
  const face = poly(quad(0, 0, 0, 2, 2, 'y'), 'face');
  const line = seg([0, -3, 0.1], [0, 3, 0.1], 'line');
  const out = orderScene([face, line], cam, { items: [[face], [line]] });
  const tags = out.map((x) => `${x.s.tag}:${x.k === SEG ? (x.p[1] + x.p[4] > 0 ? 'far' : 'near') : ''}`);
  assert.deepEqual(tags, ['line:far', 'face:', 'line:near']);
});

test('lines lying on a face are drawn after it and points behind it before it', () => {
  const cam = camState({ theta: -1, phi: 0.8, distance: 8 });
  const face = poly(quad(0, 0, 0, 2, 2, 'z'), 'face');
  const onLine = seg([-1, 0, 0], [1, 0, 0], 'on');
  const pt = { k: PT, p: [0, 0, -1], u: null, f: -1, pl: null, whole: true, s: { tag: 'below' } };
  const out = orderScene([onLine, face, pt], cam, { items: [[onLine], [face], [pt]] });
  assert.deepEqual(out.map((x) => x.s.tag), ['below', 'face', 'on']);
});

async function frameOf(build, t = 0, th = theme) {
  const scene = await buildScene(build, { width: 640, height: 360 });
  return sampleFrame(scene, t, th);
}

test('Scene3D sampleItems emits 2D path items with shaded faces and edges', async () => {
  const f = await frameOf((scene) => {
    const s = new Scene3D({ width: 8, height: 4.5 });
    s.add(new Mesh3D(polyhedron('dodecahedron')));
    scene.add(s);
  });
  const faces = f.items.filter((i) => i.meta.role === 'face');
  const edges = f.items.filter((i) => i.meta.role === 'edge');
  const m = polyhedron('dodecahedron');
  const eye = new Camera3D().eye();
  const N = faceNormals(m);
  const C = faceCentroids(m);
  let front = 0;
  for (let i = 0; i < m.faces.length; i++) if ((eye[0] - C[i * 3]) * N[i * 3] + (eye[1] - C[i * 3 + 1]) * N[i * 3 + 1] + (eye[2] - C[i * 3 + 2]) * N[i * 3 + 2] > 0) front++;
  assert.equal(faces.length, front, 'back faces of a closed opaque mesh are culled');
  assert.ok(edges.length > 0);
  for (const it of f.items) {
    assert.equal(it.kind, 'path');
    assert.ok(it.path.subpaths.length > 0);
  }
  const fills = new Set(faces.map((i) => `${i.fill.r.toFixed(3)},${i.fill.g.toFixed(3)},${i.fill.b.toFixed(3)}`));
  assert.ok(fills.size >= 3, 'faces are shaded differently');
  for (const i of faces) {
    const { C } = rgbToOklch(i.fill);
    assert.ok(C > 0.03, 'shading keeps chroma (never gray)');
  }
  const e = edges[0].stroke;
  assert.ok(e.a > 0.15 && e.a < 0.5, 'edge lines are subtle');
});

test('the Scene3D 2D matrix positions and scales the projection', async () => {
  const bounds = async (x, s) => {
    const f = await frameOf((scene) => {
      const v = new Scene3D({ width: 4, height: 4, position: [x, 0], scale: s });
      v.add(new Mesh3D(box(1, 1, 1)));
      scene.add(v);
    });
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const it of f.items) for (const sp of it.path.subpaths) for (let i = 0; i < sp.points.length; i += 2) {
      x0 = Math.min(x0, sp.points[i]);
      x1 = Math.max(x1, sp.points[i]);
    }
    return [x0, x1];
  };
  const [a0, a1] = await bounds(0, 1);
  const [b0, b1] = await bounds(3, 2);
  assert.ok(Math.abs((b1 - b0) - 2 * (a1 - a0)) < 1e-6);
  assert.ok(Math.abs((b0 + b1) / 2 - (3 + (a0 + a1))) < 1e-6);
});

test('core create() draws a mesh wireframe on and then fades its faces in', async () => {
  const f = await frameOf(async (scene) => {
    const s = new Scene3D();
    const m = new Mesh3D(polyhedron('cube', 1.2));
    s.add(m);
    scene.add(s);
    await scene.play(create(m), { duration: 1 });
  }, 0.3);
  assert.equal(f.items.filter((i) => i.meta.role === 'face').length, 0);
  assert.ok(f.items.some((i) => i.nodeType === 'lines3d'));
});

test('multi-camera cuts switch the view at the cut time', async () => {
  const scene = await buildScene(async (sc) => {
    const s = new Scene3D();
    s.add(new Mesh3D(box(1, 2, 3)));
    const i = s.addCamera(new Camera3D({ theta: 1.2, phi: 0.4, distance: 6 }));
    sc.add(s);
    await sc.wait(1);
    s.cut(i);
    await sc.wait(1);
  }, { width: 320, height: 180 });
  const key = (t) => JSON.stringify(sampleFrame(scene, t, theme).items.map((i) => i.path.subpaths[0].points.slice(0, 2).map((v) => v.toFixed(3))));
  assert.equal(key(0.5), key(0.9));
  assert.notEqual(key(0.9), key(1.5));
});

test('lines, points, and labels render; hidden parts are ordered behind faces', async () => {
  const f = await frameOf((scene) => {
    const s = new Scene3D({ labelFactory: () => rectPath(0, 0.35, 0.6, 0.7) });
    s.add(new Mesh3D(box(2, 2, 2), { name: 'cube' }));
    s.add(new Lines3D([[[-3, 0, 0], [3, 0, 0]]], { name: 'axis' }));
    s.add(new Points3D([[0, 0, 2]], { radius: 0.1 }));
    s.add(new Label3D('A', { position: [0, 0, 1.6] }));
    scene.add(s);
  });
  const roles = f.items.map((i) => i.meta.role);
  assert.ok(roles.includes('line') && roles.includes('point') && roles.includes('label'));
  const firstLine = roles.indexOf('line');
  const firstFace = roles.indexOf('face');
  const lastLine = roles.lastIndexOf('line');
  assert.ok(firstLine < firstFace && lastLine > firstFace, 'the axis enters behind the cube and exits in front');
});

test('a 3D object placed directly in a 2D scene renders with a default view', async () => {
  const f = await frameOf((scene) => {
    scene.add(new Mesh3D(polyhedron('octahedron')));
    scene.add(new PathNode(rectPath(0, 0, 1, 1)));
  });
  assert.ok(f.items.filter((i) => i.meta.role === 'face').length >= 4);
});

test('board themes turn solids into ink drawings with occluding faces', async () => {
  const chalk = getTheme('chalkboard');
  assert.equal(resolveLightPreset(chalk), 'blackboard');
  assert.equal(resolveLightPreset(getTheme('blueprint')), 'blueprint');
  assert.equal(resolveLightPreset(theme), 'studio');
  const f = await frameOf((scene) => {
    const s = new Scene3D();
    s.add(new Mesh3D(polyhedron('cube')));
    scene.add(s);
  }, 0, chalk);
  const faces = f.items.filter((i) => i.meta.role === 'face');
  assert.ok(faces.every((i) => i.meta.noBoard && i.meta.occluder));
  const bg = parseColor(chalk.colors.background);
  assert.ok(Math.abs(faces[0].fill.r - bg.r) < 1e-9);
  const edges = f.items.filter((i) => i.meta.role === 'edge');
  assert.ok(edges.every((i) => i.stroke.a > 0.8));
  assert.equal(presetMaterial(material('glossy'), 'blueprint').backEdges, 'dash');
});

test('studio lighting shades in OKLab without going gray and default color is the softened accent', () => {
  const accent = parseColor(theme.colors.accent);
  const soft = softenColor(accent);
  assert.ok(Math.abs(rgbToOklch(soft).C - rgbToOklch(accent).C * 0.72) < 0.01);
  const dark = shade(soft, 0.1);
  const lit = shade(soft, 1);
  assert.ok(rgbToOklch(dark).L < rgbToOklch(lit).L);
  assert.ok(rgbToOklch(dark).C > 0.5 * rgbToOklch(lit).C);
  const cam = new Camera3D().state(1);
  const lights = worldLights(LIGHT_PRESETS.studio(), cam);
  assert.ok(lights.filter((l) => l.kind === 'directional').length >= 3, 'no single harsh light');
  const up = diffuseAt(lights, [0, 0, 1], [0, 0, 0]);
  const down = diffuseAt(lights, [0, 0, -1], [0, 0, 0]);
  assert.ok(up > down && down > 0.1);
});

test('a 2000-face sphere with axes samples quickly', async () => {
  const scene = await buildScene((sc) => {
    const s = new Scene3D({ width: 16, height: 9 });
    s.add(new Mesh3D(uvSphere(1.5, 64, 32)));
    s.add(new Axes3D({ labelFactory: () => rectPath(0, 0.35, 0.5, 0.7) }));
    sc.add(s);
  });
  for (let i = 0; i < 3; i++) sampleFrame(scene, 0, theme);
  const t0 = performance.now();
  const n = 5;
  for (let i = 0; i < n; i++) sampleFrame(scene, 0, theme);
  const ms = (performance.now() - t0) / n;
  assert.ok(ms < 60, `sampling took ${ms.toFixed(1)} ms`);
});

test('a torus knot self-occludes correctly', () => {
  const cam = camState({ theta: -1.9, phi: 0.8, distance: 8 });
  const m = torusKnot(2, 3, { segments: 96, tubeSegments: 8 });
  const prims = [];
  m.faces.forEach((f, fi) => {
    const pts = f.map((v) => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]);
    const x = { ...poly(pts, fi), f: fi };
    const toEye = [cam.eye[0] - pts[0][0], cam.eye[1] - pts[0][1], cam.eye[2] - pts[0][2]];
    if (x.pl[0] * toEye[0] + x.pl[1] * toEye[1] + x.pl[2] * toEye[2] > 0) prims.push(x);
  });
  const out = orderScene(prims, cam, { items: [prims] });
  assert.ok(checkOrder(out, cam, 20000) > 100);
});
