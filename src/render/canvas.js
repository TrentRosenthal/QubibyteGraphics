/**
 * Canvas2D renderer. Draws a sampled Frame into any Canvas2D context: a
 * browser canvas, an OffscreenCanvas, or @napi-rs/canvas in Node. This is the
 * reference backend for golden images and video export.
 * @module render/canvas
 */

import { tracePath } from '../core/path.js';
import { toCSS, parseColor, mix } from '../core/color.js';
import { createCanvas } from '../core/platform.js';
import { Random } from '../core/random.js';

/**
 * Board renderers register here (see src/board). Each provides
 * drawBackground(ctx, frame, view) and drawItem(ctx, item, frame, view).
 * @type {Record<string, {drawBackground: Function, drawItem: Function, drawOverlay?: Function}>}
 */
export const BOARD_RENDERERS = {};

/**
 * Register a board renderer.
 * @param {string} id
 * @param {{drawBackground: Function, drawItem: Function, drawOverlay?: Function}} renderer
 */
export function registerBoard(id, renderer) {
  BOARD_RENDERERS[id] = renderer;
}

/**
 * @typedef {Object} View
 * @property {number} scale Pixels per world unit (includes camera zoom).
 * @property {number} strokeScale Pixels per stroke-width unit (px at 1080p).
 * @property {number[]} matrix World to pixel matrix [a, b, c, d, e, f].
 * @property {number} pixelWidth
 * @property {number} pixelHeight
 * @property {number} pixelRatio
 */

/**
 * Compute the world-to-pixel view for a frame.
 * @param {import('../core/sampler.js').Frame} frame
 * @param {number} [pixelRatio=1] Device pixel ratio or supersampling factor.
 * @returns {View}
 */
export function viewFor(frame, pixelRatio = 1) {
  const W = frame.width * pixelRatio;
  const H = frame.height * pixelRatio;
  const s = (pixelRatio / frame.unit) * frame.camera.zoom;
  const r = -frame.camera.rotation;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // p = T(W/2, H/2) * S(s, -s) * R(r) * T(-cx, -cy)
  const a = s * cos;
  const b = -s * sin;
  const c = -s * sin;
  const d = -s * cos;
  const cx = frame.camera.x;
  const cy = frame.camera.y;
  const e = W / 2 - (a * cx + c * cy);
  const f = H / 2 - (b * cx + d * cy);
  const short = Math.min(frame.width, frame.height) * pixelRatio;
  return { scale: s, strokeScale: short / 1080, matrix: [a, b, c, d, e, f], pixelWidth: W, pixelHeight: H, pixelRatio };
}

/**
 * Render a frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/sampler.js').Frame} frame
 * @param {{pixelRatio?: number, transparent?: boolean, assets?: Map<string, any>, drawCaptions?: boolean}} [opts]
 */
export function renderFrame(ctx, frame, opts = {}) {
  const view = viewFor(frame, opts.pixelRatio ?? 1);
  const theme = frame.theme;
  const board = theme.board ? BOARD_RENDERERS[theme.board] : null;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.pixelWidth, view.pixelHeight);
  if (!opts.transparent) {
    if (board) board.drawBackground(ctx, frame, view);
    else drawBackground(ctx, frame, view);
  }
  for (const item of frame.items) {
    if (item.kind === 'image') drawImageItem(ctx, item, view, opts.assets, frame);
    else if (board && !item.meta.noBoard) board.drawItem(ctx, item, frame, view);
    else drawPathItem(ctx, item, view, theme.effects.glow);
  }
  if (board && board.drawOverlay) board.drawOverlay(ctx, frame, view);
  if (!opts.transparent && theme.texture.grain > 0 && !board) drawGrain(ctx, view, theme.texture.grain, frame.seed);
  if (!opts.transparent && theme.effects.scanlines > 0) drawScanlines(ctx, view, theme.effects.scanlines);
  ctx.restore();
}

/**
 * Draw a path item with clean vector strokes.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/sampler.js').PathItem} item
 * @param {View} view
 */
export function drawPathItem(ctx, item, view, glow = 0) {
  const [a, b, c, d, e, f] = view.matrix;
  ctx.setTransform(a, b, c, d, e, f);
  if (glow > 0) {
    const col = item.stroke || item.fill;
    ctx.shadowColor = toCSS(col, 0.85);
    ctx.shadowBlur = glow * 14 * view.strokeScale;
  }
  ctx.beginPath();
  tracePath(ctx, item.path);
  if (item.fill) {
    ctx.fillStyle = toCSS(item.fill);
    ctx.fill(item.fillRule);
  }
  if (item.stroke && item.strokeWidth > 0) {
    ctx.lineWidth = (item.strokeWidth * view.strokeScale) / view.scale;
    ctx.lineCap = item.lineCap;
    ctx.lineJoin = item.lineJoin;
    ctx.miterLimit = 4;
    ctx.setLineDash(item.dash ? item.dash.map((v) => v) : []);
    ctx.strokeStyle = toCSS(item.stroke);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (glow > 0) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
  }
}

/**
 * Horizontal scanlines for the terminal look.
 * @param {CanvasRenderingContext2D} ctx
 * @param {View} view
 * @param {number} amount 0 to 1
 */
export function drawScanlines(ctx, view, amount) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(0,0,0,${Math.min(1, amount)})`;
  const step = Math.max(2, Math.round(3 * view.strokeScale));
  for (let y = 0; y < view.pixelHeight; y += step) ctx.fillRect(0, y, view.pixelWidth, Math.max(1, step / 2));
  ctx.restore();
}

/**
 * Draw the theme background (solid, gradient, grid, dots, paper).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/sampler.js').Frame} frame
 * @param {View} view
 */
export function drawBackground(ctx, frame, view) {
  const theme = frame.theme;
  const bg = theme.background;
  const W = view.pixelWidth;
  const H = view.pixelHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const base = parseColor(theme.colors.background);
  if (bg.kind === 'gradient') {
    const g = bg.radial ? ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H / 2, Math.hypot(W, H) * 0.6) : ctx.createLinearGradient(0, 0, 0, H);
    const stops = bg.stops ?? [[0, theme.colors.background], [1, theme.colors.surface]];
    for (const [o, col] of stops) g.addColorStop(o, toCSS(parseColor(theme.colors[col] ?? col)));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = toCSS(base);
  }
  ctx.fillRect(0, 0, W, H);
  if (bg.kind === 'grid' || bg.kind === 'dots') {
    const step = (bg.spacing ?? 0.5) * view.scale;
    const col = parseColor(theme.colors[bg.color ?? 'grid'] ?? bg.color);
    const [, , , , e, f] = view.matrix;
    const ox = ((e % step) + step) % step;
    const oy = ((f % step) + step) % step;
    if (bg.kind === 'grid') {
      ctx.strokeStyle = toCSS(col, bg.opacity ?? 0.5);
      ctx.lineWidth = Math.max(1, (bg.width ?? 1) * view.strokeScale);
      ctx.beginPath();
      for (let x = ox; x <= W; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
      }
      for (let y = oy; y <= H; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(W, Math.round(y) + 0.5);
      }
      ctx.stroke();
      if (bg.major) {
        const M = step * bg.major;
        const mx = ((e % M) + M) % M;
        const my = ((f % M) + M) % M;
        ctx.strokeStyle = toCSS(col, Math.min(1, (bg.opacity ?? 0.5) * 1.8));
        ctx.beginPath();
        for (let x = mx; x <= W; x += M) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, H);
        }
        for (let y = my; y <= H; y += M) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(W, Math.round(y) + 0.5);
        }
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = toCSS(col, bg.opacity ?? 0.7);
      const r = Math.max(1, 1.4 * view.strokeScale);
      for (let x = ox; x <= W; x += step) {
        for (let y = oy; y <= H; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  if (bg.vignette) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, toCSS(base, 0));
    g.addColorStop(1, toCSS(mix(base, '#000000', 0.5), bg.vignette));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

const grainCache = new Map();

/**
 * Overlay deterministic film grain.
 * @param {CanvasRenderingContext2D} ctx
 * @param {View} view
 * @param {number} amount 0 to 1
 * @param {number} seed
 */
export function drawGrain(ctx, view, amount, seed) {
  const size = 256;
  const key = `${seed}`;
  let tile = grainCache.get(key);
  if (!tile) {
    tile = createCanvas(size, size);
    const tctx = tile.getContext('2d');
    const img = tctx.createImageData(size, size);
    const rng = new Random(seed ^ 0x5eed);
    for (let i = 0; i < size * size; i++) {
      const v = Math.floor(rng.next() * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    grainCache.set(key, tile);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, amount) * 0.12;
  ctx.globalCompositeOperation = 'overlay';
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, view.pixelWidth, view.pixelHeight);
  ctx.restore();
}

const treated = new Map();

/**
 * Apply an image treatment that matches the image to the theme.
 * @param {any} img decoded image
 * @param {string} treatment 'tint' | 'duotone' | 'desaturate'
 * @param {import('../themes/tokens.js').Theme} theme
 * @returns {any} canvas
 */
export function treatImage(img, treatment, theme) {
  const key = img;
  let byKey = treated.get(key);
  if (!byKey) {
    byKey = new Map();
    treated.set(key, byKey);
  }
  const k2 = `${treatment}|${theme.colors.background}|${theme.colors.ink}|${theme.colors.accent}`;
  if (byKey.has(k2)) return byKey.get(k2);
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h);
  const dark = parseColor(theme.dark ? theme.colors.background : theme.colors.ink);
  const light = parseColor(theme.dark ? theme.colors.ink : theme.colors.background);
  const accent = parseColor(theme.colors.accent);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const L = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    let r;
    let g;
    let b;
    if (treatment === 'desaturate') {
      r = g = b = L;
    } else if (treatment === 'duotone') {
      r = dark.r + (light.r - dark.r) * L;
      g = dark.g + (light.g - dark.g) * L;
      b = dark.b + (light.b - dark.b) * L;
    } else {
      const m = 0.55;
      r = (px[i] / 255) * (1 - m) + accent.r * L * m;
      g = (px[i + 1] / 255) * (1 - m) + accent.g * L * m;
      b = (px[i + 2] / 255) * (1 - m) + accent.b * L * m;
    }
    px[i] = r * 255;
    px[i + 1] = g * 255;
    px[i + 2] = b * 255;
  }
  cx.putImageData(data, 0, 0);
  byKey.set(k2, c);
  return c;
}

/**
 * Draw an image item.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/sampler.js').ImageItem} item
 * @param {View} view
 * @param {Map<string, any>|undefined} assets
 * @param {import('../core/sampler.js').Frame} frame
 */
export function drawImageItem(ctx, item, view, assets, frame) {
  let src = item.source;
  if (typeof src === 'string' && assets && assets.has(src)) src = assets.get(src);
  if (src && src.decoded) src = src.decoded;
  if (src && typeof src.frameAt === 'function') src = src.frameAt(item.time);
  if (!src || typeof src === 'string') return;
  if (item.treatment && item.treatment !== 'none') src = treatImage(src, item.treatment, frame.theme);
  const [a, b, c, d, e, f] = view.matrix;
  ctx.setTransform(a, b, c, d, e, f);
  const m = item.matrix;
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.scale(1, -1);
  ctx.globalAlpha = item.opacity;
  const w = item.width;
  const h = item.height;
  if (item.fit === 'cover' && src.width && src.height) {
    const ar = src.width / src.height;
    const tr = w / h;
    let sw = src.width;
    let sh = src.height;
    if (ar > tr) sw = sh * tr;
    else sh = sw / tr;
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
  }
  ctx.globalAlpha = 1;
}
