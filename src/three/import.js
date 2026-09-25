/**
 * Mesh importers: OBJ, STL (ASCII and binary), glTF 2.0 (.gltf with
 * embedded buffers, and binary .glb), and 3MF. Every importer returns a
 * MeshGeometry; face colors are kept where the format carries them.
 * @module three/import
 */

import { makeMesh, weld, mergeMeshes, transformMesh } from './geometry.js';
import { readZip } from './zip.js';
import * as M from './mat4.js';

function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new TextEncoder().encode(String(data));
}

function textOf(data) {
  return typeof data === 'string' ? data : new TextDecoder().decode(bytesOf(data));
}

/**
 * Parse Wavefront OBJ: `v`, `vn` (accepted and ignored: normals are derived
 * per face), and `f` with polygons and v, v/vt, v//vn, v/vt/vn references,
 * including negative indices.
 * @param {string|Uint8Array|ArrayBuffer} data
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function parseOBJ(data) {
  const pos = [];
  const faces = [];
  for (const rawLine of textOf(data).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') pos.push([+parts[1], +parts[2], +parts[3]]);
    else if (parts[0] === 'f') {
      const f = parts.slice(1).map((tok) => {
        const i = parseInt(tok.split('/')[0], 10);
        return i < 0 ? pos.length + i : i - 1;
      });
      if (f.length >= 3) faces.push(f);
    }
  }
  return makeMesh(pos, faces);
}

/**
 * Parse STL, ASCII or binary (detected from the size field).
 * Coincident vertices are welded so the result has shared topology.
 * @param {string|Uint8Array|ArrayBuffer} data
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function parseSTL(data) {
  if (typeof data !== 'string') {
    const b = bytesOf(data);
    if (b.length >= 84) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const n = dv.getUint32(80, true);
      if (84 + 50 * n === b.length) {
        const pos = new Float64Array(n * 9);
        const faces = [];
        for (let i = 0; i < n; i++) {
          const o = 84 + 50 * i + 12;
          for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + 4 * k, true);
          faces.push([i * 3, i * 3 + 1, i * 3 + 2]);
        }
        return weld(makeMesh(pos, faces), 1e-6);
      }
    }
  }
  const text = textOf(data);
  const pos = [];
  const faces = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(text))) pos.push([+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < pos.length; i += 3) faces.push([i, i + 1, i + 2]);
  if (!faces.length) throw new Error('STL: no facets found');
  return weld(makeMesh(pos, faces), 1e-6);
}

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function decodeBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Parse glTF 2.0: a .gltf JSON (string or object) with data-URI buffers, or
 * a binary .glb. Triangle primitives (modes 4, 5, 6) are read with node
 * transforms applied; base color factors become face colors.
 * @param {string|object|Uint8Array|ArrayBuffer} data
 * @param {{buffers?: Uint8Array[]}} [opts] external buffers by index
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function parseGLTF(data, opts = {}) {
  let json;
  let bin = null;
  if (typeof data === 'string') json = JSON.parse(data);
  else if (data && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) json = data;
  else {
    const b = bytesOf(data);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(0, true) === 0x46546c67) {
      let p = 12;
      while (p < b.length) {
        const len = dv.getUint32(p, true);
        const type = dv.getUint32(p + 4, true);
        const chunk = b.subarray(p + 8, p + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
        else if (type === 0x004e4942) bin = chunk;
        p += 8 + len;
      }
    } else json = JSON.parse(new TextDecoder().decode(b));
  }
  if (!json) throw new Error('glTF: no JSON chunk');
  const buffers = (json.buffers || []).map((buf, i) => {
    if (opts.buffers && opts.buffers[i]) return bytesOf(opts.buffers[i]);
    if (buf.uri && buf.uri.startsWith('data:')) return decodeBase64(buf.uri.slice(buf.uri.indexOf(',') + 1));
    if (!buf.uri && bin) return bin;
    throw new Error(`glTF: buffer ${i} is external; pass it in opts.buffers`);
  });
  const accessor = (i) => {
    const a = json.accessors[i];
    const size = SIZE[a.type];
    const out = new Float64Array(a.count * size);
    if (a.bufferView == null) return { data: out, size };
    const bv = json.bufferViews[a.bufferView];
    const buf = buffers[bv.buffer];
    const Type = COMPONENT[a.componentType];
    const stride = bv.byteStride || Type.BYTES_PER_ELEMENT * size;
    const base = buf.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const dv = new DataView(buf.buffer);
    const read = {
      5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true),
      5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
    }[a.componentType];
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < size; c++) out[k * size + c] = read(base + k * stride + c * Type.BYTES_PER_ELEMENT);
    }
    return { data: out, size };
  };
  const meshCache = new Map();
  const meshOf = (mi) => {
    if (meshCache.has(mi)) return meshCache.get(mi);
    const parts = [];
    for (const prim of json.meshes[mi].primitives) {
      const mode = prim.mode ?? 4;
      if (mode < 4 || prim.attributes.POSITION == null) continue;
      const P = accessor(prim.attributes.POSITION).data;
      const n = P.length / 3;
      const idx = prim.indices != null ? Array.from(accessor(prim.indices).data) : Array.from({ length: n }, (_, i) => i);
      const faces = [];
      if (mode === 4) for (let k = 0; k + 2 < idx.length; k += 3) faces.push([idx[k], idx[k + 1], idx[k + 2]]);
      else if (mode === 5) for (let k = 0; k + 2 < idx.length; k++) faces.push(k % 2 ? [idx[k + 1], idx[k], idx[k + 2]] : [idx[k], idx[k + 1], idx[k + 2]]);
      else for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0], idx[k], idx[k + 1]]);
      const mat = prim.material != null && json.materials ? json.materials[prim.material] : null;
      const f = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor;
      const color = f ? { r: linearToSrgb(f[0]), g: linearToSrgb(f[1]), b: linearToSrgb(f[2]), a: f[3] ?? 1 } : undefined;
      parts.push({ mesh: makeMesh(P, faces), color });
    }
    const merged = mergeMeshes(parts);
    meshCache.set(mi, merged);
    return merged;
  };
  const out = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    let local;
    if (node.matrix) local = Float64Array.from(node.matrix);
    else local = M.compose(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
    const world = M.multiply(parent, local);
    if (node.mesh != null) out.push({ mesh: transformMesh(meshOf(node.mesh), world) });
    for (const c of node.children || []) visit(c, world);
  };
  const scene = json.scenes ? json.scenes[json.scene ?? 0] : null;
  if (scene) for (const ni of scene.nodes) visit(ni, M.identity());
  else if (json.nodes) json.nodes.forEach((_, i) => visit(i, M.identity()));
  else (json.meshes || []).forEach((_, i) => out.push({ mesh: meshOf(i) }));
  return weld(mergeMeshes(out), 1e-7);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function attrs(tag) {
  const out = {};
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

function parseTransform(s) {
  const v = s.trim().split(/\s+/).map(Number);
  const m = M.identity();
  m[0] = v[0];
  m[1] = v[1];
  m[2] = v[2];
  m[4] = v[3];
  m[5] = v[4];
  m[6] = v[5];
  m[8] = v[6];
  m[9] = v[7];
  m[10] = v[8];
  m[12] = v[9];
  m[13] = v[10];
  m[14] = v[11];
  return m;
}

function hexColor(s) {
  const h = s.replace('#', '');
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length >= 8 ? n(6) : 1 };
}

/**
 * Parse the XML of a 3MF model part.
 * @param {string} xml
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function parse3MFModel(xml) {
  const materials = new Map();
  for (const bm of xml.matchAll(/<(?:\w+:)?basematerials\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?basematerials>/g)) {
    const id = attrs(bm[1]).id;
    materials.set(id, [...bm[2].matchAll(/<(?:\w+:)?base\b([^>]*)\/?>/g)].map((b) => hexColor(attrs(b[1]).displaycolor || '#808080')));
  }
  const objects = new Map();
  for (const ob of xml.matchAll(/<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g)) {
    const a = attrs(ob[1]);
    const body = ob[2];
    const pos = [...body.matchAll(/<(?:\w+:)?vertex\b([^>]*)\/?>/g)].map((v) => {
      const va = attrs(v[1]);
      return [+va.x, +va.y, +va.z];
    });
    const faces = [];
    const colors = [];
    let anyColor = false;
    for (const t of body.matchAll(/<(?:\w+:)?triangle\b([^>]*)\/?>/g)) {
      const ta = attrs(t[1]);
      faces.push([+ta.v1, +ta.v2, +ta.v3]);
      const pid = ta.pid ?? a.pid;
      const pi = ta.p1 ?? a.pindex;
      const c = pid != null && pi != null && materials.has(pid) ? materials.get(pid)[+pi] : null;
      if (c) anyColor = true;
      colors.push(c);
    }
    const comps = [...body.matchAll(/<(?:\w+:)?component\b([^>]*)\/?>/g)].map((c) => attrs(c[1]));
    objects.set(a.id, { pos, faces, colors: anyColor ? colors : null, comps });
  }
  const build = (id, depth = 0) => {
    const o = objects.get(id);
    if (!o || depth > 16) return [];
    const parts = [];
    if (o.faces.length) parts.push({ mesh: makeMesh(o.pos, o.faces, { faceColors: o.colors }) });
    for (const c of o.comps) {
      const sub = mergeMeshes(build(c.objectid, depth + 1));
      parts.push({ mesh: c.transform ? transformMesh(sub, parseTransform(c.transform)) : sub });
    }
    return parts;
  };
  const items = [...xml.matchAll(/<(?:\w+:)?item\b([^>]*)\/?>/g)].map((i) => attrs(i[1]));
  const parts = [];
  for (const it of items.length ? items : [...objects.keys()].map((id) => ({ objectid: id }))) {
    const mesh = mergeMeshes(build(it.objectid));
    parts.push({ mesh: it.transform ? transformMesh(mesh, parseTransform(it.transform)) : mesh });
  }
  return weld(mergeMeshes(parts), 1e-7);
}

/**
 * Parse a 3MF package (a ZIP archive holding 3D/3dmodel.model).
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Promise<import('./geometry.js').MeshGeometry>}
 */
export async function parse3MF(data) {
  const files = await readZip(data);
  let name = [...files.keys()].find((k) => /^\/?3D\/[^/]+\.model$/i.test(k));
  const rels = files.get('_rels/.rels');
  if (rels) {
    const m = /Target="\/?([^"]+\.model)"/i.exec(new TextDecoder().decode(rels));
    if (m && files.has(m[1])) name = m[1];
  }
  if (!name) throw new Error('3MF: no model part found');
  return parse3MFModel(new TextDecoder().decode(files.get(name)));
}

/**
 * Import a mesh by format name or file extension: 'obj', 'stl', 'gltf',
 * 'glb', '3mf'.
 * @param {string|Uint8Array|ArrayBuffer|object} data
 * @param {string} format
 * @returns {Promise<import('./geometry.js').MeshGeometry>}
 */
export async function importMesh(data, format) {
  const f = format.toLowerCase().replace(/^.*\./, '');
  if (f === 'obj') return parseOBJ(data);
  if (f === 'stl') return parseSTL(data);
  if (f === 'gltf' || f === 'glb') return parseGLTF(data);
  if (f === '3mf') return parse3MF(data);
  throw new Error(`Unknown mesh format "${format}"`);
}
