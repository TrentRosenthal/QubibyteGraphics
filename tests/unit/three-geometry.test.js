import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  polyhedron, faceNormals, faceCentroids, meshBounds, eulerCharacteristic, isClosed, meshVolume, meshArea, vertexCount,
  uvSphere, icosphere, cubeSphere, torus, torusKnot, cylinder, cone, prism, box, roundedBox, plane, lathe, tube, loft,
  extrudePath, heightField, ruledSurface, parametricSurface, levelSets, triangulatePolygon, triangulateMesh, convexHull,
  marchingCubes, MC_TRI_TABLE, MC_EDGE_TABLE, clipMesh, unfoldMesh, netTree, explodeMesh, resampleRadial, mergeMeshes,
  transformMesh, mat4,
} from '../../src/three/index.js';
import { rectPath, mergePaths, circlePath } from '../../src/core/path.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

function assertOutward(mesh) {
  const N = faceNormals(mesh);
  const C = faceCentroids(mesh);
  const b = meshBounds(mesh);
  const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
  for (let i = 0; i < mesh.faces.length; i++) {
    const d = (C[i * 3] - c[0]) * N[i * 3] + (C[i * 3 + 1] - c[1]) * N[i * 3 + 1] + (C[i * 3 + 2] - c[2]) * N[i * 3 + 2];
    assert.ok(d > 0, `face ${i} points inward`);
  }
}

function faceSizes(mesh) {
  const out = {};
  for (const f of mesh.faces) out[f.length] = (out[f.length] || 0) + 1;
  return out;
}

test('Platonic solids have the right counts, are closed, and satisfy V - E + F = 2', () => {
  const expect = { tetrahedron: [4, 4, 3], cube: [8, 6, 4], octahedron: [6, 8, 3], dodecahedron: [20, 12, 5], icosahedron: [12, 20, 3] };
  for (const [name, [V, F, n]] of Object.entries(expect)) {
    const m = polyhedron(name, 1.5);
    assert.equal(vertexCount(m), V, name);
    assert.equal(m.faces.length, F, name);
    assert.deepEqual(faceSizes(m), { [n]: F }, name);
    assert.equal(eulerCharacteristic(m), 2, name);
    assert.ok(isClosed(m) && m.convex, name);
    assertOutward(m);
    for (let i = 0; i < m.positions.length; i += 3) close(Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]), 1.5, 1e-9);
  }
});

test('Archimedean solids have the expected face types', () => {
  const expect = {
    cuboctahedron: { 3: 8, 4: 6 },
    icosidodecahedron: { 3: 20, 5: 12 },
    truncatedTetrahedron: { 3: 4, 6: 4 },
    truncatedOctahedron: { 4: 6, 6: 8 },
    truncatedIcosahedron: { 5: 12, 6: 20 },
  };
  for (const [name, sizes] of Object.entries(expect)) {
    const m = polyhedron(name);
    assert.deepEqual(faceSizes(m), sizes, name);
    assert.equal(eulerCharacteristic(m), 2, name);
    assertOutward(m);
  }
});

test('the cube has unit volume at edge length one', () => {
  close(meshVolume(box(1, 1, 1)), 1);
  close(meshArea(box(1, 2, 3)), 22);
  close(meshVolume(polyhedron('cube', Math.sqrt(3) / 2)), 1, 1e-9);
});

test('curved primitives are closed with the right topology and outward normals', () => {
  const cases = [
    [uvSphere(1, 32, 16), 2, (4 / 3) * Math.PI, 0.03],
    [icosphere(1, 3), 2, (4 / 3) * Math.PI, 0.02],
    [cubeSphere(1, 10), 2, (4 / 3) * Math.PI, 0.02],
    [cylinder(0.5, 2, 48), 2, Math.PI * 0.25 * 2, 0.01],
    [cone(0.5, 2, 48), 2, (Math.PI * 0.25 * 2) / 3, 0.01],
    [prism(6, 1, 1), 2, (3 * Math.sqrt(3)) / 2, 1e-9],
    [roundedBox(1, 1, 1, 0.2, 3), 2, null, 0],
    [torus(1, 0.3, 48, 24), 0, 2 * Math.PI * Math.PI * 1 * 0.09, 0.02],
    [torusKnot(2, 3), 0, null, 0],
  ];
  for (const [m, chi, vol, tol] of cases) {
    assert.ok(isClosed(m));
    assert.equal(eulerCharacteristic(m), chi);
    assert.ok(meshVolume(m) > 0);
    if (vol != null) assert.ok(Math.abs(meshVolume(m) - vol) / vol < tol + 1e-12, `volume ${meshVolume(m)} vs ${vol}`);
  }
  assertOutward(uvSphere(1, 24, 12));
  assertOutward(cylinder(1, 1, 24));
  assertOutward(roundedBox(2, 1, 1, 0.2));
});

test('lathe, tube, and loft build closed solids', () => {
  const vase = lathe([[0, -1], [0.6, -0.9], [0.8, 0], [0.4, 0.9], [0, 1]], { segments: 40 });
  assert.ok(isClosed(vase));
  assert.equal(eulerCharacteristic(vase), 2);
  const t = tube([[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]], { radius: 0.1, radialSegments: 12 });
  assert.ok(isClosed(t));
  assert.ok(meshVolume(t) > 0);
  const l = loft([[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], { samples: 4 });
  assert.ok(isClosed(l));
  close(meshVolume(l), 1, 1e-9);
});

test('surfaces: plane, height field, ruled and parametric', () => {
  const p = plane(2, 3, 4, 5);
  assert.equal(p.faces.length, 20);
  assert.equal(isClosed(p), false);
  close(meshArea(p), 6);
  const h = heightField((x, y) => x * y, { nx: 10, ny: 10 });
  assert.equal(h.faces.length, 100);
  assert.ok(faceNormals(h)[2] > 0);
  const r = ruledSurface((u) => [u, 0, 0], (u) => [u, 1, 1], { nu: 8, nv: 2 });
  close(meshArea(r), Math.SQRT2, 1e-9);
  const s = parametricSurface((u, v) => [Math.cos(u) * (2 + Math.cos(v)), Math.sin(u) * (2 + Math.cos(v)), Math.sin(v)], { u: [0, 2 * Math.PI], v: [0, 2 * Math.PI], nu: 24, nv: 12, closedU: true, closedV: true });
  assert.equal(eulerCharacteristic(s), 0);
});

test('ear clipping with holes covers exactly the polygon area', () => {
  const outer = [[0, 0], [6, 0], [6, 4], [3, 6], [0, 4]];
  const holes = [[[1, 1], [2, 1], [2, 2], [1, 2]], [[4, 1], [5, 1], [4.5, 2.5]]];
  const pts = [...outer, ...holes.flat()];
  const tris = triangulatePolygon(outer, holes);
  let A = 0;
  for (const [a, b, c] of tris) {
    const cr = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
    assert.ok(cr > 0, 'triangles are counterclockwise');
    A += cr / 2;
  }
  close(A, 24 + 6 - 1 - 0.75, 1e-9);
  assert.equal(tris.length, outer.length + 4 + 3 + 2 * 2 - 2);
});

test('ear clipping handles a concave polygon', () => {
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1;
    star.push([r * Math.cos((i * Math.PI) / 5), r * Math.sin((i * Math.PI) / 5)]);
  }
  const tris = triangulatePolygon(star);
  assert.equal(tris.length, 8);
  let A = 0;
  for (const [a, b, c] of tris) A += ((star[b][0] - star[a][0]) * (star[c][1] - star[a][1]) - (star[b][1] - star[a][1]) * (star[c][0] - star[a][0])) / 2;
  close(A, 10 * 0.5 * 1 * 0.4 * Math.sin(Math.PI / 5), 1e-9);
});

test('extruding a 2D path with a hole gives a closed solid of the right volume', () => {
  const hole = rectPath(0, 0, 1, 1);
  const outer = rectPath(0, 0, 3, 3);
  const m = extrudePath(mergePaths(outer, hole), { depth: 0.5 });
  assert.ok(isClosed(m));
  close(meshVolume(m), (9 - 1) * 0.5, 1e-9);
  assert.equal(eulerCharacteristic(m), 0);
  const disk = extrudePath(circlePath(0, 0, 1), { depth: 1, tolerance: 0.001 });
  assert.ok(Math.abs(meshVolume(disk) - Math.PI) < 0.01);
});

test('convex hull of a cube with interior points is the cube', () => {
  const pts = [];
  for (let s = 0; s < 8; s++) pts.push([s & 1 ? 1 : -1, s & 2 ? 1 : -1, s & 4 ? 1 : -1]);
  pts.push([0, 0, 0], [0.5, 0.2, -0.3]);
  const h = convexHull(pts);
  assert.equal(h.faces.length, 6);
  close(meshVolume(h), 8);
});

test('marching cubes table is complete and consistent', () => {
  assert.equal(MC_TRI_TABLE.length, 256);
  assert.equal(MC_TRI_TABLE[0].length, 0);
  assert.equal(MC_TRI_TABLE[255].length, 0);
  for (let c = 1; c < 255; c++) {
    assert.ok(MC_TRI_TABLE[c].length > 0 && MC_TRI_TABLE[c].length % 3 === 0, `case ${c}`);
    assert.equal(MC_EDGE_TABLE[c], MC_EDGE_TABLE[255 - c], `complement ${c}`);
  }
  assert.deepEqual([...MC_TRI_TABLE[1]].sort(), [0, 3, 8]);
});

test('marching cubes on a sphere field puts vertices on the sphere and closes the surface', () => {
  const R = 0.8;
  const m = marchingCubes((x, y, z) => Math.hypot(x, y, z) - R, { resolution: 28 });
  for (let i = 0; i < m.positions.length; i += 3) close(Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]), R, 0.004);
  assert.ok(isClosed(m));
  assert.equal(eulerCharacteristic(m), 2);
  const V = meshVolume(m);
  assert.ok(V > 0 && Math.abs(V - (4 / 3) * Math.PI * R ** 3) / V < 0.02);
});

test('marching cubes stays watertight on a noisy field', () => {
  const m = marchingCubes((x, y, z) => Math.sin(4 * x) * Math.cos(3 * y) + Math.sin(5 * z + x) - 0.2, { resolution: 14, min: [-1, -1, -1], max: [1, 1, 1] });
  const b = meshBounds(m);
  const onBoundary = (i) => [0, 1, 2].some((k) => Math.abs(Math.abs(m.positions[i * 3 + k]) - 1) < 1e-9);
  let interiorOpen = 0;
  const edges = new Map();
  for (const f of m.faces) for (let k = 0; k < 3; k++) {
    const a = f[k];
    const c = f[(k + 1) % 3];
    const key = a < c ? `${a},${c}` : `${c},${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  for (const [key, n] of edges) {
    const [a, c] = key.split(',').map(Number);
    if (n !== 2 && !(onBoundary(a) && onBoundary(c))) interiorOpen++;
  }
  assert.equal(interiorOpen, 0);
  assert.ok(b.max[0] <= 1 + 1e-9);
});

test('level sets of x^2 + y^2 are circles', () => {
  const g = levelSets((x, y) => x * x + y * y, { nx: 40, ny: 40 }, [0.25], { z: 'surface' });
  assert.equal(g.polylines.length, 1);
  assert.ok(g.polylines[0].closed);
  for (const p of g.polylines[0].points) {
    close(Math.hypot(p[0], p[1]), 0.5, 0.01);
    close(p[2], 0.25);
  }
});

test('clipping a cube with a plane caps the cut and halves the volume', () => {
  const r = clipMesh(box(2, 2, 2), [0, 0, 1, 0]);
  assert.ok(r.capFaces > 0);
  assert.ok(isClosed(r.mesh));
  close(meshVolume(r.mesh), 4, 1e-9);
  const t = clipMesh(torus(1, 0.3, 32, 16), [1, 0, 0, 0]);
  assert.ok(isClosed(t.mesh));
  assert.equal(t.section.length, 2);
});

test('unfolding a cube and a tetrahedron lays every face flat', () => {
  for (const m of [box(1, 1, 1), polyhedron('tetrahedron'), polyhedron('octahedron')]) {
    const tree = netTree(m, 0);
    assert.equal(tree.order.length, m.faces.length);
    const u = unfoldMesh(m, 1);
    const N = faceNormals(u);
    for (let i = 1; i < u.faces.length; i++) close(Math.abs(N[0] * N[i * 3] + N[1] * N[i * 3 + 1] + N[2] * N[i * 3 + 2]), 1, 1e-9);
    close(meshArea(u), meshArea(m), 1e-9);
    const half = unfoldMesh(m, 0.5);
    close(meshArea(half), meshArea(m), 1e-9);
  }
});

test('exploded faces keep their shape and move outward', () => {
  const m = polyhedron('dodecahedron');
  const e = explodeMesh(m, 0.5);
  close(meshArea(e), meshArea(m), 1e-9);
  const b = meshBounds(e);
  assert.ok(b.max[0] > meshBounds(m).max[0] + 0.2);
});

test('radial resampling maps a cube onto a shared cube-sphere topology', () => {
  const template = cubeSphere(1, 6);
  const c = resampleRadial(box(2, 2, 2), template);
  const s = resampleRadial(uvSphere(1, 48, 24), template);
  assert.equal(c.faces.length, s.faces.length);
  for (let i = 0; i < c.positions.length; i += 3) {
    close(Math.max(Math.abs(c.positions[i]), Math.abs(c.positions[i + 1]), Math.abs(c.positions[i + 2])), 1, 1e-9);
    close(Math.hypot(s.positions[i], s.positions[i + 1], s.positions[i + 2]), 1, 0.01);
  }
});

test('transforms, merges, and triangulation keep volumes', () => {
  const m = transformMesh(box(1, 1, 1), mat4.multiply(mat4.translation(3, 0, 0), mat4.scaling(2, 1, 1)));
  close(meshVolume(m), 2);
  const flipped = transformMesh(box(1, 1, 1), mat4.scaling(-1, 1, 1));
  close(meshVolume(flipped), 1);
  const merged = mergeMeshes([{ mesh: box(1, 1, 1), color: 'accent' }, { mesh: m, color: 'accent2' }]);
  close(meshVolume(merged), 3);
  assert.equal(merged.faceColors.filter((c) => c === 'accent2').length, 6);
  const tri = triangulateMesh(polyhedron('dodecahedron'));
  assert.equal(tri.faces.length, 36);
  close(meshVolume(tri), meshVolume(polyhedron('dodecahedron')), 1e-9);
});
