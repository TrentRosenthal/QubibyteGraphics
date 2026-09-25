/**
 * SVG versions of the board styles. Geometry uses the same hand-drawn
 * perturbation as Canvas2D; media textures become SVG filters so the output
 * stays vector.
 * @module board/svg
 */

import { handStrokes, hatchPath, pathArea } from './hand.js';
import { HAND_STYLES } from './boards.js';
import { registerSVGBoard } from '../render/svg.js';
import { toHex, parseColor } from '../core/color.js';
import { toSVGPath } from '../core/path.js';

function ribbonD(pts, width, view) {
  const [a, b, c, d, e, f] = view.matrix;
  const P = pts.map((p) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f, w: p.w }));
  if (P.length < 2) return '';
  const L = [];
  const R = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[Math.max(0, i - 1)];
    const q = P[Math.min(P.length - 1, i + 1)];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    const w = (width * P[i].w) / 2;
    L.push(`${(P[i].x - dy * w).toFixed(2)} ${(P[i].y + dx * w).toFixed(2)}`);
    R.push(`${(P[i].x + dy * w).toFixed(2)} ${(P[i].y - dx * w).toFixed(2)}`);
  }
  return `M${L.join('L')}L${R.reverse().join('L')}Z`;
}

function fillAttr(c, alpha = 1) {
  const a = c.a * alpha;
  return `fill="${toHex({ ...c, a: 1 })}"${a < 1 ? ` fill-opacity="${a.toFixed(3)}"` : ''}`;
}

function pathItemSVG(item, view, medium, filterId) {
  const px = view.strokeScale;
  const style = HAND_STYLES[medium];
  const parts = [];
  if (item.fill) {
    const big = !(item.meta.solidFill || item.meta.glyph) && pathArea(item.path) > 0.45;
    if (!big) parts.push(`<path d="${worldToPixelD(item.path, view)}" ${fillAttr(item.fill, 0.93)}/>`);
    else {
      parts.push(`<path d="${worldToPixelD(item.path, view)}" ${fillAttr(item.fill, 0.18)}/>`);
      const hs = handStrokes(hatchPath(item.path, 0.1, Math.PI / 4, item.seed), item.seed + 1, { ...style, overshoot: 0 });
      for (const st of hs) parts.push(`<path d="${ribbonD(st.pts, 2.4 * px, view)}" ${fillAttr(item.fill, 0.8)}/>`);
    }
  }
  if (item.stroke) {
    const hs = handStrokes(item.path, item.seed, style);
    const w = Math.max(3, item.strokeWidth * (medium === 'chalk' ? 1.25 : 1.1)) * px;
    for (const st of hs) parts.push(`<path d="${ribbonD(st.pts, w, view)}" ${fillAttr(item.stroke, 0.94)}/>`);
  }
  return `<g${filterId ? ` filter="url(#${filterId})"` : ''}>${parts.join('')}</g>`;
}

function worldToPixelD(path, view) {
  const [a, b, c, d, e, f] = view.matrix;
  return toSVGPath({ subpaths: path.subpaths.map((s) => ({ closed: s.closed, points: s.points.map((v, i, arr) => (i % 2 === 0 ? a * v + c * arr[i + 1] + e : b * arr[i - 1] + d * v + f)) })) }, 2);
}

function surfaceSVG(frame, view, turbulence, opacity) {
  const bg = parseColor(frame.theme.colors.background);
  const W = view.pixelWidth;
  const H = view.pixelHeight;
  return `<defs><filter id="qg-surface" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${turbulence}" numOctaves="3" seed="${frame.seed % 1000}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${opacity}"/></feComponentTransfer></filter>`
    + `<filter id="qg-chalk"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${(frame.seed + 7) % 1000}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.6" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter></defs>`
    + `<rect width="${W}" height="${H}" fill="${toHex({ ...bg, a: 1 })}"/><rect width="${W}" height="${H}" filter="url(#qg-surface)"/>`;
}

// SVG item paths are produced in pixel space; the SVG renderer wraps items in
// the world transform, so these boards undo it with an inverse group.
function wrapPixelSpace(view, inner) {
  const [a, b, c, d, e, f] = view.matrix;
  const det = a * d - b * c;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = (c * f - d * e) / det;
  const iff = (b * e - a * f) / det;
  return `<g transform="matrix(${[ia, ib, ic, id, ie, iff].map((v) => +v.toFixed(8)).join(' ')})">${inner}</g>`;
}

registerSVGBoard('chalkboard', {
  background: (frame, view) => surfaceSVG(frame, view, 0.012, 0.06),
  item: (item, frame, view) => wrapPixelSpace(view, pathItemSVG(item, view, 'chalk', 'qg-chalk')),
});
registerSVGBoard('whiteboard', {
  background: (frame, view) => surfaceSVG(frame, view, 0.01, 0.02),
  item: (item, frame, view) => wrapPixelSpace(view, pathItemSVG(item, view, 'marker', null)),
});
registerSVGBoard('paper', {
  background: (frame, view) => surfaceSVG(frame, view, 0.03, 0.035),
  item: (item, frame, view) => wrapPixelSpace(view, pathItemSVG(item, view, frame.theme.boardOptions.tool ?? 'ballpoint', null)),
});
registerSVGBoard('blueprint', {
  background: (frame, view) => surfaceSVG(frame, view, 0.008, 0.08),
  item: (item, frame, view) => wrapPixelSpace(view, pathItemSVG(item, view, 'drafting', null)),
});
