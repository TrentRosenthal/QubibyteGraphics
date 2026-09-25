/**
 * Animated GIF encoder: a global palette from median-cut quantization of
 * sampled frames, optional Floyd-Steinberg dithering, frame differencing
 * (each frame after the first stores only the rectangle that changed), and
 * LZW compression.
 * @module playground/export/gif
 */

import { ByteWriter } from './bytes.js';

/**
 * Build a palette with median cut over a 15-bit color histogram.
 * @param {Array<Uint8Array|Uint8ClampedArray>} samples RGBA pixel buffers (whole frames or subsamples)
 * @param {number} [maxColors=256] 2 to 256
 * @returns {Uint8Array} RGB triples, length 3 * colors
 */
export function buildPalette(samples, maxColors = 256) {
  const hist = new Float64Array(32768);
  for (const px of samples) {
    const step = Math.max(1, Math.floor(px.length / 4 / 400000)) * 4;
    for (let i = 0; i < px.length; i += step) hist[((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)]++;
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (hist[k] > 0) bins.push(k);
  const boxes = [makeBox(bins, hist)];
  while (boxes.length < maxColors) {
    let best = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.bins.length < 2) continue;
      const s = b.count * Math.max(b.range[0], b.range[1], b.range[2]);
      if (s > score) {
        score = s;
        best = i;
      }
    }
    if (best < 0) break;
    const b = boxes[best];
    const axis = b.range.indexOf(Math.max(...b.range));
    const shift = axis === 0 ? 10 : axis === 1 ? 5 : 0;
    b.bins.sort((x, y) => ((x >> shift) & 31) - ((y >> shift) & 31));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < b.bins.length - 1; i++) {
      acc += hist[b.bins[i]];
      cut = i + 1;
      if (acc >= b.count / 2) break;
    }
    boxes.splice(best, 1, makeBox(b.bins.slice(0, cut), hist), makeBox(b.bins.slice(cut), hist));
  }
  const pal = new Uint8Array(boxes.length * 3);
  boxes.forEach((b, i) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const k of b.bins) {
      const w = hist[k];
      r += (((k >> 10) & 31) * 8 + 4) * w;
      g += (((k >> 5) & 31) * 8 + 4) * w;
      bl += ((k & 31) * 8 + 4) * w;
    }
    pal[i * 3] = Math.round(r / b.count);
    pal[i * 3 + 1] = Math.round(g / b.count);
    pal[i * 3 + 2] = Math.round(bl / b.count);
  });
  return pal;
}

function makeBox(bins, hist) {
  const lo = [31, 31, 31];
  const hi = [0, 0, 0];
  let count = 0;
  for (const k of bins) {
    const c = [(k >> 10) & 31, (k >> 5) & 31, k & 31];
    for (let j = 0; j < 3; j++) {
      if (c[j] < lo[j]) lo[j] = c[j];
      if (c[j] > hi[j]) hi[j] = c[j];
    }
    count += hist[k];
  }
  return { bins, count, range: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

/** Nearest-color lookup with a cache over 15-bit colors. */
class PaletteMap {
  constructor(pal) {
    this.pal = pal;
    this.n = pal.length / 3;
    this.cache = new Int16Array(32768).fill(-1);
  }

  index(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = this.cache[key];
    if (idx >= 0) return idx;
    let best = Infinity;
    const p = this.pal;
    for (let i = 0; i < this.n; i++) {
      const dr = p[i * 3] - r;
      const dg = p[i * 3 + 1] - g;
      const db = p[i * 3 + 2] - b;
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    this.cache[key] = idx;
    return idx;
  }
}

/**
 * Map an RGBA frame to palette indices, optionally with Floyd-Steinberg error diffusion.
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {PaletteMap} map
 * @param {boolean} dither
 * @returns {Uint8Array}
 */
function indexFrame(rgba, w, h, map, dither) {
  const out = new Uint8Array(w * h);
  const pal = map.pal;
  if (!dither) {
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = map.index(rgba[j], rgba[j + 1], rgba[j + 2]);
    return out;
  }
  let cur = new Float32Array((w + 2) * 3);
  let next = new Float32Array((w + 2) * 3);
  for (let y = 0; y < h; y++) {
    next.fill(0);
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const e = (x + 1) * 3;
      const r = clamp(rgba[j] + cur[e]);
      const g = clamp(rgba[j + 1] + cur[e + 1]);
      const b = clamp(rgba[j + 2] + cur[e + 2]);
      const idx = map.index(r, g, b);
      out[y * w + x] = idx;
      const er = r - pal[idx * 3];
      const eg = g - pal[idx * 3 + 1];
      const eb = b - pal[idx * 3 + 2];
      cur[e + 3] += (er * 7) / 16;
      cur[e + 4] += (eg * 7) / 16;
      cur[e + 5] += (eb * 7) / 16;
      next[e - 3] += (er * 3) / 16;
      next[e - 2] += (eg * 3) / 16;
      next[e - 1] += (eb * 3) / 16;
      next[e] += (er * 5) / 16;
      next[e + 1] += (eg * 5) / 16;
      next[e + 2] += (eb * 5) / 16;
      next[e + 3] += er / 16;
      next[e + 4] += eg / 16;
      next[e + 5] += eb / 16;
    }
    const t = cur;
    cur = next;
    next = t;
  }
  return out;
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * LZW-compress palette indices with GIF's variable-width codes.
 * @param {Uint8Array} pixels
 * @param {number} minCodeSize
 * @returns {Uint8Array}
 */
export function lzwEncode(pixels, minCodeSize) {
  const out = new ByteWriter(pixels.length / 2 + 64);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const HSIZE = 5003;
  const hashKeys = new Int32Array(HSIZE);
  const hashCodes = new Int32Array(HSIZE);
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let bitBuf = 0;
  let bitCount = 0;
  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.u8(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };
  const reset = () => {
    hashKeys.fill(-1);
    codeSize = minCodeSize + 1;
    next = eoi + 1;
  };
  reset();
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = (prefix << 8) | k;
    let h = ((k << 12) ^ prefix) % HSIZE;
    let found = -1;
    while (hashKeys[h] !== -1) {
      if (hashKeys[h] === key) {
        found = hashCodes[h];
        break;
      }
      h = h + 1 === HSIZE ? 0 : h + 1;
    }
    if (found >= 0) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      hashKeys[h] = key;
      hashCodes[h] = next++;
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) out.u8(bitBuf & 0xff);
  return out.done();
}

/** Animated GIF writer with one global palette. */
export class GifEncoder {
  /**
   * @param {{width: number, height: number, fps: number, palette: Uint8Array, dither?: boolean, loop?: number}} opts loop 0 repeats forever
   */
  constructor(opts) {
    this.w = opts.width;
    this.h = opts.height;
    this.fps = opts.fps;
    this.dither = opts.dither ?? true;
    let bits = 1;
    while (1 << bits < opts.palette.length / 3) bits++;
    this.bits = bits;
    const pal = new Uint8Array(3 << bits);
    pal.set(opts.palette);
    this.map = new PaletteMap(opts.palette);
    this.out = new ByteWriter(1 << 20);
    this.frames = 0;
    this.prev = null;
    const o = this.out;
    o.ascii('GIF89a');
    o.u8(this.w & 0xff).u8(this.w >> 8).u8(this.h & 0xff).u8(this.h >> 8);
    o.u8(0x80 | ((bits - 1) << 4) | (bits - 1)).u8(0).u8(0);
    o.bytes(pal);
    o.u8(0x21).u8(0xff).u8(11).ascii('NETSCAPE2.0').u8(3).u8(1);
    const loop = opts.loop ?? 0;
    o.u8(loop & 0xff).u8(loop >> 8).u8(0);
  }

  /**
   * Add a frame.
   * @param {Uint8Array|Uint8ClampedArray} rgba width * height * 4 bytes
   */
  addFrame(rgba) {
    const { w, h } = this;
    const idx = indexFrame(rgba, w, h, this.map, this.dither);
    let x0 = 0;
    let y0 = 0;
    let x1 = w - 1;
    let y1 = h - 1;
    if (this.prev) {
      x0 = w;
      y0 = h;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          if (idx[row + x] !== this.prev[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
      }
      if (x1 < 0) {
        x0 = 0;
        y0 = 0;
        x1 = 0;
        y1 = 0;
      }
    }
    const fw = x1 - x0 + 1;
    const fh = y1 - y0 + 1;
    const sub = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) sub.set(idx.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + fw), y * fw);
    const n = this.frames;
    const delay = Math.round(((n + 1) * 100) / this.fps) - Math.round((n * 100) / this.fps);
    const o = this.out;
    o.u8(0x21).u8(0xf9).u8(4).u8(1 << 2).u8(delay & 0xff).u8(delay >> 8).u8(0).u8(0);
    o.u8(0x2c).u8(x0 & 0xff).u8(x0 >> 8).u8(y0 & 0xff).u8(y0 >> 8).u8(fw & 0xff).u8(fw >> 8).u8(fh & 0xff).u8(fh >> 8).u8(0);
    const minCode = Math.max(2, this.bits);
    o.u8(minCode);
    const data = lzwEncode(sub, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const len = Math.min(255, data.length - i);
      o.u8(len).bytes(data.subarray(i, i + len));
    }
    o.u8(0);
    this.prev = idx;
    this.frames++;
  }

  /** @returns {Uint8Array} the finished file */
  finish() {
    this.out.u8(0x3b);
    return this.out.done();
  }
}
