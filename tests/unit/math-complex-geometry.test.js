import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Complex, rootsOfUnity, nthRoots, domainColor, domainColoring, conformalGrid, riemannSurface, contourIntegral, circlePath,
  residues, toLatex, gradient, divergence, curl, gradientNumeric, divergenceNumeric, curlNumeric, lineIntegral,
  surfaceIntegral, tangentPlane, surfaceNormal, curvature, geodesic, classifyConic, lineLine, lineCircle, circleCircle,
  perpendicularBisector, angleBisector, rotation2D, scaling2D, shear2D, reflection2D, affine2D, transformPoints,
  cyclicGroup, dihedralGroup, cayleyTable, SeededRandom,
} from '../../src/math/index.js';

const rng = new SeededRandom(7);
const near = (a, b, tol = 1e-10) => Math.abs(a - b) <= tol * (1 + Math.abs(b));

test('complex arithmetic and elementary function identities', () => {
  const z = new Complex(1, 2);
  const w = new Complex(-0.5, 0.25);
  assert.ok(z.mul(w).div(w).equals(z));
  assert.equal(z.toString(), '1 + 2i');
  assert.equal(new Complex(0, -1).toString(), '-i');
  for (let k = 0; k < 20; k++) {
    const u = new Complex(rng.uniform(-2, 2), rng.uniform(-2, 2));
    assert.ok(u.exp().log().equals(u, 1e-12) || Math.abs(u.im) > Math.PI);
    assert.ok(u.sqrt().mul(u.sqrt()).equals(u, 1e-12));
    const s = u.sin();
    const c = u.cos();
    assert.ok(s.mul(s).add(c.mul(c)).equals(new Complex(1, 0), 1e-10));
    assert.ok(u.asin().sin().equals(u, 1e-9));
    assert.ok(u.atan().tan().equals(u, 1e-9));
    assert.ok(u.acos().cos().equals(u, 1e-9));
    assert.ok(u.sinh().equals(u.exp().sub(u.neg().exp()).div(2), 1e-12));
    assert.ok(u.pow(new Complex(2, 0)).equals(u.mul(u), 1e-12));
    assert.ok(u.pow(new Complex(0.5, 0)).equals(u.sqrt(), 1e-12));
  }
  // Branch cut of log and sqrt on the negative real axis: values from above.
  assert.ok(new Complex(-4, 0).sqrt().equals(new Complex(0, 2)));
  assert.equal(new Complex(-1, 0).log().im, Math.PI);
  assert.ok(new Complex(-1, -1e-300).log().im < 0);
  assert.ok(new Complex(0, 0).pow(2).equals(new Complex(0, 0)));
  const r = rootsOfUnity(6);
  assert.equal(r.length, 6);
  for (const q of r) assert.ok(q.pow(6).equals(new Complex(1, 0), 1e-12));
  for (const q of nthRoots(new Complex(0, 8), 3)) assert.ok(q.pow(3).equals(new Complex(0, 8), 1e-12));
});

test('domain colouring, conformal grids and Riemann surfaces', () => {
  const [r, g, b] = domainColor(new Complex(1, 0));
  assert.ok(r > g && r > b, 'arg 0 is red');
  assert.deepEqual(domainColor(new Complex(0, 0)), [0, 0, 0]);
  assert.deepEqual(domainColor(new Complex(Infinity, 0)), [255, 255, 255]);
  const [r2, g2, b2] = domainColor(new Complex(-1, 1e-9));
  assert.ok(b2 > r2 || g2 > r2, 'arg pi is cyan');
  const img = domainColoring('z^2 - 1', { width: 8, height: 6 });
  assert.equal(img.data.length, 8 * 6 * 4);
  assert.ok(img.data.every((v, i) => i % 4 !== 3 || v === 255));
  const grid = conformalGrid((z) => z.mul(z), { lines: 5, samples: 10 });
  assert.equal(grid.horizontal.length, 5);
  const line = grid.vertical[4];
  line.source.forEach((p, i) => {
    const w = new Complex(p.x, p.y).mul(new Complex(p.x, p.y));
    assert.ok(near(line.image[i].x, w.re) && near(line.image[i].y, w.im));
  });
  const sq = riemannSurface('sqrt', { rings: 3, spokes: 8 });
  assert.equal(sq.sheets.length, 2);
  const p0 = sq.sheets[0].grid[2][0];
  const p1 = sq.sheets[1].grid[2][0];
  assert.ok(near(p0.x, p1.x) && near(p0.re, -p1.re), 'the two sheets differ by sign');
  const lg = riemannSurface('log', { sheets: 3, rings: 2, spokes: 4 });
  assert.equal(lg.sheets.length, 3);
  assert.ok(near(lg.sheets[1].grid[0][0].im - lg.sheets[0].grid[0][0].im, 2 * Math.PI));
});

test('contour integrals and residues', () => {
  const I = contourIntegral('1/z', circlePath(0, 1), 0, 2 * Math.PI);
  assert.ok(I.equals(new Complex(0, 2 * Math.PI), 1e-9));
  const zero = contourIntegral('z^2 + 3z', circlePath(new Complex(1, 1), 2), 0, 2 * Math.PI);
  assert.ok(zero.abs() < 1e-9);
  const res = residues('1/(z^2+1)');
  assert.equal(res.length, 2);
  assert.deepEqual(res.map((x) => toLatex(x.residue)).sort(), ['-\\frac{i}{2}', '\\frac{i}{2}']);
  const three = residues('(z+2)/(z (z-1)^2)');
  const byPole = Object.fromEntries(three.map((x) => [toLatex(x.pole), x]));
  assert.equal(toLatex(byPole['0'].residue), '2');
  assert.equal(byPole['1'].order, 2);
  assert.equal(toLatex(byPole['1'].residue), '-2');
  const numeric = residues('1/(z^3 - 2)');
  const total = numeric.reduce((s, x) => s.add(Complex.from(x.residue)), new Complex(0, 0));
  assert.ok(total.abs() < 1e-9, 'residues of a degree -3 rational function sum to zero');
  assert.ok(numeric.every((x) => x.exact === false));
  // The residue theorem matches a contour integral around all poles.
  const loop = contourIntegral('1/(z^3 - 2)', circlePath(0, 2), 0, 2 * Math.PI);
  assert.ok(loop.abs() < 1e-9);
});

test('gradient, divergence and curl: symbolic and numeric agree', () => {
  assert.equal(gradient('x^2 y + sin(z)', ['x', 'y', 'z']).latex, '\\left\\langle 2xy, x^{2}, \\cos(z) \\right\\rangle');
  assert.equal(divergence(['x^2', 'x y', 'z'], ['x', 'y', 'z']).latex, '3x + 1');
  assert.equal(curl(['-y', 'x', '0'], ['x', 'y', 'z']).latex, '\\left\\langle 0, 0, 2 \\right\\rangle');
  assert.equal(curl(['-y', 'x'], ['x', 'y']).latex, '2');
  const g = gradientNumeric((x, y) => x * x * y, [1.5, 2]);
  assert.ok(near(g[0], 6, 1e-8) && near(g[1], 2.25, 1e-8));
  assert.ok(near(divergenceNumeric((x, y, z) => [x * x, x * y, z], [2, 1, 0]), 7, 1e-8));
  const c = curlNumeric((x, y, z) => [y * z, x * z, x * y * 3], [1, 2, 3]);
  assert.ok(near(c[0], 3 * 1 - 1, 1e-7) && near(c[1], 2 - 3 * 2, 1e-7) && near(c[2], 0, 1e-7));
});

test('line and surface integrals', () => {
  assert.ok(near(lineIntegral(['-y', 'x'], ['cos(t)', 'sin(t)'], 0, 2 * Math.PI).value, 2 * Math.PI));
  assert.ok(near(lineIntegral('1', ['cos(t)', 'sin(t)'], 0, 2 * Math.PI).value, 2 * Math.PI));
  assert.ok(near(lineIntegral('x + y', (t) => [t, t], 0, 1).value, Math.SQRT2));
  const sphere = ['sin(u) cos(v)', 'sin(u) sin(v)', 'cos(u)'];
  assert.ok(near(surfaceIntegral('1', sphere, [0, Math.PI], [0, 2 * Math.PI]).value, 4 * Math.PI, 1e-8));
  assert.ok(near(surfaceIntegral(['x', 'y', 'z'], sphere, [0, Math.PI], [0, 2 * Math.PI]).value, 4 * Math.PI, 1e-8));
  const disk = (u, v) => [u * Math.cos(v), u * Math.sin(v), 0];
  assert.ok(near(surfaceIntegral((x, y) => x * x + y * y, disk, [0, 1], [0, 2 * Math.PI]).value, Math.PI / 2, 1e-6));
});

test('tangent planes, normals, curvature, torsion and geodesics', () => {
  assert.equal(tangentPlane('x^2 + y^2', 1, 2).latex, 'z = 2x + 4y - 5');
  assert.deepEqual(tangentPlane('x^2 + y^2', 1, 2).normal.map(toLatex), ['-2', '-4', '1']);
  const n = surfaceNormal(['u', 'v', 'u^2 + v^2']);
  assert.equal(n.latex, '\\left\\langle -2u, -2v, 1 \\right\\rangle');
  const helix = curvature(['cos(t)', 'sin(t)', 't']);
  const at = helix.at(0.7);
  assert.ok(near(at.curvature, 0.5) && near(at.torsion, 0.5));
  const circle = curvature(['3cos(t)', '3sin(t)']);
  assert.ok(near(circle.at(1.2).curvature, 1 / 3));
  assert.ok(near(curvature(['t', 't^2']).at(0).curvature, 2));
  // Geodesics on the unit sphere stay on it and the equator is a geodesic.
  const sphere = ['cos(u) cos(v)', 'cos(u) sin(v)', 'sin(u)'];
  const eq = geodesic(sphere, { u0: 0, v0: 0, du0: 0, dv0: 1, tEnd: Math.PI, steps: 200 });
  const end = eq.points[eq.points.length - 1];
  assert.ok(near(end[0], -1, 1e-8) && Math.abs(end[2]) < 1e-9);
  const tilted = geodesic(sphere, { u0: 0.3, v0: 0, du0: 0.5, dv0: 1, tEnd: 3, steps: 300 });
  for (const p of tilted.points) assert.ok(near(Math.hypot(...p), 1, 1e-9));
  // A great circle lies in a plane through the origin: the points span a plane.
  const [a, b] = [tilted.points[10], tilted.points[100]];
  const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const p of tilted.points) assert.ok(Math.abs(p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2]) < 1e-6);
});

test('conic classification with centers, axes, foci and eccentricity', () => {
  const e = classifyConic('x^2/9 + y^2/4 = 1');
  assert.equal(e.type, 'ellipse');
  assert.ok(near(e.a, 3) && near(e.b, 2) && near(e.eccentricity, Math.sqrt(5) / 3));
  assert.ok(near(Math.abs(e.foci[0].x), Math.sqrt(5)));
  const c = classifyConic('x^2 + y^2 - 2x - 4y - 4 = 0');
  assert.equal(c.type, 'circle');
  assert.ok(near(c.center.x, 1) && near(c.center.y, 2) && near(c.a, 3));
  const p = classifyConic('y = x^2');
  assert.equal(p.type, 'parabola');
  assert.ok(near(p.foci[0].y, 0.25) && Math.abs(p.foci[0].x) < 1e-12);
  const p2 = classifyConic('x = y^2 + 2y');
  assert.ok(near(p2.vertex.x, -1) && near(p2.vertex.y, -1) && near(p2.foci[0].x, -0.75));
  const h = classifyConic('x^2 - y^2 = 1');
  assert.equal(h.type, 'hyperbola');
  assert.ok(near(h.eccentricity, Math.SQRT2));
  const rotated = classifyConic({ A: 5, B: -6, C: 5, F: -8 });
  assert.equal(rotated.type, 'ellipse');
  assert.ok(near(rotated.a, 2) && near(rotated.b, 1) && near(Math.abs(Math.tan(rotated.angle)), 1));
  assert.equal(classifyConic('x y = 1').type, 'hyperbola');
  assert.equal(classifyConic('x^2 - y^2 = 0').type, 'degenerate');
  assert.equal(classifyConic('x^2 + y^2 + 1 = 0').type, 'empty');
  // Foci definition: sum of distances equals 2a on the ellipse.
  for (let k = 0; k < 5; k++) {
    const t = rng.uniform(0, 2 * Math.PI);
    const pt = { x: 3 * Math.cos(t), y: 2 * Math.sin(t) };
    const s = e.foci.reduce((acc, f) => acc + Math.hypot(pt.x - f.x, pt.y - f.y), 0);
    assert.ok(near(s, 6));
  }
});

test('construction helpers', () => {
  assert.deepEqual(lineLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }), { x: 0.5, y: 0.5 });
  assert.equal(lineLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 2 }), null);
  assert.equal(lineCircle({ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }, 1).length, 2);
  assert.equal(lineCircle({ x: -2, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 0 }, 1).length, 1);
  assert.equal(lineCircle({ x: -2, y: 3 }, { x: 2, y: 3 }, { x: 0, y: 0 }, 1).length, 0);
  const cc = circleCircle({ x: 0, y: 0 }, 1, { x: 1, y: 0 }, 1);
  for (const q of cc) {
    assert.ok(near(Math.hypot(q.x, q.y), 1) && near(Math.hypot(q.x - 1, q.y), 1));
  }
  assert.equal(circleCircle({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1).length, 0);
  assert.equal(circleCircle({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, 1).length, 1);
  const pb = perpendicularBisector({ x: 0, y: 0 }, { x: 2, y: 2 });
  assert.deepEqual(pb.point, { x: 1, y: 1 });
  assert.ok(near(pb.direction.x * 2 + pb.direction.y * 2, 0));
  const ab = angleBisector({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
  assert.ok(near(ab.direction.x, Math.SQRT1_2) && near(ab.direction.y, Math.SQRT1_2));
  assert.throws(() => perpendicularBisector({ x: 1, y: 1 }, { x: 1, y: 1 }), /coincide/);
});

test('transformations and symmetry groups', () => {
  const [p] = transformPoints(rotation2D(Math.PI / 2), [{ x: 1, y: 0 }]);
  assert.ok(near(p.x, 0) && near(p.y, 1));
  assert.deepEqual(transformPoints(scaling2D(2, 3), [{ x: 1, y: 1 }]), [{ x: 2, y: 3 }]);
  assert.deepEqual(transformPoints(shear2D(1), [{ x: 0, y: 1 }]), [{ x: 1, y: 1 }]);
  const [r] = transformPoints(reflection2D(Math.PI / 4), [{ x: 1, y: 0 }]);
  assert.ok(near(r.x, 0) && near(r.y, 1));
  assert.deepEqual(transformPoints(affine2D([[1, 0], [0, 1]], 2, -1), [{ x: 0, y: 0 }]), [{ x: 2, y: -1 }]);
  const C4 = cyclicGroup(4);
  assert.deepEqual(C4.map((g) => g.name), ['e', 'r', 'r^2', 'r^3']);
  const D3 = dihedralGroup(3);
  assert.equal(D3.length, 6);
  const { table, names } = cayleyTable(D3);
  assert.deepEqual(names[0], ['e', 'r', 'r^2', 's', 'sr', 'sr^2']);
  // Latin square property and matrix consistency: M(a b) = M(a) M(b).
  for (const row of table) assert.equal(new Set(row).size, 6);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const A = D3[i].matrix;
      const B = D3[j].matrix;
      const AB = [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
      const M = D3[table[i][j]].matrix;
      assert.ok([0, 1].every((a) => [0, 1].every((b) => near(AB[a][b], M[a][b], 1e-12))));
    }
  }
  // Every reflection has order two.
  for (const g of D3.slice(3)) assert.equal(table[D3.indexOf(g)][D3.indexOf(g)], 0);
});
