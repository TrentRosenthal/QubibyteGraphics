/**
 * Fourier series epicycles: a closed curve drawn by a chain of rotating
 * arrows, one per frequency, largest first. Computed with a DFT of the
 * curve sampled by arc length.
 * @module explainers/fourier
 */

import { Node } from '../core/node.js';
import { circlePath, polyPath, samplePath, parseSVGPath } from '../core/path.js';
import { pushPathItem } from '../core/sampler.js';

/**
 * Discrete Fourier coefficients of complex samples z_k = x_k + i y_k.
 * @param {Array<[number, number]>} pts
 * @param {number} count number of frequencies to keep (by magnitude)
 * @returns {Array<{freq: number, re: number, im: number, amp: number, phase: number}>} sorted by amplitude, frequency 0 first
 */
export function epicycleCoefficients(pts, count) {
  const N = pts.length;
  const out = [];
  const half = Math.floor(N / 2);
  for (let f = -half; f < N - half; f++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < N; k++) {
      const a = (-2 * Math.PI * f * k) / N;
      const [x, y] = pts[k];
      re += x * Math.cos(a) - y * Math.sin(a);
      im += x * Math.sin(a) + y * Math.cos(a);
    }
    re /= N;
    im /= N;
    out.push({ freq: f, re, im, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
  }
  const dc = out.find((c) => c.freq === 0);
  const rest = out.filter((c) => c.freq !== 0).sort((a, b) => b.amp - a.amp).slice(0, Math.max(0, count - 1));
  return [dc, ...rest];
}

/**
 * Epicycle drawing: tracked `time` in [0, 1] turns the arrows; the traced
 * curve is drawn up to the current time.
 */
export class Epicycles extends Node {
  /**
   * @param {import('../core/path.js').Path|string|Array<[number, number]>} shape a Path, an SVG path string, or points (world units)
   * @param {Record<string, any>} [props] terms (default 60), samples (default 512), trail (fraction of a turn to keep bright, default 1), circles (show circles, default true)
   */
  constructor(shape, props = {}) {
    super('epicycles', { stroke: 'accent', strokeWidth: 4.5, ...pick(props) });
    this._define('time', 0);
    const samples = props.samples ?? 512;
    let pts;
    if (Array.isArray(shape)) pts = shape;
    else {
      const path = typeof shape === 'string' ? parseSVGPath(shape) : shape;
      pts = samplePath(path, samples + 1).slice(0, samples).map(([x, y]) => [x, y]);
    }
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    this.coeffs = epicycleCoefficients(pts.map(([x, y]) => [x - cx, y - cy]), props.terms ?? 60);
    this.center = [cx, cy];
    this.showCircles = props.circles ?? true;
    this.trailSamples = props.trailSamples ?? 600;
  }

  /**
   * Point on the reconstructed curve and the chain of arm joints at time t.
   * @param {number} t in [0, 1]
   * @returns {Array<[number, number]>} joints from the center to the tip
   */
  chain(t) {
    let x = 0;
    let y = 0;
    const joints = [[x, y]];
    for (const c of this.coeffs) {
      const a = 2 * Math.PI * c.freq * t + c.phase;
      x += c.amp * Math.cos(a);
      y += c.amp * Math.sin(a);
      joints.push([x, y]);
    }
    return joints;
  }

  geometry() {
    const t = this.get('time');
    const n = Math.max(2, Math.round(this.trailSamples * Math.min(1, t)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const j = this.chain((t * i) / n);
      pts.push(j[j.length - 1]);
    }
    return polyPath(pts);
  }

  sampleItems(c) {
    const t = this.get('time');
    const joints = this.chain(t);
    if (this.showCircles) {
      for (let i = 1; i < this.coeffs.length; i++) {
        const r = this.coeffs[i].amp;
        if (r < 0.01) continue;
        const [x, y] = joints[i];
        pushPathItem(this, circlePath(x, y, r), c, { strokeColor: 'muted', strokeWidth: 1.4, noFill: true, meta: { ...this.meta, part: 'circle' } });
        const it = c.items[c.items.length - 1];
        if (it && it.stroke) it.stroke = { ...it.stroke, a: it.stroke.a * Math.max(0.12, 0.45 - i * 0.006) };
      }
    }
    pushPathItem(this, polyPath(joints), c, { strokeColor: 'ink', strokeWidth: 2, noFill: true, meta: { ...this.meta, part: 'arms' } });
    const armItem = c.items[c.items.length - 1];
    if (armItem && armItem.stroke) armItem.stroke = { ...armItem.stroke, a: armItem.stroke.a * 0.7 };
    if (t > 0) pushPathItem(this, this.geometry(), c, { noFill: true });
    const tip = joints[joints.length - 1];
    pushPathItem(this, circlePath(tip[0], tip[1], 0.07), c, { fillColor: 'accent', strokeColor: null, strokeWidth: 0, meta: { ...this.meta, part: 'tip', solidFill: true } });
  }
}

function pick(props) {
  const out = {};
  for (const k of ['x', 'y', 'position', 'opacity', 'id', 'name', 'tokens', 'scale']) if (props[k] !== undefined) out[k] = props[k];
  return out;
}
