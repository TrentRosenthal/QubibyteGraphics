import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import {
  parseOBJ, parseSTL, parseGLTF, parse3MF, importMesh, exportOBJ, exportSTLAscii, exportSTLBinary, export3MF, model3MF,
  readZip, writeZip, crc32, polyhedron, torus, box, meshVolume, isClosed, eulerCharacteristic, mergeMeshes, translateMesh,
  circuitMesh,
} from '../../src/three/index.js';
import { getTheme } from '../../src/themes/index.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('OBJ fixture: polygons, v/vt/vn references, and negative indices', () => {
  const m = parseOBJ(readFileSync(new URL('./fixtures/three/cube.obj', import.meta.url), 'utf8'));
  assert.equal(m.faces.length, 6);
  assert.ok(isClosed(m));
  close(meshVolume(m), 1, 1e-12);
});

test('OBJ round trip keeps polygon faces', () => {
  const m = polyhedron('truncatedIcosahedron');
  const r = parseOBJ(exportOBJ(m));
  assert.equal(r.faces.length, 32);
  close(meshVolume(r), meshVolume(m), 1e-6);
});

test('STL binary and ASCII round trips weld back to a closed mesh', () => {
  const m = torus(1, 0.3, 24, 12);
  const bin = exportSTLBinary(m);
  assert.equal(bin.length, 84 + 50 * m.faces.length * 2);
  const a = parseSTL(bin);
  assert.ok(isClosed(a));
  assert.equal(eulerCharacteristic(a), 0);
  close(meshVolume(a), meshVolume(m), 1e-4);
  const text = exportSTLAscii(m, { name: 'ring' });
  assert.ok(text.startsWith('solid ring') && text.trimEnd().endsWith('endsolid ring'));
  const b = parseSTL(text);
  close(meshVolume(b), meshVolume(m), 1e-6);
});

test('CRC32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP writer output is read back, and deflated entries inflate', async () => {
  const z = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const files = await readZip(z);
  assert.equal(new TextDecoder().decode(files.get('a.txt')), 'hello');
  assert.deepEqual([...files.get('dir/b.bin')], [1, 2, 3]);
  const raw = new TextEncoder().encode('deflated content '.repeat(50));
  const comp = deflateRawSync(raw);
  const name = new TextEncoder().encode('d.txt');
  const buf = new Uint8Array(30 + name.length + comp.length + 46 + name.length + 22);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(8, 8, true);
  dv.setUint32(14, crc32(raw), true);
  dv.setUint32(18, comp.length, true);
  dv.setUint32(22, raw.length, true);
  dv.setUint16(26, name.length, true);
  buf.set(name, 30);
  buf.set(comp, 30 + name.length);
  const cd = 30 + name.length + comp.length;
  dv.setUint32(cd, 0x02014b50, true);
  dv.setUint16(cd + 10, 8, true);
  dv.setUint32(cd + 20, comp.length, true);
  dv.setUint32(cd + 24, raw.length, true);
  dv.setUint16(cd + 28, name.length, true);
  dv.setUint32(cd + 42, 0, true);
  buf.set(name, cd + 46);
  const eocd = cd + 46 + name.length;
  dv.setUint32(eocd, 0x06054b50, true);
  dv.setUint16(eocd + 8, 1, true);
  dv.setUint16(eocd + 10, 1, true);
  dv.setUint32(eocd + 12, 46 + name.length, true);
  dv.setUint32(eocd + 16, cd, true);
  const out = await readZip(buf);
  assert.equal(new TextDecoder().decode(out.get('d.txt')), 'deflated content '.repeat(50));
});

test('3MF round trip keeps geometry and base colors', async () => {
  const m = mergeMeshes([{ mesh: box(1, 1, 1), color: 'accent' }, { mesh: translateMesh(box(1, 1, 1), 2, 0, 0), color: '#d9a441' }]);
  const theme = getTheme('qubibyte');
  const bytes = export3MF(m, { theme });
  const files = await readZip(bytes);
  assert.ok(files.has('[Content_Types].xml') && files.has('_rels/.rels') && files.has('3D/3dmodel.model'));
  const r = await parse3MF(bytes);
  assert.equal(r.faces.length, 24);
  close(meshVolume(r), 2, 1e-6);
  const colors = new Set(r.faceColors.map((c) => `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`));
  assert.equal(colors.size, 2);
  assert.ok(colors.has('217,164,65'));
  assert.match(model3MF(box(1, 1, 1)), /<triangle v1="\d+" v2="\d+" v3="\d+"\/>/);
});

test('glTF with an embedded buffer and a node transform', () => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const idx = new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const bytes = new Uint8Array(pos.byteLength + idx.byteLength);
  bytes.set(new Uint8Array(pos.buffer), 0);
  bytes.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64') }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 1] } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0, translation: [5, 0, 0], scale: [2, 2, 2] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const m = parseGLTF(JSON.stringify(json));
  assert.equal(m.faces.length, 4);
  assert.ok(isClosed(m));
  close(meshVolume(m), 8 / 6, 1e-6);
  let minX = Infinity;
  for (let i = 0; i < m.positions.length; i += 3) minX = Math.min(minX, m.positions[i]);
  close(minX, 5);
  close(m.faceColors[0].g, 0.735, 0.01);
  const jsonBytes = new TextEncoder().encode(JSON.stringify({ ...json, buffers: [{ byteLength: bytes.length }] }));
  const pad = (n) => (4 - (n % 4)) % 4;
  const jl = jsonBytes.length + pad(jsonBytes.length);
  const bl = bytes.length + pad(bytes.length);
  const glb = new Uint8Array(12 + 8 + jl + 8 + bl);
  const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + jl);
  glb.set(jsonBytes, 20);
  dv.setUint32(20 + jl, bl, true);
  dv.setUint32(24 + jl, 0x004e4942, true);
  glb.set(bytes, 28 + jl);
  const g = parseGLTF(glb);
  close(meshVolume(g), 8 / 6, 1e-6);
});

test('importMesh dispatches by extension and the circuit model exports as a closed solid', async () => {
  const m = await importMesh(exportOBJ(box(2, 1, 1)), 'model.obj');
  close(meshVolume(m), 2, 1e-9);
  const { mesh } = circuitMesh({ wires: 2, gates: [{ column: 0, wires: [0], kind: 'box', label: 'H' }, { column: 1, wires: [0], kind: 'control' }, { column: 1, wires: [1], kind: 'target' }, { column: 2, wires: [1], kind: 'measure' }] });
  assert.ok(isClosed(mesh));
  const r = await parse3MF(export3MF(mesh, { theme: getTheme('clean-light') }));
  assert.equal(r.faces.length, parseSTL(exportSTLBinary(mesh)).faces.length);
  close(meshVolume(r), meshVolume(mesh), 1e-3);
});
