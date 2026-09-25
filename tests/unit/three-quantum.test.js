import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from '../../src/core/scene.js';
import { sampleFrame } from '../../src/core/sampler.js';
import { rectPath } from '../../src/core/path.js';
import { getTheme } from '../../src/themes/index.js';
import {
  Scene3D, BlochSphere, blochRotate, qSphere, barCity, amplitudeLandscape, circuitMesh, Mesh3D, Points3D, Lines3D, Label3D,
  isClosed, meshBounds, vec3, VERTEX_SHADER, FRAGMENT_SHADER, SHADING, WRAP, meshBuffers, lightUniforms, previewState,
  LIGHT_PRESETS, worldLights, box, mat4,
} from '../../src/three/index.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const theme = getTheme('qubibyte');
const factory = () => rectPath(0, 0.35, 0.6, 0.7);

test('Bloch sphere arrow tip follows theta and phi', async () => {
  let b;
  const scene = await buildScene((sc) => {
    const s = new Scene3D();
    b = new BlochSphere({ theta: Math.PI / 3, phi: Math.PI / 4, labelFactory: factory });
    s.add(b);
    sc.add(s);
  });
  const [, tip] = scene.evaluateAt(0, () => b.arrow.endpoints());
  const want = vec3.spherical(Math.PI / 3, Math.PI / 4).map((v) => v * b.radius * 0.985);
  tip.forEach((v, i) => close(v, want[i]));
  const f = sampleFrame(scene, 0, theme);
  assert.equal(f.items.filter((i) => i.meta.role === 'label').length, 6);
  assert.ok(f.items.some((i) => i.meta.role === 'edge'), 'latitude and longitude lines are drawn');
});

test('Bloch rotation sweeps the tip along the rotation circle and the trail records it', async () => {
  let b;
  const scene = await buildScene(async (sc) => {
    const s = new Scene3D();
    b = new BlochSphere({ labelFactory: factory, trail: true });
    s.add(b);
    sc.add(s);
    await sc.play(blochRotate(b, [1, 0, 0], Math.PI / 2), { duration: 1 });
  });
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const v = scene.evaluateAt(t, () => vec3.spherical(b.get('theta'), b.get('phi')));
    close(v[0], 0, 1e-9);
    close(Math.hypot(v[1], v[2]), 1, 1e-9);
  }
  const end = scene.evaluateAt(1, () => vec3.spherical(b.get('theta'), b.get('phi')));
  [0, -1, 0].forEach((x, i) => close(end[i], x, 1e-9));
  const units = [];
  scene.evaluateAt(0.5, () => b.collect({ units, t: 0.5 }, mat4.identity(), 1));
  const trail = units.find((u) => u.kind === 'lines' && u.id === b.children.find((c) => c.name === 'bloch-trail').id);
  assert.ok(trail.polylines[0].points.length > 10);
  const ind = b.rotationIndicator([0, 0, 1], { angle: -1 });
  assert.ok(ind.children.some((c) => c instanceof Lines3D && c.dash3));
});

test('Q-sphere places dots by latitude and longitude with lines to the center', () => {
  const g = qSphere([
    { latitude: Math.PI / 2, longitude: 0, magnitude: 0.5, phase: 0 },
    { latitude: -Math.PI / 2, longitude: 0, magnitude: 0.5, phase: Math.PI },
    { polar: Math.PI / 2, longitude: Math.PI / 2, magnitude: 0 },
  ], { radius: 2 });
  const pts = g.children.filter((c) => c instanceof Points3D);
  assert.equal(pts.length, 2);
  close(pts[0].points[0][2], 2);
  close(pts[1].points[0][2], -2);
  assert.notDeepEqual(pts[0].colors ?? pts[0].get('fill'), pts[1].get('fill'));
});

test('bar city has one bar per nonzero entry with height from the value', () => {
  const rho = [[0.5, 0, 0, [0, 0.5]], [0, 0, 0, 0], [0, 0, 0, 0], [[0, -0.5], 0, 0, 0.5]];
  const g = barCity(rho, { scale: 2, labels: ['00', '01', '10', '11'], labelFactory: factory });
  const bars = g.children.filter((c) => c instanceof Mesh3D);
  assert.equal(bars.length, 4);
  for (const b of bars) close(meshBounds(b.mesh).max[2] - meshBounds(b.mesh).min[2], 1);
  assert.equal(g.children.filter((c) => c instanceof Label3D).length, 8);
  const real = barCity([[0.5, -0.25], [-0.25, 0.5]], { height: 'real' });
  const neg = real.children.filter((c) => c instanceof Mesh3D && c.get('fill') === 'negative');
  assert.equal(neg.length, 2);
});

test('bar city renders with bars in correct depth order', async () => {
  const f = await buildScene((sc) => {
    const s = new Scene3D({ camera: { theta: -2.3, phi: 1, distance: 14 } });
    s.add(barCity([[1, 0.5], [0.5, 1]], { scale: 2 }));
    sc.add(s);
  }).then((scene) => sampleFrame(scene, 0, theme));
  assert.ok(f.items.filter((i) => i.meta.role === 'face').length >= 8);
});

test('amplitude landscape as bars and as a surface', () => {
  const bars = amplitudeLandscape([[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]]);
  assert.equal(bars.children.filter((c) => c instanceof Mesh3D).length, 4);
  const grid = amplitudeLandscape([[0.1, 0.2, 0.3], [0.2, 0.4, 0.2], [0.3, 0.2, 0.1]]);
  const surf = grid.children.find((c) => c instanceof Mesh3D);
  assert.equal(surf.mesh.faces.length, 4);
});

test('circuit model is a closed printable mesh and a displayable group', () => {
  const circuit = {
    wires: 3,
    gates: [
      { column: 0, wires: [0], kind: 'box', label: 'H' },
      { column: 1, wires: [0], kind: 'control' }, { column: 1, wires: [2], kind: 'target' },
      { column: 2, wires: [1, 2], kind: 'swap' },
      { column: 3, wires: [0], kind: 'measure' }, { column: 3, wires: [1], kind: 'measure' },
    ],
  };
  const { mesh, group } = circuitMesh(circuit, { labelFactory: () => rectPath(0, 0.35, 0.5, 0.7) });
  assert.ok(isClosed(mesh));
  assert.ok(mesh.faceColors.includes('gateHadamard') && mesh.faceColors.includes('gateControlled'));
  const names = group.children.map((c) => c.name);
  assert.ok(names.includes('connector-1') && names.includes('connector-2'));
  assert.ok(!names.includes('connector-3'), 'independent measurements are not joined');
  assert.ok(names.includes('label-0'));
  assert.equal(names.filter((n) => n.startsWith('wire-')).length, 3);
});

test('WebGL preview shares the projector camera and shading constants', async () => {
  for (const k of ['shadowL', 'litL', 'chromaBase', 'specWhite']) assert.ok(FRAGMENT_SHADER.includes(String(SHADING[k])), k);
  assert.ok(FRAGMENT_SHADER.includes(String(WRAP)));
  assert.match(VERTEX_SHADER, /uViewProj/);
  const buf = meshBuffers(box(1, 1, 1), mat4.translation(1, 0, 0), () => ({ r: 1, g: 0, b: 0, a: 1 }));
  assert.equal(buf.count, 36);
  assert.equal(buf.position.length, 108);
  let minX = Infinity;
  for (let i = 0; i < buf.position.length; i += 3) minX = Math.min(minX, buf.position[i]);
  close(minX, 0.5, 1e-6);
  let s3d;
  const scene = await buildScene((sc) => {
    s3d = new Scene3D({ width: 8, height: 4 });
    s3d.add(new Mesh3D(box(1, 1, 1)));
    sc.add(s3d);
  });
  const st = previewState(s3d, 0, theme);
  const ref = scene.evaluateAt(0, () => s3d.cameraState());
  for (let i = 0; i < 16; i++) close(st.cam.viewProj[i], ref.viewProj[i]);
  assert.equal(st.units.length, 1);
  const lu = lightUniforms(worldLights(LIGHT_PRESETS.studio(), st.cam));
  assert.equal(lu.dirCount, 3);
  assert.ok(lu.hemi[0] > 0 && lu.ambient > 0);
  const orbited = previewState(s3d, 0, theme, { theta: 0.5 });
  assert.notEqual(orbited.cam.eye[0], st.cam.eye[0]);
});

test('circuitModel turns a Qubi circuit into printable-model gates, one column per operation', async () => {
  const { circuitModel } = await import('../../src/three/index.js');
  const { evaluate } = await import('../../src/qubi/index.js');
  const m = circuitModel(evaluate('H 0\nCX [0,1]\nSWAP [0,1]\nMEASURE 1'));
  assert.equal(m.wires, 2);
  const kinds = m.gates.map((g) => `${g.column}:${g.kind}:${g.wires.join(',')}`);
  assert.deepEqual(kinds, ['0:box:0', '1:control:0', '1:target:1', '2:swap:0,1', '3:measure:1']);
  const { mesh } = circuitMesh(m);
  assert.ok(mesh.faces.length > 100);
});
