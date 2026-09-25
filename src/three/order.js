/**
 * Visibility ordering for the vector projector (painter's algorithm made
 * exact). Primitives are polygons, segments, and points in world space. The
 * order is built in three layers:
 *
 * 1. Grouping. Primitives are grouped by overlapping world-space bounding
 *    boxes (meshes as whole objects, lines as short pieces). Groups whose
 *    boxes are disjoint are separated by an axis-aligned plane, so the group
 *    on the camera's side of that plane is drawn later: a topological sort
 *    over screen-overlapping pairs orders the groups exactly.
 * 2. Convex solids. Inside a group, a whole convex solid K splits the rest
 *    into what lies behind it (inside its silhouette cone, past it), inside
 *    it, and in front of or beside it. The order is: behind, K's back faces
 *    (translucent only), inside, K's front faces, front. The split clips
 *    primitives against the cone planes and K's faces, so nothing is
 *    approximated.
 * 3. BSP trees. Remaining polygons are ordered by a BSP tree, built once
 *    per static mesh in model space (and reused every frame by moving the
 *    eye into model space) or per frame for deforming geometry. Primitives
 *    of other objects are inserted into the tree, split by its planes.
 *    Lines lying in a polygon's plane are drawn right after it, so wireframes
 *    and grids on surfaces never z-fight.
 * @module three/order
 */

import { transformPoint } from './mat4.js';

/** Primitive kinds. */
export const POLY = 0;
export const SEG = 1;
export const PT = 2;

/**
 * @typedef {Object} Prim
 * @property {number} k kind: POLY, SEG, or PT
 * @property {number[]} p world coordinates, flat xyz
 * @property {any} u owner unit info
 * @property {number} f face index for polygons, else -1
 * @property {number[]|null} pl plane [nx, ny, nz, d] for polygons
 * @property {boolean} whole not split
 * @property {any} s style payload used by the emitter
 */

/**
 * Plane of a polygon (Newell normal, unit length) as [nx, ny, nz, d].
 * @param {number[]} p flat xyz
 * @returns {number[]}
 */
export function planeOf(p) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const n = p.length / 3;
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    const b = ((i + 1) % n) * 3;
    nx += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
    ny += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
    nz += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
    cx += p[a];
    cy += p[a + 1];
    cz += p[a + 2];
  }
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L;
  ny /= L;
  nz /= L;
  return [nx, ny, nz, (nx * cx + ny * cy + nz * cz) / n];
}

/**
 * Signed side of the (homogeneous) eye relative to a plane.
 * @param {number[]} pl @param {number[]} eyeH
 * @returns {number}
 */
export function eyeSide(pl, eyeH) {
  return pl[0] * eyeH[0] + pl[1] * eyeH[1] + pl[2] * eyeH[2] - pl[3] * eyeH[3];
}

function piece(src, p) {
  return { k: src.k, p, u: src.u, f: src.f, pl: src.pl, whole: false, s: src.s, src: src.src ?? src };
}

/**
 * Split a primitive by a plane.
 * @param {Prim} x
 * @param {number[]} pl
 * @param {number} eps
 * @returns {{front: Prim|null, back: Prim|null, on: boolean}}
 */
export function splitPrim(x, pl, eps) {
  const p = x.p;
  const n = p.length / 3;
  const nx = pl[0];
  const ny = pl[1];
  const nz = pl[2];
  const d = pl[3];
  let pos = 0;
  let neg = 0;
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = nx * p[i * 3] + ny * p[i * 3 + 1] + nz * p[i * 3 + 2] - d;
    s[i] = v;
    if (v > eps) pos++;
    else if (v < -eps) neg++;
  }
  if (!pos && !neg) return { front: null, back: null, on: true };
  if (!neg) return { front: x, back: null, on: false };
  if (!pos) return { front: null, back: x, on: false };
  if (x.k === SEG) {
    const t = s[0] / (s[0] - s[1]);
    const m = [p[0] + (p[3] - p[0]) * t, p[1] + (p[4] - p[1]) * t, p[2] + (p[5] - p[2]) * t];
    const a = piece(x, [p[0], p[1], p[2], m[0], m[1], m[2]]);
    const b = piece(x, [m[0], m[1], m[2], p[3], p[4], p[5]]);
    return s[0] > 0 ? { front: a, back: b, on: false } : { front: b, back: a, on: false };
  }
  const F = [];
  const B = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const si = s[i];
    const sj = s[j];
    const xi = p[i * 3];
    const yi = p[i * 3 + 1];
    const zi = p[i * 3 + 2];
    if (si >= -eps) F.push(xi, yi, zi);
    if (si <= eps) B.push(xi, yi, zi);
    if ((si > eps && sj < -eps) || (si < -eps && sj > eps)) {
      const t = si / (si - sj);
      const mx = xi + (p[j * 3] - xi) * t;
      const my = yi + (p[j * 3 + 1] - yi) * t;
      const mz = zi + (p[j * 3 + 2] - zi) * t;
      F.push(mx, my, mz);
      B.push(mx, my, mz);
    }
  }
  return { front: F.length >= 9 ? piece(x, F) : null, back: B.length >= 9 ? piece(x, B) : null, on: false };
}

function centroid(p) {
  const n = p.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < p.length; i += 3) {
    x += p[i];
    y += p[i + 1];
    z += p[i + 2];
  }
  return [x / n, y / n, z / n];
}

/**
 * View depth of a primitive's centroid (larger is farther).
 * @param {Prim} x
 * @param {{eye: number[], forward: number[]}} cam
 * @returns {number}
 */
export function depthOf(x, cam) {
  const c = centroid(x.p);
  return (c[0] - cam.eye[0]) * cam.forward[0] + (c[1] - cam.eye[1]) * cam.forward[1] + (c[2] - cam.eye[2]) * cam.forward[2];
}

function sortFarFirst(list, cam) {
  if (list.length < 2) return list;
  const d = new Map();
  for (const x of list) d.set(x, depthOf(x, cam));
  return list.slice().sort((a, b) => d.get(b) - d.get(a) || (a.k === SEG ? 0 : 1) - (b.k === SEG ? 0 : 1));
}

/**
 * Build a BSP tree over a list of primitives. Only polygons split space;
 * segments and points are carried to the leaves, and those lying in a
 * splitting plane stay with it.
 * @param {Prim[]} list
 * @param {number} eps
 * @returns {any} tree root
 */
export function buildBSP(list, eps) {
  const root = {};
  const stack = [[root, list]];
  while (stack.length) {
    const [node, items] = stack.pop();
    let polyCount = 0;
    for (const x of items) if (x.k === POLY) polyCount++;
    if (!polyCount) {
      node.leaf = items;
      continue;
    }
    const pick = chooseSplitter(items, polyCount, eps);
    node.pl = pick.pl;
    node.on = [];
    node.lines = [];
    const F = [];
    const B = [];
    for (const x of items) {
      if (x === pick) {
        node.on.push(x);
        continue;
      }
      const r = splitPrim(x, node.pl, eps);
      if (r.on) (x.k === POLY ? node.on : node.lines).push(x);
      else {
        if (r.front) F.push(r.front);
        if (r.back) B.push(r.back);
      }
    }
    node.front = F.length ? {} : null;
    node.back = B.length ? {} : null;
    if (F.length) stack.push([node.front, F]);
    if (B.length) stack.push([node.back, B]);
  }
  return root;
}

function chooseSplitter(items, polyCount, eps) {
  const polys = [];
  for (const x of items) if (x.k === POLY) polys.push(x);
  if (polys.length === 1) return polys[0];
  const cand = [];
  const nc = Math.min(6, polys.length);
  for (let i = 0; i < nc; i++) cand.push(polys[Math.floor((i * polys.length) / nc)]);
  const sample = [];
  const ns = Math.min(48, items.length);
  for (let i = 0; i < ns; i++) sample.push(items[Math.floor((i * items.length) / ns)]);
  let best = cand[0];
  let bestScore = Infinity;
  for (const c of cand) {
    let f = 0;
    let b = 0;
    let splits = 0;
    const [nx, ny, nz, d] = c.pl;
    for (const x of sample) {
      if (x === c) continue;
      let pos = 0;
      let neg = 0;
      const p = x.p;
      for (let i = 0; i < p.length; i += 3) {
        const v = nx * p[i] + ny * p[i + 1] + nz * p[i + 2] - d;
        if (v > eps) pos++;
        else if (v < -eps) neg++;
      }
      if (pos && neg) splits++;
      else if (pos) f++;
      else if (neg) b++;
    }
    const score = splits * 4 + Math.abs(f - b);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Traverse a BSP tree back to front from the eye.
 * @param {any} root
 * @param {number[]} eyeH
 * @param {any} cam
 * @param {Prim[]} out
 * @param {(node: any, side: number) => Prim[]|null} [nodeItems] override for a node's own items
 * @param {(node: any, which: 'front'|'back') => Prim[]|null} [emptyChild] items for an empty child slot
 */
export function traverseBSP(root, eyeH, cam, out, nodeItems, emptyChild) {
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    if (x.emit) {
      for (const y of x.emit) out.push(y);
      continue;
    }
    if (x.leaf) {
      for (const y of sortFarFirst(x.leaf, cam)) out.push(y);
      continue;
    }
    const s = eyeSide(x.pl, eyeH);
    const nearKey = s >= 0 ? 'front' : 'back';
    const farKey = s >= 0 ? 'back' : 'front';
    const near = x[nearKey] ?? (emptyChild ? emptyChild(x, nearKey) : null);
    const far = x[farKey] ?? (emptyChild ? emptyChild(x, farKey) : null);
    if (near) stack.push(Array.isArray(near) ? { emit: near } : near);
    const own = nodeItems ? nodeItems(x, s) : x.on.concat(x.lines);
    if (own && own.length) stack.push({ emit: own });
    if (far) stack.push(Array.isArray(far) ? { emit: far } : far);
  }
}

/**
 * Silhouette cone planes of a convex solid seen from the eye; points inside
 * all planes (negative side) project inside the solid's outline.
 * @param {any} K unit info with worldPos, faces, front flags, edges, center
 * @param {any} cam
 * @returns {number[][]}
 */
function silhouetteCone(K, cam) {
  const E = K.edges;
  const P = K.worldPos;
  const planes = [];
  for (let i = 0; i < E.count; i++) {
    const f1 = E.f1[i];
    if (f1 < 0 || K.front[E.f0[i]] === K.front[f1]) continue;
    const a = [P[E.a[i] * 3], P[E.a[i] * 3 + 1], P[E.a[i] * 3 + 2]];
    const b = [P[E.b[i] * 3], P[E.b[i] * 3 + 1], P[E.b[i] * 3 + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = cam.orthographic ? cam.forward : [a[0] - cam.eyeH[0], a[1] - cam.eyeH[1], a[2] - cam.eyeH[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(...n);
    if (L < 1e-14) continue;
    n = n.map((c) => c / L);
    let d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    if (n[0] * K.center[0] + n[1] * K.center[1] + n[2] * K.center[2] - d > 0) {
      n = n.map((c) => -c);
      d = -d;
    }
    planes.push([n[0], n[1], n[2], d]);
  }
  return planes;
}

function allPositive(p, pl, eps) {
  for (let i = 0; i < p.length; i += 3) if (pl[0] * p[i] + pl[1] * p[i + 1] + pl[2] * p[i + 2] - pl[3] <= eps) return false;
  return true;
}

function boundSphere(p) {
  const c = centroid(p);
  let r = 0;
  for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - c[0], p[i + 1] - c[1], p[i + 2] - c[2]));
  return [c, r];
}

function partitionConvex(K, others, cam, eps) {
  const behind = [];
  const inside = [];
  const front = [];
  const cone = silhouetteCone(K, cam);
  const frontPlanes = [];
  for (let f = 0; f < K.planes.length; f++) if (K.front[f]) frontPlanes.push(K.planes[f]);
  const beforeK = (x) => {
    const c = centroid(x.p);
    for (const pl of frontPlanes) if (pl[0] * c[0] + pl[1] * c[1] + pl[2] * c[2] - pl[3] > eps) return true;
    return false;
  };
  for (const x of others) {
    let outside = false;
    for (const pl of cone) {
      if (allPositive(x.p, pl, -eps)) {
        outside = true;
        break;
      }
    }
    if (outside) {
      front.push(x);
      continue;
    }
    const [c, r] = boundSphere(x.p);
    const dc = Math.hypot(c[0] - K.center[0], c[1] - K.center[1], c[2] - K.center[2]);
    if (dc + r < K.inR - eps) {
      inside.push(x);
      continue;
    }
    let pieces = [x];
    for (const pl of cone) {
      const next = [];
      for (const pc of pieces) {
        const s = splitPrim(pc, pl, eps);
        if (s.on) front.push(pc);
        else {
          if (s.front) front.push(s.front);
          if (s.back) next.push(s.back);
        }
      }
      pieces = next;
      if (!pieces.length) break;
    }
    if (!pieces.length) continue;
    if (dc - r > K.outR + eps) {
      for (const pc of pieces) (beforeK(pc) ? front : behind).push(pc);
      continue;
    }
    for (let f = 0; f < K.planes.length && pieces.length; f++) {
      const pl = K.planes[f];
      const next = [];
      for (const pc of pieces) {
        const s = splitPrim(pc, pl, eps);
        if (s.on) (K.front[f] ? front : inside).push(pc);
        else {
          if (s.front) (beforeK(s.front) ? front : behind).push(s.front);
          if (s.back) next.push(s.back);
        }
      }
      pieces = next;
    }
    for (const pc of pieces) inside.push(pc);
  }
  return { behind, inside, front };
}

function toModel(x, U) {
  const p = x.p;
  const q = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const r = transformPoint(U.Minv, [p[i], p[i + 1], p[i + 2]]);
    q[i] = r[0];
    q[i + 1] = r[1];
    q[i + 2] = r[2];
  }
  return { k: x.k, p: q, u: x.u, f: x.f, pl: x.pl, whole: x.whole, s: x.s, src: x.src, orig: x };
}

function toWorld(x, U) {
  if (x.orig) return x.orig;
  const p = x.p;
  const q = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const r = transformPoint(U.M, [p[i], p[i + 1], p[i + 2]]);
    q[i] = r[0];
    q[i + 1] = r[1];
    q[i + 2] = r[2];
  }
  const y = { k: x.k, p: q, u: x.u, f: x.f, pl: x.pl, whole: false, s: x.s, src: x.src };
  if (x.k === POLY && x.u !== U) y.pl = planeOf(q);
  return y;
}

function orderWithCachedTree(U, others, cam, eps, ctx) {
  const tree = U.bsp;
  const eyeH = U.eyeModel;
  const extra = new Map();
  const bucket = (node, key) => {
    let e = extra.get(node);
    if (!e) {
      e = { on: [], front: [], back: [] };
      extra.set(node, e);
    }
    return e[key];
  };
  for (const x of others) {
    const stack = [[tree, toModel(x, U)]];
    while (stack.length) {
      const [node, y] = stack.pop();
      if (node.leaf) {
        bucket(node, 'front').push(y);
        continue;
      }
      const r = splitPrim(y, node.pl, eps);
      if (r.on) {
        bucket(node, 'on').push(y);
        continue;
      }
      if (r.front) {
        if (node.front) stack.push([node.front, r.front]);
        else bucket(node, 'front').push(r.front);
      }
      if (r.back) {
        if (node.back) stack.push([node.back, r.back]);
        else bucket(node, 'back').push(r.back);
      }
    }
  }
  const out = [];
  const frontSign = U.detSign;
  const ownFace = (y) => (U.cull && eyeSide(y.pl, eyeH) * frontSign <= 0 ? null : U.faceWorld(y));
  const worldList = (list) => list.map((y) => toWorld(y, U));
  traverseBSP(
    tree,
    eyeH,
    { eye: U.eyeModelPoint, forward: U.forwardModel },
    out,
    (node) => {
      const res = [];
      for (const y of node.on) {
        const w = ownFace(y);
        if (w) res.push(w);
      }
      const e = extra.get(node);
      if (e && e.on.length) {
        const polys = e.on.filter((y) => y.k === POLY);
        const rest = e.on.filter((y) => y.k !== POLY);
        for (const y of orderGroup(worldList(polys), cam, eps, ctx)) res.push(y);
        for (const y of sortFarFirst(worldList(rest), cam)) res.push(y);
      }
      return res;
    },
    (node, key) => {
      const e = extra.get(node);
      if (!e || !e[key].length) return null;
      return orderGroup(worldList(e[key]), cam, eps, ctx);
    },
  );
  return out;
}

/**
 * Order the primitives of one group back to front.
 * @param {Prim[]} list
 * @param {any} cam camera state
 * @param {number} eps
 * @param {any} [ctx]
 * @returns {Prim[]}
 */
export function orderGroup(list, cam, eps, ctx = {}) {
  if (list.length <= 1) return list;
  const counts = new Map();
  let polys = 0;
  for (const x of list) {
    if (x.k !== POLY) continue;
    polys++;
    if (x.whole) counts.set(x.u, (counts.get(x.u) || 0) + 1);
  }
  if (!polys) return sortFarFirst(list, cam);
  let K = null;
  let cached = null;
  for (const [U, n] of counts) {
    if (n !== U.polyCount) continue;
    if (U.convex && U.hasFront && (!K || U.outR > K.outR)) K = U;
    if (U.bsp && (!cached || U.polyCount > cached.polyCount)) cached = U;
  }
  if (K) {
    const own = [];
    const others = [];
    for (const x of list) (x.u === K && x.k === POLY ? own : others).push(x);
    const back = own.filter((x) => !K.front[x.f]);
    const front = own.filter((x) => K.front[x.f]);
    if (!others.length) return back.concat(front);
    const part = partitionConvex(K, others, cam, eps);
    return [
      ...orderGroup(part.behind, cam, eps, ctx),
      ...back,
      ...orderGroup(part.inside, cam, eps, ctx),
      ...front,
      ...orderGroup(part.front, cam, eps, ctx),
    ];
  }
  if (cached) {
    const others = list.filter((x) => x.u !== cached || x.k !== POLY);
    return orderWithCachedTree(cached, others, cam, eps, ctx);
  }
  const out = [];
  traverseBSP(buildBSP(list, eps), cam.eyeH, cam, out);
  return out;
}

class UnionFind {
  constructor(n) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }

  find(i) {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }

  union(a, b) {
    const x = this.find(a);
    const y = this.find(b);
    if (x !== y) this.p[x] = y;
  }
}

function boxOf(list) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of list) {
    const p = x.p;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return { min, max };
}

function overlaps(a, b, eps) {
  for (let k = 0; k < 3; k++) if (a.min[k] >= b.max[k] - eps || b.min[k] >= a.max[k] - eps) return false;
  return true;
}

function clusterBoxes(boxes, eps) {
  const n = boxes.length;
  const uf = new UnionFind(n);
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => boxes[a].min[0] - boxes[b].min[0]);
  const active = [];
  for (const i of idx) {
    const bi = boxes[i];
    for (let j = active.length - 1; j >= 0; j--) {
      const bj = boxes[active[j]];
      if (bj.max[0] <= bi.min[0] + eps) {
        active.splice(j, 1);
        continue;
      }
      if (overlaps(bi, bj, eps)) uf.union(i, active[j]);
    }
    active.push(i);
  }
  return uf;
}

/**
 * Order all primitives of a frame back to front.
 * @param {Prim[]} prims
 * @param {any} cam camera state (eye, forward, eyeH, viewProj, orthographic)
 * @param {{eps?: number, items?: Prim[][]}} [opts] items: pre-grouped primitives (one entry per mesh object or line piece)
 * @returns {Prim[]}
 */
export function orderScene(prims, cam, opts = {}) {
  const eps = opts.eps ?? 1e-7;
  let groups = (opts.items ?? prims.map((x) => [x])).filter((g) => g.length);
  if (!groups.length) return [];
  let boxes = groups.map(boxOf);
  for (let iter = 0; iter < 8; iter++) {
    const uf = clusterBoxes(boxes, eps);
    const merged = new Map();
    groups.forEach((g, i) => {
      const r = uf.find(i);
      if (!merged.has(r)) merged.set(r, []);
      merged.get(r).push(g);
    });
    if (merged.size === groups.length) break;
    groups = [...merged.values()].map((gs) => gs.flat());
    boxes = groups.map(boxOf);
  }
  const ordered = groups.map((g) => orderGroup(g, cam, eps));
  if (groups.length === 1) return ordered[0];
  return topoGroups(ordered, boxes, cam, eps);
}

function screenBox(box, cam) {
  const m = cam.viewProj;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let depth = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max[0] : box.min[0];
    const y = i & 2 ? box.max[1] : box.min[1];
    const z = i & 4 ? box.max[2] : box.min[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const d = (x - cam.eye[0]) * cam.forward[0] + (y - cam.eye[1]) * cam.forward[1] + (z - cam.eye[2]) * cam.forward[2];
    depth = Math.max(depth, d);
    if (w <= 1e-9) return { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity, depth };
    const sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
  }
  return { x0, y0, x1, y1, depth };
}

function topoGroups(ordered, boxes, cam, eps) {
  const n = ordered.length;
  const sb = boxes.map((b) => screenBox(b, cam));
  const succ = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => sb[a].x0 - sb[b].x0);
  const active = [];
  for (const i of idx) {
    const a = sb[i];
    for (let j = active.length - 1; j >= 0; j--) {
      const k = active[j];
      const b = sb[k];
      if (b.x1 <= a.x0) {
        active.splice(j, 1);
        continue;
      }
      if (a.y0 >= b.y1 || b.y0 >= a.y1) continue;
      const rel = nearer(boxes[i], boxes[k], cam, eps);
      if (rel > 0) {
        succ[k].push(i);
        indeg[i]++;
      } else if (rel < 0) {
        succ[i].push(k);
        indeg[k]++;
      }
    }
    active.push(i);
  }
  const heap = [];
  const push = (i) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (sb[heap[p]].depth >= sb[heap[c]].depth) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && sb[heap[l]].depth > sb[heap[m]].depth) m = l;
        if (r < heap.length && sb[heap[r]].depth > sb[heap[m]].depth) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++) if (!indeg[i]) push(i);
  const done = new Uint8Array(n);
  const out = [];
  let emitted = 0;
  while (emitted < n) {
    if (!heap.length) {
      let best = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || sb[i].depth > sb[best].depth)) best = i;
      indeg[best] = 0;
      push(best);
    }
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    emitted++;
    for (const y of ordered[i]) out.push(y);
    for (const j of succ[i]) if (--indeg[j] === 0 && !done[j]) push(j);
  }
  return out;
}

/**
 * Which of two disjoint boxes is nearer the eye: 1 if a is nearer (drawn
 * later), -1 if b is, 0 if they cannot occlude each other.
 * @returns {number}
 */
function nearer(a, b, cam, eps) {
  const e = cam.eyeH;
  for (let k = 0; k < 3; k++) {
    let lowIsA;
    if (a.max[k] <= b.min[k] + eps) lowIsA = true;
    else if (b.max[k] <= a.min[k] + eps) lowIsA = false;
    else continue;
    const s = lowIsA ? (a.max[k] + b.min[k]) / 2 : (b.max[k] + a.min[k]) / 2;
    const side = e[3] > 0 ? e[k] - s : e[k];
    if (Math.abs(side) < 1e-12) return 0;
    const highNearer = side > 0;
    return highNearer === lowIsA ? -1 : 1;
  }
  return 0;
}
