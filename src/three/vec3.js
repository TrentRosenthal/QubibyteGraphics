/**
 * Small 3D vector helpers on plain arrays [x, y, z]. Functions return new
 * arrays; none of them mutate their arguments.
 * @module three/vec3
 */

/** @typedef {number[]} Vec3 A 3D vector [x, y, z]. */

/**
 * @param {Vec3} a @param {Vec3} b
 * @returns {Vec3}
 */
export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * @param {Vec3} a @param {Vec3} b
 * @returns {Vec3} a - b
 */
export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * @param {Vec3} a @param {number} s
 * @returns {Vec3}
 */
export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * @param {Vec3} a @param {Vec3} b
 * @returns {number}
 */
export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * @param {Vec3} a @param {Vec3} b
 * @returns {Vec3} a x b
 */
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * @param {Vec3} a
 * @returns {number}
 */
export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

/**
 * Unit vector in the direction of a; the zero vector stays zero.
 * @param {Vec3} a
 * @returns {Vec3}
 */
export function normalize(a) {
  const L = Math.hypot(a[0], a[1], a[2]);
  return L > 0 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0];
}

/**
 * @param {Vec3} a @param {Vec3} b @param {number} t
 * @returns {Vec3}
 */
export function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * @param {Vec3} a @param {Vec3} b
 * @returns {number}
 */
export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Any unit vector perpendicular to a (a must be nonzero).
 * @param {Vec3} a
 * @returns {Vec3}
 */
export function perpendicular(a) {
  const n = normalize(a);
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return normalize(cross(n, helper));
}

/**
 * Rotate v about a unit axis by an angle (Rodrigues' formula).
 * @param {Vec3} v @param {Vec3} axis unit axis @param {number} angle radians
 * @returns {Vec3}
 */
export function rotateAxis(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = axis;
  const kv = dot(k, v);
  const kxv = cross(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kv * (1 - c),
  ];
}

/**
 * Point on the unit sphere from polar angle theta (from +z) and azimuth phi
 * (from +x toward +y). This is the Bloch sphere convention.
 * @param {number} theta @param {number} phi
 * @returns {Vec3}
 */
export function spherical(theta, phi) {
  const s = Math.sin(theta);
  return [s * Math.cos(phi), s * Math.sin(phi), Math.cos(theta)];
}
