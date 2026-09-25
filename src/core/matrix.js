/**
 * 2D affine matrices in the Canvas2D convention [a, b, c, d, e, f]:
 *   x' = a x + c y + e
 *   y' = b x + d y + f
 * @module core/matrix
 */

/** @typedef {number[]} Mat2D */

/** @returns {Mat2D} */
export function identity() {
  return [1, 0, 0, 1, 0, 0];
}

/**
 * Product m1 * m2 (apply m2 first, then m1).
 * @param {Mat2D} m1 @param {Mat2D} m2
 * @returns {Mat2D}
 */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Compose translate(x, y) * rotate(r) * scale(sx, sy) * translate(-px, -py).
 * @returns {Mat2D}
 */
export function compose(x, y, rotation, sx, sy, px = 0, py = 0) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a, b, c, d, x - (a * px + c * py), y - (b * px + d * py)];
}

/**
 * Inverse of an affine matrix.
 * @param {Mat2D} m
 * @returns {Mat2D}
 */
export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-15) throw new Error('Matrix is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * Apply to a point.
 * @param {Mat2D} m @param {number} x @param {number} y
 * @returns {[number, number]}
 */
export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

