import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4, quat, vec3 } from '../../src/three/index.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const closeVec = (a, b, eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps));

test('mat4 inverse times matrix is the identity', () => {
  const m = mat4.multiply(mat4.translation(1, -2, 3), mat4.multiply(mat4.axisAngle([1, 2, 3], 0.7), mat4.scaling(2, 0.5, 3)));
  const p = mat4.multiply(m, mat4.invert(m));
  const I = mat4.identity();
  for (let i = 0; i < 16; i++) close(p[i], I[i], 1e-12);
});

test('mat4 multiply applies the right-hand matrix first', () => {
  const m = mat4.multiply(mat4.translation(5, 0, 0), mat4.scaling(2, 2, 2));
  closeVec(mat4.transformPoint(m, [1, 1, 1]), [7, 2, 2]);
});

test('Euler matrix and Euler quaternion agree', () => {
  const [rx, ry, rz] = [0.3, -1.1, 2.2];
  const a = mat4.fromEulerXYZ(rx, ry, rz);
  const b = mat4.fromQuat(quat.fromEuler(rx, ry, rz));
  for (let i = 0; i < 16; i++) close(a[i], b[i], 1e-12);
});

test('lookAt puts the eye at the origin and the target on the -z axis', () => {
  const eye = [3, -4, 2];
  const target = [0.5, 1, -1];
  const V = mat4.lookAt(eye, target, [0, 0, 1]);
  closeVec(mat4.transformPoint(V, eye), [0, 0, 0]);
  const t = mat4.transformPoint(V, target);
  close(t[0], 0);
  close(t[1], 0);
  close(t[2], -vec3.distance(eye, target));
});

test('perspective maps the near and far planes to -1 and 1', () => {
  const P = mat4.perspective(Math.PI / 3, 16 / 9, 0.5, 50);
  close(mat4.transformPoint(P, [0, 0, -0.5])[2], -1, 1e-9);
  close(mat4.transformPoint(P, [0, 0, -50])[2], 1, 1e-9);
  const top = Math.tan(Math.PI / 6) * 10;
  close(mat4.transformPoint(P, [0, top, -10])[1], 1, 1e-9);
});

test('orthographic maps its box to the unit cube', () => {
  const O = mat4.orthographic(-4, 4, -2, 2, 1, 11);
  closeVec(mat4.transformPoint(O, [4, 2, -1]), [1, 1, -1]);
  closeVec(mat4.transformPoint(O, [-4, -2, -11]), [-1, -1, 1]);
});

test('projection morph keeps the focus plane size and ends orthographic', () => {
  const fov = Math.PI / 5;
  const focus = 8;
  const edge = focus * Math.tan(fov / 2);
  for (const t of [0, 0.3, 0.7, 0.95]) {
    const { proj, back } = mat4.projectionMorph(fov, 1, 0.1, 100, t, focus);
    const y = mat4.transformPoint(proj, [0, edge, -(focus + back)])[1];
    close(y, 1, 1e-9);
  }
  const end = mat4.projectionMorph(fov, 1, 0.1, 100, 1, focus);
  assert.equal(end.orthographic, true);
  close(mat4.transformPoint(end.proj, [0, edge, -3])[1], 1, 1e-9);
  close(mat4.transformPoint(end.proj, [0, edge, -30])[1], 1, 1e-9);
});

test('slerp halfway between identity and a quarter turn is an eighth turn', () => {
  const q = quat.slerp(quat.identity(), quat.fromAxisAngle([0, 0, 1], Math.PI / 2), 0.5);
  closeVec(q, quat.fromAxisAngle([0, 0, 1], Math.PI / 4), 1e-12);
  close(Math.hypot(...q), 1, 1e-12);
});

test('slerp takes the short arc when the quaternions are antipodal representatives', () => {
  const a = quat.fromAxisAngle([0, 1, 0], 0.2);
  const b = quat.fromAxisAngle([0, 1, 0], 0.6).map((v) => -v);
  const m = quat.slerp(a, b, 0.5);
  close(quat.angle(m), 0.4, 1e-9);
});

test('slerp moves at constant angular speed', () => {
  const a = quat.fromEuler(0.1, 0.4, -0.3);
  const b = quat.fromEuler(1.2, -0.5, 0.9);
  const total = quat.angle(quat.multiply(b, quat.conjugate(a)));
  for (const t of [0.25, 0.5, 0.75]) {
    const q = quat.slerp(a, b, t);
    close(quat.angle(quat.multiply(q, quat.conjugate(a))), total * t, 1e-9);
  }
});

test('quaternion rotation matches the rotation matrix', () => {
  const q = quat.fromAxisAngle([1, 1, 0], 1.3);
  const m = mat4.fromQuat(q);
  const v = [0.2, -1, 3];
  closeVec(quat.rotate(q, v), mat4.transformDirection(m, v), 1e-12);
  closeVec(vec3.rotateAxis(v, vec3.normalize([1, 1, 0]), 1.3), quat.rotate(q, v), 1e-12);
});

test('lookRotation aims the camera -z axis at the target with z up', () => {
  const eye = [4, 3, 2];
  const q = quat.lookRotation(eye, [0, 0, 0]);
  closeVec(quat.rotate(q, [0, 0, -1]), vec3.normalize([-4, -3, -2]), 1e-12);
  assert.ok(quat.rotate(q, [0, 1, 0])[2] > 0);
});

test('fromUnitVectors and fromBasis produce the expected rotations', () => {
  const a = vec3.normalize([1, 2, 3]);
  const b = vec3.normalize([-2, 0.5, 1]);
  closeVec(quat.rotate(quat.fromUnitVectors(a, b), a), b, 1e-12);
  closeVec(quat.rotate(quat.fromUnitVectors([0, 0, 1], [0, 0, -1]), [0, 0, 1]), [0, 0, -1], 1e-12);
  const q = quat.fromEuler(0.4, 0.2, -1);
  const r = quat.fromBasis(quat.rotate(q, [1, 0, 0]), quat.rotate(q, [0, 1, 0]), quat.rotate(q, [0, 0, 1]));
  close(Math.abs(quat.dot(q, r)), 1, 1e-12);
});

test('spherical follows the Bloch sphere convention', () => {
  closeVec(vec3.spherical(0, 1), [0, 0, 1]);
  closeVec(vec3.spherical(Math.PI / 2, 0), [1, 0, 0]);
  closeVec(vec3.spherical(Math.PI / 2, Math.PI / 2), [0, 1, 0]);
});
