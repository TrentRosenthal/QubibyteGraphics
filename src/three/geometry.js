/**
 * Mesh geometry and primitive generators.
 *
 * A mesh is indexed polygons: a flat position array and a list of faces,
 * each a loop of vertex indices ordered counterclockwise when seen from the
 * front (outside), so the right-hand normal points outward. Faces may be
 * triangles, quads, or larger planar polygons. Per-face normals are derived
 * and cached.
 *
 * World convention: z is up.
 * @module three/geometry
 */

import { flattenPath } from '../core/path.js';
import { triangulatePolygon } from './triangulate.js';
import { transformPoint } from './mat4.js';

/**
 * @typedef {Object} MeshGeometry
 * @property {Float64Array} positions Flat xyz.
 * @property {number[][]} faces Vertex index loops, counterclockwise from the front.
 * @property {boolean} convex The mesh bounds a convex solid.
 * @property {boolean} closed Every edge is shared by exactly two faces.
 * @property {Array<any>|null} faceColors Optional color value per face (theme token, hex, or RGBA).
 * @property {Float64Array|null} faceParams Optional (u, v) in [0, 1] per face, for sweeps.
 * @property {Map<string, string>|null} edgeClass Optional class per edge key "a,b" (a < b), for styled edges.
 * @property {number} id Unique id, used for caches.
 */

/**
 * @typedef {Object} LineGeometry
 * @property {Array<{points: number[][], closed: boolean}>} polylines
 */

let MESH_ID = 0;
const derived = new WeakMap();

/**
 * Create a mesh.
 * @param {number[][]|Float64Array|number[]} positions [[x, y, z], ...] or flat xyz
 * @param {number[][]} faces
 * @param {{convex?: boolean, closed?: boolean, faceColors?: any[]|null, faceParams?: Float64Array|null, edgeClass?: Map<string, string>|null}} [opts]
 * @returns {MeshGeometry}
 */
export function makeMesh(positions, faces, opts = {}) {
  let flat;
  if (positions instanceof Float64Array) flat = positions;
  else if (positions.length && Array.isArray(positions[0])) {
    flat = new Float64Array(positions.length * 3);
    positions.forEach((p, i) => {
      flat[i * 3] = p[0];
      flat[i * 3 + 1] = p[1];
      flat[i * 3 + 2] = p[2];
    });
  } else flat = Float64Array.from(positions);
  const mesh = {
    positions: flat,
    faces,
    convex: !!opts.convex,
    closed: false,
    faceColors: opts.faceColors ?? null,
    faceParams: opts.faceParams ?? null,
    edgeClass: opts.edgeClass ?? null,
    id: ++MESH_ID,
  };
  mesh.closed = opts.closed ?? isClosed(mesh);
  return mesh;
}

function cache(mesh) {
  let c = derived.get(mesh);
  if (!c) {
    c = {};
    derived.set(mesh, c);
  }
  return c;
}

/** Number of vertices. @param {MeshGeometry} mesh @returns {number} */
export function vertexCount(mesh) {
  return mesh.positions.length / 3;
}

/**
 * Per-face unit normals (Newell's method, robust for polygons).
 * @param {MeshGeometry} mesh
 * @returns {Float64Array}
 */
export function faceNormals(mesh) {
  const c = cache(mesh);
  if (c.normals) return c.normals;
  const P = mesh.positions;
  const out = new Float64Array(mesh.faces.length * 3);
  mesh.faces.forEach((f, i) => {
    const n = newell(P, f);
    out[i * 3] = n[0];
    out[i * 3 + 1] = n[1];
    out[i * 3 + 2] = n[2];
  });
  c.normals = out;
  return out;
}

/**
 * Newell normal of a polygon given by vertex indices into a flat array.
 * @param {ArrayLike<number>} P @param {number[]} f
 * @returns {number[]}
 */
export function newell(P, f) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = f.length;
  for (let k = 0; k < n; k++) {
    const a = f[k] * 3;
    const b = f[(k + 1) % n] * 3;
    nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
    ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
    nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
  }
  const L = Math.hypot(nx, ny, nz) || 1;
  return [nx / L, ny / L, nz / L];
}

/**
 * Face centroids (vertex average).
 * @param {MeshGeometry} mesh
 * @returns {Float64Array}
 */
export function faceCentroids(mesh) {
  const c = cache(mesh);
  if (c.centroids) return c.centroids;
  const P = mesh.positions;
  const out = new Float64Array(mesh.faces.length * 3);
  mesh.faces.forEach((f, i) => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const v of f) {
      x += P[v * 3];
      y += P[v * 3 + 1];
      z += P[v * 3 + 2];
    }
    out[i * 3] = x / f.length;
    out[i * 3 + 1] = y / f.length;
    out[i * 3 + 2] = z / f.length;
  });
  c.centroids = out;
  return out;
}

/**
 * Undirected edges with their adjacent faces.
 * @param {MeshGeometry} mesh
 * @returns {{a: Int32Array, b: Int32Array, f0: Int32Array, f1: Int32Array, count: number, extra: number}} f1 is -1 on boundary edges; `extra` counts edges with more than two faces
 */
export function meshEdges(mesh) {
  const c = cache(mesh);
  if (c.edges) return c.edges;
  const map = new Map();
  const A = [];
  const B = [];
  const F0 = [];
  const F1 = [];
  let extra = 0;
  const nv = mesh.positions.length / 3 + 1;
  mesh.faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const u = f[k];
      const v = f[(k + 1) % f.length];
      if (u === v) continue;
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = lo * nv + hi;
      const e = map.get(key);
      if (e === undefined) {
        map.set(key, A.length);
        A.push(lo);
        B.push(hi);
        F0.push(fi);
        F1.push(-1);
      } else if (F1[e] === -1) F1[e] = fi;
      else extra++;
    }
  });
  c.edges = { a: Int32Array.from(A), b: Int32Array.from(B), f0: Int32Array.from(F0), f1: Int32Array.from(F1), count: A.length, extra };
  return c.edges;
}

/**
 * Whether every edge borders exactly two faces.
 * @param {MeshGeometry} mesh
 * @returns {boolean}
 */
export function isClosed(mesh) {
  if (!mesh.faces.length) return false;
  const e = meshEdges(mesh);
  if (e.extra) return false;
  for (let i = 0; i < e.count; i++) if (e.f1[i] < 0) return false;
  return true;
}

/**
 * Euler characteristic V - E + F (counting only referenced vertices).
 * @param {MeshGeometry} mesh
 * @returns {number}
 */
export function eulerCharacteristic(mesh) {
  const used = new Set();
  for (const f of mesh.faces) for (const v of f) used.add(v);
  return used.size - meshEdges(mesh).count + mesh.faces.length;
}

/**
 * Axis-aligned bounds.
 * @param {MeshGeometry} mesh
 * @returns {{min: number[], max: number[]}}
 */
export function meshBounds(mesh) {
  const c = cache(mesh);
  if (c.bounds) return c.bounds;
  const P = mesh.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (P[i + k] < min[k]) min[k] = P[i + k];
      if (P[i + k] > max[k]) max[k] = P[i + k];
    }
  }
  c.bounds = { min, max };
  return c.bounds;
}

/**
 * Signed volume (positive when faces point outward).
 * @param {MeshGeometry} mesh
 * @returns {number}
 */
export function meshVolume(mesh) {
  const P = mesh.positions;
  let V = 0;
  for (const f of mesh.faces) {
    const a = f[0] * 3;
    for (let k = 1; k + 1 < f.length; k++) {
      const b = f[k] * 3;
      const c = f[k + 1] * 3;
      V += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
    }
  }
  return V / 6;
}

/**
 * Total surface area.
 * @param {MeshGeometry} mesh
 * @returns {number}
 */
export function meshArea(mesh) {
  const P = mesh.positions;
  let A = 0;
  for (const f of mesh.faces) {
    const a = f[0] * 3;
    for (let k = 1; k + 1 < f.length; k++) {
      const b = f[k] * 3;
      const c = f[k + 1] * 3;
      const ux = P[b] - P[a];
      const uy = P[b + 1] - P[a + 1];
      const uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a];
      const vy = P[c + 1] - P[a + 1];
      const vz = P[c + 2] - P[a + 2];
      A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
  }
  return A;
}

/**
 * Merge coincident vertices, drop repeated indices in faces, and drop faces
 * with fewer than three distinct vertices.
 * @param {MeshGeometry} mesh
 * @param {number} [eps=1e-9]
 * @returns {MeshGeometry}
 */
export function weld(mesh, eps = 1e-9) {
  const P = mesh.positions;
  const n = P.length / 3;
  const map = new Map();
  const remap = new Int32Array(n);
  const out = [];
  const q = 1 / Math.max(eps, 1e-12);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(P[i * 3] * q)},${Math.round(P[i * 3 + 1] * q)},${Math.round(P[i * 3 + 2] * q)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = out.length / 3;
      map.set(key, j);
      out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const faces = [];
  const colors = mesh.faceColors ? [] : null;
  const params = mesh.faceParams ? [] : null;
  mesh.faces.forEach((f, fi) => {
    const g = [];
    for (const v of f) {
      const r = remap[v];
      if (g.length === 0 || g[g.length - 1] !== r) g.push(r);
    }
    while (g.length > 1 && g[0] === g[g.length - 1]) g.pop();
    if (new Set(g).size < 3) return;
    faces.push(g);
    if (colors) colors.push(mesh.faceColors[fi]);
    if (params) params.push(mesh.faceParams[fi * 2], mesh.faceParams[fi * 2 + 1]);
  });
  let edgeClass = null;
  if (mesh.edgeClass) {
    edgeClass = new Map();
    for (const [k, v] of mesh.edgeClass) {
      const [a, b] = k.split(',').map(Number);
      const ra = remap[a];
      const rb = remap[b];
      if (ra !== rb) edgeClass.set(`${Math.min(ra, rb)},${Math.max(ra, rb)}`, v);
    }
  }
  return makeMesh(Float64Array.from(out), faces, { convex: mesh.convex, faceColors: colors, faceParams: params ? Float64Array.from(params) : null, edgeClass });
}

/**
 * Reverse every face (flip normals).
 * @param {MeshGeometry} mesh
 * @returns {MeshGeometry}
 */
export function flipFaces(mesh) {
  return makeMesh(mesh.positions, mesh.faces.map((f) => f.slice().reverse()), { convex: mesh.convex, closed: mesh.closed, faceColors: mesh.faceColors, faceParams: mesh.faceParams, edgeClass: mesh.edgeClass });
}

/**
 * For a closed mesh, flip all faces if the signed volume is negative.
 * @param {MeshGeometry} mesh
 * @returns {MeshGeometry}
 */
export function orientOutward(mesh) {
  return mesh.closed && meshVolume(mesh) < 0 ? flipFaces(mesh) : mesh;
}

/**
 * Apply a 4x4 matrix to a mesh.
 * @param {MeshGeometry} mesh
 * @param {import('./mat4.js').Mat4} m
 * @returns {MeshGeometry}
 */
export function transformMesh(mesh, m) {
  const P = mesh.positions;
  const out = new Float64Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const p = transformPoint(m, [P[i], P[i + 1], P[i + 2]]);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  const faces = det < 0 ? mesh.faces.map((f) => f.slice().reverse()) : mesh.faces;
  return makeMesh(out, faces, { convex: mesh.convex, closed: mesh.closed, faceColors: mesh.faceColors, faceParams: mesh.faceParams, edgeClass: mesh.edgeClass });
}

/**
 * Merge meshes into one, optionally transformed and colored per part.
 * @param {Array<MeshGeometry|{mesh: MeshGeometry, matrix?: import('./mat4.js').Mat4, color?: any}>} parts
 * @returns {MeshGeometry}
 */
export function mergeMeshes(parts) {
  const pos = [];
  const faces = [];
  const colors = [];
  let anyColor = false;
  for (const part of parts) {
    const p = /** @type {any} */ (part).positions ? { mesh: /** @type {MeshGeometry} */ (part) } : /** @type {any} */ (part);
    const mesh = p.matrix ? transformMesh(p.mesh, p.matrix) : p.mesh;
    const base = pos.length / 3;
    for (let i = 0; i < mesh.positions.length; i++) pos.push(mesh.positions[i]);
    mesh.faces.forEach((f, fi) => {
      faces.push(f.map((v) => v + base));
      const c = p.color ?? (mesh.faceColors ? mesh.faceColors[fi] : null);
      if (c != null) anyColor = true;
      colors.push(c);
    });
  }
  return makeMesh(Float64Array.from(pos), faces, { faceColors: anyColor ? colors : null });
}

/**
 * Split every face into triangles (fans for convex faces, ear clipping for
 * concave ones).
 * @param {MeshGeometry} mesh
 * @returns {MeshGeometry}
 */
export function triangulateMesh(mesh) {
  const P = mesh.positions;
  const normals = faceNormals(mesh);
  const faces = [];
  const colors = mesh.faceColors ? [] : null;
  mesh.faces.forEach((f, fi) => {
    let tris;
    if (f.length === 3) tris = [f];
    else {
      const n = [normals[fi * 3], normals[fi * 3 + 1], normals[fi * 3 + 2]];
      const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
      const i0 = (ax + 1) % 3;
      const i1 = (ax + 2) % 3;
      const flip = n[ax] < 0;
      const pts = f.map((v) => (flip ? [P[v * 3 + i1], P[v * 3 + i0]] : [P[v * 3 + i0], P[v * 3 + i1]]));
      tris = triangulatePolygon(pts).map((t) => t.map((k) => f[k]));
    }
    for (const t of tris) {
      faces.push(t);
      if (colors) colors.push(mesh.faceColors[fi]);
    }
  });
  return makeMesh(mesh.positions, faces, { convex: mesh.convex, closed: mesh.closed, faceColors: colors });
}

/**
 * Convex hull of a small point set (up to a few hundred points) with
 * polygonal faces: coplanar facets merge into one face.
 * @param {number[][]} points
 * @param {number} [eps=1e-7]
 * @returns {MeshGeometry}
 */
export function convexHull(points, eps = 1e-7) {
  const n = points.length;
  const planes = [];
  const seen = new Set();
  let scale = 0;
  for (const p of points) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const tol = eps * Math.max(1, scale);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = points[i];
        const b = points[j];
        const c = points[k];
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const L = Math.hypot(nx, ny, nz);
        if (L < tol * tol) continue;
        nx /= L;
        ny /= L;
        nz /= L;
        const d = nx * a[0] + ny * a[1] + nz * a[2];
        let pos = 0;
        let neg = 0;
        for (let m = 0; m < n; m++) {
          const s = nx * points[m][0] + ny * points[m][1] + nz * points[m][2] - d;
          if (s > tol) pos++;
          else if (s < -tol) neg++;
          if (pos && neg) break;
        }
        if (pos && neg) continue;
        if (pos) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const dd = pos ? -d : d;
        const key = `${Math.round(nx * 1e5)},${Math.round(ny * 1e5)},${Math.round(nz * 1e5)},${Math.round((dd / Math.max(1, scale)) * 1e5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        planes.push([nx, ny, nz, dd]);
      }
    }
  }
  const faces = [];
  for (const [nx, ny, nz, d] of planes) {
    const idx = [];
    for (let m = 0; m < n; m++) {
      if (Math.abs(nx * points[m][0] + ny * points[m][1] + nz * points[m][2] - d) <= tol) idx.push(m);
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const m of idx) {
      cx += points[m][0];
      cy += points[m][1];
      cz += points[m][2];
    }
    cx /= idx.length;
    cy /= idx.length;
    cz /= idx.length;
    const helper = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let ex = [ny * helper[2] - nz * helper[1], nz * helper[0] - nx * helper[2], nx * helper[1] - ny * helper[0]];
    const el = Math.hypot(...ex);
    ex = ex.map((v) => v / el);
    const ey = [ny * ex[2] - nz * ex[1], nz * ex[0] - nx * ex[2], nx * ex[1] - ny * ex[0]];
    const ang = (m) => {
      const dx = points[m][0] - cx;
      const dy = points[m][1] - cy;
      const dz = points[m][2] - cz;
      return Math.atan2(dx * ey[0] + dy * ey[1] + dz * ey[2], dx * ex[0] + dy * ex[1] + dz * ex[2]);
    };
    idx.sort((p, q) => ang(p) - ang(q));
    faces.push(idx);
  }
  return weld(makeMesh(points, faces, { convex: true }), tol * 0.5);
}

function unitRadius(points, size) {
  let R = 0;
  for (const p of points) R = Math.max(R, Math.hypot(p[0], p[1], p[2]));
  return points.map((p) => p.map((v) => (v / R) * size));
}

const hullCache = new Map();

function solid(name, points, size) {
  let unit = hullCache.get(name);
  if (!unit) {
    unit = convexHull(unitRadius(points, 1));
    hullCache.set(name, unit);
  }
  return size === 1 ? unit : makeMesh(unit.positions.map((v) => v * size), unit.faces, { convex: true, closed: true });
}

const PHI = (1 + Math.sqrt(5)) / 2;

function cyclic(p) {
  return [p, [p[1], p[2], p[0]], [p[2], p[0], p[1]]];
}

function signs(p) {
  const out = [];
  for (let s = 0; s < 8; s++) {
    const q = [p[0] * (s & 1 ? -1 : 1), p[1] * (s & 2 ? -1 : 1), p[2] * (s & 4 ? -1 : 1)];
    if (!out.some((o) => o[0] === q[0] && o[1] === q[1] && o[2] === q[2])) out.push(q);
  }
  return out;
}

function permutations(p) {
  const [a, b, c] = p;
  return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

function dedupe(points) {
  const out = [];
  const keys = new Set();
  for (const p of points) {
    const k = p.map((v) => Math.round(v * 1e9)).join(',');
    if (!keys.has(k)) {
      keys.add(k);
      out.push(p);
    }
  }
  return out;
}

const cyclicSigned = (base) => dedupe(base.flatMap((b) => cyclic(b).flatMap(signs)));

/**
 * The five Platonic solids and the Archimedean solids provided, by name.
 * Each has circumradius 1 before scaling.
 * @type {Record<string, () => number[][]>}
 */
export const POLYHEDRA = {
  tetrahedron: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  cube: () => signs([1, 1, 1]),
  octahedron: () => dedupe(permutations([1, 0, 0]).flatMap(signs)),
  dodecahedron: () => dedupe([...signs([1, 1, 1]), ...cyclicSigned([[0, 1 / PHI, PHI]])]),
  icosahedron: () => cyclicSigned([[0, 1, PHI]]),
  cuboctahedron: () => dedupe(permutations([1, 1, 0]).flatMap(signs)),
  icosidodecahedron: () => cyclicSigned([[0, 0, PHI], [0.5, PHI / 2, (PHI * PHI) / 2]]),
  truncatedTetrahedron: () => dedupe(permutations([3, 1, 1]).flatMap(signs)).filter((p) => p.filter((v) => v < 0).length % 2 === 0),
  truncatedOctahedron: () => dedupe(permutations([0, 1, 2]).flatMap(signs)),
  truncatedIcosahedron: () => cyclicSigned([[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, PHI ** 3]]),
};

/**
 * A named polyhedron (see {@link POLYHEDRA}) scaled to a circumradius.
 * @param {string} name
 * @param {number} [radius=1]
 * @returns {MeshGeometry}
 */
export function polyhedron(name, radius = 1) {
  const gen = POLYHEDRA[name];
  if (!gen) throw new Error(`Unknown polyhedron "${name}". Known: ${Object.keys(POLYHEDRA).join(', ')}`);
  return solid(name, gen(), radius);
}

/**
 * Grid of quads over (i, j) in [0, nu] x [0, nv]. Face order makes the normal
 * point along (d/du) x (d/dv).
 * @param {number} nu @param {number} nv
 * @param {(u: number, v: number) => number[]} fn u, v in [0, 1]
 * @param {{closedU?: boolean, closedV?: boolean, convex?: boolean, weldEps?: number, lines?: number[]}} [opts] lines [everyU, everyV] marks every n-th grid line as a 'grid' edge class
 * @returns {MeshGeometry}
 */
export function gridMesh(nu, nv, fn, opts = {}) {
  const cu = opts.closedU ? nu : nu + 1;
  const cv = opts.closedV ? nv : nv + 1;
  const pos = new Float64Array(cu * cv * 3);
  for (let j = 0; j < cv; j++) {
    for (let i = 0; i < cu; i++) {
      const p = fn(i / nu, j / nv);
      const k = (j * cu + i) * 3;
      pos[k] = p[0];
      pos[k + 1] = p[1];
      pos[k + 2] = p[2];
    }
  }
  const id = (i, j) => (j % cv) * cu + (i % cu);
  let edgeClass = null;
  if (opts.lines) {
    edgeClass = new Map();
    const [eu, ev] = opts.lines;
    const mark = (a, b) => edgeClass.set(a < b ? `${a},${b}` : `${b},${a}`, 'grid');
    for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) if (ev > 0 && j % ev === 0) mark(id(i, j), id(i + 1, j));
    for (let i = 0; i <= nu; i++) for (let j = 0; j < nv; j++) if (eu > 0 && i % eu === 0) mark(id(i, j), id(i, j + 1));
  }
  const faces = [];
  const params = new Float64Array(nu * nv * 2);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      params[faces.length * 2] = (i + 1) / nu;
      params[faces.length * 2 + 1] = (j + 1) / nv;
      faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  }
  const mesh = makeMesh(pos, faces, { convex: opts.convex, faceParams: params, edgeClass });
  return opts.weldEps === 0 ? mesh : weld(mesh, opts.weldEps ?? 1e-9);
}

/**
 * Box centered at the origin.
 * @param {number} [w=1] @param {number} [d=1] @param {number} [h=1] sizes along x, y, z
 * @returns {MeshGeometry}
 */
export function box(w = 1, d = 1, h = 1) {
  const x = w / 2;
  const y = d / 2;
  const z = h / 2;
  const P = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return makeMesh(P, F, { convex: true, closed: true });
}

/**
 * Box with rounded edges and corners (convex).
 * @param {number} w @param {number} d @param {number} h sizes along x, y, z
 * @param {number} [radius=0.1]
 * @param {number} [segments=3] segments per 45 degrees of rounding
 * @returns {MeshGeometry}
 */
export function roundedBox(w, d, h, radius = 0.1, segments = 3) {
  const half = [w / 2, d / 2, h / 2];
  const r = Math.max(1e-6, Math.min(radius, ...half));
  const inner = half.map((v) => v - r);
  const nodes = inner.map((a) => {
    const side = [];
    for (let k = segments; k >= 1; k--) side.push(a + r * Math.tan(((Math.PI / 4) * k) / segments));
    const neg = side.map((v) => -v);
    return a > 1e-9 ? [...neg, -a, a, ...side.reverse()] : [...neg, 0, ...side.reverse()];
  });
  const pos = [];
  const faces = [];
  const place = (q) => {
    const c = q.map((v, i) => Math.max(-inner[i], Math.min(inner[i], v)));
    const dx = q[0] - c[0];
    const dy = q[1] - c[1];
    const dz = q[2] - c[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    return [c[0] + (r * dx) / L, c[1] + (r * dy) / L, c[2] + (r * dz) / L];
  };
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) {
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const L1 = nodes[a1];
      const L2 = nodes[a2];
      const base = pos.length;
      for (let j = 0; j < L2.length; j++) {
        for (let i = 0; i < L1.length; i++) {
          const q = [0, 0, 0];
          q[axis] = s * (inner[axis] + r);
          q[a1] = L1[i];
          q[a2] = L2[j];
          pos.push(place(q));
        }
      }
      const id = (i, j) => base + j * L1.length + i;
      for (let j = 0; j + 1 < L2.length; j++) {
        for (let i = 0; i + 1 < L1.length; i++) {
          const f = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
          faces.push(s > 0 ? f : f.reverse());
        }
      }
    }
  }
  return weld(makeMesh(pos, faces, { convex: true }), 1e-9 * Math.max(w, d, h));
}

/**
 * UV sphere. Poles become triangle fans.
 * @param {number} [radius=1]
 * @param {number} [segments=32] around the z axis
 * @param {number} [rings=16] from pole to pole
 * @returns {MeshGeometry}
 */
export function uvSphere(radius = 1, segments = 32, rings = 16) {
  return gridMesh(segments, rings, (u, v) => {
    const th = Math.PI * (1 - v);
    const ph = 2 * Math.PI * u;
    const s = Math.sin(th);
    return [radius * s * Math.cos(ph), radius * s * Math.sin(ph), radius * Math.cos(th)];
  }, { closedU: true, convex: true, weldEps: radius * 1e-9 });
}

/**
 * Icosphere: a subdivided icosahedron pushed onto the sphere.
 * @param {number} [radius=1]
 * @param {number} [detail=2] subdivision levels
 * @returns {MeshGeometry}
 */
export function icosphere(radius = 1, detail = 2) {
  const base = polyhedron('icosahedron', 1);
  let P = [];
  for (let i = 0; i < base.positions.length; i += 3) P.push([base.positions[i], base.positions[i + 1], base.positions[i + 2]]);
  let F = base.faces.map((f) => f.slice());
  for (let l = 0; l < detail; l++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        const p = [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2, (P[a][2] + P[b][2]) / 2];
        const L = Math.hypot(...p);
        m = P.length;
        P.push(p.map((v) => v / L));
        mid.set(key, m);
      }
      return m;
    };
    const next = [];
    for (const [a, b, c] of F) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    F = next;
  }
  P = P.map((p) => p.map((v) => v * radius));
  return makeMesh(P, F, { convex: true, closed: true });
}

/**
 * Sphere made from a subdivided cube pushed onto the sphere (a "cube sphere").
 * Its topology matches {@link cubeGrid}, which makes cube to sphere morphs exact.
 * @param {number} [radius=1]
 * @param {number} [n=8] quads per cube edge
 * @returns {MeshGeometry}
 */
export function cubeSphere(radius = 1, n = 8) {
  const g = cubeGrid(2, n);
  const P = g.positions.slice();
  for (let i = 0; i < P.length; i += 3) {
    const L = Math.hypot(P[i], P[i + 1], P[i + 2]);
    P[i] = (P[i] / L) * radius;
    P[i + 1] = (P[i + 1] / L) * radius;
    P[i + 2] = (P[i + 2] / L) * radius;
  }
  return makeMesh(P, g.faces, { convex: true, closed: true });
}

/**
 * Cube of a given edge length with every face divided into n x n quads.
 * @param {number} [size=1]
 * @param {number} [n=4]
 * @returns {MeshGeometry}
 */
export function cubeGrid(size = 1, n = 4) {
  const h = size / 2;
  const pos = [];
  const faces = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) {
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const base = pos.length;
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const q = [0, 0, 0];
          q[axis] = s * h;
          q[a1] = -h + (size * i) / n;
          q[a2] = -h + (size * j) / n;
          pos.push(q);
        }
      }
      const id = (i, j) => base + j * (n + 1) + i;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const f = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
          faces.push(s > 0 ? f : f.reverse());
        }
      }
    }
  }
  return weld(makeMesh(pos, faces, { convex: true }), 1e-9 * size);
}

/**
 * Cylinder along z from -h/2 to h/2.
 * @param {number} [radius=0.5] @param {number} [height=1]
 * @param {number} [segments=32]
 * @param {{radiusTop?: number, caps?: boolean}} [opts] radiusTop makes a frustum; radiusTop 0 is a cone
 * @returns {MeshGeometry}
 */
export function cylinder(radius = 0.5, height = 1, segments = 32, opts = {}) {
  const rt = opts.radiusTop ?? radius;
  const caps = opts.caps ?? true;
  const pos = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pos.push([radius * Math.cos(a), radius * Math.sin(a), -height / 2]);
  }
  const top = rt > 0 ? segments : 1;
  for (let i = 0; i < top; i++) {
    const a = (2 * Math.PI * i) / segments;
    pos.push(rt > 0 ? [rt * Math.cos(a), rt * Math.sin(a), height / 2] : [0, 0, height / 2]);
  }
  const faces = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    if (rt > 0) faces.push([i, j, segments + j, segments + i]);
    else faces.push([i, j, segments]);
  }
  if (caps) {
    faces.push(Array.from({ length: segments }, (_, i) => segments - 1 - i));
    if (rt > 0) faces.push(Array.from({ length: segments }, (_, i) => segments + i));
  }
  return makeMesh(pos, faces, { convex: caps });
}

/**
 * Cone along z with its base at -h/2 and apex at h/2.
 * @param {number} [radius=0.5] @param {number} [height=1] @param {number} [segments=32]
 * @returns {MeshGeometry}
 */
export function cone(radius = 0.5, height = 1, segments = 32) {
  return cylinder(radius, height, segments, { radiusTop: 0 });
}

/**
 * Right prism over a regular n-gon, along z.
 * @param {number} [sides=6] @param {number} [radius=0.5] @param {number} [height=1]
 * @returns {MeshGeometry}
 */
export function prism(sides = 6, radius = 0.5, height = 1) {
  return cylinder(radius, height, sides);
}

/**
 * Torus around the z axis.
 * @param {number} [R=1] major radius @param {number} [r=0.35] tube radius
 * @param {number} [segments=48] @param {number} [tubeSegments=24]
 * @returns {MeshGeometry}
 */
export function torus(R = 1, r = 0.35, segments = 48, tubeSegments = 24) {
  return gridMesh(segments, tubeSegments, (u, v) => {
    const a = 2 * Math.PI * u;
    const b = 2 * Math.PI * v;
    const rr = R + r * Math.cos(b);
    return [rr * Math.cos(a), rr * Math.sin(a), r * Math.sin(b)];
  }, { closedU: true, closedV: true });
}

/**
 * Torus knot: a tube along the (p, q) knot on a torus.
 * @param {number} [p=2] @param {number} [q=3]
 * @param {{R?: number, r?: number, tube?: number, segments?: number, tubeSegments?: number}} [opts]
 * @returns {MeshGeometry}
 */
export function torusKnot(p = 2, q = 3, opts = {}) {
  const R = opts.R ?? 1;
  const r = opts.r ?? 0.42;
  const curve = (t) => {
    const a = 2 * Math.PI * t;
    const rr = R + r * Math.cos(q * a);
    return [rr * Math.cos(p * a), rr * Math.sin(p * a), r * Math.sin(q * a)];
  };
  return tube(curve, { radius: opts.tube ?? 0.16, segments: opts.segments ?? 256, radialSegments: opts.tubeSegments ?? 16, closed: true });
}

/**
 * Plane in the xy plane, centered, normal +z.
 * @param {number} [w=1] @param {number} [d=1] @param {number} [nx=1] @param {number} [ny=1]
 * @returns {MeshGeometry}
 */
export function plane(w = 1, d = 1, nx = 1, ny = 1) {
  return gridMesh(nx, ny, (u, v) => [(u - 0.5) * w, (v - 0.5) * d, 0], { weldEps: 0 });
}

/**
 * Parametric surface p(u, v).
 * @param {(u: number, v: number) => number[]} f
 * @param {{u?: number[], v?: number[], nu?: number, nv?: number, closedU?: boolean, closedV?: boolean, lines?: number[]}} [opts] u and v ranges default to [0, 1]; lines marks every n-th parameter line as a grid edge
 * @returns {MeshGeometry}
 */
export function parametricSurface(f, opts = {}) {
  const [u0, u1] = opts.u ?? [0, 1];
  const [v0, v1] = opts.v ?? [0, 1];
  const mesh = gridMesh(opts.nu ?? 32, opts.nv ?? 32, (s, t) => f(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t), { closedU: opts.closedU, closedV: opts.closedV, lines: opts.lines });
  return orientOutward(mesh);
}

/**
 * Height field z = f(x, y) over a rectangle.
 * @param {(x: number, y: number) => number} f
 * @param {{x?: number[], y?: number[], nx?: number, ny?: number}} [opts]
 * @returns {MeshGeometry}
 */
export function heightField(f, opts = {}) {
  const [x0, x1] = opts.x ?? [-1, 1];
  const [y0, y1] = opts.y ?? [-1, 1];
  return parametricSurface((x, y) => [x, y, f(x, y)], { u: [x0, x1], v: [y0, y1], nu: opts.nx ?? 32, nv: opts.ny ?? 32 });
}

/**
 * Ruled surface between two curves: p(u, v) = (1 - v) a(u) + v b(u).
 * @param {(u: number) => number[]} a @param {(u: number) => number[]} b
 * @param {{u?: number[], nu?: number, nv?: number}} [opts]
 * @returns {MeshGeometry}
 */
export function ruledSurface(a, b, opts = {}) {
  return parametricSurface((u, v) => {
    const p = a(u);
    const q = b(u);
    return [p[0] + (q[0] - p[0]) * v, p[1] + (q[1] - p[1]) * v, p[2] + (q[2] - p[2]) * v];
  }, { u: opts.u ?? [0, 1], v: [0, 1], nu: opts.nu ?? 32, nv: opts.nv ?? 4 });
}

/**
 * Surface of revolution of a profile [[r, z], ...] around the z axis.
 * Profile ends on the axis (r = 0) close the surface.
 * @param {number[][]} profile
 * @param {{segments?: number, angle?: number}} [opts]
 * @returns {MeshGeometry}
 */
export function lathe(profile, opts = {}) {
  const seg = opts.segments ?? 48;
  const full = (opts.angle ?? 2 * Math.PI) >= 2 * Math.PI - 1e-9;
  const ang = opts.angle ?? 2 * Math.PI;
  const m = profile.length - 1;
  const mesh = gridMesh(seg, m, (u, v) => {
    const [r, z] = profile[Math.round(v * m)];
    const a = ang * u;
    return [r * Math.cos(a), r * Math.sin(a), z];
  }, { closedU: full });
  return orientOutward(mesh);
}

/**
 * Parallel-transport frames along a polyline.
 * @param {number[][]} pts
 * @param {boolean} closed
 * @returns {{T: number[][], N: number[][], B: number[][]}}
 */
export function transportFrames(pts, closed) {
  const n = pts.length;
  const T = pts.map((_, i) => {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(...d) || 1;
    return d.map((v) => v / L);
  });
  const N = [];
  const B = [];
  const t0 = T[0];
  const helper = Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let nrm = normalize3(cross3(cross3(t0, helper), t0));
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const ax = cross3(T[i - 1], T[i]);
      const s = Math.hypot(...ax);
      if (s > 1e-12) {
        const ang = Math.atan2(s, dot3(T[i - 1], T[i]));
        nrm = rodrigues(nrm, ax.map((v) => v / s), ang);
      }
      nrm = normalize3(sub3(nrm, T[i].map((v) => v * dot3(nrm, T[i]))));
    }
    N.push(nrm);
    B.push(cross3(T[i], nrm));
  }
  if (closed && n > 2) {
    const ax = cross3(T[n - 1], T[0]);
    const s = Math.hypot(...ax);
    let end = N[n - 1];
    if (s > 1e-12) end = rodrigues(end, ax.map((v) => v / s), Math.atan2(s, dot3(T[n - 1], T[0])));
    const twist = Math.atan2(dot3(cross3(end, N[0]), T[0]), dot3(end, N[0]));
    for (let i = 0; i < n; i++) {
      const a = (twist * i) / n;
      N[i] = rodrigues(N[i], T[i], a);
      B[i] = cross3(T[i], N[i]);
    }
  }
  return { T, N, B };
}

/**
 * Tube along a 3D curve.
 * @param {number[][]|((t: number) => number[])} path points, or a function of t in [0, 1]
 * @param {{radius?: number|((t: number) => number), segments?: number, radialSegments?: number, closed?: boolean, caps?: boolean}} [opts]
 * @returns {MeshGeometry}
 */
export function tube(path, opts = {}) {
  const closed = !!opts.closed;
  let pts;
  if (typeof path === 'function') {
    const n = opts.segments ?? 64;
    pts = [];
    for (let i = 0; i < (closed ? n : n + 1); i++) pts.push(path(i / n));
  } else pts = path;
  const n = pts.length;
  const rs = opts.radialSegments ?? 12;
  const rad = typeof opts.radius === 'function' ? opts.radius : () => opts.radius ?? 0.1;
  const { N, B } = transportFrames(pts, closed);
  const pos = [];
  for (let i = 0; i < n; i++) {
    const t = closed ? i / n : i / (n - 1);
    const r = rad(t);
    for (let j = 0; j < rs; j++) {
      const a = (2 * Math.PI * j) / rs;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      pos.push([pts[i][0] + N[i][0] * c + B[i][0] * s, pts[i][1] + N[i][1] * c + B[i][1] * s, pts[i][2] + N[i][2] * c + B[i][2] * s]);
    }
  }
  const faces = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < rs; j++) {
      const j1 = (j + 1) % rs;
      faces.push([i * rs + j, i * rs + j1, i1 * rs + j1, i1 * rs + j]);
    }
  }
  if (!closed && (opts.caps ?? true)) {
    faces.push(Array.from({ length: rs }, (_, j) => rs - 1 - j));
    faces.push(Array.from({ length: rs }, (_, j) => (n - 1) * rs + j));
  }
  return orientOutward(weld(makeMesh(pos, faces), 1e-12));
}

/**
 * Loft through a sequence of closed profiles (3D point loops). Profiles are
 * resampled to a common point count by arc length.
 * @param {number[][][]} profiles
 * @param {{caps?: boolean, samples?: number}} [opts]
 * @returns {MeshGeometry}
 */
export function loft(profiles, opts = {}) {
  const m = opts.samples ?? Math.max(...profiles.map((p) => p.length));
  const rings = profiles.map((p) => resampleLoop(p, m));
  const pos = rings.flat();
  const faces = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      faces.push([i * m + j, i * m + j1, (i + 1) * m + j1, (i + 1) * m + j]);
    }
  }
  if (opts.caps ?? true) {
    faces.push(Array.from({ length: m }, (_, j) => m - 1 - j));
    faces.push(Array.from({ length: m }, (_, j) => (rings.length - 1) * m + j));
  }
  const mesh = weld(makeMesh(pos, faces), 1e-12);
  return mesh.closed ? orientOutward(mesh) : mesh;
}

function resampleLoop(loop, m) {
  const n = loop.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = cum[n];
  const out = [];
  let k = 0;
  for (let s = 0; s < m; s++) {
    const d = (total * s) / m;
    while (k < n - 1 && cum[k + 1] < d) k++;
    const a = loop[k];
    const b = loop[(k + 1) % n];
    const seg = cum[k + 1] - cum[k];
    const t = seg > 0 ? (d - cum[k]) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/**
 * Extrude a 2D Path (from core/path) along z from 0 to depth. Contours are
 * flattened; holes (contours inside others) are cut from the caps with ear
 * clipping.
 * @param {import('../core/path.js').Path} path
 * @param {{depth?: number, tolerance?: number}} [opts]
 * @returns {MeshGeometry}
 */
export function extrudePath(path, opts = {}) {
  const depth = opts.depth ?? 0.2;
  const loops = flattenPath(path, opts.tolerance ?? 0.01)
    .map((c) => dropDuplicate(c.pts))
    .filter((pts) => pts.length >= 3 && Math.abs(area2(pts)) > 1e-12);
  const shapes = groupContours(loops);
  const pos = [];
  const faces = [];
  for (const { outer, holes } of shapes) {
    const tris = triangulatePolygon(outer, holes);
    const flat = [outer, ...holes].flat();
    const base = pos.length;
    const count = flat.length;
    for (const p of flat) pos.push([p[0], p[1], 0]);
    for (const p of flat) pos.push([p[0], p[1], depth]);
    for (const [a, b, c] of tris) {
      faces.push([base + count + a, base + count + b, base + count + c]);
      faces.push([base + c, base + b, base + a]);
    }
    let off = 0;
    for (const loop of [outer, ...holes]) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        faces.push([base + off + i, base + off + i1, base + count + off + i1, base + count + off + i]);
      }
      off += n;
    }
  }
  const mesh = makeMesh(pos, faces);
  return mesh.closed ? orientOutward(mesh) : mesh;
}

function dropDuplicate(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

function area2(pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    A += a[0] * b[1] - b[0] * a[1];
  }
  return A / 2;
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Group flattened contours into outer boundaries with holes by nesting depth
 * (even depth is an outer boundary, odd depth a hole). Outers become
 * counterclockwise and holes clockwise.
 * @param {number[][][]} loops
 * @returns {Array<{outer: number[][], holes: number[][][]}>}
 */
export function groupContours(loops) {
  const depth = loops.map((l, i) => loops.reduce((d, m, j) => (j !== i && Math.abs(area2(m)) > Math.abs(area2(l)) && pointInPolygon(l[0], m) ? d + 1 : d), 0));
  const shapes = [];
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) shapes.push({ outer: area2(l) > 0 ? l : l.slice().reverse(), holes: [], depth: depth[i], src: l });
  });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    let best = null;
    for (const s of shapes) {
      if (s.depth === depth[i] - 1 && pointInPolygon(l[0], s.src) && (!best || Math.abs(area2(s.src)) < Math.abs(area2(best.src)))) best = s;
    }
    if (best) best.holes.push(area2(l) < 0 ? l : l.slice().reverse());
  });
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

/**
 * Translate a mesh.
 * @param {MeshGeometry} mesh @param {number} x @param {number} y @param {number} z
 * @returns {MeshGeometry}
 */
export function translateMesh(mesh, x, y, z) {
  const P = mesh.positions.slice();
  for (let i = 0; i < P.length; i += 3) {
    P[i] += x;
    P[i + 1] += y;
    P[i + 2] += z;
  }
  return makeMesh(P, mesh.faces, { convex: mesh.convex, closed: mesh.closed, faceColors: mesh.faceColors, faceParams: mesh.faceParams, edgeClass: mesh.edgeClass });
}

/**
 * Contour lines of f(x, y) = level by marching squares. Returns segments
 * as 3D polylines at height z (a number) or on the surface z = f when z is
 * 'surface'.
 * @param {(x: number, y: number) => number} f
 * @param {{x?: number[], y?: number[], nx?: number, ny?: number}} domain
 * @param {number[]} levels
 * @param {{z?: number|'surface'}} [opts]
 * @returns {LineGeometry}
 */
export function levelSets(f, domain, levels, opts = {}) {
  const [x0, x1] = domain.x ?? [-1, 1];
  const [y0, y1] = domain.y ?? [-1, 1];
  const nx = domain.nx ?? 48;
  const ny = domain.ny ?? 48;
  const V = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) V.push(f(x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny));
  const polylines = [];
  const zOf = (lev) => (opts.z === 'surface' ? lev : opts.z ?? 0);
  const idx = (i, j) => j * (nx + 1) + i;
  for (const lev of levels) {
    const points = new Map();
    const cross = (a, b) => {
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (!points.has(key)) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const t = (lev - V[lo]) / (V[hi] - V[lo]);
        const il = lo % (nx + 1);
        const jl = Math.floor(lo / (nx + 1));
        const ih = hi % (nx + 1);
        const jh = Math.floor(hi / (nx + 1));
        points.set(key, [x0 + ((x1 - x0) * (il + (ih - il) * t)) / nx, y0 + ((y1 - y0) * (jl + (jh - jl) * t)) / ny, zOf(lev)]);
      }
      return key;
    };
    const segs = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)];
        const hits = [];
        for (let k = 0; k < 4; k++) {
          const a = c[k];
          const b = c[(k + 1) % 4];
          if ((V[a] < lev) !== (V[b] < lev)) hits.push(cross(a, b));
        }
        if (hits.length === 2) segs.push(hits);
        else if (hits.length === 4) {
          const center = (V[c[0]] + V[c[1]] + V[c[2]] + V[c[3]]) / 4;
          if ((center < lev) === (V[c[0]] < lev)) segs.push([hits[0], hits[3]], [hits[1], hits[2]]);
          else segs.push([hits[0], hits[1]], [hits[2], hits[3]]);
        }
      }
    }
    for (const chain of chainSegments(segs)) polylines.push({ points: chain.keys.map((k) => points.get(k)), closed: chain.closed });
  }
  return { polylines };
}

function chainSegments(segs) {
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const k of s) {
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const keys = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? keys[keys.length - 1] : keys[0];
        const next = (adj.get(end) || []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const other = segs[next][0] === end ? segs[next][1] : segs[next][0];
        if (dir) keys.push(other);
        else keys.unshift(other);
      }
    }
    const closed = keys.length > 3 && keys[0] === keys[keys.length - 1];
    if (closed) keys.pop();
    out.push({ keys, closed });
  }
  return out;
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function normalize3(a) {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}
function rodrigues(v, k, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = dot3(k, v);
  const kx = cross3(k, v);
  return [v[0] * c + kx[0] * s + k[0] * kv * (1 - c), v[1] * c + kx[1] * s + k[1] * kv * (1 - c), v[2] * c + kx[2] * s + k[2] * kv * (1 - c)];
}
