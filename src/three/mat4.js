/**
 * 4x4 matrices, column-major like WebGL: element (row r, column c) is at
 * index c * 4 + r. Points are column vectors, so `multiply(a, b)` applies b
 * first. The camera looks down its local -z axis (right-handed, OpenGL
 * clip space with z in [-1, 1]).
 * @module three/mat4
 */

/** @typedef {Float64Array|number[]} Mat4 */

/** @returns {Mat4} */
export function identity() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * Product a * b.
 * @param {Mat4} a @param {Mat4} b
 * @returns {Mat4}
 */
export function multiply(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}

/**
 * General inverse (cofactor expansion).
 * @param {Mat4} m
 * @returns {Mat4}
 */
export function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-300) throw new Error('mat4.invert: matrix is singular');
  const d = 1 / det;
  const o = new Float64Array(16);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return o;
}

/**
 * @param {Mat4} m
 * @returns {Mat4}
 */
export function transpose(m) {
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = m[r * 4 + c];
  return o;
}

/** @param {number} x @param {number} y @param {number} z @returns {Mat4} */
export function translation(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** @param {number} x @param {number} y @param {number} z @returns {Mat4} */
export function scaling(x, y, z) {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

/**
 * Rotation about a unit axis by an angle (radians, right-hand rule).
 * @param {number[]} axis @param {number} angle
 * @returns {Mat4}
 */
export function axisAngle(axis, angle) {
  const L = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / L;
  const y = axis[1] / L;
  const z = axis[2] / L;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const m = identity();
  m[0] = t * x * x + c;
  m[1] = t * x * y + s * z;
  m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z;
  m[5] = t * y * y + c;
  m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y;
  m[9] = t * y * z - s * x;
  m[10] = t * z * z + c;
  return m;
}

/**
 * Rotation matrix of a unit quaternion [x, y, z, w].
 * @param {number[]} q
 * @returns {Mat4}
 */
export function fromQuat(q) {
  const [x, y, z, w] = q;
  const m = identity();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

/**
 * Euler rotation: x first, then y, then z, all about fixed world axes
 * (R = Rz Ry Rx).
 * @param {number} rx @param {number} ry @param {number} rz
 * @returns {Mat4}
 */
export function fromEulerXYZ(rx, ry, rz) {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const m = identity();
  m[0] = cz * cy;
  m[1] = sz * cy;
  m[2] = -sy;
  m[4] = cz * sy * sx - sz * cx;
  m[5] = sz * sy * sx + cz * cx;
  m[6] = cy * sx;
  m[8] = cz * sy * cx + sz * sx;
  m[9] = sz * sy * cx - cz * sx;
  m[10] = cy * cx;
  return m;
}

/**
 * Transform point (w = 1) with perspective divide.
 * @param {Mat4} m @param {number[]} p
 * @returns {number[]}
 */
export function transformPoint(m, p) {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = w !== 0 ? 1 / w : 1;
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) * iw, (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw, (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw];
}

/**
 * Transform a direction (w = 0).
 * @param {Mat4} m @param {number[]} v
 * @returns {number[]}
 */
export function transformDirection(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}

/**
 * Homogeneous transform of [x, y, z, w].
 * @param {Mat4} m @param {number[]} v
 * @returns {number[]}
 */
export function transformVec4(m, v) {
  const [x, y, z, w] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

/**
 * Translate, rotate by quaternion, scale: M = T R S.
 * @param {number[]} pos @param {number[]} q @param {number[]} s
 * @returns {Mat4}
 */
export function compose(pos, q, s) {
  const m = fromQuat(q);
  for (let i = 0; i < 3; i++) {
    m[i] *= s[0];
    m[4 + i] *= s[1];
    m[8 + i] *= s[2];
  }
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  return m;
}

/**
 * View matrix for a camera at `eye` looking at `target`.
 * @param {number[]} eye @param {number[]} target @param {number[]} up
 * @returns {Mat4}
 */
export function lookAt(eye, target, up) {
  let fx = target[0] - eye[0];
  let fy = target[1] - eye[1];
  let fz = target[2] - eye[2];
  let L = Math.hypot(fx, fy, fz) || 1;
  fx /= L;
  fy /= L;
  fz /= L;
  let rx = fy * up[2] - fz * up[1];
  let ry = fz * up[0] - fx * up[2];
  let rz = fx * up[1] - fy * up[0];
  L = Math.hypot(rx, ry, rz);
  if (L < 1e-12) {
    const alt = Math.abs(fz) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    rx = fy * alt[2] - fz * alt[1];
    ry = fz * alt[0] - fx * alt[2];
    rz = fx * alt[1] - fy * alt[0];
    L = Math.hypot(rx, ry, rz);
  }
  rx /= L;
  ry /= L;
  rz /= L;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  return viewFromBasis(eye, [rx, ry, rz], [ux, uy, uz], [fx, fy, fz]);
}

/**
 * View matrix from an eye point and an orthonormal camera basis.
 * @param {number[]} eye @param {number[]} right @param {number[]} up @param {number[]} forward
 * @returns {Mat4}
 */
export function viewFromBasis(eye, right, up, forward) {
  const m = identity();
  m[0] = right[0];
  m[4] = right[1];
  m[8] = right[2];
  m[1] = up[0];
  m[5] = up[1];
  m[9] = up[2];
  m[2] = -forward[0];
  m[6] = -forward[1];
  m[10] = -forward[2];
  m[12] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
  m[13] = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
  m[14] = forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2];
  return m;
}

/**
 * Perspective projection.
 * @param {number} fovY vertical field of view in radians
 * @param {number} aspect width / height
 * @param {number} near @param {number} far
 * @returns {Mat4}
 */
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/**
 * Orthographic projection of the box [l, r] x [b, t] x [-near, -far].
 * @returns {Mat4}
 */
export function orthographic(l, r, b, t, near, far) {
  const m = identity();
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = -2 / (far - near);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -(far + near) / (far - near);
  return m;
}

/**
 * Projection morph between perspective (t = 0) and orthographic (t = 1).
 * It is a dolly zoom: the camera backs away from the focus plane by
 * `focus / s - focus` (s = 1 - t) while the field of view narrows so the focus
 * plane keeps its size. Every intermediate is a true perspective camera,
 * which keeps depth ordering exact, and t = 1 is exactly orthographic.
 * @param {number} fovY radians
 * @param {number} aspect
 * @param {number} near distance from the unmorphed eye
 * @param {number} far distance from the unmorphed eye
 * @param {number} t blend in [0, 1]
 * @param {number} focus distance from the eye to the plane that keeps its size
 * @returns {{proj: Mat4, back: number, orthographic: boolean}} `back` is how far the eye moves backward
 */
export function projectionMorph(fovY, aspect, near, far, t, focus) {
  const s = 1 - Math.min(1, Math.max(0, t));
  const halfH = focus * Math.tan(fovY / 2);
  if (s < 1e-4) {
    return { proj: orthographic(-halfH * aspect, halfH * aspect, -halfH, halfH, near, far), back: 0, orthographic: true };
  }
  const back = focus / s - focus;
  const fov = 2 * Math.atan(s * Math.tan(fovY / 2));
  return { proj: perspective(fov, aspect, near + back, far + back), back, orthographic: false };
}
