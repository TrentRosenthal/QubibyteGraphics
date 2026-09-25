/**
 * Unit quaternions [x, y, z, w] for rotations.
 * @module three/quat
 */

/** @typedef {number[]} Quat */

/** @returns {Quat} */
export function identity() {
  return [0, 0, 0, 1];
}

/**
 * @param {number[]} axis @param {number} angle radians
 * @returns {Quat}
 */
export function fromAxisAngle(axis, angle) {
  const L = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2) / L;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/**
 * Hamilton product a * b (apply b, then a).
 * @param {Quat} a @param {Quat} b
 * @returns {Quat}
 */
export function multiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** @param {Quat} q @returns {Quat} */
export function conjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** @param {Quat} q @returns {Quat} */
export function normalize(q) {
  const L = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / L, q[1] / L, q[2] / L, q[3] / L];
}

/** @param {Quat} a @param {Quat} b @returns {number} */
export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/**
 * Euler rotation x, then y, then z about fixed axes (matches mat4.fromEulerXYZ).
 * @param {number} rx @param {number} ry @param {number} rz
 * @returns {Quat}
 */
export function fromEuler(rx, ry, rz) {
  return multiply(fromAxisAngle([0, 0, 1], rz), multiply(fromAxisAngle([0, 1, 0], ry), fromAxisAngle([1, 0, 0], rx)));
}

/**
 * Spherical linear interpolation along the shorter arc.
 * @param {Quat} a @param {Quat} b @param {number} t
 * @returns {Quat}
 */
export function slerp(a, b, t) {
  let c = dot(a, b);
  let bb = b;
  if (c < 0) {
    c = -c;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (c > 0.99995) {
    return normalize([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  }
  const th = Math.acos(Math.min(1, c));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}

/**
 * Rotate a vector.
 * @param {Quat} q @param {number[]} v
 * @returns {number[]}
 */
export function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/**
 * Quaternion of a rotation whose columns are the images of x, y, z.
 * @param {number[]} X @param {number[]} Y @param {number[]} Z orthonormal, right-handed
 * @returns {Quat}
 */
export function fromBasis(X, Y, Z) {
  const m00 = X[0];
  const m10 = X[1];
  const m20 = X[2];
  const m01 = Y[0];
  const m11 = Y[1];
  const m21 = Y[2];
  const m02 = Z[0];
  const m12 = Z[1];
  const m22 = Z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return normalize(q);
}

/**
 * Orientation of a camera at `eye` looking at `target` with an up hint: the
 * camera's local -z maps to the view direction and local +y toward `up`.
 * @param {number[]} eye @param {number[]} target @param {number[]} [up=[0,0,1]]
 * @returns {Quat}
 */
export function lookRotation(eye, target, up = [0, 0, 1]) {
  let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const L = Math.hypot(...f) || 1;
  f = f.map((v) => v / L);
  let r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  let rl = Math.hypot(...r);
  if (rl < 1e-9) {
    r = [1, 0, 0];
    rl = 1;
  }
  r = r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return fromBasis(r, u, [-f[0], -f[1], -f[2]]);
}

/**
 * Shortest rotation taking unit vector a to unit vector b.
 * @param {number[]} a @param {number[]} b
 * @returns {Quat}
 */
export function fromUnitVectors(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    let ax = [0, -a[2], a[1]];
    if (Math.hypot(...ax) < 1e-6) ax = [-a[2], 0, a[0]];
    return fromAxisAngle(ax, Math.PI);
  }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return normalize([c[0], c[1], c[2], 1 + d]);
}

/**
 * Rotation angle of a unit quaternion, in [0, pi].
 * @param {Quat} q
 * @returns {number}
 */
export function angle(q) {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}
