/**
 * LaTeX to vector paths, identical in Node and the browser.
 *
 * KaTeX (vendored) parses the TeX and builds its HTML box tree in memory
 * (`__renderToHTMLTree`), which carries the classes and inline styles its
 * stylesheet turns into a layout. Instead of handing that tree to a browser,
 * this module evaluates it with a small CSS engine that implements exactly the
 * `katex.css` rules KaTeX relies on: inline flow of glyph runs, `.vlist`
 * tables whose rows are positioned with `top` offsets against a `.pstrut`,
 * text-align inside table cells, the `.sizing` font-size table, font family
 * selection classes, borders drawn as rules, and absolutely positioned SVG
 * shapes (radicals, stretchy arrows, braces) with their viewBox scaling and
 * `overflow: hidden` clipping. Glyphs come from the bundled KaTeX TTFs.
 *
 * Output is in world units with y up. `size` is the KaTeX em (the size of
 * the math font, which KaTeX's stylesheet sets to 1.21 times the surrounding
 * text). The origin is the left end of the baseline.
 *
 * Token addressing: see {@link texToPaths} and the notes on the probe render
 * in `tokenize` and `probeSource` below.
 *
 * @module text/tex
 */

import katex from '../../vendor/katex/katex.mjs';
import { PathBuilder, parseSVGPath, transformPath } from '../core/path.js';
import { getFont, hasFont } from './fonts.js';

/**
 * @typedef {import('../core/path.js').Path} Path
 * @typedef {import('./ttf.js').Font} Font
 */

const { Span, Anchor, SymbolNode, SvgNode, PathNode, LineNode } = katex.__domTree;

const SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];

/**
 * Font-selection rules from katex.css, in stylesheet order (later wins).
 * Each entry: [required classes, family, style, weight].
 */
const FONT_RULES = [
  [['textbf'], null, null, 'bold'],
  [['textit'], null, 'italic', null],
  [['textrm'], 'Main', null, null],
  [['textsf'], 'SansSerif', null, null],
  [['texttt'], 'Typewriter', null, null],
  [['mathnormal'], 'Math', 'italic', null],
  [['mathit'], 'Main', 'italic', null],
  [['mathrm'], null, 'normal', null],
  [['mathbf'], 'Main', null, 'bold'],
  [['boldsymbol'], 'Math', 'italic', 'bold'],
  [['amsrm'], 'AMS', null, null],
  [['mathbb'], 'AMS', null, null],
  [['textbb'], 'AMS', null, null],
  [['mathcal'], 'Caligraphic', null, null],
  [['mathfrak'], 'Fraktur', null, null],
  [['textfrak'], 'Fraktur', null, null],
  [['mathboldfrak'], 'Fraktur', null, 'bold'],
  [['textboldfrak'], 'Fraktur', null, 'bold'],
  [['mathtt'], 'Typewriter', null, null],
  [['mathscr'], 'Script', null, null],
  [['textscr'], 'Script', null, null],
  [['mathsf'], 'SansSerif', null, null],
  [['textsf'], 'SansSerif', null, null],
  [['mathboldsf'], 'SansSerif', null, 'bold'],
  [['textboldsf'], 'SansSerif', null, 'bold'],
  [['mathsfit'], 'SansSerif', 'italic', null],
  [['mathitsf'], 'SansSerif', 'italic', null],
  [['textitsf'], 'SansSerif', 'italic', null],
  [['mainrm'], 'Main', 'normal', null],
  [['delimsizing', 'size1'], 'Size1', null, null],
  [['delimsizing', 'size2'], 'Size2', null, null],
  [['delimsizing', 'size3'], 'Size3', null, null],
  [['delimsizing', 'size4'], 'Size4', null, null],
  [['op-symbol', 'small-op'], 'Size1', null, null],
  [['op-symbol', 'large-op'], 'Size2', null, null],
];

/** Padding (left, right) and margins from class rules, in em. */
const BOX_RULES = {
  boxpad: { pl: 0.3, pr: 0.3 },
  'x-arrow-pad': { pl: 0.5, pr: 0.5 },
  'cd-arrow-pad': { pl: 0.27778, pr: 0.55556 },
  'cancel-pad': { pl: 0.2, pr: 0.2 },
  'cancel-lap': { ml: -0.2, mr: -0.2 },
  anglpad: { pl: 0.03889, pr: 0.03889 },
  angl: { mr: 0.03889, bt: 0.049, br: 0.049 },
  fbox: { bt: 0.04, br: 0.04, bb: 0.04, bl: 0.04 },
  fcolorbox: { bt: 0.04, br: 0.04, bb: 0.04, bl: 0.04 },
  sout: { bb: 0.08 },
};

const INLINE_BLOCK = new Set([
  'base', 'strut', 'mspace', 'nulldelimiter', 'rule', 'frac-line', 'overline-line', 'underline-line', 'hline',
  'hdashline', 'vertical-separator', 'arraycolsep', 'fix', 'cd-vert-arrow', 'hide-tail', 'stretchy', 'overlay',
  'cd-label-left', 'cd-label-right',
]);
const FULL_WIDTH = new Set(['frac-line', 'overline-line', 'underline-line', 'hline', 'hdashline', 'hide-tail', 'stretchy']);
const ABSOLUTE = { 'halfarrow-left': [0, 0.502, 'left'], 'halfarrow-right': [0, 0.502, 'right'], 'brace-left': [0, 0.251, 'left'], 'brace-center': [0.25, 0.5, 'left'], 'brace-right': [0, 0.251, 'right'] };

/**
 * Parse a CSS length used by KaTeX. Returns em units relative to `em`
 * (the element's font size), or a percentage of `pct`.
 */
function len(v, em, pct = 0) {
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  const calc = /^calc\((.*)\)$/.exec(s);
  if (calc) {
    const terms = calc[1].split(/\s+(?=[-+]\s)/);
    let total = 0;
    for (const t of terms) {
      const m = /^([-+])?\s*(.+)$/.exec(t.trim());
      const sign = m[1] === '-' ? -1 : 1;
      total += sign * len(m[2], em, pct);
    }
    return total;
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (s.endsWith('%')) return (n / 100) * pct;
  if (s.endsWith('em')) return n * em;
  return 0;
}

const hasCls = (node, c) => !!(node && node.classes && node.classes.includes(c));

/**
 * @typedef {Object} Ctx
 * @property {number} em Font size in base ems.
 * @property {string} family KaTeX family suffix, e.g. `Main`.
 * @property {string} fstyle `normal` or `italic`.
 * @property {string} weight `normal` or `bold`.
 * @property {'left'|'center'|'right'} align
 * @property {string|null} color
 * @property {object[]} chain Ancestor nodes, nearest last.
 */

function childCtx(ctx, node) {
  const c = { ...ctx, chain: ctx.chain.concat([node]) };
  const cls = node.classes || [];
  if (cls.length) {
    for (const [req, fam, st, wt] of FONT_RULES) {
      if (req.every((r) => cls.includes(r))) {
        if (fam) c.family = fam;
        if (st) c.fstyle = st;
        if (wt) c.weight = wt;
      }
    }
    const parent = ctx.chain[ctx.chain.length - 1];
    const grand = ctx.chain[ctx.chain.length - 2];
    if (parent && (hasCls(parent, 'delim-size1') || hasCls(parent, 'delim-size4'))) {
      if (ctx.chain.some((n) => hasCls(n, 'delimsizing') && hasCls(n, 'mult'))) c.family = hasCls(parent, 'delim-size1') ? 'Size1' : 'Size4';
    }
    if (cls.includes('sizing') || cls.includes('fontsize-ensurer')) {
      let reset = 0;
      let size = 0;
      for (const k of cls) {
        const r = /^reset-size(\d+)$/.exec(k);
        if (r) reset = +r[1];
        const s = /^size(\d+)$/.exec(k);
        if (s) size = +s[1];
      }
      if (reset && size) c.em = (ctx.em * SIZES[size - 1]) / SIZES[reset - 1];
    }
    if (cls.includes('msupsub') || cls.includes('svg-align')) c.align = 'left';
    if (cls.includes('x-arrow') || cls.includes('mover') || cls.includes('munder')) c.align = 'center';
    if (cls.includes('vlist-t') && parent) {
      if (hasCls(parent, 'op-limits') || hasCls(parent, 'accent')) c.align = 'center';
      for (const a of ['c', 'l', 'r']) {
        if (hasCls(parent, 'col-align-' + a) && ctx.chain.some((n) => hasCls(n, 'mtable'))) c.align = a === 'c' ? 'center' : a === 'l' ? 'left' : 'right';
      }
    }
    if (grand && hasCls(grand, 'mfrac') && node instanceof Span && parent instanceof Span) c.align = 'center';
  } else {
    const parent = ctx.chain[ctx.chain.length - 1];
    const grand = ctx.chain[ctx.chain.length - 2];
    if (grand && hasCls(grand, 'mfrac') && node instanceof Span && parent instanceof Span) c.align = 'center';
  }
  const style = node.style || {};
  if (style.color) c.color = style.color;
  return c;
}

function pickFont(ctx) {
  const fam = 'KaTeX_' + ctx.family;
  const want = ctx.weight === 'bold' ? (ctx.fstyle === 'italic' ? 'bolditalic' : 'bold') : ctx.fstyle === 'italic' ? 'italic' : 'regular';
  for (const s of [want, ctx.fstyle === 'italic' ? 'italic' : 'regular', 'regular', 'italic', 'bold', 'bolditalic']) {
    if (hasFont(fam, s)) return getFont(fam, s);
  }
  return getFont('KaTeX_Main', 'regular');
}

/** Resolve a code point to a font and glyph, falling back like the CSS font stack would. */
function glyphFor(ctx, cp) {
  const f = pickFont(ctx);
  let g = f.glyphIndex(cp);
  if (g) return [f, g];
  const alt = [
    ['KaTeX_Main', ctx.fstyle === 'italic' ? 'italic' : 'regular'],
    ['KaTeX_Main', 'regular'],
    ['KaTeX_AMS', 'regular'],
    ['KaTeX_Size1', 'regular'],
    ['Inter', 'regular'],
  ];
  for (const [fam, st] of alt) {
    if (!hasFont(fam, st)) continue;
    const ff = getFont(fam, st);
    g = ff.glyphIndex(cp);
    if (g) return [ff, g];
  }
  return [f, 0];
}

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

function symbolRuns(node, ctx) {
  const out = [];
  for (const ch of node.text) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) continue;
    const [font, gid] = glyphFor(ctx, cp);
    out.push({ ch, font, gid, adv: (font.advance(gid) / font.unitsPerEm) * ctx.em });
  }
  return out;
}

function symbolMargins(node, ctx) {
  let ml = 0;
  let mr = 0;
  if (node.italic > 0) mr = node.italic * ctx.em;
  const st = node.style || {};
  if (st.marginLeft) ml = len(st.marginLeft, ctx.em);
  if (st.marginRight) mr = len(st.marginRight, ctx.em);
  return [ml, mr];
}

/** Box properties of a span: display kind, margins, paddings, borders, explicit sizes. */
function boxOf(node, ctx, parentIsWrapper) {
  const cls = node.classes || [];
  const st = node.style || {};
  const em = ctx.em;
  const b = { ml: 0, mr: 0, pl: 0, pr: 0, bl: 0, br: 0, bt: 0, bb: 0, width: null, minWidth: 0, height: null, inlineBlock: parentIsWrapper, full: false };
  for (const c of cls) {
    const r = BOX_RULES[c];
    if (r) for (const k of Object.keys(r)) b[k] = r[k] * em;
    if (INLINE_BLOCK.has(c)) b.inlineBlock = true;
    if (FULL_WIDTH.has(c)) b.full = true;
  }
  if (cls.includes('nulldelimiter')) b.width = '0.12em';
  if (cls.includes('accent-body') && !cls.includes('accent-full')) b.width = '0em';
  if (cls.includes('llap') || cls.includes('rlap') || cls.includes('clap')) b.width = '0em';
  if (cls.includes('root') && hasCls(ctx.chain[ctx.chain.length - 2], 'sqrt')) {
    b.ml = 0.2777777778 * em;
    b.mr = -0.5555555556 * em;
  }
  if (st.margin) {
    const parts = String(st.margin).trim().split(/\s+/);
    const h = parts.length > 1 ? parts[1] : parts[0];
    b.ml = b.mr = len(h, em);
  }
  if (st.marginLeft) b.ml = len(st.marginLeft, em);
  if (st.marginRight) b.mr = len(st.marginRight, em);
  if (st.paddingLeft) b.pl = len(st.paddingLeft, em);
  if (st.borderWidth) b.bl = b.br = b.bt = b.bb = len(st.borderWidth, em);
  if (st.borderRightWidth) b.br = len(st.borderRightWidth, em);
  if (st.borderTopWidth) b.bt = len(st.borderTopWidth, em);
  if (st.borderBottomWidth) b.bb = len(st.borderBottomWidth, em);
  if (st.width) b.width = st.width;
  if (st.minWidth) b.minWidth = len(st.minWidth, em);
  if (st.height) b.height = len(st.height, em);
  return b;
}

/**
 * The layout engine. `width` returns the intrinsic (shrink-to-fit) margin-box
 * width of a node; `emit` places a node with its left margin edge at x and its
 * baseline at y (y up, base em units), appending drawable items to `out`.
 */
class Engine {
  constructor() {
    /** @type {WeakMap<object, number>} */
    this.memo = new WeakMap();
    /** @type {object[]} */
    this.out = [];
  }

  /** Children of a node, with KaTeX DocumentFragments flattened. */
  kids(node) {
    const res = [];
    for (const c of node.children || []) {
      if (c && !(c instanceof Span) && !(c instanceof Anchor) && !(c instanceof SymbolNode) && !(c instanceof SvgNode) && Array.isArray(c.children) && !c.src) res.push(...this.kids(c));
      else if (c) res.push(c);
    }
    return res;
  }

  width(node, ctx, wrapperChild = false) {
    const hit = this.memo.get(node);
    if (hit !== undefined) return hit;
    const w = this._width(node, ctx, wrapperChild);
    this.memo.set(node, w);
    return w;
  }

  _width(node, ctx, wrapperChild) {
    if (node instanceof SymbolNode) {
      const c = childCtx(ctx, node);
      const [ml, mr] = symbolMargins(node, c);
      return ml + mr + symbolRuns(node, c).reduce((s, r) => s + r.adv, 0);
    }
    if (node instanceof SvgNode || node instanceof PathNode || node instanceof LineNode) return 0;
    if (!(node instanceof Span || node instanceof Anchor)) {
      return node.style && node.style.width ? len(node.style.width, ctx.em) : 0;
    }
    const c = childCtx(ctx, node);
    if (hasCls(node, 'strut') || hasCls(node, 'pstrut')) return 0;
    if (hasCls(node, 'vlist-t')) return this.vlistWidth(node, c);
    const b = boxOf(node, c, wrapperChild);
    if (Object.keys(ABSOLUTE).some((k) => hasCls(node, k))) return 0;
    let content;
    if (b.width != null && !String(b.width).includes('%')) content = len(b.width, c.em);
    else if (b.full) content = 0;
    else content = this.kids(node).reduce((s, k) => s + this.width(k, c), 0);
    content = Math.max(content, b.minWidth);
    return b.ml + b.bl + b.pl + content + b.pr + b.br + b.mr;
  }

  vlistParts(node, ctx) {
    const rows = this.kids(node).filter((r) => hasCls(r, 'vlist-r'));
    const r0 = rows[0];
    const rctx = childCtx(ctx, r0);
    const cell = this.kids(r0).find((k) => hasCls(k, 'vlist'));
    const cctx = childCtx(rctx, cell);
    const wraps = this.kids(cell).map((w) => {
      const wctx = childCtx(cctx, w);
      const ks = this.kids(w);
      const pstrut = ks.find((k) => hasCls(k, 'pstrut'));
      const elem = ks.find((k) => k !== pstrut);
      const st = w.style || {};
      return {
        w,
        wctx,
        elem,
        P: pstrut ? len(pstrut.style.height, wctx.em) : 0,
        top: len(st.top, wctx.em),
        ml: len(st.marginLeft, wctx.em),
        mr: len(st.marginRight, wctx.em),
        explicitWidth: st.width || null,
      };
    });
    return { cctx, wraps };
  }

  vlistWidth(node, ctx) {
    const { wraps } = this.vlistParts(node, ctx);
    let w = 0;
    for (const p of wraps) {
      const inner = p.elem ? this.width(p.elem, p.wctx, true) : 0;
      w = Math.max(w, p.ml + inner + p.mr);
    }
    return w;
  }

  emitVlist(node, ctx, x, y) {
    const c = childCtx(ctx, node);
    const { wraps } = this.vlistParts(node, c);
    const cellW = this.width(node, ctx);
    for (const p of wraps) {
      if (!p.elem) continue;
      let avail = cellW - p.ml - p.mr;
      if (p.explicitWidth) avail = len(p.explicitWidth, p.wctx.em, cellW);
      const ew = this.width(p.elem, p.wctx, true);
      const eb = p.elem instanceof Span ? boxOf(p.elem, childCtx(p.wctx, p.elem), true) : null;
      const used = eb && eb.full ? Math.max(avail, eb.minWidth) : ew;
      let off = 0;
      if (p.wctx.align === 'center') off = (avail - used) / 2;
      else if (p.wctx.align === 'right') off = avail - used;
      off = Math.max(0, off);
      this.emit(p.elem, p.wctx, x + p.ml + off, y - (p.top + p.P), avail, true);
    }
  }

  emit(node, ctx, x, y, avail, wrapperChild = false) {
    if (node instanceof SymbolNode) {
      const c = childCtx(ctx, node);
      if (c.color === 'transparent') return;
      const [ml] = symbolMargins(node, c);
      let cx = x + ml;
      for (const r of symbolRuns(node, c)) {
        if (!/\s/.test(r.ch)) this.out.push({ kind: 'glyph', ch: r.ch, font: r.font, gid: r.gid, x: cx, y, em: c.em, color: c.color });
        cx += r.adv;
      }
      return;
    }
    if (!(node instanceof Span || node instanceof Anchor)) return;
    const c = childCtx(ctx, node);
    if (c.color === 'transparent') return;
    if (hasCls(node, 'strut') || hasCls(node, 'pstrut')) return;
    const st = node.style || {};
    if (st.top) y -= len(st.top, c.em);
    if (st.bottom) y += len(st.bottom, c.em);
    if (st.left) x += len(st.left, c.em);
    if (st.verticalAlign && !hasCls(node, 'strut')) y += len(st.verticalAlign, c.em);
    if (hasCls(node, 'vlist-t')) {
      this.emitVlist(node, ctx, x, y);
      return;
    }
    const b = boxOf(node, c, wrapperChild);
    let content;
    if (b.width != null) content = len(b.width, c.em, avail || 0);
    else if (b.full) content = avail || 0;
    else content = this.kids(node).reduce((s, k) => s + this.width(k, c), 0);
    content = Math.max(content, b.minWidth);
    const x0 = x + b.ml;
    const outerW = b.bl + b.pl + content + b.pr + b.br;
    const boxH = (b.height || 0) + b.bt + b.bb;
    this.borders(b, x0, y, outerW, boxH, c);
    const inner = x0 + b.bl + b.pl;
    const childAvail = b.inlineBlock ? content : avail;
    const svgs = this.kids(node).filter((k) => k instanceof SvgNode);
    const positioned = hasCls(node, 'hide-tail') || hasCls(node, 'stretchy') || (b.width != null && !String(b.width).includes('%'));
    const svgBox = positioned || !avail ? content : avail;
    for (const s of svgs) this.emitSvg(s, c, inner, y + boxH - b.bt, svgBox, b.height != null ? b.height : null, node);
    for (const k of this.kids(node)) {
      if (k instanceof Span) {
        const abs = Object.keys(ABSOLUTE).find((a) => hasCls(k, a));
        if (abs) {
          const [leftPct, wPct, side] = ABSOLUTE[abs];
          const w = wPct * content;
          const ax = side === 'left' ? inner + leftPct * content : inner + content - w;
          this.emitClipped(k, c, ax, y + boxH, w);
          continue;
        }
      }
      if (k instanceof SvgNode) continue;
      if (hasCls(node, 'llap') || hasCls(node, 'rlap') || hasCls(node, 'clap')) {
        const kw = this.width(k, c);
        let kx = inner;
        if (hasCls(node, 'llap')) kx = inner - kw;
        else if (hasCls(node, 'clap')) kx = inner - kw / 2;
        this.emit(k, c, kx, y, childAvail);
        continue;
      }
      this.emit(k, c, x0 + b.bl + b.pl + this.flowX(node, k, c), y, childAvail);
    }
  }

  flowX(parent, child, c) {
    let s = 0;
    for (const k of this.kids(parent)) {
      if (k === child) return s;
      s += this.width(k, c);
    }
    return s;
  }

  borders(b, x0, y, w, h, c) {
    const rect = (ax, ay, bx, by) => {
      if (bx - ax <= 0 || by - ay <= 0) return;
      this.out.push({ kind: 'rule', x: ax, y: ay, w: bx - ax, h: by - ay, color: c.color });
    };
    if (b.bb) rect(x0, y, x0 + w, y + b.bb);
    if (b.bt) rect(x0, y + h - b.bt, x0 + w, y + h);
    if (b.bl) rect(x0, y, x0 + b.bl, y + h);
    if (b.br) rect(x0 + w - b.br, y, x0 + w, y + h);
  }

  /** An absolutely positioned, overflow-hidden span holding an SVG (stretchy pieces). */
  emitClipped(span, ctx, x, yTop, w) {
    const c = childCtx(ctx, span);
    const h = len((span.style || {}).height, c.em);
    for (const s of this.kids(span)) {
      if (s instanceof SvgNode) this.emitSvg(s, c, x, yTop, w, h, span, [x, x + w]);
    }
  }

  /**
   * Place an SVG whose top-left corner is at (x, yTop). Its width is its own
   * style width or 100% of the containing box; its height is inherited from
   * the parent's CSS height or taken from the attribute.
   */
  emitSvg(svg, ctx, x, yTop, boxW, inheritedH, parent, clip) {
    const a = svg.attributes || {};
    let w = boxW;
    const sm = /width:\s*([-\d.]+em)/.exec(a.style || '');
    if (sm) w = len(sm[1], ctx.em);
    const h = inheritedH != null ? inheritedH : len(a.height, ctx.em);
    let clipX0 = x;
    let clipX1 = x + w;
    if (clip) {
      clipX0 = Math.max(clipX0, clip[0]);
      clipX1 = Math.min(clipX1, clip[1]);
    }
    if (hasCls(parent, 'hide-tail') || hasCls(parent, 'stretchy')) clipX1 = Math.min(clipX1, x + boxW);
    let vb = [0, 0, w, h];
    let unitScale = 1;
    if (a.viewBox) vb = a.viewBox.trim().split(/[\s,]+/).map(Number);
    else unitScale = 0;
    const par = (a.preserveAspectRatio || 'xMidYMid meet').trim().split(/\s+/);
    let sx;
    let sy;
    let tx = 0;
    let ty = 0;
    if (unitScale === 0) {
      sx = sy = 1;
    } else if (par[0] === 'none') {
      sx = w / vb[2];
      sy = h / vb[3];
    } else {
      const slice = par[1] === 'slice';
      const s = slice ? Math.max(w / vb[2], h / vb[3]) : Math.min(w / vb[2], h / vb[3]);
      sx = sy = s;
      const al = par[0];
      if (al.startsWith('xMid')) tx = (w - vb[2] * s) / 2;
      else if (al.startsWith('xMax')) tx = w - vb[2] * s;
      if (al.includes('YMid')) ty = (h - vb[3] * s) / 2;
      else if (al.includes('YMax')) ty = h - vb[3] * s;
    }
    const m = [sx, 0, 0, -sy, x + tx - vb[0] * sx, yTop - ty + vb[1] * sy];
    for (const p of svg.children || []) {
      let path;
      if (p instanceof PathNode) {
        const markup = p.toMarkup();
        const d = /d="([^"]*)"/.exec(markup)[1].replace(/&amp;/g, '&');
        path = transformPath(parseSVGPath(d), m);
      } else if (p instanceof LineNode) {
        const at = p.attributes;
        const px = (v) => x + len(v, ctx.em, w) + (String(v).match(/^[-\d.]+$/) ? parseFloat(v) : 0);
        const py = (v) => yTop - (len(v, ctx.em, h) + (String(v).match(/^[-\d.]+$/) ? parseFloat(v) : 0));
        const x1 = px(at.x1);
        const y1 = py(at.y1);
        const x2 = px(at.x2);
        const y2 = py(at.y2);
        const sw = len(at['stroke-width'] || '0.04em', ctx.em) / 2;
        const L = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = (-(y2 - y1) / L) * sw;
        const ny = ((x2 - x1) / L) * sw;
        path = new PathBuilder().moveTo(x1 + nx, y1 + ny).lineTo(x2 + nx, y2 + ny).lineTo(x2 - nx, y2 - ny).lineTo(x1 - nx, y1 - ny).close().build();
      } else continue;
      const yLo = yTop - h;
      for (const sp of path.subpaths) {
        const pts = sp.points;
        for (let i = 0; i < pts.length; i += 2) {
          pts[i] = Math.min(clipX1, Math.max(clipX0, pts[i]));
          pts[i + 1] = Math.min(yTop, Math.max(yLo, pts[i + 1]));
        }
      }
      this.out.push({ kind: 'svg', path, x: clipX0, y: yTop - h, color: ctx.color });
    }
  }
}

function findHtml(node) {
  if (hasCls(node, 'katex-html')) return node;
  for (const c of node.children || []) {
    const r = findHtml(c);
    if (r) return r;
  }
  return null;
}

/**
 * Lay out a KaTeX HTML tree. Returns items in base em units.
 */
function layoutTree(tree) {
  const eng = new Engine();
  const html = findHtml(tree);
  if (!html) throw new Error('tex: KaTeX produced no HTML tree');
  const root = { em: 1, family: 'Main', fstyle: 'normal', weight: 'normal', align: 'left', color: null, chain: [tree] };
  const ctx = childCtx(root, html);
  let x = 0;
  let y = 0;
  let width = 0;
  let lineAsc = 0;
  let lineDesc = 0;
  let height = 0;
  let depth = 0;
  const tags = [];
  const kids = eng.kids(html);
  kids.forEach((k) => {
    if (hasCls(k, 'tag')) {
      tags.push(k);
      return;
    }
    if (hasCls(k, 'newline')) {
      const next = kids.slice(kids.indexOf(k) + 1).find((n) => hasCls(n, 'base'));
      const asc = next ? Math.max(0.9155, next.height) : 0.9155;
      y -= Math.max(lineDesc, 0.2845) + asc + len((k.style || {}).marginTop, 1);
      depth = Math.max(depth, -y + (next ? next.depth : 0));
      x = 0;
      lineAsc = 0;
      lineDesc = 0;
      return;
    }
    eng.emit(k, ctx, x, y, 0);
    x += eng.width(k, ctx);
    width = Math.max(width, x);
    lineAsc = Math.max(lineAsc, k.height || 0);
    lineDesc = Math.max(lineDesc, k.depth || 0);
    if (y === 0) height = Math.max(height, k.height || 0);
    depth = Math.max(depth, -y + (k.depth || 0));
  });
  for (const t of tags) {
    const tx = width + 1;
    eng.emit(t, ctx, tx, 0, 0);
    width = tx + eng.width(t, ctx);
  }
  return { items: eng.out, width, height, depth };
}

// ---------------------------------------------------------------------------
// Tokenizer and probe rendering for per-token addressing.

/**
 * @typedef {Object} TexToken
 * @property {number} index
 * @property {string} text Normalized token text (e.g. `\frac`, `x`, `\left(`, `\begin{pmatrix}`).
 * @property {number} start Source offset.
 * @property {number} end Source offset (exclusive).
 * @property {'command'|'char'|'space'|'open'|'close'|'script'|'align'} kind
 * @property {number[]} glyphs Indices into `paths` of the items this token produced.
 */

const DELIM_CMDS = /^\\(left|right|middle|big|Big|bigg|Bigg)(l|r|m)?$/;

/**
 * Split TeX source into tokens. Delimiter-sizing commands absorb their
 * delimiter (`\left(`), and `\begin{env}` / `\end{env}` are single tokens.
 * @param {string} src
 * @returns {TexToken[]}
 */
export function tokenize(src) {
  const toks = [];
  let i = 0;
  const push = (text, start, end, kind) => toks.push({ index: toks.length, text, start, end, kind, glyphs: [] });
  const readCmd = (p) => {
    if (src[p] !== '\\') return null;
    let q = p + 1;
    if (q >= src.length) return { text: '\\', end: q };
    if (/[A-Za-z@]/.test(src[q])) {
      while (q < src.length && /[A-Za-z@]/.test(src[q])) q++;
      if (src[q] === '*' && /^\\(operatorname|tag|hspace|vspace)$/.test(src.slice(p, q))) q++;
    } else q = q + 1;
    return { text: src.slice(p, q), end: q };
  };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      push(' ', i, j, 'space');
      i = j;
      continue;
    }
    if (ch === '%') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      push(' ', i, j, 'space');
      i = j;
      continue;
    }
    if (ch === '\\') {
      const c = readCmd(i);
      let text = c.text;
      let end = c.end;
      if (DELIM_CMDS.test(text)) {
        let j = end;
        while (j < src.length && /\s/.test(src[j])) j++;
        const d = src[j] === '\\' ? readCmd(j) : j < src.length ? { text: src[j], end: j + 1 } : null;
        if (d) {
          text += d.text;
          end = d.end;
        }
      } else if (text === '\\begin' || text === '\\end') {
        const m = /^\s*\{([^}]*)\}/.exec(src.slice(end));
        if (m) {
          text += '{' + m[1] + '}';
          end += m[0].length;
        }
      }
      push(text, i, end, 'command');
      i = end;
      continue;
    }
    const cp = src.codePointAt(i);
    const s = String.fromCodePoint(cp);
    const kind = ch === '{' ? 'open' : ch === '}' ? 'close' : ch === '^' || ch === '_' || ch === "'" ? 'script' : ch === '&' ? 'align' : 'char';
    push(s, i, i + s.length, kind);
    i += s.length;
  }
  return toks;
}

/**
 * Argument specs for commands: m = math argument (recursed), t = text-mode
 * argument (recursed), r = raw argument (copied verbatim), o = optional math
 * argument in brackets, R = optional raw argument. Commands listed in
 * NO_WRAP are declarations or spacing and are never wrapped.
 */
const ARGS = {};
const def = (spec, names) => names.split(' ').forEach((n) => (ARGS['\\' + n] = spec));
def('mm', 'frac dfrac tfrac cfrac binom dbinom tbinom stackrel overset underset buildrel');
def('om', 'sqrt xrightarrow xleftarrow xleftrightarrow xRightarrow xLeftarrow xLeftrightarrow xhookleftarrow xhookrightarrow xmapsto xrightharpoondown xrightharpoonup xleftharpoondown xleftharpoonup xrightleftharpoons xleftrightharpoons xlongequal xtwoheadrightarrow xtwoheadleftarrow xtofrom');
def('m', 'substack hat widehat check widecheck tilde widetilde bar vec dot ddot dddot ddddot breve acute grave mathring overline underline overbrace underbrace overrightarrow overleftarrow overleftrightarrow underrightarrow underleftarrow underleftrightarrow overgroup undergroup overlinesegment underlinesegment utilde Overrightarrow boxed phantom hphantom vphantom smash cancel bcancel xcancel sout mathbb mathbf mathrm mathit mathcal mathfrak mathscr mathsf mathtt mathnormal boldsymbol bm pmb mathbin mathrel mathord mathopen mathclose mathpunct mathinner mathop mathllap mathrlap mathclap llap rlap clap underbar Bbb bold frak');
def('t', 'text textrm textbf textit textsf texttt textnormal textup textmd emph mbox hbox textsc');
def('rm', 'textcolor colorbox');
def('rrm', 'fcolorbox');
def('rm', 'htmlClass htmlId htmlStyle htmlData href raisebox');
def('r', 'operatorname operatorname* url verb tag tag* label ref eqref');
def('Rrr', 'rule');
def('rmm', 'genfrac');
def('t', "' ` ^ \" ~ = . u v H r c");
const NO_WRAP = new Set(
  (
    'displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits nonumber notag hline hdashline cr ' +
    'quad qquad enspace thinspace medspace thickspace negthinspace negmedspace negthickspace space nobreak allowbreak ' +
    'tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge rm bf it sf tt cal ' +
    'color hspace hskip kern mkern mskip mspace vspace'
  ).split(' ').map((n) => '\\' + n)
);
const SPACING = new Set(['\\,', '\\;', '\\:', '\\!', '\\ ', '\\>', '~', '\\\\', '\\newline']);
const DECL_ARG = { '\\color': 'r', '\\hspace': 'r', '\\hspace*': 'r', '\\hskip': 'r', '\\kern': 'r', '\\mkern': 'r', '\\mskip': 'r', '\\mspace': 'r', '\\vspace': 'r' };

/**
 * Build the probe source: every glyph-producing unit wrapped in
 * `\textcolor{#nnnnnn}{...}`, where the color encodes a probe id. KaTeX
 * treats color groups as transparent fragments, so spacing and atom classes
 * are unchanged. Script bases are never wrapped (a colored base would lose its
 * italic correction and op limits); the whole `base^sup_sub` is wrapped
 * instead and its base inherits that color.
 * @param {TexToken[]} toks
 * @param {boolean} coarse Wrap only top-level units.
 * @returns {{source: string, owners: (number[] & {primes?: number[]})[]}} Probe source and, per probe id, the owning token indices (plus prime tokens of a script base).
 */
function probeSource(toks, coarse) {
  const owners = [];
  const newId = (list) => {
    owners.push(list);
    return owners.length;
  };
  const color = (id) => '#' + id.toString(16).padStart(6, '0');
  let p = 0;
  const skipSpace = () => {
    let s = '';
    while (p < toks.length && toks[p].kind === 'space') s += ' ', p++;
    return s;
  };
  const raw = (t) => t.text;

  /** Read one argument: a braced group or a single token. Returns {text, toks: [start, end)}. */
  const readArg = (mode, kind, depth) => {
    const sp = skipSpace();
    if (p >= toks.length) return sp;
    const t = toks[p];
    if (kind === 'r' || kind === 'R') {
      if (kind === 'R' && t.text !== '[') return sp;
      if (t.kind === 'open' || t.text === '[') {
        const close = t.kind === 'open' ? '}' : ']';
        let lvl = 0;
        let s = '';
        do {
          const u = toks[p++];
          if (u.kind === 'open' || u.text === '[') lvl += u.kind === 'open' || close === ']' ? 1 : 0;
          if (u.kind === 'close' || (close === ']' && u.text === ']')) lvl -= 1;
          s += u.kind === 'space' ? ' ' : raw(u);
        } while (p < toks.length && lvl > 0);
        return sp + s;
      }
      p++;
      return sp + raw(t);
    }
    if (kind === 'o') {
      if (t.text !== '[') return sp;
      p++;
      const body = seq(mode, (u) => u.text === ']', depth + 1);
      p++;
      return sp + '[' + body + ']';
    }
    if (t.kind === 'open') {
      p++;
      const body = seq(mode, (u) => u.kind === 'close', depth + 1);
      p++;
      return sp + '{' + body + '}';
    }
    return sp + '{' + unit(mode, depth + 1) + '}';
  };

  const readArgs = (spec, mode, depth) => {
    let s = '';
    for (const k of spec) s += readArg(k === 't' ? 'text' : mode, k, depth);
    return s;
  };

  /** Parse one unit (atom or command with its arguments). Returns [text, ownerTokens] unwrapped. */
  const bare = (mode, depth) => {
    const t = toks[p++];
    if (t.kind === 'open') {
      const body = seq(mode, (u) => u.kind === 'close', depth + 1);
      p++;
      return ['{' + body + '}', [], false];
    }
    if (t.text === '$' && mode === 'text') {
      const body = seq('math', (u) => u.text === '$', depth + 1);
      p++;
      return ['$' + body + '$', [], false];
    }
    if (/^\\left/.test(t.text)) {
      const own = [t.index];
      let body = '';
      for (;;) {
        body += seq(mode, (u) => /^\\(middle|right)/.test(u.text), depth + 1);
        if (p >= toks.length) break;
        const u = toks[p++];
        own.push(u.index);
        body += ' ' + u.text + ' ';
        if (/^\\right/.test(u.text)) break;
      }
      return [t.text + ' ' + body, own, true];
    }
    if (/^\\begin\{/.test(t.text)) {
      const name = t.text.slice(7, -1);
      let args = '';
      if (name === 'array' || name === 'darray' || name === 'subarray') args = readArg(mode, 'r', depth);
      const body = seq(mode, (u) => u.text === '\\end{' + name + '}', depth + 1);
      const own = [t.index];
      let end = '';
      if (p < toks.length) {
        own.push(toks[p].index);
        end = toks[p++].text;
      }
      return [t.text + args + body + end, own, true];
    }
    if (t.kind === 'command') {
      const spec = ARGS[t.text];
      if (spec) {
        const inner = coarse ? rawArgs(spec) : readArgs(spec, mode, depth);
        return [t.text + inner, [t.index], true];
      }
      return [t.text + (/^\\[A-Za-z@]+$/.test(t.text) ? ' ' : ''), [t.index], true];
    }
    return [t.text, [t.index], true];
  };

  const rawArgs = (spec) => {
    let s = '';
    for (const k of spec) s += readArg('math', k === 'o' ? 'R' : 'r', 0);
    return s;
  };

  const wrap = (text, own) => '\\textcolor{' + color(newId(own)) + '}{' + text + '}';

  const unit = (mode, depth) => {
    const t = toks[p];
    if (t.kind === 'command' && (NO_WRAP.has(t.text) || SPACING.has(t.text))) {
      p++;
      const a = DECL_ARG[t.text];
      return t.text + (a ? readArg(mode, a, depth) : /^\\[A-Za-z@]+$/.test(t.text) ? ' ' : '');
    }
    if (t.kind === 'align' || t.text === '~' || (t.kind === 'command' && t.text === '\\\\')) {
      p++;
      let s = t.text;
      if (t.text === '\\\\' && toks[p] && toks[p].text === '[') s += readArg(mode, 'R', depth);
      return s;
    }
    const startP = p;
    const bareBase = t.kind === 'script';
    const [text, own, colorable] = bareBase ? ['', [], true] : bare(mode, depth);
    let q = p;
    while (q < toks.length && toks[q].kind === 'space') q++;
    const scripted = bareBase || (mode === 'math' && q < toks.length && (toks[q].kind === 'script' || toks[q].text === '\\limits' || toks[q].text === '\\nolimits'));
    if (scripted) {
      let s = text;
      const baseOwn = own.slice();
      const primes = [];
      while (p < toks.length) {
        skipSpace();
        const u = toks[p];
        if (!u) break;
        if (u.text === '\\limits' || u.text === '\\nolimits') {
          s += u.text + ' ';
          p++;
          continue;
        }
        if (u.kind !== 'script') break;
        p++;
        if (u.text === "'") {
          s += "'";
          primes.push(u.index);
          continue;
        }
        s += u.text + readArg(mode, 'm', depth);
      }
      if (coarse && depth > 0) return s;
      baseOwn.primes = primes;
      return wrap(s, baseOwn);
    }
    if (!colorable || (coarse && depth > 0) || (mode === 'text' && toks[startP].kind === 'space')) return text;
    return wrap(text, own);
  };

  const seq = (mode, stop, depth) => {
    let s = '';
    while (p < toks.length && !stop(toks[p])) {
      if (toks[p].kind === 'space') {
        s += ' ';
        p++;
        continue;
      }
      s += unit(mode, depth);
    }
    return s;
  };

  const source = seq('math', () => false, 0);
  return { source, owners };
}

/** Parse a probe color back to its id, or 0. */
function probeId(color) {
  if (!color) return 0;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  return m ? parseInt(m[1], 16) : 0;
}

function sameShape(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind) return false;
    if (a[i].kind === 'glyph' && a[i].ch !== b[i].ch) return false;
  }
  return true;
}

/**
 * Assign each item a token index from a probe layout. Items sharing a probe
 * id form runs in output order; run k goes to owner k (clamped), so a
 * `\left( ... \right)` pair or a base with primes splits correctly.
 */
function assignOwners(probeItems, owners) {
  const res = new Array(probeItems.length).fill(-1);
  const runs = new Map();
  let prev = -1;
  probeItems.forEach((it, i) => {
    const id = probeId(it.color);
    if (!id) {
      prev = -1;
      return;
    }
    if (!runs.has(id)) runs.set(id, []);
    const r = runs.get(id);
    if (id !== prev) r.push([]);
    r[r.length - 1].push(i);
    prev = id;
  });
  for (const [id, allRuns] of runs) {
    const own = owners[id - 1] || [];
    if (!own.length) continue;
    const primes = own.primes || [];
    let rs = allRuns;
    if (primes.length) {
      let q = 0;
      rs = allRuns.map((run) =>
        run.filter((i) => {
          if (probeItems[i].ch !== '\u2032' || q >= primes.length) return true;
          res[i] = primes[q++];
          return false;
        })
      ).filter((run) => run.length);
    }
    rs.forEach((run, k) => {
      const o = own[Math.min(k, own.length - 1)];
      for (const i of run) res[i] = o;
    });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Public API.

/**
 * @typedef {Object} TexItem
 * @property {Path} path Outline in world units, positioned.
 * @property {number} tokenIndex Index into `tokens` of the source token that produced this item, or -1.
 * @property {string} text The glyph character, or the owning token's text for rules and SVG shapes.
 * @property {'glyph'|'rule'|'svg'} kind
 * @property {number} x Glyph origin x (for rules and shapes: left edge), world units.
 * @property {number} y Glyph baseline y (for rules and shapes: bottom edge), world units, y up.
 * @property {string|null} color CSS color from `\color` / `\textcolor`, or null for the default.
 */

/**
 * @typedef {Object} TexResult
 * @property {string} source The TeX source.
 * @property {TexItem[]} paths Drawable items in KaTeX's DOM order.
 * @property {number} width Horizontal extent, world units.
 * @property {number} height Height above the baseline, world units.
 * @property {number} depth Depth below the baseline (positive number), world units.
 * @property {TexToken[]} tokens Source tokens with the items each produced.
 * @property {'exact'|'coarse'|'none'} mapping How item-to-token mapping was obtained.
 * @property {(sub: string, nth?: number) => number[]} part Item indices produced by a TeX substring (nth occurrence).
 */

/**
 * @typedef {Object} TexOptions
 * @property {number} [size=1] Math font size (KaTeX em) in world units.
 * @property {boolean} [display=false] Display style (`\displaystyle`, centered limits).
 * @property {Record<string, string>} [macros] Extra KaTeX macros.
 */

const layoutCache = new Map();

function render(src, display, macros) {
  const key = (display ? 'D' : 'T') + JSON.stringify(macros || {}) + '\u0000' + src;
  let hit = layoutCache.get(key);
  if (!hit) {
    const tree = katex.__renderToHTMLTree(src, { displayMode: !!display, output: 'html', throwOnError: true, macros: { ...(macros || {}) }, strict: 'ignore' });
    hit = layoutTree(tree);
    if (layoutCache.size > 500) layoutCache.clear();
    layoutCache.set(key, hit);
  }
  return hit;
}

function itemPath(it, size) {
  if (it.kind === 'glyph') {
    const k = (it.em * size) / it.font.unitsPerEm;
    return transformPath(it.font.glyphPath(it.gid), [k, 0, 0, k, it.x * size, it.y * size]);
  }
  if (it.kind === 'rule') {
    const x0 = it.x * size;
    const y0 = it.y * size;
    const x1 = (it.x + it.w) * size;
    const y1 = (it.y + it.h) * size;
    return new PathBuilder().moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).close().build();
  }
  return transformPath(it.path, [size, 0, 0, size, 0, 0]);
}

/**
 * Typeset TeX math into positioned paths with per-token addressing.
 *
 * Token mapping: the source is split into tokens ({@link tokenize}), then a
 * second "probe" copy of the formula is rendered in which every glyph-making
 * unit is wrapped in `\textcolor` with a unique color. Color groups do not
 * change KaTeX's layout, so the probe yields the same item sequence (this is
 * checked); each item's probe color names the token that produced it. If the
 * fine probe fails to parse or its item sequence differs, a coarse probe that
 * wraps only top-level units is tried, and failing that items are left
 * unmapped (`tokenIndex` -1, `mapping: 'none'`).
 *
 * @param {string} src TeX math source (no surrounding `$`).
 * @param {TexOptions} [opts]
 * @returns {TexResult}
 */
export function texToPaths(src, opts = {}) {
  const size = opts.size == null ? 1 : opts.size;
  const main = render(src, opts.display, opts.macros);
  const tokens = tokenize(src);
  let owner = null;
  let mapping = 'none';
  for (const coarse of [false, true]) {
    try {
      const probe = probeSource(tokens, coarse);
      const pl = render(probe.source, opts.display, opts.macros);
      if (sameShape(pl.items, main.items)) {
        owner = assignOwners(pl.items, probe.owners);
        mapping = coarse ? 'coarse' : 'exact';
        break;
      }
    } catch {
      owner = null;
    }
  }
  /** @type {TexItem[]} */
  const paths = main.items.map((it, i) => {
    const tokenIndex = owner ? owner[i] : -1;
    const text = it.kind === 'glyph' ? it.ch : tokenIndex >= 0 ? tokens[tokenIndex].text : '';
    return { path: itemPath(it, size), tokenIndex, text, kind: it.kind, x: it.x * size, y: it.y * size, color: it.color || null };
  });
  const tag = tokens.find((t) => /^\\tag\*?$/.test(t.text));
  if (tag && owner) {
    for (const p of paths) {
      if (p.tokenIndex < 0) {
        p.tokenIndex = tag.index;
        if (p.kind !== 'glyph') p.text = tag.text;
      }
    }
  }
  paths.forEach((p, i) => {
    if (p.tokenIndex >= 0) tokens[p.tokenIndex].glyphs.push(i);
  });
  const result = {
    source: src,
    paths,
    width: main.width * size,
    height: main.height * size,
    depth: main.depth * size,
    tokens,
    mapping,
    part: (sub, nth = 0) => texPart(result, sub, nth),
  };
  return result;
}

const significant = (t) => t.kind !== 'space' && t.kind !== 'open' && t.kind !== 'close';

/**
 * Item indices produced by a substring of the TeX source. The substring is
 * first looked up verbatim; if absent, its tokens are matched against the
 * source's tokens ignoring spaces and braces, so `x^2` also finds `x^{2}`.
 * @param {TexResult} result
 * @param {string} sub
 * @param {number} [nth=0] Which occurrence.
 * @returns {number[]} Sorted item indices; empty if not found.
 */
export function texPart(result, sub, nth = 0) {
  const collect = (s, e) => {
    const out = [];
    for (const t of result.tokens) if (t.start >= s && t.end <= e) out.push(...t.glyphs);
    return out.sort((a, b) => a - b);
  };
  let from = 0;
  let count = 0;
  for (;;) {
    const at = result.source.indexOf(sub, from);
    if (at < 0) break;
    if (count === nth) return collect(at, at + sub.length);
    count++;
    from = at + 1;
  }
  const want = tokenize(sub).filter(significant).map((t) => t.text);
  if (!want.length) return [];
  const have = result.tokens.filter(significant);
  count = 0;
  for (let i = 0; i + want.length <= have.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length && ok; k++) ok = have[i + k].text === want[k];
    if (!ok) continue;
    if (count === nth) return collect(have[i].start, have[i + want.length - 1].end);
    count++;
  }
  return [];
}

/**
 * Color items by token text: every item whose owning token's text is a key
 * of `colors` gets that color. Keys may also be source substrings, colored
 * through {@link texPart}. Returns a new result; the input is not changed.
 * @param {TexResult} result
 * @param {Record<string, string>} colors Token text or substring to CSS color.
 * @returns {TexResult}
 */
export function colorByToken(result, colors) {
  const paths = result.paths.map((p) => ({ ...p }));
  for (const [key, col] of Object.entries(colors)) {
    let hit = false;
    for (const t of result.tokens) {
      if (t.text !== key) continue;
      for (const i of t.glyphs) paths[i].color = col;
      hit = hit || t.glyphs.length > 0;
    }
    if (!hit) {
      for (let n = 0; ; n++) {
        const idx = texPart(result, key, n);
        if (!idx.length) break;
        for (const i of idx) paths[i].color = col;
      }
    }
  }
  const out = { ...result, paths };
  out.part = (sub, nth = 0) => texPart(out, sub, nth);
  return out;
}

/**
 * @typedef {Object} TokenMatch
 * @property {[number, number][]} pairs Item index in A paired with item index in B.
 * @property {number[]} unmatchedA Items of A with no partner (fade out).
 * @property {number[]} unmatchedB Items of B with no partner (fade in).
 */

/**
 * Match items between two typeset expressions for morphing. Significant
 * tokens (not spaces or braces) are aligned with a longest common
 * subsequence over their texts; matched tokens pair their items in order.
 * Leftover tokens with equal text are then paired in order, so reordered
 * terms still morph. Everything else is reported as unmatched.
 * @param {TexResult} a
 * @param {TexResult} b
 * @returns {TokenMatch}
 */
export function matchTokens(a, b) {
  const ta = a.tokens.filter((t) => significant(t) && t.glyphs.length);
  const tb = b.tokens.filter((t) => significant(t) && t.glyphs.length);
  const n = ta.length;
  const m = tb.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = ta[i].text === tb[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const tokPairs = [];
  const usedA = new Set();
  const usedB = new Set();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i].text === tb[j].text) {
      tokPairs.push([ta[i], tb[j]]);
      usedA.add(i);
      usedB.add(j);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  for (let i = 0; i < n; i++) {
    if (usedA.has(i)) continue;
    for (let j = 0; j < m; j++) {
      if (!usedB.has(j) && ta[i].text === tb[j].text) {
        tokPairs.push([ta[i], tb[j]]);
        usedA.add(i);
        usedB.add(j);
        break;
      }
    }
  }
  const pairs = [];
  const pa = new Set();
  const pb = new Set();
  for (const [x, y] of tokPairs) {
    const k = Math.min(x.glyphs.length, y.glyphs.length);
    for (let q = 0; q < k; q++) {
      pairs.push([x.glyphs[q], y.glyphs[q]]);
      pa.add(x.glyphs[q]);
      pb.add(y.glyphs[q]);
    }
  }
  pairs.sort((u, v) => u[0] - v[0]);
  return {
    pairs,
    unmatchedA: a.paths.map((_, i) => i).filter((i) => !pa.has(i)),
    unmatchedB: b.paths.map((_, i) => i).filter((i) => !pb.has(i)),
  };
}
