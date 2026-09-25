/**
 * Polygon triangulation by ear clipping, with holes joined to the outer
 * boundary by bridge edges (the method of Eberly, "Triangulation by Ear
 * Clipping").
 * @module three/triangulate
 */

/**
 * Triangulate a simple polygon with optional holes.
 * @param {number[][]} outer [[x, y], ...] in either orientation
 * @param {number[][][]} [holes] each [[x, y], ...], in either orientation
 * @returns {number[][]} triangles as index triples into the concatenation [outer, ...holes], counterclockwise
 */
export function triangulatePolygon(outer, holes = []) {
  const pts = [...outer];
  for (const h of holes) pts.push(...h);
  let ring = outer.map((_, i) => i);
  if (signedArea(pts, ring) < 0) ring.reverse();
  let offset = outer.length;
  const holeRings = holes.map((h) => {
    let r = h.map((_, i) => offset + i);
    offset += h.length;
    if (signedArea(pts, r) > 0) r = r.reverse();
    return r;
  }).filter((r) => r.length >= 3);
  holeRings.sort((a, b) => maxX(pts, b) - maxX(pts, a));
  for (const h of holeRings) ring = bridge(pts, ring, h);
  return earClip(pts, ring);
}

function signedArea(pts, ring) {
  let A = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = pts[ring[i]];
    const b = pts[ring[(i + 1) % ring.length]];
    A += a[0] * b[1] - b[0] * a[1];
  }
  return A / 2;
}

function maxX(pts, ring) {
  let m = -Infinity;
  for (const i of ring) m = Math.max(m, pts[i][0]);
  return m;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function inTriangle(p, a, b, c, eps) {
  return cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;
}

function same(p, q) {
  return p[0] === q[0] && p[1] === q[1];
}

function bridge(pts, ring, hole) {
  let hi = 0;
  for (let k = 1; k < hole.length; k++) if (pts[hole[k]][0] > pts[hole[hi]][0]) hi = k;
  const M = pts[hole[hi]];
  let bestX = Infinity;
  let bestEdge = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = pts[ring[i]];
    const b = pts[ring[(i + 1) % ring.length]];
    if ((a[1] - M[1]) * (b[1] - M[1]) > 0 || a[1] === b[1]) continue;
    const x = a[0] + ((M[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (x >= M[0] && x < bestX) {
      bestX = x;
      bestEdge = i;
    }
  }
  if (bestEdge < 0) return ring;
  const ia = bestEdge;
  const ib = (bestEdge + 1) % ring.length;
  let pi = pts[ring[ia]][0] > pts[ring[ib]][0] ? ia : ib;
  const I = [bestX, M[1]];
  const P = pts[ring[pi]];
  if (!(I[0] === P[0] && I[1] === P[1])) {
    let bestAng = Infinity;
    let bestD = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const R = pts[ring[k]];
      const prev = pts[ring[(k - 1 + ring.length) % ring.length]];
      const next = pts[ring[(k + 1) % ring.length]];
      if (cross(prev, R, next) >= 0) continue;
      const area = cross(M, I, P);
      const s = Math.sign(area) || 1;
      if (s * cross(M, I, R) >= 0 && s * cross(I, P, R) >= 0 && s * cross(P, M, R) >= 0 && !same(R, P)) {
        const ang = Math.abs(Math.atan2(R[1] - M[1], R[0] - M[0]));
        const d = Math.hypot(R[0] - M[0], R[1] - M[1]);
        if (ang < bestAng - 1e-12 || (Math.abs(ang - bestAng) <= 1e-12 && d < bestD)) {
          bestAng = ang;
          bestD = d;
          pi = k;
        }
      }
    }
  }
  const holeSeq = [];
  for (let k = 0; k <= hole.length; k++) holeSeq.push(hole[(hi + k) % hole.length]);
  return [...ring.slice(0, pi + 1), ...holeSeq, ring[pi], ...ring.slice(pi + 1)];
}

function earClip(pts, ring) {
  const tris = [];
  const V = ring.slice();
  let scale = 0;
  for (const i of V) scale = Math.max(scale, Math.abs(pts[i][0]), Math.abs(pts[i][1]));
  const eps = 1e-12 * Math.max(1, scale * scale);
  let stall = 0;
  let i = 0;
  while (V.length > 3) {
    const n = V.length;
    const ia = V[(i - 1 + n) % n];
    const ib = V[i % n];
    const ic = V[(i + 1) % n];
    const a = pts[ia];
    const b = pts[ib];
    const c = pts[ic];
    const cr = cross(a, b, c);
    let ear = cr > eps;
    if (ear) {
      for (let k = 0; k < n; k++) {
        const v = V[k];
        if (v === ia || v === ib || v === ic) continue;
        const p = pts[v];
        if (same(p, a) || same(p, b) || same(p, c)) continue;
        if (inTriangle(p, a, b, c, -eps)) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      tris.push([ia, ib, ic]);
      V.splice(i % n, 1);
      stall = 0;
      i = Math.max(0, (i % n) - 1);
      continue;
    }
    if (Math.abs(cr) <= eps && stall >= n) {
      V.splice(i % n, 1);
      stall = 0;
      continue;
    }
    stall++;
    if (stall > 2 * n) {
      let best = 0;
      let bc = -Infinity;
      for (let k = 0; k < n; k++) {
        const v = cross(pts[V[(k - 1 + n) % n]], pts[V[k]], pts[V[(k + 1) % n]]);
        if (v > bc) {
          bc = v;
          best = k;
        }
      }
      if (bc > eps) tris.push([V[(best - 1 + n) % n], V[best], V[(best + 1) % n]]);
      V.splice(best, 1);
      stall = 0;
      i = 0;
      continue;
    }
    i = (i + 1) % n;
  }
  if (V.length === 3 && cross(pts[V[0]], pts[V[1]], pts[V[2]]) > eps) tris.push([V[0], V[1], V[2]]);
  return tris;
}
