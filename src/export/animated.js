/**
 * Animated vector export: Lottie JSON and animated SVG (SMIL). Both sample
 * the scene frame by frame, convert each frame to pixel-space vector ops,
 * and collect a track per path (node id and subpath index). Tracks hold
 * keyframes only where something changed.
 * @module export/animated
 */

import { sampleFrame } from '../core/sampler.js';
import { frameToVector } from '../render/vector.js';
import { toSVGPath } from '../core/path.js';
import { toHex } from '../core/color.js';
import { PROJECT } from '../config.js';

/**
 * @typedef {Object} Track
 * @property {string} key
 * @property {Array<{frame: number, sub: {points: number[], closed: boolean}, fill: any, stroke: any, width: number, cap: string, join: string}>} keys
 */

/**
 * Sample a scene into per-path tracks.
 * @param {import('../core/scene.js').Scene} scene
 * @param {import('../themes/tokens.js').Theme} theme
 * @param {{fps?: number}} [opts] sampling rate (default the scene fps)
 * @returns {{tracks: Track[], frames: number, fps: number, width: number, height: number, background: any, rasterized: Set<string>}}
 */
export function collectTracks(scene, theme, opts = {}) {
  const fps = opts.fps ?? scene.fps;
  const frames = Math.max(1, Math.round(scene.duration * fps));
  const tracks = new Map();
  const rasterized = new Set();
  let background = null;
  for (let f = 0; f < frames; f++) {
    const t = scene.outputToSceneTime(f / fps);
    const v = frameToVector(sampleFrame(scene, t, theme));
    background = v.background;
    for (const r of v.rasterized) rasterized.add(r);
    const seen = new Map();
    for (const op of v.ops) {
      if (op.kind === 'image') {
        rasterized.add(`image ${op.id} is omitted (images are not converted to vector tracks)`);
        continue;
      }
      op.path.subpaths.forEach((sub) => {
        const base = `${op.id}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = `${base}#${n}`;
        if (!tracks.has(key)) tracks.set(key, { key, keys: [] });
        tracks.get(key).keys.push({ frame: f, sub, fill: op.fill, stroke: op.stroke, width: op.width, cap: op.cap, join: op.join });
      });
    }
  }
  return { tracks: [...tracks.values()], frames, fps, width: scene.width, height: scene.height, background, rasterized };
}

function r3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Lottie shape value from a cubic subpath (vertices with relative tangents).
 * @param {{points: number[], closed: boolean}} s
 * @returns {{c: boolean, v: number[][], i: number[][], o: number[][]}}
 */
export function lottieShape(s) {
  const p = s.points;
  const nSeg = (p.length - 2) / 6;
  const v = [];
  const iT = [];
  const oT = [];
  for (let k = 0; k <= nSeg; k++) {
    const x = p[6 * k];
    const y = p[6 * k + 1];
    v.push([r3(x), r3(y)]);
    iT.push(k > 0 ? [r3(p[6 * k - 2] - x), r3(p[6 * k - 1] - y)] : [0, 0]);
    oT.push(k < nSeg ? [r3(p[6 * k + 2] - x), r3(p[6 * k + 3] - y)] : [0, 0]);
  }
  if (s.closed && v.length > 1) {
    const last = v.length - 1;
    if (Math.abs(v[last][0] - v[0][0]) < 1e-6 && Math.abs(v[last][1] - v[0][1]) < 1e-6) {
      iT[0] = iT[last];
      v.pop();
      iT.pop();
      oT.pop();
    }
  }
  return { c: !!s.closed, v, i: iT, o: oT };
}

function animated(keys, valueOf) {
  const out = [];
  let prev;
  for (const k of keys) {
    const val = valueOf(k);
    const js = JSON.stringify(val);
    if (js === prev) continue;
    prev = js;
    out.push({ t: k.frame, s: val, h: 1 });
  }
  if (out.length === 1) return { a: 0, k: out[0].s };
  return { a: 1, k: out };
}

/**
 * Lottie JSON (Bodymovin 5.7) for a scene. Returns the animation and a
 * report of what was converted exactly and what was left out.
 * @param {import('../core/scene.js').Scene} scene
 * @param {import('../themes/tokens.js').Theme} theme
 * @param {{fps?: number, transparent?: boolean}} [opts]
 * @returns {{json: Record<string, any>, report: string}}
 */
export function toLottie(scene, theme, opts = {}) {
  const c = collectTracks(scene, theme, opts);
  const layers = [];
  c.tracks.forEach((tr, idx) => {
    const first = tr.keys[0].frame;
    const last = tr.keys[tr.keys.length - 1].frame + 1;
    const presence = new Set(tr.keys.map((k) => k.frame));
    const it = [];
    // Keyframe the path; frames where the path is absent hide the layer by opacity.
    it.push({ ty: 'sh', ks: animated(tr.keys, (k) => lottieShape(k.sub)) });
    const hasFill = tr.keys.some((k) => k.fill);
    const hasStroke = tr.keys.some((k) => k.stroke);
    if (hasStroke) {
      it.push({
        ty: 'st',
        c: animated(tr.keys, (k) => (k.stroke ? [r3(k.stroke.r), r3(k.stroke.g), r3(k.stroke.b), 1] : [0, 0, 0, 1])),
        o: animated(tr.keys, (k) => (k.stroke ? r3(k.stroke.a * 100) : 0)),
        w: animated(tr.keys, (k) => r3(k.width)),
        lc: { butt: 1, round: 2, square: 3 }[tr.keys[0].cap] ?? 2,
        lj: { miter: 1, round: 2, bevel: 3 }[tr.keys[0].join] ?? 2,
      });
    }
    if (hasFill) {
      it.push({
        ty: 'fl',
        c: animated(tr.keys, (k) => (k.fill ? [r3(k.fill.r), r3(k.fill.g), r3(k.fill.b), 1] : [0, 0, 0, 1])),
        o: animated(tr.keys, (k) => (k.fill ? r3(k.fill.a * 100) : 0)),
        r: 1,
      });
    }
    it.push({ ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
    const opacity = [];
    let prevOn = null;
    for (let f = first; f < last; f++) {
      const on = presence.has(f);
      if (on !== prevOn) opacity.push({ t: f, s: [on ? 100 : 0], h: 1 });
      prevOn = on;
    }
    layers.push({
      ddd: 0, ind: idx + 1, ty: 4, nm: tr.key, sr: 1,
      ks: { o: opacity.length > 1 ? { a: 1, k: opacity } : { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      ao: 0, shapes: [{ ty: 'gr', it, nm: 'path' }], ip: first, op: last, st: 0, bm: 0,
    });
  });
  // Lottie draws the first layer on top: reverse so later scene items stay in front.
  layers.reverse();
  if (!opts.transparent && c.background) {
    const b = c.background;
    layers.push({ ddd: 0, ind: layers.length + 1, ty: 1, nm: 'background', sc: toHex({ ...b, a: 1 }), sw: c.width, sh: c.height, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [c.width / 2, c.height / 2, 0] }, a: { a: 0, k: [c.width / 2, c.height / 2, 0] }, s: { a: 0, k: [100, 100, 100] } }, ip: 0, op: c.frames, st: 0, bm: 0 });
  }
  const json = { v: '5.7.4', fr: c.fps, ip: 0, op: c.frames, w: c.width, h: c.height, nm: scene.title || PROJECT.name, ddd: 0, assets: [], layers };
  const lines = [`Converted ${c.tracks.length} paths over ${c.frames} frames at ${c.fps} fps as vector shape layers with hold keyframes.`];
  if (c.rasterized.size) {
    lines.push('Not converted:');
    for (const r of c.rasterized) lines.push(`  ${r}`);
  } else lines.push('Everything in the scene converted to vector layers.');
  return { json, report: lines.join('\n') };
}

/**
 * Animated SVG with SMIL: each path track becomes a <path> whose `d`,
 * fill, stroke, and opacity change at discrete frame times.
 * @param {import('../core/scene.js').Scene} scene
 * @param {import('../themes/tokens.js').Theme} theme
 * @param {{fps?: number, transparent?: boolean}} [opts]
 * @returns {{svg: string, report: string}}
 */
export function toAnimatedSVG(scene, theme, opts = {}) {
  const c = collectTracks(scene, theme, { fps: opts.fps ?? Math.min(30, scene.fps) });
  const dur = c.frames / c.fps;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}">`];
  if (!opts.transparent && c.background) parts.push(`<rect width="100%" height="100%" fill="${toHex({ ...c.background, a: 1 })}"/>`);
  for (const tr of c.tracks) {
    const byFrame = new Map(tr.keys.map((k) => [k.frame, k]));
    const times = [];
    const ds = [];
    const fills = [];
    const strokes = [];
    const vis = [];
    let prev = null;
    for (let f = 0; f < c.frames; f++) {
      const k = byFrame.get(f);
      const d = k ? toSVGPath({ subpaths: [k.sub] }, 2) : prev ? prev.d : 'M0 0';
      const fill = k && k.fill ? toHex({ ...k.fill, a: 1 }) : 'none';
      const stroke = k && k.stroke ? toHex({ ...k.stroke, a: 1 }) : 'none';
      const op = k ? String(r3(k.fill ? k.fill.a : k.stroke ? k.stroke.a : 1)) : '0';
      const sig = `${d}|${fill}|${stroke}|${op}`;
      if (prev && prev.sig === sig) continue;
      times.push(r3(f / c.frames));
      ds.push(d);
      fills.push(fill);
      strokes.push(stroke);
      vis.push(op);
      prev = { sig, d };
    }
    const k0 = tr.keys[0];
    const attrs = `stroke-width="${r3(k0.width)}" stroke-linecap="${k0.cap}" stroke-linejoin="${k0.join}"`;
    const anim = (name, values) => (new Set(values).size > 1 ? `<animate attributeName="${name}" dur="${r3(dur)}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${times.join(';')}" values="${values.join(';')}"/>` : '');
    parts.push(`<path d="${ds[0]}" fill="${fills[0]}" stroke="${strokes[0]}" opacity="${vis[0]}" ${attrs}>${anim('d', ds)}${anim('fill', fills)}${anim('stroke', strokes)}${anim('opacity', vis)}</path>`);
  }
  parts.push('</svg>');
  const report = `Animated SVG: ${c.tracks.length} paths, ${c.frames} frames at ${c.fps} fps.${c.rasterized.size ? ` Not converted: ${[...c.rasterized].join('; ')}.` : ''}`;
  return { svg: parts.join(''), report };
}
