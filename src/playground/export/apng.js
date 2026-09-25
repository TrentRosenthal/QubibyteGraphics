/**
 * PNG encoding and APNG assembly. Frames are encoded as ordinary PNG files
 * (RGBA, adaptive row filters, zlib from the platform), then
 * `assembleAPNG` splices their image data into one animated PNG: the first
 * frame's IDAT is the default image, later frames become fcTL and fdAT
 * chunks with running sequence numbers.
 * @module playground/export/apng
 */

import { ByteWriter, concatBytes, crc32 } from './bytes.js';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const w = new ByteWriter(data.length + 12);
  w.u32(data.length).ascii(type).bytes(data);
  const bytes = w.done();
  const crc = crc32(bytes, 4, bytes.length);
  return concatBytes([bytes, new ByteWriter(4).u32(crc).done()]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Filter RGBA rows for PNG, choosing per row the filter with the smallest
 * sum of absolute residuals (None, Sub, Up, Paeth).
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
function filterRows(rgba, w, h) {
  const stride = w * 4;
  const out = new Uint8Array(h * (stride + 1));
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  const types = [0, 1, 2, 4];
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const up = row - stride;
    let bestSum = Infinity;
    let best = 0;
    for (let f = 0; f < 4; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[row + i];
        const a = i >= 4 ? rgba[row + i - 4] : 0;
        const b = y > 0 ? rgba[up + i] : 0;
        const cc = y > 0 && i >= 4 ? rgba[up + i - 4] : 0;
        let v;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else v = x - paeth(a, b, cc);
        v &= 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    const o = y * (stride + 1);
    out[o] = types[best];
    // Recompute the winner in full: the loop above may have stopped early for it.
    const c = cand[best];
    for (let i = 0; i < stride; i++) {
      const x = rgba[row + i];
      const a = i >= 4 ? rgba[row + i - 4] : 0;
      const b = y > 0 ? rgba[up + i] : 0;
      const cc = y > 0 && i >= 4 ? rgba[up + i - 4] : 0;
      const pred = best === 0 ? 0 : best === 1 ? a : best === 2 ? b : paeth(a, b, cc);
      c[i] = (x - pred) & 0xff;
    }
    out.set(c, o + 1);
  }
  return out;
}

/**
 * Encode RGBA pixels as a PNG file.
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {(bytes: Uint8Array) => Promise<Uint8Array>|Uint8Array} deflate zlib (RFC 1950) compressor
 * @returns {Promise<Uint8Array>}
 */
export async function encodePNG(rgba, width, height, deflate) {
  const ihdr = new ByteWriter(13).u32(width).u32(height).u8(8).u8(6).u8(0).u8(0).u8(0).done();
  const idat = await deflate(filterRows(rgba, width, height));
  return concatBytes([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

function readChunks(png) {
  for (let i = 0; i < 8; i++) if (png[i] !== SIGNATURE[i]) throw new Error('Not a PNG file');
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = [];
  for (let o = 8; o + 12 <= png.length;) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/**
 * Assemble PNG frames (same size and pixel format) into an animated PNG.
 * @param {Uint8Array[]} pngs PNG files, one per frame
 * @param {{fps: number, loops?: number}} opts loops 0 repeats forever
 * @returns {Uint8Array}
 */
export function assembleAPNG(pngs, opts) {
  if (!pngs.length) throw new Error('No frames to assemble');
  const parsed = pngs.map(readChunks);
  const ihdr = parsed[0].find((c) => c.type === 'IHDR').data;
  const iv = new DataView(ihdr.buffer, ihdr.byteOffset, 13);
  const width = iv.getUint32(0);
  const height = iv.getUint32(4);
  parsed.forEach((chunks, i) => {
    const h = chunks.find((c) => c.type === 'IHDR').data;
    for (let k = 0; k < 13; k++) if (h[k] !== ihdr[k]) throw new Error(`Frame ${i} has a different size or pixel format than frame 0`);
  });
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', new ByteWriter(8).u32(pngs.length).u32(opts.loops ?? 0).done())];
  for (const c of parsed[0]) if (c.type !== 'IHDR' && c.type !== 'IDAT' && c.type !== 'IEND' && /^[a-z]/.test(c.type) && c.type !== 'acTL') parts.push(chunk(c.type, c.data));
  let seq = 0;
  const [num, den] = Number.isInteger(opts.fps) ? [1, opts.fps] : [1000, Math.round(opts.fps * 1000)];
  parsed.forEach((chunks, i) => {
    const fctl = new ByteWriter(26).u32(seq++).u32(width).u32(height).u32(0).u32(0).u16(num).u16(den).u8(0).u8(0).done();
    parts.push(chunk('fcTL', fctl));
    for (const c of chunks) {
      if (c.type !== 'IDAT') continue;
      if (i === 0) parts.push(chunk('IDAT', c.data));
      else parts.push(chunk('fdAT', concatBytes([new ByteWriter(4).u32(seq++).done(), c.data])));
    }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return concatBytes(parts);
}
