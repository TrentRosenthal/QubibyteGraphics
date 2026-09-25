/**
 * Text and math as scene nodes. A Text or Tex node is a group of glyph
 * nodes, one per visible glyph (plus rules and drawn shapes for math), so
 * every glyph can be addressed and animated on its own.
 *
 * Glyphs adapt to the theme at render time: themes that set a different
 * text family re-lay the same string in that family, themes whose text
 * family is a Hershey stroke font draw strokes, and board styles write the
 * glyphs by hand in stroke order with pauses between strokes.
 * @module text/nodes
 */

import { Node, Group, ctx } from '../core/node.js';
import { transformPath, pathBounds, polyPath, emptyPath, mergePaths } from '../core/path.js';
import { pushPathItem } from '../core/sampler.js';
import { noise1, hashSeed } from '../core/random.js';
import { BASE } from '../themes/tokens.js';
import { layoutText } from './layout.js';
import { texToPaths, matchTokens } from './tex.js';
import { strokeText } from './hershey.js';
import { skeletonize } from './skeleton.js';
import { hasFont } from './fonts.js';
import { Animation, TransformMatching } from '../core/animations.js';

/** Cap height of Inter as a fraction of the em, for matching stroke fonts to outline sizes. */
const CAP_RATIO = 0.727;

/**
 * Resolve a size token ('caption', 'label', 'body', 'heading', 'title',
 * 'display') or number to world units.
 * @param {number|string|undefined} size
 * @param {number} fallback
 * @returns {number}
 */
export function resolveSize(size, fallback) {
  if (size == null) return fallback;
  if (typeof size === 'number') return size;
  const v = BASE.type.scale[size];
  if (v == null) throw new Error(`Unknown text size "${size}". Use a number or one of ${Object.keys(BASE.type.scale).join(', ')}`);
  return v;
}

const strokeCache = new Map();

function cachedStrokes(key, make) {
  if (!strokeCache.has(key)) {
    if (strokeCache.size > 6000) strokeCache.clear();
    strokeCache.set(key, make());
  }
  return strokeCache.get(key);
}

/**
 * Map draw progress through a sequence of pen strokes with dwell between
 * strokes, so a hand pauses when lifting the pen. Returns a path with the
 * strokes drawn so far (the last one partial).
 * @param {Array<Array<[number, number]>>} strokes
 * @param {number} d draw progress in [0, 1]
 * @param {number} dwell pause per stroke as a fraction of the average stroke time
 * @returns {import('../core/path.js').Path}
 */
export function dwellStrokes(strokes, d, dwell = 0.35) {
  if (!strokes.length) return emptyPath();
  if (d >= 1) return mergePaths(...strokes.map((s) => polyPath(s)));
  const lens = strokes.map((s) => {
    let L = 0;
    for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    return L;
  });
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length || 1;
  const times = lens.map((L, i) => L + (i < lens.length - 1 ? dwell * avg : 0));
  const total = times.reduce((a, b) => a + b, 0) || 1;
  let t = d * total;
  const out = [];
  for (let i = 0; i < strokes.length; i++) {
    if (t <= 0) break;
    if (t >= lens[i]) {
      out.push(polyPath(strokes[i]));
      t -= times[i];
      continue;
    }
    const s = strokes[i];
    const pts = [s[0]];
    let acc = 0;
    for (let k = 1; k < s.length; k++) {
      const seg = Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]);
      if (acc + seg >= t) {
        const f = seg ? (t - acc) / seg : 0;
        pts.push([s[k - 1][0] + (s[k][0] - s[k - 1][0]) * f, s[k - 1][1] + (s[k][1] - s[k - 1][1]) * f]);
        break;
      }
      pts.push(s[k]);
      acc += seg;
    }
    out.push(polyPath(pts));
    break;
  }
  return mergePaths(...out);
}

/**
 * One glyph (or math rule or shape). Its outline is local to the owning text
 * node; the text node positions the whole block.
 */
export class Glyph extends Node {
  /**
   * @param {import('../core/path.js').Path} path
   * @param {Record<string, any>} [props]
   */
  constructor(path, props = {}) {
    super(props.type ?? 'glyph', { fill: 'ink', stroke: null, ...props, meta: { glyph: true, fillByDefault: true, ...(props.meta || {}) } });
    this.path = path;
    /** Index among the owner's glyphs. */
    this.index = props.index ?? 0;
    /** @type {TextBase|null} */
    this.owner = null;
  }

  geometry() {
    const theme = ctx.theme;
    if (theme && this.owner) {
      const alt = this.owner.themePath(this, theme);
      if (alt) return alt;
    }
    return this.path;
  }

  /** @param {Object} c sampler context */
  sampleItems(c) {
    const theme = c.theme;
    const owner = this.owner;
    const hand = owner && (theme.board || owner.strokeFont(theme));
    if (!hand) {
      pushPathItem(this, this.resolvedGeometry(), c);
      return;
    }
    const strokes = owner.handStrokesFor(this, theme);
    if (!strokes) {
      pushPathItem(this, this.resolvedGeometry(), c);
      return;
    }
    // Pen strokes: write in stroke order with dwell, in the glyph's fill color.
    const d = Math.min(1, Math.max(0, this.get('draw')));
    const fillA = this.get('fillOpacity');
    const strokeVisible = this.get('stroke') != null ? this.get('strokeOpacity') : 0;
    const visibility = Math.max(fillA, strokeVisible > 0 && d < 1 ? 1 : 0);
    if (visibility <= 0 || d <= 0) return;
    const path = dwellStrokes(strokes, d, theme.board === 'whiteboard' ? 0.5 : 0.3);
    const width = Math.max(2.2, owner.strokeWeight(theme));
    pushPathItem(this, path, { ...c, opacity: c.opacity * Math.min(1, visibility) }, {
      strokeColor: this.get('fill') ?? this.get('stroke') ?? 'ink',
      strokeWidth: width,
      noFill: true,
      draw: 1,
      meta: { ...this.meta, glyph: false, handwriting: true },
    });
  }

}

/**
 * Shared behavior of Text and Tex: glyph children, centering, theme
 * adaptation, and handwriting.
 */
export class TextBase extends Group {
  /** @param {string} type @param {Record<string, any>} props */
  constructor(type, props) {
    super([], { type, ...pickProps(props) });
    /** @type {Glyph[]} */
    this.glyphs = [];
    this.size = 1;
    this.offset = [0, 0];
    this.handFont = props.handFont ?? null;
  }

  /**
   * Attach glyph nodes and center the block on the local origin.
   * @param {Array<{path: import('../core/path.js').Path, meta?: Record<string, any>, fill?: string}>} parts
   * @param {Record<string, any>} style
   * @protected
   */
  _setGlyphs(parts, style) {
    const all = mergePaths(...parts.map((p) => p.path));
    const b = pathBounds(all) || { x: 0, y: 0, w: 0, h: 0 };
    this.offset = [-(b.x + b.w / 2), -(b.y + b.h / 2)];
    const T = [1, 0, 0, 1, this.offset[0], this.offset[1]];
    parts.forEach((p, i) => {
      const g = new Glyph(transformPath(p.path, T), { fill: p.fill ?? style.color ?? style.fill ?? 'ink', index: i, meta: { ...(p.meta || {}) } });
      g.owner = this;
      if (style.fillOpacity != null) g.set('fillOpacity', style.fillOpacity);
      this.glyphs.push(g);
      this.add(g);
    });
  }

  /**
   * Alternate outline for a glyph under a theme (different text family), or null.
   * @param {Glyph} _glyph
   * @param {any} _theme
   * @returns {import('../core/path.js').Path|null}
   */
  themePath(_glyph, _theme) {
    return null;
  }

  /**
   * Stroke font to use outside board styles, from a theme text family like 'hershey:futural'.
   * @param {any} theme
   * @returns {string|null}
   */
  strokeFont(theme) {
    if (this.explicitFont) return null;
    const fam = theme.type.text;
    return typeof fam === 'string' && fam.startsWith('hershey:') ? fam.slice(8) : null;
  }

  /**
   * Stroke weight for handwriting in pixels at 1080p, scaled with the text size.
   * @param {any} theme
   * @returns {number}
   */
  strokeWeight(theme) {
    const base = theme.board === 'chalkboard' ? 4 : theme.board === 'whiteboard' ? 3.8 : theme.board === 'blueprint' ? 2.6 : 3;
    return Math.min(6, base * Math.sqrt(this.size / 0.5)) * (theme.board ? 1 : 0.75);
  }

  /**
   * Pen strokes for a glyph (local coordinates), or null when the glyph has no stroke form.
   * @param {Glyph} glyph
   * @param {any} theme
   * @returns {Array<Array<[number, number]>>|null}
   */
  handStrokesFor(glyph, theme) {
    const key = `${this.id}|${glyph.index}|${theme.board ?? ''}|${this.strokeFont(theme) ?? ''}|${ctx.seed}`;
    return cachedStrokes(key, () => {
      const raw = this._rawStrokes(glyph, theme);
      if (!raw) return null;
      dabDots(raw, this.size * 0.22);
      if (!theme.board) return raw;
      return this._jitter(raw, glyph, theme);
    });
  }

  /**
   * Baseline drift, slight rotation, and size wobble per glyph, seeded by the
   * scene seed and the node id so a hand is consistent within a video.
   * @private
   */
  _jitter(strokes, glyph, _theme) {
    const seed = hashSeed(`${ctx.seed}|${this.id}`);
    const b = pathBounds(glyph.path) || { x: 0, y: 0, w: 0, h: 0 };
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const s = this.size;
    const drift = 0.05 * s * noise1(cx / (3 * s) + 0.5, seed);
    const rot = 0.05 * noise1(glyph.index * 0.7, seed + 1);
    const scale = 1 + 0.04 * noise1(glyph.index * 1.3, seed + 2);
    const cos = Math.cos(rot) * scale;
    const sin = Math.sin(rot) * scale;
    return strokes.map((st) => st.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos + drift];
    }));
  }

  /** @protected */
  _rawStrokes(glyph) {
    return skeletonStrokes(glyph.path);
  }
}

/**
 * Replace tiny closed strokes (periods, the dot of an i) with a short dab,
 * which a pen draws as a solid dot instead of a small ring.
 * @param {Array<Array<[number, number]>>} strokes modified in place
 * @param {number} limit size below which a stroke becomes a dab
 */
function dabDots(strokes, limit) {
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of s) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (Math.hypot(x1 - x0, y1 - y0) < limit) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const r = limit * 0.18;
      strokes[i] = [[cx - r, cy + r * 0.3], [cx + r, cy - r * 0.3]];
    }
  }
}

function skeletonStrokes(path) {
  const b = pathBounds(path);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const strokes = skeletonize(path, { resolution: 72 });
  if (!strokes.length) return null;
  return strokes.map((s) => s.points.map((p) => [p[0], p[1]]));
}

function pickProps(props) {
  const out = {};
  for (const k of ['x', 'y', 'position', 'opacity', 'id', 'name', 'tokens', 'rotation', 'scale']) if (props[k] !== undefined) out[k] = props[k];
  return out;
}

/**
 * Text set in a proportional font (Inter by default), laid out with kerning,
 * line breaking, and alignment.
 */
export class Text extends TextBase {
  /**
   * @param {string} content
   * @param {Record<string, any>} [props] size (number or 'caption'|'label'|'body'|'heading'|'title'|'display'), font, weight ('regular'|'medium'|'semibold'|'italic'), color, align, maxWidth, lineHeight, letterSpacing
   */
  constructor(content, props = {}) {
    super('text', props);
    this.content = String(content);
    this.size = resolveSize(props.size, BASE.type.scale.body);
    /** An explicit font is kept under every theme; the default follows the theme's text family. */
    this.explicitFont = props.font != null;
    this.opts = {
      font: props.font ?? 'Inter',
      style: normalizeWeight(props.weight),
      align: props.align ?? 'left',
      maxWidth: props.maxWidth ?? Infinity,
      lineHeight: props.lineHeight ?? 1.25,
      letterSpacing: props.letterSpacing ?? 0,
    };
    this.layout = layoutText(this.content, { ...this.opts, size: this.size });
    this._setGlyphs(this.layout.paths.map((p) => ({ path: p.path, meta: { key: p.char, char: p.char, cluster: p.cluster } })), props);
    this.altLayouts = new Map();
  }

  themePath(glyph, theme) {
    const fam = theme.type.text;
    if (this.explicitFont || !fam || fam === this.opts.font || fam.startsWith('hershey:') || !hasFont(fam, 'regular')) return null;
    let alt = this.altLayouts.get(fam);
    if (alt === undefined) {
      const lay = layoutText(this.content, { ...this.opts, font: fam, style: 'regular', size: this.size });
      if (lay.paths.length !== this.glyphs.length) alt = null;
      else {
        const all = mergePaths(...lay.paths.map((p) => p.path));
        const b = pathBounds(all) || { x: 0, y: 0, w: 0, h: 0 };
        const T = [1, 0, 0, 1, -(b.x + b.w / 2), -(b.y + b.h / 2)];
        alt = lay.paths.map((p) => transformPath(p.path, T));
      }
      this.altLayouts.set(fam, alt);
    }
    return alt ? alt[glyph.index] : null;
  }

  _rawStrokes(glyph, theme) {
    const g = this.layout.paths[glyph.index];
    const font = this.handFont ?? this.strokeFont(theme) ?? (theme.board === 'blueprint' ? 'futural' : theme.type.hand ?? 'futural');
    const r = strokeText(g.char, { font, size: this.size * CAP_RATIO });
    if (!r.strokes.length) return skeletonStrokes(glyph.path);
    const gx = g.x + this.offset[0];
    const gy = g.y + this.offset[1];
    // Center the stroke glyph on the outline glyph's advance so spacing matches the laid-out text.
    const shift = (g.advance - r.width) / 2;
    return r.strokes.map((s) => s.points.map(([x, y]) => [gx + shift + x, gy + y]));
  }
}

function normalizeWeight(w) {
  if (!w) return 'regular';
  const k = String(w).toLowerCase();
  if (k === 'bold' || k === 'semibold' || k === '600') return 'semibold';
  if (k === 'medium' || k === '500') return 'medium';
  if (k === 'italic') return 'italic';
  return 'regular';
}

/**
 * Math typeset with KaTeX and converted to paths. Tokens are addressable:
 * `tex.part('x^2')` returns a group of just those glyphs.
 */
export class Tex extends TextBase {
  /**
   * @param {string} source LaTeX
   * @param {Record<string, any>} [props] size (default 0.6), color, colors ({tokenText: color}), display (default true)
   */
  constructor(source, props = {}) {
    super('tex', props);
    this.source = source;
    this.size = resolveSize(props.size, 0.6);
    this.result = texToPaths(source, { size: this.size, display: props.display ?? true, macros: props.macros });
    const colors = props.colors ?? {};
    this._setGlyphs(this.result.paths.map((p) => ({
      path: p.kind === 'rule' ? p.path : p.path,
      fill: p.color ?? colors[p.text] ?? undefined,
      meta: { key: p.text, tokenIndex: p.tokenIndex, kind: p.kind, solidFill: p.kind !== 'glyph' },
    })), props);
    this.parts = new Map();
  }

  /**
   * Group of the glyphs produced by a TeX substring (nth occurrence).
   * The glyphs move into a subgroup; their positions do not change.
   * @param {string} sub
   * @param {number} [nth=0]
   * @returns {Group}
   */
  part(sub, nth = 0) {
    const key = `${sub}|${nth}`;
    if (this.parts.has(key)) return this.parts.get(key);
    const idx = this.result.part(sub, nth);
    if (!idx || !idx.length) throw new Error(`"${sub}" does not appear in ${this.source}`);
    const g = new Group([], { type: 'texPart' });
    this.add(g);
    for (const i of idx) g.add(this.glyphs[i]);
    this.parts.set(key, g);
    return g;
  }

  /**
   * Color every occurrence of token texts.
   * @param {Record<string, string>} map token text to color
   * @returns {this}
   */
  colorTokens(map) {
    this.glyphs.forEach((g) => {
      const c = map[g.meta.key];
      if (c) g.set('fill', c);
    });
    return this;
  }

  _rawStrokes(glyph, theme) {
    const item = this.result.paths[glyph.index];
    if (item.kind === 'rule') {
      const b = pathBounds(glyph.path);
      if (!b) return null;
      const y = b.y + b.h / 2;
      return [[[b.x, y], [b.x + b.w, y]]];
    }
    const ch = item.text;
    const b = pathBounds(glyph.path);
    if (b && item.kind === 'glyph' && /^[A-Za-z0-9+\-=()[\]<>|,.;:!?/*]$/.test(ch)) {
      const font = this.handFont ?? theme.type.hand ?? 'futural';
      const r = strokeText(ch, { font, size: this.size * CAP_RATIO });
      const rb = r.strokes.length ? pathBounds(mergePaths(...r.strokes.map((st) => polyPath(st.points)))) : null;
      if (rb) {
        // Fit the stroke glyph into the outline glyph's box, keeping its aspect ratio.
        const kx = rb.w > 1e-9 ? b.w / rb.w : Infinity;
        const ky = rb.h > 1e-9 ? b.h / rb.h : Infinity;
        let k = Math.min(kx, ky);
        if (!Number.isFinite(k)) k = 1;
        return r.strokes.map((st) => st.points.map(([x, y]) => [b.x + b.w / 2 + (x - (rb.x + rb.w / 2)) * k, b.y + b.h / 2 + (y - (rb.y + rb.h / 2)) * k]));
      }
    }
    return skeletonStrokes(glyph.path);
  }
}

/**
 * A number that animates its value and re-typesets each frame. Use
 * `number.animate.set('value', 10)` or `countTo(number, 10)`.
 */
export class DecimalNumber extends Node {
  /**
   * @param {number} value
   * @param {Record<string, any>} [props] decimals (2), size, color, prefix, suffix (TeX), showSign, unit (TeX appended)
   */
  constructor(value = 0, props = {}) {
    super('decimal', { fill: props.color ?? 'ink', stroke: null, ...pickProps(props), meta: { glyph: true, fillByDefault: true } });
    this._define('value', value);
    this.decimals = props.decimals ?? 2;
    this.size = resolveSize(props.size, 0.6);
    this.prefix = props.prefix ?? '';
    this.suffix = props.suffix ?? '';
    this.showSign = !!props.showSign;
    this.align = props.align ?? 'center';
    this.cache = new Map();
  }

  /** @returns {number} */
  get value() {
    return this.get('value');
  }

  set value(v) {
    this.set('value', v);
  }

  /**
   * TeX for a value.
   * @param {number} v
   * @returns {string}
   */
  texFor(v) {
    const r = Number(v.toFixed(this.decimals));
    const sign = this.showSign && r > 0 ? '+' : '';
    const body = (Object.is(r, -0) ? 0 : r).toFixed(this.decimals);
    return `${this.prefix}${sign}${body}${this.suffix}`;
  }

  geometry() {
    const tex = this.texFor(this.get('value'));
    let g = this.cache.get(tex);
    if (!g) {
      const r = texToPaths(tex, { size: this.size });
      const all = mergePaths(...r.paths.map((p) => p.path));
      const b = pathBounds(all) || { x: 0, y: 0, w: 0, h: 0 };
      const dx = this.align === 'left' ? 0 : this.align === 'right' ? -(b.x + b.w) : -(b.x + b.w / 2);
      g = transformPath(all, [1, 0, 0, 1, dx, -(this.size * 0.35)]);
      if (this.cache.size > 2000) this.cache.clear();
      this.cache.set(tex, g);
    }
    return g;
  }
}

/**
 * Animate a DecimalNumber (or any node with a `value`) to a target value.
 * @param {Node} node
 * @param {number} value
 * @param {Record<string, any>} [opts]
 * @returns {any}
 */
export function countTo(node, value, opts = {}) {
  return node.animate.set('value', value).with(opts);
}

/**
 * Morph one Tex into another: glyphs of matching tokens move to their new
 * places, the rest fade out and in.
 */
export class TransformMatchingTex extends Animation {
  /** @param {Tex} a @param {Tex} b @param {Record<string, any>} [opts] */
  constructor(a, b, opts = {}) {
    super(opts);
    this.a = a;
    this.b = b;
    this.defaultDuration = 1.4;
  }

  schedule(scene, t0) {
    const m = matchTokens(this.a.result, this.b.result);
    const inner = new TransformMatching(this.a, this.b, {
      duration: this.duration,
      ease: this.ease,
      pairs: m.pairs,
      sourceLeaves: this.a.glyphs,
      targetLeaves: this.b.glyphs,
    });
    inner.applyDefaults({}, scene);
    inner.duration = this.duration;
    inner.ease = this.ease;
    inner.delay = this.delay;
    return inner.schedule(scene, t0);
  }
}

/**
 * @param {Tex} a
 * @param {Tex} b
 * @param {Record<string, any>} [opts]
 * @returns {TransformMatchingTex}
 */
export function transformMatchingTex(a, b, opts) {
  return new TransformMatchingTex(a, b, opts);
}

/**
 * Glyph outlines for axis labels and other small TeX, as one merged path.
 * @param {string} tex
 * @param {number} size
 * @returns {{path: import('../core/path.js').Path, width: number, height: number, depth: number}}
 */
export function texLabelGlyphs(tex, size) {
  const r = texToPaths(tex, { size });
  return { path: mergePaths(...r.paths.map((p) => p.path)), width: r.width, height: r.height, depth: r.depth };
}
