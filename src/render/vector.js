/**
 * Vector operations in pixel space for vector exporters (PDF, Lottie,
 * animated SVG). Clean themes pass paths through; board themes turn strokes
 * into hand-drawn ribbons (filled polygons) so the output stays vector.
 * Pixel space: origin top-left, y down, units are output pixels.
 * @module render/vector
 */

import { viewFor } from './canvas.js';
import { transformPath, polyPath } from '../core/path.js';
import { handStrokes, hatchPath, pathArea } from '../board/hand.js';
import { HAND_STYLES } from '../board/boards.js';
import { parseColor } from '../core/color.js';

/**
 * @typedef {Object} VectorPath
 * @property {'path'} kind
 * @property {string} id
 * @property {import('../core/path.js').Path} path pixel space
 * @property {import('../core/color.js').RGBA|null} fill
 * @property {import('../core/color.js').RGBA|null} stroke
 * @property {number} width stroke width in pixels
 * @property {string} cap
 * @property {string} join
 * @property {number[]|null} dash pixels
 * @property {'nonzero'|'evenodd'} fillRule
 */

/**
 * @typedef {Object} VectorImage
 * @property {'image'} kind
 * @property {string} id
 * @property {number[]} matrix maps the unit image square (0..1, y down) to pixels
 * @property {any} source
 * @property {number} opacity
 */

/**
 * Convert a frame to pixel-space vector operations.
 * @param {import('../core/sampler.js').Frame} frame
 * @returns {{width: number, height: number, background: import('../core/color.js').RGBA, ops: Array<VectorPath|VectorImage>, rasterized: string[]}}
 */
export function frameToVector(frame) {
  const view = viewFor(frame, 1);
  const M = view.matrix;
  const theme = frame.theme;
  const board = theme.board;
  const medium = board === 'chalkboard' ? 'chalk' : board === 'whiteboard' ? 'marker' : board === 'blueprint' ? 'drafting' : board === 'paper' ? theme.boardOptions.tool ?? 'ballpoint' : null;
  const ops = [];
  const rasterized = [];
  if (board) rasterized.push(`${board} surface texture and grain (vector output uses flat color and hand-drawn geometry)`);
  for (const item of frame.items) {
    if (item.kind === 'image') {
      const m = item.matrix;
      const w = item.width;
      const h = item.height;
      // Unit square (0..1 with y down) to the image's local frame (centered, y up), then to world, then to pixels.
      const local = [w, 0, 0, -h, -w / 2, h / 2];
      ops.push({ kind: 'image', id: item.id, matrix: mul(M, mul(m, local)), source: item.source, opacity: item.opacity, treatment: item.treatment });
      continue;
    }
    const scale = view.strokeScale;
    if (!medium || item.meta.noBoard) {
      ops.push({
        kind: 'path',
        id: item.id,
        path: transformPath(item.path, M),
        fill: item.fill,
        stroke: item.stroke,
        width: item.strokeWidth * scale,
        cap: item.lineCap,
        join: item.lineJoin,
        dash: item.dash ? item.dash.map((d) => d * view.scale) : null,
        fillRule: item.fillRule,
      });
      continue;
    }
    const style = HAND_STYLES[medium] ?? HAND_STYLES.marker;
    if (item.fill) {
      const big = !(item.meta.solidFill || item.meta.glyph) && pathArea(item.path) > 0.45;
      if (!big) ops.push(fillOp(item.id, transformPath(item.path, M), item.fill));
      else {
        ops.push(fillOp(item.id, transformPath(item.path, M), { ...item.fill, a: item.fill.a * 0.18 }));
        for (const st of handStrokes(hatchPath(item.path, 0.1, Math.PI / 4, item.seed), item.seed + 1, { ...style, overshoot: 0 })) {
          ops.push(fillOp(item.id, ribbon(st.pts, 2.4 * scale, M), { ...item.fill, a: item.fill.a * 0.8 }));
        }
      }
    }
    if (item.stroke) {
      const w = Math.max(3, item.strokeWidth * (medium === 'chalk' ? 1.25 : 1.1)) * scale;
      for (const st of handStrokes(item.path, item.seed, style)) ops.push(fillOp(item.id, ribbon(st.pts, w, M), { ...item.stroke, a: item.stroke.a * 0.94 }));
    }
  }
  return { width: frame.width, height: frame.height, background: parseColor(theme.colors.background), ops, rasterized };
}

function fillOp(id, path, fill) {
  return { kind: 'path', id, path, fill, stroke: null, width: 0, cap: 'round', join: 'round', dash: null, fillRule: 'nonzero' };
}

function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Variable-width ribbon around hand-stroke points, as a closed pixel path.
 * @param {Array<{x: number, y: number, w: number}>} pts world points with width factors
 * @param {number} width pixels
 * @param {number[]} M world to pixel matrix
 * @returns {import('../core/path.js').Path}
 */
export function ribbon(pts, width, M) {
  const P = pts.map((p) => ({ x: M[0] * p.x + M[2] * p.y + M[4], y: M[1] * p.x + M[3] * p.y + M[5], w: p.w }));
  if (P.length < 2) {
    if (!P.length) return { subpaths: [] };
    const r = (width * P[0].w) / 2;
    return polyPath([[P[0].x - r, P[0].y - r], [P[0].x + r, P[0].y - r], [P[0].x + r, P[0].y + r], [P[0].x - r, P[0].y + r]], true);
  }
  const L = [];
  const R = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(P.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    const w = (width * P[i].w) / 2;
    L.push([P[i].x - dy * w, P[i].y + dx * w]);
    R.push([P[i].x + dy * w, P[i].y - dx * w]);
  }
  return polyPath(L.concat(R.reverse()), true);
}
