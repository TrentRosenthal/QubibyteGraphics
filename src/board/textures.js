/**
 * Procedural textures for board styles: slate and whiteboard surfaces, paper
 * fiber, cyanotype mottling, and the grain masks that break up chalk and
 * pencil strokes. Everything is seeded and cached per size.
 * @module board/textures
 */

import { createCanvas } from '../core/platform.js';
import { parseColor, rgbToOklab, oklabToRgb } from '../core/color.js';
import { Random } from '../core/random.js';

/**
 * Fractal value noise over a w x h grid, values roughly in [-1, 1].
 * @param {number} w
 * @param {number} h
 * @param {number} scale cell size of the lowest octave in pixels
 * @param {number} octaves
 * @param {number} seed
 * @param {{stretchX?: number}} [opts] anisotropy: >1 stretches features horizontally
 * @returns {Float32Array}
 */
export function fbm(w, h, scale, octaves, seed, opts = {}) {
  const out = new Float32Array(w * h);
  const rng = new Random(seed);
  let amp = 1;
  let total = 0;
  const sx = opts.stretchX ?? 1;
  for (let o = 0; o < octaves; o++) {
    const cell = Math.max(1, scale / 2 ** o);
    const cw = cell * sx;
    const gw = Math.ceil(w / cw) + 2;
    const gh = Math.ceil(h / cell) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next() * 2 - 1;
    for (let y = 0; y < h; y++) {
      const fy = y / cell;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / cw;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const a = grid[iy * gw + ix];
        const b = grid[iy * gw + ix + 1];
        const c = grid[(iy + 1) * gw + ix];
        const d = grid[(iy + 1) * gw + ix + 1];
        out[y * w + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const cache = new Map();

function cached(key, make) {
  if (!cache.has(key)) {
    if (cache.size > 48) cache.delete(cache.keys().next().value);
    cache.set(key, make());
  }
  return cache.get(key);
}

/**
 * Alpha mask tile that breaks strokes into grain. Opaque where the medium
 * deposits, transparent in the gaps.
 * @param {'chalk'|'pencil'|'marker'} medium
 * @param {number} seed
 * @param {number} [px=1] pixel scale (1 at 1080p)
 * @returns {any} canvas tile
 */
export function grainMask(medium, seed, px = 1) {
  const size = Math.max(64, Math.round(256 * Math.min(2, Math.max(0.5, px))));
  return cached(`grain|${medium}|${seed}|${size}`, () => {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const fine = fbm(size, size, 2.2 * px, 2, seed + 1);
    const mid = fbm(size, size, 7 * px, 3, seed + 2, { stretchX: 1.6 });
    const rng = new Random(seed + 3);
    for (let i = 0; i < size * size; i++) {
      let a;
      if (medium === 'chalk') {
        const v = 0.55 * fine[i] + 0.6 * mid[i] + 0.35 * (rng.next() - 0.5);
        a = 0.25 + 0.75 * smooth(-0.55, 0.25, v);
      } else if (medium === 'pencil') {
        const v = 0.8 * fine[i] + 0.3 * mid[i] + 0.3 * (rng.next() - 0.5);
        a = 0.35 + 0.65 * smooth(-0.5, 0.35, v);
      } else {
        a = 0.93 + 0.07 * fine[i];
      }
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
}

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Shift a color's OKLab lightness.
 * @param {import('../core/color.js').RGBA} c
 * @param {number} dL
 * @returns {import('../core/color.js').RGBA}
 */
function shiftL(c, dL) {
  const l = rgbToOklab(c);
  return oklabToRgb(l.L + dL, l.a, l.b, c.a);
}

/**
 * Full-frame surface texture for a board, cached by size, kind, seed, and
 * base color. Rulings and grids are drawn per frame elsewhere so they can
 * scroll with the camera.
 * @param {'chalkboard'|'whiteboard'|'paper'|'blueprint'} kind
 * @param {number} W
 * @param {number} H
 * @param {number} seed
 * @param {string} baseColor
 * @param {Record<string, any>} [opts] variant and similar board options
 * @returns {any} canvas
 */
export function surface(kind, W, H, seed, baseColor, opts = {}) {
  const key = `surface|${kind}|${W}x${H}|${seed}|${baseColor}|${opts.variant ?? ''}`;
  return cached(key, () => {
    // Low-frequency fields are generated at reduced resolution and scaled up.
    const ds = Math.max(1, Math.round(Math.max(W, H) / 640));
    const w = Math.ceil(W / ds);
    const h = Math.ceil(H / ds);
    const base = parseColor(baseColor);
    const low = fbm(w, h, 180 / ds, 4, seed + 11);
    const small = fbm(w, h, Math.max(1, 6 / ds), 2, seed + 12);
    const cSmall = createCanvas(w, h);
    const sctx = cSmall.getContext('2d');
    const img = sctx.createImageData(w, h);
    const lab = rgbToOklab(base);
    const rng = new Random(seed + 13);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let dL;
        if (kind === 'chalkboard') dL = 0.022 * low[i] + 0.012 * small[i] + 0.008 * (rng.next() - 0.5);
        else if (kind === 'whiteboard') {
          const gx = (x / w - 0.62) * 1.4;
          const gy = (y / h - 0.28) * 2.2;
          dL = 0.012 * Math.exp(-(gx * gx + gy * gy)) + 0.004 * low[i] + 0.003 * (rng.next() - 0.5);
        } else if (kind === 'paper') dL = 0.008 * low[i] + 0.01 * small[i] + 0.006 * (rng.next() - 0.5);
        else dL = 0.035 * low[i] + 0.014 * small[i] + 0.01 * (rng.next() - 0.5);
        const c = oklabToRgb(lab.L + dL, lab.a, lab.b);
        img.data[i * 4] = Math.round(c.r * 255);
        img.data[i * 4 + 1] = Math.round(c.g * 255);
        img.data[i * 4 + 2] = Math.round(c.b * 255);
        img.data[i * 4 + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cSmall, 0, 0, W, H);
    const px = Math.min(W, H) / 1080;
    const r2 = new Random(seed + 21);
    if (kind === 'chalkboard') {
      // Ghosts of earlier erasing: wide, soft, nearly invisible swirls.
      ctx.save();
      ctx.lineCap = 'round';
      const ghost = shiftL(base, 0.05);
      for (let k = 0; k < 7; k++) {
        const cx = r2.range(0.1, 0.9) * W;
        const cy = r2.range(0.1, 0.8) * H;
        const rx = r2.range(0.08, 0.22) * W;
        const ry = rx * r2.range(0.25, 0.6);
        ctx.strokeStyle = `rgba(${Math.round(ghost.r * 255)},${Math.round(ghost.g * 255)},${Math.round(ghost.b * 255)},${r2.range(0.05, 0.1)})`;
        ctx.lineWidth = r2.range(40, 90) * px;
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 * r2.range(0.6, 1.4); a += 0.05) {
          const x = cx + rx * Math.cos(a) + 8 * px * Math.sin(a * 5);
          const y = cy + ry * Math.sin(a) * (1 + 0.1 * Math.sin(a * 3));
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      // Chalk tray ledge along the bottom edge.
      const ledge = Math.round(14 * px);
      const dark = shiftL(base, -0.08);
      ctx.fillStyle = `rgb(${Math.round(dark.r * 255)},${Math.round(dark.g * 255)},${Math.round(dark.b * 255)})`;
      ctx.fillRect(0, H - ledge, W, ledge);
      const edge = shiftL(base, 0.06);
      ctx.fillStyle = `rgba(${Math.round(edge.r * 255)},${Math.round(edge.g * 255)},${Math.round(edge.b * 255)},0.5)`;
      ctx.fillRect(0, H - ledge, W, Math.max(1, Math.round(1.5 * px)));
    }
    if (kind === 'whiteboard') {
      ctx.save();
      ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const x = r2.range(0.05, 0.8) * W;
        const y = r2.range(0.1, 0.9) * H;
        const len = r2.range(120, 320) * px;
        const amp = r2.range(6, 18) * px;
        const freq = r2.range(0.015, 0.03) / px;
        ctx.strokeStyle = `rgba(60,70,80,${r2.range(0.012, 0.022)})`;
        ctx.lineWidth = r2.range(4, 7) * px;
        ctx.beginPath();
        for (let d = 0; d <= len; d += 4 * px) {
          const yy = y + amp * Math.sin(d * freq + k);
          if (d === 0) ctx.moveTo(x + d, yy);
          else ctx.lineTo(x + d, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    if (kind === 'blueprint') {
      ctx.save();
      const fold = shiftL(base, 0.05);
      ctx.strokeStyle = `rgba(${Math.round(fold.r * 255)},${Math.round(fold.g * 255)},${Math.round(fold.b * 255)},0.35)`;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(W / 2 + r2.range(-10, 10) * px, 0);
      ctx.lineTo(W / 2 + r2.range(-10, 10) * px, H);
      ctx.moveTo(0, H / 2 + r2.range(-6, 6) * px);
      ctx.lineTo(W, H / 2 + r2.range(-6, 6) * px);
      ctx.stroke();
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,10,30,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (kind === 'paper') {
      ctx.save();
      for (let k = 0; k < 900; k++) {
        const x = r2.next() * W;
        const y = r2.next() * H;
        const a = r2.next() * Math.PI;
        const L = r2.range(4, 14) * px;
        ctx.strokeStyle = `rgba(120,100,70,${r2.range(0.03, 0.07)})`;
        ctx.lineWidth = 0.6 * px;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + L * Math.cos(a), y + L * Math.sin(a));
        ctx.stroke();
      }
      ctx.restore();
    }
    return c;
  });
}
