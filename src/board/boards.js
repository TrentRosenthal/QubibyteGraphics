/**
 * Board renderers for Canvas2D: chalkboard, whiteboard, paper, and
 * blueprint. Each turns path items into hand-drawn marks in its medium.
 * @module board/boards
 */

import { handStrokes, hatchPath, pathArea } from './hand.js';
import { grainMask, surface } from './textures.js';
import { createCanvas } from '../core/platform.js';
import { toCSS, parseColor, mix } from '../core/color.js';
import { tracePath } from '../core/path.js';
import { Random } from '../core/random.js';
import { registerBoard } from '../render/canvas.js';

/** Hand styles per medium, in world units. */
export const HAND_STYLES = {
  chalk: { wobble: 0.028, wobbleScale: 1.6, bow: 0.018, overshoot: 0.08, endJitter: 0.035, pressure: 0.3, taper: 0.1, taperLength: 0.1 },
  marker: { wobble: 0.022, wobbleScale: 1.7, bow: 0.015, overshoot: 0.07, endJitter: 0.03, pressure: 0.08, taper: 0.08, taperLength: 0.08 },
  pencil: { wobble: 0.009, wobbleScale: 1.2, bow: 0.006, overshoot: 0.05, endJitter: 0.015, pressure: 0.3, taper: 0.45, taperLength: 0.2 },
  ballpoint: { wobble: 0.007, wobbleScale: 1.2, bow: 0.005, overshoot: 0.05, endJitter: 0.012, pressure: 0.25, taper: 0.4, taperLength: 0.15 },
  fountain: { wobble: 0.006, wobbleScale: 1.3, bow: 0.005, overshoot: 0.04, endJitter: 0.01, pressure: 0.2, taper: 0.3, taperLength: 0.12 },
  highlighter: { wobble: 0.006, wobbleScale: 2, bow: 0.004, overshoot: 0, endJitter: 0.03, pressure: 0.03, taper: 0, taperLength: 0.1 },
  drafting: { wobble: 0.003, wobbleScale: 2.2, bow: 0.002, overshoot: 0, endJitter: 0, pressure: 0.06, taper: 0, taperLength: 0.1 },
};

const states = new WeakMap();

function state(ctx, view) {
  let s = states.get(ctx);
  if (!s || s.w !== view.pixelWidth || s.h !== view.pixelHeight) {
    const layer = createCanvas(view.pixelWidth, view.pixelHeight);
    // Writing goes on its own layer so the band it wipes under itself never clips neighboring letters.
    const wlayer = createCanvas(view.pixelWidth, view.pixelHeight);
    s = { w: view.pixelWidth, h: view.pixelHeight, layer, lctx: layer.getContext('2d'), wlayer, wctx: wlayer.getContext('2d'), wrote: false, ink: 0, tip: null };
    states.set(ctx, s);
  }
  return s;
}

function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function toPx(view, x, y) {
  const [a, b, c, d, e, f] = view.matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * Fill a variable-width ribbon along points (pixel space) with round caps.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number, w: number}>} pts
 * @param {number} width pixels
 * @param {{widthFn?: (p: any, i: number, dx: number, dy: number) => number, caps?: boolean}} [o]
 */
export function drawRibbon(ctx, pts, width, o = {}) {
  if (!pts.length) return;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (width * pts[0].w) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const left = [];
  const right = [];
  const n = pts.length;
  const widths = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(n - 1, i + 1)];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const w = (o.widthFn ? o.widthFn(pts[i], i, dx, dy) : width * pts[i].w) / 2;
    widths.push(w);
    left.push([pts[i].x - dy * w, pts[i].y + dx * w]);
    right.push([pts[i].x + dy * w, pts[i].y - dx * w]);
  }
  // Body polygon, then round caps as full circles wound the same way as the
  // body, so overlapping caps on short strokes never cancel under nonzero fill.
  let area = 0;
  const poly = left.concat(right.slice().reverse());
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    area += x0 * y1 - x1 * y0;
  }
  const ccw = area < 0;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  if (o.caps !== false) {
    for (const i of [0, n - 1]) {
      ctx.moveTo(pts[i].x + widths[i], pts[i].y);
      ctx.arc(pts[i].x, pts[i].y, widths[i], 0, Math.PI * 2, ccw);
      ctx.closePath();
    }
  }
  ctx.fill('nonzero');
}

function strokesPx(view, strokes) {
  return strokes.map((s) => ({ pts: s.pts.map((p) => {
    const [x, y] = toPx(view, p.x, p.y);
    return { x, y, w: p.w, s: p.s };
  }), closed: s.closed }));
}

function fillPathPx(ctx, view, path) {
  const [a, b, c, d, e, f] = view.matrix;
  ctx.save();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.beginPath();
  tracePath(ctx, path);
  ctx.restore();
  ctx.fill('nonzero');
}

function strokeLength(strokes) {
  let L = 0;
  for (const s of strokes) if (s.pts.length) L += s.pts[s.pts.length - 1].s;
  return L;
}

function isGlyphLike(item) {
  return item.meta.glyph || item.nodeType === 'glyph' || item.nodeType === 'texGlyph';
}

/**
 * Decide how a filled item is rendered: 'solid' for small shapes and glyphs,
 * 'hatch' for large regions.
 */
function fillMode(item) {
  if (item.meta.solidFill || isGlyphLike(item)) return 'solid';
  if (item.meta.hatch) return 'hatch';
  return pathArea(item.path) > 0.45 ? 'hatch' : 'solid';
}

function drawCursor(ctx, s, view, kind) {
  if (!s.tip) return;
  const [x, y] = s.tip;
  const k = view.strokeScale;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, x, y);
  ctx.rotate(-0.6);
  if (kind === 'chalk') {
    ctx.fillStyle = 'rgba(244,242,232,0.95)';
    ctx.fillRect(0, -6 * k, 70 * k, 12 * k);
  } else {
    ctx.fillStyle = 'rgba(30,34,40,0.92)';
    ctx.fillRect(10 * k, -9 * k, 110 * k, 18 * k);
    ctx.fillStyle = 'rgba(30,34,40,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12 * k, -7 * k);
    ctx.lineTo(12 * k, 7 * k);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function trackTip(s, item, strokesP) {
  if (item.draw > 0 && item.draw < 1 && strokesP.length) {
    const last = strokesP[strokesP.length - 1].pts;
    const p = last[last.length - 1];
    if (p) s.tip = [p.x, p.y];
  }
}

function cameraOffset(view, tile) {
  const e = view.matrix[4];
  const f = view.matrix[5];
  return [((e % tile.width) + tile.width) % tile.width, ((f % tile.height) + tile.height) % tile.height];
}

/**
 * Mask a board's texture layer with its grain and composite it onto ctx.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} frame
 * @param {any} view
 * @param {'chalk'|'pencil'} medium
 * @param {string} [composite]
 */
function flushLayer(ctx, frame, view, medium, composite = 'source-over') {
  const s = state(ctx, view);
  if (s.wrote) {
    s.lctx.save();
    s.lctx.setTransform(1, 0, 0, 1, 0, 0);
    s.lctx.drawImage(s.wlayer, 0, 0);
    s.lctx.restore();
    s.wctx.setTransform(1, 0, 0, 1, 0, 0);
    s.wctx.clearRect(0, 0, s.w, s.h);
    s.wrote = false;
  }
  const mask = grainMask(medium, frame.seed, view.strokeScale);
  const [ox, oy] = cameraOffset(view, mask);
  s.lctx.save();
  s.lctx.setTransform(1, 0, 0, 1, ox, oy);
  s.lctx.globalCompositeOperation = 'destination-in';
  s.lctx.fillStyle = s.lctx.createPattern(mask, 'repeat');
  s.lctx.fillRect(-ox, -oy, s.w, s.h);
  s.lctx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = composite;
  ctx.drawImage(s.layer, 0, 0);
  ctx.restore();
  s.lctx.setTransform(1, 0, 0, 1, 0, 0);
  s.lctx.clearRect(0, 0, s.w, s.h);
}

// Chalkboard

/**
 * Deposit chalk along a stroke: a translucent body plus particles scattered
 * across the width, denser at the center, so the edge is broken and grainy.
 * Particles are seeded by arc-length index so a partial stroke is a prefix.
 */
function chalkStroke(ctx, pts, w, color, seed) {
  if (pts.length < 2) return;
  ctx.fillStyle = toCSS(color, 0.5);
  drawRibbon(ctx, pts, w * 0.82);
  const rgb = `${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)}`;
  const step = 0.7;
  let acc = 0;
  let idx = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L === 0) continue;
    const nx = -dy / L;
    const ny = dx / L;
    let t = (step - acc) / L;
    while (t <= 1) {
      const rng = new Random(seed * 7919 + idx);
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      const width = w * (a.w + (b.w - a.w) * t);
      for (let k = 0; k < 3; k++) {
        const g = (rng.next() + rng.next() + rng.next() - 1.5) / 1.5;
        const off = g * width * 0.62;
        const size = (0.7 + rng.next() * 1.3) * Math.max(1, width / 7);
        const alpha = (0.35 + 0.6 * rng.next()) * (1 - 0.55 * Math.abs(g));
        ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
        ctx.fillRect(x + nx * off - size / 2, y + ny * off - size / 2, size, size);
      }
      idx++;
      t += step / L;
    }
    acc = (acc + L) % step;
  }
}


const chalkboard = {
  drawBackground(ctx, frame, view) {
    const s = state(ctx, view);
    s.lctx.setTransform(1, 0, 0, 1, 0, 0);
    s.lctx.clearRect(0, 0, s.w, s.h);
    s.ink = 0;
    s.tip = null;
    const bg = surface('chalkboard', view.pixelWidth, view.pixelHeight, frame.seed, frame.theme.colors.background, frame.theme.boardOptions);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
  },

  drawItem(ctx, item, frame, view) {
    const s = state(ctx, view);
    const lctx = s.lctx;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    const px = view.strokeScale;
    if (item.fill) {
      const mode = fillMode(item);
      if (mode === 'solid') {
        lctx.fillStyle = toCSS(item.fill, 0.94);
        fillPathPx(lctx, view, item.path);
      } else {
        lctx.fillStyle = toCSS(item.fill, 0.42);
        fillPathPx(lctx, view, item.path);
        const hatch = hatchPath(item.path, 0.16, Math.PI / 3.2, item.seed);
        const hs = strokesPx(view, handStrokes(hatch, item.seed + 1, { ...HAND_STYLES.chalk, overshoot: 0, wobble: 0.012 }));
        hs.forEach((st, k) => chalkStroke(lctx, st.pts, 3.2 * px, item.fill, item.seed * 17 + k));
      }
    }
    if (item.stroke) {
      const hs = strokesPx(view, handStrokes(item.path, item.seed, HAND_STYLES.chalk));
      const w = Math.max(3.5, item.strokeWidth * 1.25) * px;
      const writing = !!(item.meta && item.meta.handwriting);
      if (writing) {
        // Wipe a narrow band of earlier chalk (hatching, washes) under writing so labels stay legible.
        lctx.globalCompositeOperation = 'destination-out';
        lctx.fillStyle = 'rgba(0,0,0,0.9)';
        for (const st of hs) drawRibbon(lctx, st.pts, w * 3.4);
        lctx.globalCompositeOperation = 'source-over';
        s.wrote = true;
      }
      const target = writing ? s.wctx : lctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = toCSS(item.stroke, 0.03);
      for (const st of hs) drawRibbon(ctx, st.pts, w * 2);
      hs.forEach((st, k) => chalkStroke(target, st.pts, w, item.stroke, item.seed * 131 + k));
      s.ink += strokeLength(hs.map((st) => ({ pts: st.pts })));
      trackTip(s, item, hs);
    }
  },

  drawOverlay(ctx, frame, view) {
    const s = state(ctx, view);
    const ink = s.ink;
    flushLayer(ctx, frame, view, 'chalk');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTrayDust(ctx, frame, view, ink);
    if (frame.theme.boardOptions.cursor) drawCursor(ctx, s, view, 'chalk');
    ctx.restore();
  },

  drawItemTo(c, item, frame, view) {
    this.drawItem(c, item, frame, view);
    flushLayer(c, frame, view, 'chalk');
  },
};

function drawTrayDust(ctx, frame, view, ink) {
  const px = view.strokeScale;
  const ledge = Math.round(14 * px);
  const count = Math.min(900, Math.floor(ink * 5));
  if (count <= 0) return;
  const rng = new Random(frame.seed + 77);
  const ink0 = parseColor(frame.theme.colors.ink);
  for (let i = 0; i < count; i++) {
    const x = rng.next() * view.pixelWidth;
    const y = view.pixelHeight - ledge - rng.next() ** 3 * 10 * px + 1.5 * px;
    const r = (0.6 + rng.next() * 1.6) * px;
    ctx.fillStyle = toCSS(ink0, 0.08 + rng.next() * 0.18);
    ctx.fillRect(x, y, r, r);
  }
}

// Whiteboard

const whiteboard = {
  drawBackground(ctx, frame, view) {
    const s = state(ctx, view);
    s.tip = null;
    const bg = surface('whiteboard', view.pixelWidth, view.pixelHeight, frame.seed, frame.theme.colors.background, frame.theme.boardOptions);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
  },

  drawItem(ctx, item, frame, view) {
    const s = state(ctx, view);
    const px = view.strokeScale;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    if (item.fill) {
      if (fillMode(item) === 'solid') {
        ctx.fillStyle = toCSS(item.fill, 0.9);
        fillPathPx(ctx, view, item.path);
      } else {
        ctx.fillStyle = toCSS(item.fill, 0.12);
        fillPathPx(ctx, view, item.path);
        const hatch = hatchPath(item.path, 0.11, Math.PI / 4, item.seed);
        const hs = strokesPx(view, handStrokes(hatch, item.seed + 1, { ...HAND_STYLES.marker, overshoot: 0 }));
        ctx.fillStyle = toCSS(item.fill, 0.55);
        for (const st of hs) drawRibbon(ctx, st.pts, 4 * px);
      }
    }
    if (item.stroke) {
      const hs = strokesPx(view, handStrokes(item.path, item.seed, HAND_STYLES.marker));
      const w = Math.max(3, item.strokeWidth * 1.15) * px;
      if (item.meta && item.meta.handwriting) {
        // Clean board under writing: a band of the surface color covers hatching behind labels.
        ctx.fillStyle = toCSS(parseColor(frame.theme.colors.background), 0.75);
        for (const st of hs) drawRibbon(ctx, st.pts, w * 2.4);
      }
      ctx.fillStyle = toCSS(item.stroke, 0.16);
      for (const st of hs) drawRibbon(ctx, st.pts, w * 1.35);
      ctx.fillStyle = toCSS(item.stroke, 0.82);
      for (const st of hs) drawRibbon(ctx, st.pts, w);
      trackTip(s, item, hs);
    }
    ctx.restore();
  },

  drawOverlay(ctx, frame, view) {
    const s = state(ctx, view);
    if (frame.theme.boardOptions.cursor) drawCursor(ctx, s, view, 'marker');
  },

  drawItemTo(c, item, frame, view) {
    this.drawItem(c, item, frame, view);
  },

  composite: 'multiply',
};

// Paper

function paperTool(item, frame) {
  if (item.meta.highlight) return 'highlighter';
  return item.meta.tool ?? frame.theme.boardOptions.tool ?? 'ballpoint';
}

const paper = {
  drawBackground(ctx, frame, view) {
    const s = state(ctx, view);
    s.lctx.setTransform(1, 0, 0, 1, 0, 0);
    s.lctx.clearRect(0, 0, s.w, s.h);
    s.tip = null;
    const theme = frame.theme;
    const bg = surface('paper', view.pixelWidth, view.pixelHeight, frame.seed, theme.colors.background, theme.boardOptions);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    drawRuling(ctx, frame, view);
  },

  drawItem(ctx, item, frame, view) {
    const s = state(ctx, view);
    const tool = paperTool(item, frame);
    const px = view.strokeScale;
    const target = tool === 'pencil' ? s.lctx : ctx;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    if (tool === 'highlighter') {
      target.globalCompositeOperation = 'multiply';
      const col = item.fill ?? item.stroke;
      const hl = mix(col, frame.theme.colors.accent2, 0.7);
      target.fillStyle = toCSS(hl, 0.42);
      const b = item.path;
      const hs = strokesPx(view, handStrokes(b, item.seed, HAND_STYLES.highlighter));
      if (item.fill) fillPathPx(target, view, item.path);
      else for (const st of hs) drawRibbon(target, st.pts, 18 * px, { caps: false });
      target.restore();
      return;
    }
    const inkColor = (c) => (tool === 'pencil' ? mix(c, '#4a4a4c', 0.55) : c);
    if (item.fill) {
      const col = inkColor(item.fill);
      if (fillMode(item) === 'solid') {
        target.fillStyle = toCSS(col, tool === 'pencil' ? 0.85 : 0.95);
        fillPathPx(target, view, item.path);
      } else {
        const hatch = hatchPath(item.path, tool === 'pencil' ? 0.05 : 0.08, Math.PI / 4, item.seed);
        const hs = strokesPx(view, handStrokes(hatch, item.seed + 1, { ...HAND_STYLES[tool === 'fountain' ? 'fountain' : tool], overshoot: 0 }));
        target.fillStyle = toCSS(col, 0.7);
        for (const st of hs) drawRibbon(target, st.pts, 1.6 * px);
      }
    }
    if (item.stroke) {
      const style = HAND_STYLES[tool] ?? HAND_STYLES.ballpoint;
      const hs = strokesPx(view, handStrokes(item.path, item.seed, style));
      const col = inkColor(item.stroke);
      const base = Math.max(2, item.strokeWidth * (tool === 'ballpoint' ? 0.7 : tool === 'pencil' ? 0.8 : 1)) * px;
      target.fillStyle = toCSS(col, tool === 'pencil' ? 0.9 : 0.93);
      if (tool === 'fountain') {
        const nib = -Math.PI / 4;
        for (const st of hs) {
          drawRibbon(target, st.pts, base, { widthFn: (p, i, dx, dy) => base * p.w * (0.35 + 1.1 * Math.abs(Math.sin(Math.atan2(dy, dx) - nib))) });
        }
      } else {
        for (const st of hs) drawRibbon(target, st.pts, base);
      }
      trackTip(s, item, hs);
    }
    target.restore();
  },

  drawOverlay(ctx, frame, view) {
    const s = state(ctx, view);
    flushLayer(ctx, frame, view, 'pencil', 'multiply');
    if (frame.theme.boardOptions.cursor) drawCursor(ctx, s, view, 'marker');
  },

  drawItemTo(c, item, frame, view) {
    this.drawItem(c, item, frame, view);
    flushLayer(c, frame, view, 'pencil');
  },

  composite: 'multiply',
};

/**
 * Draw paper ruling (ruled, graph, dots, blank) tied to the camera so page
 * scrolls move the lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/sampler.js').Frame} frame
 * @param {import('../render/canvas.js').View} view
 */
export function drawRuling(ctx, frame, view) {
  const theme = frame.theme;
  const ruling = theme.boardOptions.ruling ?? 'ruled';
  if (ruling === 'blank') return;
  const W = view.pixelWidth;
  const H = view.pixelHeight;
  const px = view.strokeScale;
  const line = parseColor(theme.colors.grid);
  const [, , , , e, f] = view.matrix;
  const spacing = (ruling === 'ruled' ? 0.5 : 0.25) * view.scale;
  const oy = ((f % spacing) + spacing) % spacing;
  const ox = ((e % spacing) + spacing) % spacing;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (ruling === 'ruled') {
    ctx.strokeStyle = toCSS(line, 0.9);
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    for (let y = oy + spacing; y < H; y += spacing) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
    }
    ctx.stroke();
    const mx = toPx(view, -(frame.width * frame.unit) / 2 + 1.2, 0)[0];
    ctx.strokeStyle = toCSS(mix(theme.colors.negative, theme.colors.background, 0.45), 0.8);
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, H);
    ctx.stroke();
  } else if (ruling === 'graph') {
    for (const [step, alpha, lw] of [[spacing, 0.55, 1], [spacing * 4, 0.9, 1.4]]) {
      const sx = ((e % step) + step) % step;
      const sy = ((f % step) + step) % step;
      ctx.strokeStyle = toCSS(line, alpha);
      ctx.lineWidth = lw * px;
      ctx.beginPath();
      for (let x = sx; x < W; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
      }
      for (let y = sy; y < H; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(W, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }
  } else if (ruling === 'dots') {
    ctx.fillStyle = toCSS(mix(line, theme.colors.ink, 0.3), 0.8);
    const r = 1.6 * px;
    for (let x = ox; x < W; x += spacing) for (let y = oy; y < H; y += spacing) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.restore();
}

// Blueprint

function cornerSplit(strokes) {
  // Split drafting strokes at sharp corners and let each piece overshoot, like construction lines.
  const out = [];
  for (const st of strokes) {
    const pts = st.pts;
    let start = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      const b = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
      let d = Math.abs(b - a);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 0.6) {
        out.push(pts.slice(start, i + 1));
        start = i;
      }
    }
    out.push(pts.slice(start));
  }
  return out.filter((p) => p.length >= 2);
}

function extendPx(pts, amount) {
  const out = pts.map((p) => ({ ...p }));
  const n = out.length;
  const ext = (i, j) => {
    const dx = out[i].x - out[j].x;
    const dy = out[i].y - out[j].y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    out[i].x += (dx / L) * amount;
    out[i].y += (dy / L) * amount;
  };
  ext(0, 1);
  ext(n - 1, n - 2);
  return out;
}

const blueprint = {
  drawBackground(ctx, frame, view) {
    const s = state(ctx, view);
    s.tip = null;
    const theme = frame.theme;
    const bg = surface('blueprint', view.pixelWidth, view.pixelHeight, frame.seed, theme.colors.background, theme.boardOptions);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    const W = view.pixelWidth;
    const H = view.pixelHeight;
    const px = view.strokeScale;
    const [, , , , e, f] = view.matrix;
    const grid = parseColor(theme.colors.grid);
    for (const [stepW, alpha, lw] of [[0.25, 0.28, 1], [1, 0.5, 1.3]]) {
      const step = stepW * view.scale;
      const sx = ((e % step) + step) % step;
      const sy = ((f % step) + step) % step;
      ctx.strokeStyle = toCSS(grid, alpha);
      ctx.lineWidth = lw * px;
      ctx.beginPath();
      for (let x = sx; x < W; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
      }
      for (let y = sy; y < H; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(W, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }
  },

  drawItem(ctx, item, frame, view) {
    const s = state(ctx, view);
    const px = view.strokeScale;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (item.fill) {
      if (fillMode(item) === 'solid') {
        ctx.fillStyle = toCSS(item.fill, 0.92);
        fillPathPx(ctx, view, item.path);
      } else {
        ctx.fillStyle = toCSS(item.fill, 0.1);
        fillPathPx(ctx, view, item.path);
        const hatch = hatchPath(item.path, 0.09, Math.PI / 4, item.seed);
        const hs = strokesPx(view, handStrokes(hatch, item.seed + 1, HAND_STYLES.drafting));
        ctx.fillStyle = toCSS(item.fill, 0.7);
        for (const st of hs) drawRibbon(ctx, st.pts, 1.3 * px);
      }
    }
    if (item.stroke) {
      const hs = strokesPx(view, handStrokes(item.path, item.seed, HAND_STYLES.drafting));
      const w = Math.max(1.6, item.strokeWidth * 0.75) * px;
      // Lettering keeps its strokes as written; only construction lines overshoot their corners.
      const pieces = item.meta.noOvershoot || item.meta.handwriting ? hs.map((h) => h.pts) : cornerSplit(hs).map((p) => extendPx(p, 7 * px));
      ctx.fillStyle = toCSS(item.stroke, 0.12);
      for (const p of pieces) drawRibbon(ctx, p, w * 2.4);
      ctx.fillStyle = toCSS(item.stroke, 0.94);
      // Flat ends suit ruled lines; a stroke only a few pen widths long is a dot, drawn as one.
      for (const p of pieces) {
        if (polyLength(p) < w * 6) {
          const c = p[Math.floor(p.length / 2)];
          ctx.beginPath();
          ctx.arc(c.x, c.y, w * 1.05, 0, Math.PI * 2);
          ctx.fill();
        } else drawRibbon(ctx, p, w, { caps: false });
      }
      trackTip(s, item, hs);
    }
    ctx.restore();
  },

  drawOverlay(ctx, frame, view) {
    const s = state(ctx, view);
    if (frame.theme.boardOptions.cursor) drawCursor(ctx, s, view, 'marker');
  },

  drawItemTo(c, item, frame, view) {
    this.drawItem(c, item, frame, view);
  },
};

registerBoard('chalkboard', chalkboard);
registerBoard('whiteboard', whiteboard);
registerBoard('paper', paper);
registerBoard('blueprint', blueprint);
