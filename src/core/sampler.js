/**
 * Frame sampling: resolve a scene at time t into a flat display list that
 * every renderer consumes. Sampling is pure with respect to the scene; the
 * same scene and t always give the same list.
 * @module core/sampler
 */

import { ctx, ColorMix } from './node.js';
import { multiply, compose, identity } from './matrix.js';
import { transformPath } from './path.js';
import { mix } from './color.js';
import { resolveColor } from '../themes/tokens.js';
import { hashSeed } from './random.js';

/**
 * @typedef {Object} PathItem
 * @property {'path'} kind
 * @property {string} id Node id.
 * @property {string} nodeType
 * @property {import('./path.js').Path} path World-space geometry.
 * @property {import('./color.js').RGBA|null} fill Alpha includes opacity.
 * @property {import('./color.js').RGBA|null} stroke Alpha includes opacity.
 * @property {number} strokeWidth Pixels at 1080p.
 * @property {string} lineCap
 * @property {string} lineJoin
 * @property {number[]|null} dash World units.
 * @property {'nonzero'|'evenodd'} fillRule
 * @property {number} seed Stable per-node seed for board styles.
 * @property {Record<string, any>} meta
 * @property {number} draw Draw-on progress end, for board renderers.
 */

/**
 * @typedef {Object} ImageItem
 * @property {'image'} kind
 * @property {string} id
 * @property {any} source
 * @property {number[]} matrix World matrix of the image's local frame.
 * @property {number} width World units.
 * @property {number} height World units.
 * @property {number} opacity
 * @property {string} treatment
 * @property {number} time Local media time for video sources.
 * @property {Record<string, any>} meta
 */

/**
 * @typedef {Object} Frame
 * @property {number} t Scene time.
 * @property {number} width Pixel width.
 * @property {number} height Pixel height.
 * @property {number} unit World units per pixel at zoom 1.
 * @property {{x: number, y: number, zoom: number, rotation: number}} camera
 * @property {Array<PathItem|ImageItem>} items
 * @property {import('../themes/tokens.js').Theme} theme
 * @property {number} seed
 * @property {Array<{text: string, start: number, end: number}>} captions Active captions.
 */

/**
 * Sample the scene at scene time t.
 * @param {import('./scene.js').Scene} scene
 * @param {number} t
 * @param {import('../themes/tokens.js').Theme} theme Resolved theme object.
 * @returns {Frame}
 */
export function sampleFrame(scene, t, theme) {
  const prev = { sampling: ctx.sampling, t: ctx.t, frame: ctx.frame };
  ctx.sampling = true;
  ctx.t = t;
  ctx.frame = new Map();
  try {
    for (const u of scene.updaters) {
      if (t >= u.t0 && t < u.t1) u.fn(t, 1 / scene.fps);
    }
    const items = [];
    walk(scene.root, identity(), 1, {}, items, theme, scene, t);
    const cam = scene.camera;
    return {
      t,
      width: scene.width,
      height: scene.height,
      unit: scene.unit,
      camera: { x: cam.get('x'), y: cam.get('y'), zoom: cam.get('zoom'), rotation: cam.get('rotation') },
      items,
      theme,
      seed: typeof scene.seed === 'number' ? scene.seed : hashSeed(scene.seed),
      captions: scene.captions.filter((c) => t >= c.start && t < c.end),
    };
  } finally {
    ctx.sampling = prev.sampling;
    ctx.t = prev.t;
    ctx.frame = prev.frame;
  }
}

function color(value, theme, tokens) {
  if (value instanceof ColorMix) {
    const a = color(value.a, theme, tokens);
    const b = color(value.b, theme, tokens);
    if (!a) return b;
    if (!b) return a;
    return mix(a, b, value.t);
  }
  return resolveColor(value, theme, tokens);
}

function withAlpha(c, a) {
  if (!c) return null;
  const alpha = c.a * a;
  if (alpha <= 0) return null;
  return { r: c.r, g: c.g, b: c.b, a: alpha };
}

function walk(node, parentM, parentOpacity, parentTokens, items, theme, scene, t) {
  if (!node.get('visible')) return;
  const opacity = parentOpacity * node.get('opacity');
  if (opacity <= 0) return;
  const m = node === scene.root ? parentM : multiply(parentM, compose(node.get('x'), node.get('y'), node.get('rotation'), node.get('scaleX'), node.get('scaleY')));
  const tokens = Object.keys(node.tokens).length ? { ...parentTokens, ...node.tokens } : parentTokens;
  if (typeof node.sampleItems === 'function') {
    node.sampleItems({ matrix: m, opacity, tokens, theme, scene, t, items, color: (v) => color(v, theme, tokens) });
  } else if (node.type === 'image' || node.type === 'video') {
    items.push({
      kind: 'image',
      id: node.id,
      source: node.source,
      matrix: m,
      width: node.get('width'),
      height: node.get('height'),
      opacity,
      treatment: node.treatment,
      fit: node.fit,
      time: node.type === 'video' ? node.startTime + (t - (node.meta.appearTime ?? 0)) * node.playbackRate : 0,
      meta: node.meta,
      tokens,
    });
  } else {
    const g = node.resolvedGeometry();
    if (g && g.subpaths.length) {
      const fill = withAlpha(color(node.get('fill'), theme, tokens), node.get('fillOpacity') * opacity);
      const stroke = withAlpha(color(node.get('stroke'), theme, tokens), node.get('strokeOpacity') * opacity);
      const sw = node.get('strokeWidth');
      if (fill || (stroke && sw > 0)) {
        items.push({
          kind: 'path',
          id: node.id,
          nodeType: node.type,
          path: transformPath(g, m),
          fill,
          stroke: sw > 0 ? stroke : null,
          strokeWidth: sw,
          lineCap: node.get('lineCap'),
          lineJoin: node.get('lineJoin'),
          dash: node.get('dash'),
          fillRule: node.meta.fillRule ?? 'nonzero',
          seed: hashSeed(node.meta.seedKey ?? node.id),
          meta: node.meta,
          draw: node.get('draw'),
        });
      }
    }
  }
  const kids = node.children;
  if (!kids.length) return;
  let ordered = kids;
  if (kids.some((k) => k.get('zIndex') !== 0)) {
    ordered = kids.map((k, i) => [k, i]).sort((a, b) => a[0].get('zIndex') - b[0].get('zIndex') || a[1] - b[1]).map((p) => p[0]);
  }
  for (const k of ordered) walk(k, m, opacity, tokens, items, theme, scene, t);
}
