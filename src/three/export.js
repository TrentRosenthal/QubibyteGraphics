/**
 * Mesh exporters: STL (binary and ASCII), OBJ, and 3MF (a stored ZIP with
 * [Content_Types].xml, _rels/.rels, and 3D/3dmodel.model, with optional base
 * colors per face).
 * @module three/export
 */

import { triangulateMesh, faceNormals } from './geometry.js';
import { writeZip } from './zip.js';
import { parseColor, toHex } from '../core/color.js';
import { resolveColor } from '../themes/tokens.js';

/**
 * Binary STL.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {{header?: string}} [opts]
 * @returns {Uint8Array}
 */
export function exportSTLBinary(mesh, opts = {}) {
  const tri = triangulateMesh(mesh);
  const N = faceNormals(tri);
  const n = tri.faces.length;
  const out = new Uint8Array(84 + 50 * n);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode((opts.header ?? 'Qubibyte Graphics STL').slice(0, 80)), 0);
  dv.setUint32(80, n, true);
  const P = tri.positions;
  tri.faces.forEach((f, i) => {
    const o = 84 + 50 * i;
    dv.setFloat32(o, N[i * 3], true);
    dv.setFloat32(o + 4, N[i * 3 + 1], true);
    dv.setFloat32(o + 8, N[i * 3 + 2], true);
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) dv.setFloat32(o + 12 + k * 12 + c * 4, P[f[k] * 3 + c], true);
    }
  });
  return out;
}

const num = (v) => {
  const s = (+v.toPrecision(9)).toString();
  return s === '-0' ? '0' : s;
};

/**
 * ASCII STL.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {{name?: string}} [opts]
 * @returns {string}
 */
export function exportSTLAscii(mesh, opts = {}) {
  const name = (opts.name ?? 'qubibyte').replace(/\s+/g, '_');
  const tri = triangulateMesh(mesh);
  const N = faceNormals(tri);
  const P = tri.positions;
  const lines = [`solid ${name}`];
  tri.faces.forEach((f, i) => {
    lines.push(`  facet normal ${num(N[i * 3])} ${num(N[i * 3 + 1])} ${num(N[i * 3 + 2])}`, '    outer loop');
    for (const v of f) lines.push(`      vertex ${num(P[v * 3])} ${num(P[v * 3 + 1])} ${num(P[v * 3 + 2])}`);
    lines.push('    endloop', '  endfacet');
  });
  lines.push(`endsolid ${name}`);
  return lines.join('\n') + '\n';
}

/**
 * Wavefront OBJ with polygonal faces.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @returns {string}
 */
export function exportOBJ(mesh) {
  const P = mesh.positions;
  const lines = ['# Qubibyte Graphics'];
  for (let i = 0; i < P.length; i += 3) lines.push(`v ${num(P[i])} ${num(P[i + 1])} ${num(P[i + 2])}`);
  for (const f of mesh.faces) lines.push('f ' + f.map((v) => v + 1).join(' '));
  return lines.join('\n') + '\n';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n';

/**
 * The 3MF model XML for a mesh.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {{unit?: string, theme?: import('../themes/tokens.js').Theme, colors?: boolean}} [opts] theme resolves token face colors
 * @returns {string}
 */
export function model3MF(mesh, opts = {}) {
  const tri = triangulateMesh(mesh);
  const P = tri.positions;
  const useColors = (opts.colors ?? true) && tri.faceColors && tri.faceColors.some((c) => c != null);
  const palette = [];
  const index = new Map();
  const colorIndex = (c) => {
    if (c == null) return 0;
    const rgba = typeof c === 'string' && opts.theme ? resolveColor(c, opts.theme) : parseColor(c);
    const hex = toHex({ ...rgba, a: 1 }).toUpperCase() + 'FF';
    if (!index.has(hex)) {
      index.set(hex, palette.length);
      palette.push(hex);
    }
    return index.get(hex);
  };
  const faceIdx = useColors ? tri.faceColors.map(colorIndex) : null;
  if (useColors && !palette.length) palette.push('#B0B0B0FF');
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<model unit="${opts.unit ?? 'millimeter'}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`);
  out.push(' <resources>');
  if (useColors) {
    out.push('  <basematerials id="1">');
    palette.forEach((h, i) => out.push(`   <base name="color${i}" displaycolor="${h}"/>`));
    out.push('  </basematerials>');
  }
  out.push(`  <object id="2" type="model"${useColors ? ' pid="1" pindex="0"' : ''}>`);
  out.push('   <mesh>', '    <vertices>');
  for (let i = 0; i < P.length; i += 3) out.push(`     <vertex x="${num(P[i])}" y="${num(P[i + 1])}" z="${num(P[i + 2])}"/>`);
  out.push('    </vertices>', '    <triangles>');
  tri.faces.forEach((f, i) => out.push(`     <triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"${useColors ? ` pid="1" p1="${faceIdx[i]}"` : ''}/>`));
  out.push('    </triangles>', '   </mesh>', '  </object>', ' </resources>', ' <build>', '  <item objectid="2"/>', ' </build>', '</model>');
  return out.join('\n') + '\n';
}

/**
 * 3MF package bytes.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {{unit?: string, theme?: import('../themes/tokens.js').Theme, colors?: boolean}} [opts]
 * @returns {Uint8Array}
 */
export function export3MF(mesh, opts = {}) {
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: model3MF(mesh, opts) },
  ]);
}
