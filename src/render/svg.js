/**
 * SVG renderer. Emits the same geometry as the Canvas2D backend as vector
 * paths, so stills and frame sequences export as resolution-independent SVG.
 * @module render/svg
 */

import { toSVGPath } from '../core/path.js';
import { toHex } from '../core/color.js';
import { viewFor } from './canvas.js';

/**
 * Registered SVG board renderers: id -> {background(frame, view) => string, item(item, frame, view) => string}.
 * @type {Record<string, {background: Function, item: Function}>}
 */
export const SVG_BOARDS = {};

/**
 * @param {string} id
 * @param {{background: Function, item: Function}} r
 */
export function registerSVGBoard(id, r) {
  SVG_BOARDS[id] = r;
}

function attrColor(c, name) {
  if (!c) return ` ${name}="none"`;
  const hex = toHex({ ...c, a: 1 });
  return c.a < 1 ? ` ${name}="${hex}" ${name}-opacity="${+c.a.toFixed(4)}"` : ` ${name}="${hex}"`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * SVG element for one path item in pixel space.
 * @param {import('../core/sampler.js').PathItem} item
 * @param {import('./canvas.js').View} view
 * @returns {string}
 */
export function svgPathElement(item, view) {
  const d = toSVGPath(item.path, 4);
  let s = `<path d="${d}"`;
  s += attrColor(item.fill, 'fill');
  if (item.fill && item.fillRule === 'evenodd') s += ' fill-rule="evenodd"';
  if (item.stroke && item.strokeWidth > 0) {
    s += attrColor(item.stroke, 'stroke');
    s += ` stroke-width="${+((item.strokeWidth * view.strokeScale) / view.scale).toFixed(5)}" stroke-linecap="${item.lineCap}" stroke-linejoin="${item.lineJoin}"`;
    if (item.dash) s += ` stroke-dasharray="${item.dash.join(' ')}"`;
  }
  return s + ' vector-effect="none"/>';
}

/**
 * Render a frame to an SVG document string.
 * @param {import('../core/sampler.js').Frame} frame
 * @param {{transparent?: boolean, assets?: Map<string, any>, imageHref?: (item: any) => string|null}} [opts]
 * @returns {string}
 */
export function renderSVG(frame, opts = {}) {
  const view = viewFor(frame, 1);
  const theme = frame.theme;
  const board = theme.board ? SVG_BOARDS[theme.board] : null;
  const [a, b, c, d, e, f] = view.matrix;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">`);
  if (!opts.transparent) {
    if (board) parts.push(board.background(frame, view));
    else parts.push(`<rect width="100%" height="100%" fill="${esc(toHex({ ...hexOf(theme.colors.background), a: 1 }))}"/>`);
  }
  parts.push(`<g transform="matrix(${[a, b, c, d, e, f].map((v) => +v.toFixed(6)).join(' ')})">`);
  for (const item of frame.items) {
    if (item.kind === 'image') {
      const href = opts.imageHref ? opts.imageHref(item) : null;
      if (!href) continue;
      const m = item.matrix;
      parts.push(`<g transform="matrix(${m.map((v) => +v.toFixed(6)).join(' ')}) scale(1 -1)" opacity="${+item.opacity.toFixed(4)}"><image href="${esc(href)}" x="${-item.width / 2}" y="${-item.height / 2}" width="${item.width}" height="${item.height}" preserveAspectRatio="none"/></g>`);
    } else if (board && !item.meta.noBoard) {
      parts.push(board.item(item, frame, view));
    } else {
      parts.push(svgPathElement(item, view));
    }
  }
  parts.push('</g></svg>');
  return parts.join('');
}

function hexOf(c) {
  const m = /^#([0-9a-f]{6})/i.exec(c);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}
