/**
 * PDF export of a single frame as vector graphics: paths with fills,
 * strokes, alpha, dashes, and embedded JPEG or PNG-derived images. Written
 * from scratch; PDF 1.4 with compressed-free content streams so the output
 * is easy to inspect and deterministic.
 * @module export/pdf
 */

import { frameToVector } from '../render/vector.js';
import { PROJECT } from '../config.js';

const n4 = (v) => {
  const s = (Math.round(v * 1e4) / 1e4).toString();
  return s === '-0' ? '0' : s;
};

/**
 * Build a PDF document for a frame.
 * @param {import('../core/sampler.js').Frame} frame
 * @param {{transparent?: boolean, images?: Map<string, {jpeg: Uint8Array, width: number, height: number}>}} [opts]
 *   images: JPEG bytes for image sources, keyed by the item's source id (provided by the caller, which owns decoding)
 * @returns {{bytes: Uint8Array, rasterized: string[]}}
 */
export function frameToPDF(frame, opts = {}) {
  const v = frameToVector(frame);
  const W = v.width;
  const H = v.height;
  const gstates = new Map();
  const gs = (fa, sa) => {
    const key = `${n4(fa)}|${n4(sa)}`;
    if (!gstates.has(key)) gstates.set(key, { name: `G${gstates.size}`, fa, sa });
    return gstates.get(key).name;
  };
  const xobjects = [];
  const out = [];
  // PDF user space: origin bottom-left, y up. Map pixel space (y down) with one matrix.
  out.push(`1 0 0 -1 0 ${n4(H)} cm`);
  if (!opts.transparent) {
    const b = v.background;
    out.push(`${n4(b.r)} ${n4(b.g)} ${n4(b.b)} rg 0 0 ${n4(W)} ${n4(H)} re f`);
  }
  const rasterized = [...v.rasterized];
  for (const op of v.ops) {
    if (op.kind === 'image') {
      const img = opts.images && opts.images.get(op.source);
      if (!img) {
        rasterized.push(`image ${op.id} (no encoded bytes supplied)`);
        continue;
      }
      const name = `Im${xobjects.length}`;
      xobjects.push({ name, ...img });
      const m = op.matrix;
      // The unit square in PDF image space is y up; flip it into our y-down unit square first.
      out.push(`q /${gs(op.opacity, op.opacity)} gs ${[m[0], m[1], m[2], m[3], m[4], m[5]].map(n4).join(' ')} cm 1 0 0 -1 0 1 cm /${name} Do Q`);
      continue;
    }
    const segs = [];
    for (const s of op.path.subpaths) {
      const p = s.points;
      segs.push(`${n4(p[0])} ${n4(p[1])} m`);
      for (let i = 2; i < p.length; i += 6) segs.push(`${n4(p[i])} ${n4(p[i + 1])} ${n4(p[i + 2])} ${n4(p[i + 3])} ${n4(p[i + 4])} ${n4(p[i + 5])} c`);
      if (s.closed) segs.push('h');
    }
    if (!segs.length) continue;
    const fill = op.fill;
    const stroke = op.stroke && op.width > 0 ? op.stroke : null;
    if (!fill && !stroke) continue;
    const parts = ['q', `/${gs(fill ? fill.a : 1, stroke ? stroke.a : 1)} gs`];
    if (fill) parts.push(`${n4(fill.r)} ${n4(fill.g)} ${n4(fill.b)} rg`);
    if (stroke) {
      parts.push(`${n4(stroke.r)} ${n4(stroke.g)} ${n4(stroke.b)} RG ${n4(op.width)} w`);
      parts.push(`${{ butt: 0, round: 1, square: 2 }[op.cap] ?? 1} J ${{ miter: 0, round: 1, bevel: 2 }[op.join] ?? 1} j`);
      parts.push(op.dash ? `[${op.dash.map(n4).join(' ')}] 0 d` : '[] 0 d');
    }
    parts.push(segs.join(' '));
    const evenodd = op.fillRule === 'evenodd';
    if (fill && stroke) parts.push(evenodd ? 'B*' : 'B');
    else if (fill) parts.push(evenodd ? 'f*' : 'f');
    else parts.push('S');
    parts.push('Q');
    out.push(parts.join('\n'));
  }
  const content = out.join('\n');
  return { bytes: assemble(W, H, content, [...gstates.values()], xobjects), rasterized };
}

function assemble(W, H, content, gstates, xobjects) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    length += b.length;
  };
  const obj = (num, body) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
    if (Array.isArray(body)) for (const b of body) push(b);
    else push(body);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%âãÏÓ\n');
  const firstX = 6;
  const gsDict = gstates.map((g) => `/${g.name} << /Type /ExtGState /ca ${n4(g.fa)} /CA ${n4(g.sa)} >>`).join(' ');
  const xDict = xobjects.map((x, i) => `/${x.name} ${firstX + i} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n4(W)} ${n4(H)}] /Resources << /ExtGState << ${gsDict} >> /XObject << ${xDict} >> >> /Contents 4 0 R >>`);
  const cbytes = enc.encode(content);
  obj(4, [`<< /Length ${cbytes.length} >>\nstream\n`, cbytes, '\nendstream']);
  obj(5, `<< /Producer (${PROJECT.name}) >>`);
  xobjects.forEach((x, i) => {
    obj(firstX + i, [`<< /Type /XObject /Subtype /Image /Width ${x.width} /Height ${x.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${x.jpeg.length} >>\nstream\n`, x.jpeg, '\nendstream']);
  });
  const count = firstX + xobjects.length;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const bytes = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  return bytes;
}

