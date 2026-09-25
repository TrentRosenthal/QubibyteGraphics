/**
 * Marching cubes. The 256-case triangle table is generated at load time
 * from the cube's face structure instead of being typed in: on every cube
 * face the inside corners are cut off one by one (so the ambiguous faces
 * resolve the same way from both neighboring cells), the cut segments are
 * chained into loops across faces, and each loop is fanned into triangles.
 * Because the face rule depends only on the face, the resulting surface is
 * watertight. Corner and edge numbering follow Paul Bourke's classic table.
 * @module three/marching
 */

import { makeMesh } from './geometry.js';

/** Cube corner offsets (Bourke numbering). @type {number[][]} */
export const MC_CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

/** Cube edges as corner pairs (Bourke numbering). @type {number[][]} */
export const MC_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];

function edgeIndex(a, b) {
  return MC_EDGES.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

function orientFaces() {
  return FACES.map((f) => {
    const c = MC_CORNERS;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 4; k++) {
      const a = c[f[k]];
      const b = c[f[(k + 1) % 4]];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const center = [0, 0, 0];
    for (const i of f) for (let k = 0; k < 3; k++) center[k] += c[i][k] / 4;
    const out = (center[0] - 0.5) * nx + (center[1] - 0.5) * ny + (center[2] - 0.5) * nz;
    return out > 0 ? f : f.slice().reverse();
  });
}

function buildTable() {
  const faces = orientFaces();
  const raw = [];
  for (let cs = 0; cs < 256; cs++) {
    const inside = (i) => ((cs >> i) & 1) === 1;
    const next = new Map();
    for (const f of faces) {
      const cross = [];
      for (let k = 0; k < 4; k++) {
        const a = f[k];
        const b = f[(k + 1) % 4];
        if (inside(a) !== inside(b)) cross.push({ e: edgeIndex(a, b), entry: !inside(a) });
      }
      for (let k = 0; k < cross.length; k++) {
        if (!cross[k].entry) continue;
        for (let s = 1; s < cross.length; s++) {
          const c = cross[(k + s) % cross.length];
          if (!c.entry) {
            next.set(cross[k].e, c.e);
            break;
          }
        }
      }
    }
    const tris = [];
    const seen = new Set();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      let e = start;
      while (!seen.has(e)) {
        seen.add(e);
        loop.push(e);
        e = next.get(e);
      }
      for (let k = 1; k + 1 < loop.length; k++) tris.push(loop[0], loop[k], loop[k + 1]);
    }
    raw.push(tris);
  }
  const mid = (e) => {
    const [a, b] = MC_EDGES[e];
    return MC_CORNERS[a].map((v, k) => (v + MC_CORNERS[b][k]) / 2);
  };
  const [p, q, r] = raw[1].map(mid);
  const n = [
    (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
    (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
  ];
  const flip = n[0] + n[1] + n[2] < 0;
  return raw.map((t) => {
    if (!flip) return Object.freeze(t);
    const o = [];
    for (let k = 0; k < t.length; k += 3) o.push(t[k], t[k + 2], t[k + 1]);
    return Object.freeze(o);
  });
}

/**
 * Triangle table: for each of the 256 corner sign cases (bit i set when
 * corner i is inside, value below the iso level), a flat list of edge
 * indices, three per triangle, oriented so normals point toward larger values.
 * @type {ReadonlyArray<ReadonlyArray<number>>}
 */
export const MC_TRI_TABLE = Object.freeze(buildTable());

/**
 * Edge table: for each case, a 12-bit mask of the edges the surface crosses.
 * @type {ReadonlyArray<number>}
 */
export const MC_EDGE_TABLE = Object.freeze(MC_TRI_TABLE.map((t) => t.reduce((m, e) => m | (1 << e), 0)));

/**
 * Extract the surface f(x, y, z) = iso. The inside is where f < iso; normals
 * point outward (toward larger f).
 * @param {(x: number, y: number, z: number) => number} f
 * @param {{min?: number[], max?: number[], resolution?: number|number[], iso?: number}} [opts]
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function marchingCubes(f, opts = {}) {
  const min = opts.min ?? [-1, -1, -1];
  const max = opts.max ?? [1, 1, 1];
  const res = Array.isArray(opts.resolution) ? opts.resolution : [opts.resolution ?? 32, opts.resolution ?? 32, opts.resolution ?? 32];
  const iso = opts.iso ?? 0;
  const [nx, ny, nz] = res;
  const sx = (max[0] - min[0]) / nx;
  const sy = (max[1] - min[1]) / ny;
  const sz = (max[2] - min[2]) / nz;
  const V = new Float64Array((nx + 1) * (ny + 1) * (nz + 1));
  const vid = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) V[vid(i, j, k)] = f(min[0] + i * sx, min[1] + j * sy, min[2] + k * sz) - iso;
  const pos = [];
  const faces = [];
  const edgeVerts = new Map();
  const cellVert = new Array(12);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let cs = 0;
        const vals = new Array(8);
        for (let c = 0; c < 8; c++) {
          const o = MC_CORNERS[c];
          vals[c] = V[vid(i + o[0], j + o[1], k + o[2])];
          if (vals[c] < 0) cs |= 1 << c;
        }
        const tri = MC_TRI_TABLE[cs];
        if (!tri.length) continue;
        const mask = MC_EDGE_TABLE[cs];
        for (let e = 0; e < 12; e++) {
          if (!(mask & (1 << e))) continue;
          const [a, b] = MC_EDGES[e];
          const oa = MC_CORNERS[a];
          const ob = MC_CORNERS[b];
          const ga = vid(i + oa[0], j + oa[1], k + oa[2]);
          const gb = vid(i + ob[0], j + ob[1], k + ob[2]);
          const key = ga < gb ? ga * 8388608 + gb : gb * 8388608 + ga;
          let id = edgeVerts.get(key);
          if (id === undefined) {
            const va = vals[a];
            const vb = vals[b];
            const t = va === vb ? 0.5 : va / (va - vb);
            id = pos.length / 3;
            pos.push(min[0] + (i + oa[0] + (ob[0] - oa[0]) * t) * sx, min[1] + (j + oa[1] + (ob[1] - oa[1]) * t) * sy, min[2] + (k + oa[2] + (ob[2] - oa[2]) * t) * sz);
            edgeVerts.set(key, id);
          }
          cellVert[e] = id;
        }
        for (let t = 0; t < tri.length; t += 3) {
          const a = cellVert[tri[t]];
          const b = cellVert[tri[t + 1]];
          const c = cellVert[tri[t + 2]];
          if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
        }
      }
    }
  }
  return makeMesh(Float64Array.from(pos), faces);
}
