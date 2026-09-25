/**
 * Erasing. An eraser sweeps a zigzag over a node; marks under the swept band
 * disappear. Board styles leave a faint smudge where marks were erased
 * (chalk dust, dry-erase ghosting); the clean renderer simply wipes.
 * @module board/erase
 */

import { Animation } from '../core/animations.js';
import { Rect } from '../core/shapes.js';
import { linear } from '../core/easing.js';
import { Group } from '../core/node.js';
import { toCSS } from '../core/color.js';
import { createCanvas } from '../core/platform.js';

/**
 * Zigzag covering a rectangle, in world coordinates.
 * @param {{x: number, y: number, w: number, h: number}} b
 * @param {number} band eraser height in world units
 * @returns {Array<[number, number]>}
 */
export function zigzag(b, band) {
  const rows = Math.max(1, Math.ceil(b.h / (band * 0.8)));
  const pts = [];
  const pad = band * 0.3;
  for (let r = 0; r <= rows; r++) {
    const y = b.y + b.h - (b.h * r) / rows;
    const left = [b.x - pad, y];
    const right = [b.x + b.w + pad, y];
    if (r % 2 === 0) pts.push(left, right);
    else pts.push(right, left);
  }
  return pts;
}

function prefix(pts, u) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const target = lens[lens.length - 1] * Math.max(0, Math.min(1, u));
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= target) out.push(pts[i]);
    else {
      const k = (target - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]);
      break;
    }
  }
  return out;
}

/**
 * Eraser position at progress u (world coordinates).
 * @param {Array<[number, number]>} pts
 * @param {number} u
 * @returns {[number, number]}
 */
export function eraserAt(pts, u) {
  const p = prefix(pts, u);
  return p[p.length - 1];
}

/**
 * Sweep an eraser over a node. The node's marks under the swept band vanish;
 * on boards a smudge stays behind.
 */
export class Erase extends Animation {
  /**
   * @param {import('../core/node.js').Node} node
   * @param {Record<string, any>} [opts] band (eraser height, world units, default 0.7), showEraser (default true), smudge (0 to 1, default 1)
   */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.band = opts.band ?? 0.7;
    this.showEraser = opts.showEraser ?? true;
    this.smudge = opts.smudge ?? 1;
    this.defaultDuration = 1.6;
    this.defaultEase = linear;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const b = this.node.bounds();
    if (!b) return e;
    const pts = zigzag(b, this.band);
    const spec = { t0: s, t1: e, pts, band: this.band, ease: this.ease, smudge: this.smudge };
    for (const leaf of this.node.leaves()) leaf.meta.erase = spec;
    if (this.showEraser) {
      const w = this.band * 1.9;
      const felt = new Rect({ width: w, height: this.band * 0.42, radius: 0.03, fill: '#2d3033', stroke: null, y: -this.band * 0.29, meta: { noBoard: true } });
      const top = new Rect({ width: w, height: this.band * 0.58, radius: 0.06, fill: '#a08463', stroke: null, y: this.band * 0.21, meta: { noBoard: true } });
      const grip = new Rect({ width: w * 0.92, height: this.band * 0.08, radius: 0.02, fill: '#8a6f51', stroke: null, y: this.band * 0.08, meta: { noBoard: true } });
      const eraser = new Group([felt, top, grip], { meta: { eraser: true } });
      const [x0, y0] = pts[0];
      eraser.set({ x: x0, y: y0 });
      eraser._init.visible = false;
      scene.root.add(eraser);
      eraser.tween('visible', s, s, true, linear);
      eraser.tween('x', s, e, pts[pts.length - 1][0], this.ease, (u) => eraserAt(pts, u)[0]);
      eraser.tween('y', s, e, pts[pts.length - 1][1], this.ease, (u) => eraserAt(pts, u)[1]);
      eraser.tween('visible', e, e, false, linear);
    }
    return e;
  }
}

/**
 * @param {import('../core/node.js').Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Erase}
 */
export function erase(node, opts) {
  return new Erase(node, opts);
}

/**
 * Erase state of an item at time t: null when not erasing.
 * @param {any} item
 * @param {number} t
 * @returns {{u: number, band: Array<[number, number]>, width: number, smudge: number}|null}
 */
export function eraseState(item, t) {
  const spec = item.meta && item.meta.erase;
  if (!spec || t < spec.t0) return null;
  const raw = spec.t1 > spec.t0 ? (t - spec.t0) / (spec.t1 - spec.t0) : 1;
  const u = raw >= 1 ? 1 : spec.ease(Math.max(0, raw));
  return { u, band: prefix(spec.pts, u), width: spec.band, smudge: spec.smudge };
}

/**
 * Draw an item through an erase mask: render it on a scratch canvas, cut the
 * swept band out, optionally draw a smudge in the band, and composite.
 * @param {CanvasRenderingContext2D} ctx destination
 * @param {any} item
 * @param {any} frame
 * @param {any} view
 * @param {(c: CanvasRenderingContext2D) => void} draw draws the item on a context
 * @param {{smudge?: boolean, composite?: string}} [opts]
 */
export function drawErased(ctx, item, frame, view, draw, opts = {}) {
  const st = eraseState(item, frame.t);
  if (!st) {
    draw(ctx);
    return;
  }
  if (st.u >= 1 && !opts.smudge) return;
  const W = view.pixelWidth;
  const H = view.pixelHeight;
  const scratch = createCanvas(W, H);
  const sctx = scratch.getContext('2d');
  draw(sctx);
  const [a, b, c, d, e, f] = view.matrix;
  const bandPx = st.band.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const bw = st.width * view.scale;
  if (opts.smudge && st.smudge > 0) {
    // Smudge: the erased marks survive faintly, blurred and dragged along the sweep.
    const smudge = createCanvas(W, H);
    const mctx = smudge.getContext('2d');
    mctx.filter = `blur(${Math.max(3, 8 * view.strokeScale)}px)`;
    const k = view.strokeScale;
    for (const [dx, dy, al] of [[0, 0, 0.1], [-14, 2, 0.07], [16, -2, 0.07], [30, 1, 0.04], [-28, -1, 0.04]]) {
      mctx.globalAlpha = al * st.smudge;
      mctx.drawImage(scratch, dx * k, dy * k);
    }
    mctx.filter = 'none';
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = 'destination-in';
    strokeBand(mctx, bandPx, bw);
    sctx.globalCompositeOperation = 'destination-out';
    strokeBand(sctx, bandPx, bw);
    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(smudge, 0, 0);
  } else {
    sctx.globalCompositeOperation = 'destination-out';
    strokeBand(sctx, bandPx, bw);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.composite) ctx.globalCompositeOperation = opts.composite;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

function strokeBand(ctx, pts, width) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = toCSS({ r: 0, g: 0, b: 0, a: 1 });
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
  ctx.stroke();
  ctx.restore();
}
