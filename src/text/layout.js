/**
 * Text layout: turns a string into positioned glyph outlines.
 *
 * Shaping applies the font's pair kerning (GPOS or kern table) and letter
 * spacing. Paragraphs split at newlines; lines break either greedily (first
 * fit) or with the Knuth-Plass total-fit algorithm, which minimizes the sum
 * of squared line badness plus penalties over the whole paragraph. Justified
 * text uses Knuth-Plass by default, since it keeps inter-word spacing even.
 *
 * Coordinates are world units with y pointing up. The origin is the top-left
 * corner of the layout box, so glyphs sit at negative y: the first baseline
 * is at `y = -ascender * size / unitsPerEm` and each further line is
 * `lineHeight * size` lower.
 *
 * @module text/layout
 */

import { transformPath, mergePaths } from '../core/path.js';
import { getFont, hasFont } from './fonts.js';

/**
 * @typedef {import('../core/path.js').Path} Path
 * @typedef {import('./ttf.js').Font} Font
 */

/**
 * @typedef {Object} PositionedGlyph
 * @property {string} char The character (one code point).
 * @property {number} glyphId Glyph id in its font.
 * @property {Path} path Outline in world units, already positioned.
 * @property {number} x Glyph origin x (world units).
 * @property {number} y Glyph origin (baseline) y, world units, y up.
 * @property {number} advance Horizontal advance in world units, including kerning and letter spacing.
 * @property {number} cluster Index of the character in the source string (UTF-16 code unit offset).
 * @property {number} line Line number, starting at 0.
 */

/**
 * @typedef {Object} LayoutLine
 * @property {number} start Source offset of the first character on the line.
 * @property {number} end Source offset just past the last character on the line.
 * @property {number} x Left edge of the line's ink advance box.
 * @property {number} y Baseline y.
 * @property {number} width Natural width after justification.
 * @property {number[]} glyphs Indices into `paths` of the glyphs on this line.
 */

/**
 * @typedef {Object} TextLayout
 * @property {PositionedGlyph[]} paths One entry per visible glyph, in reading order. Whitespace has no entry.
 * @property {number} width Width of the layout box.
 * @property {number} height Height of the layout box (ascender of the first line to descender of the last).
 * @property {number} baseline y of the first baseline (negative: below the top edge at y = 0).
 * @property {LayoutLine[]} lines
 */

/**
 * @typedef {Object} TextOptions
 * @property {Font|string} [font='Inter'] A parsed font or a registered family name.
 * @property {string} [style='regular'] Style when `font` is a family name.
 * @property {Font[]} [fallbacks] Fonts tried, in order, for characters the main font lacks.
 * @property {number} [size=1] Font size (the em) in world units.
 * @property {number} [letterSpacing=0] Extra space after each character, in em.
 * @property {number} [lineHeight=1.2] Baseline-to-baseline distance, in em.
 * @property {number} [maxWidth=Infinity] Wrap width in world units.
 * @property {'left'|'center'|'right'|'justify'} [align='left']
 * @property {'greedy'|'optimal'} [breaking] Line breaking; defaults to `optimal` for justified text, `greedy` otherwise.
 * @property {boolean} [kerning=true] Apply the font's pair kerning.
 * @property {number} [tabSize=4] Spaces per tab character.
 */

const HYPHENS = new Set([0x2d, 0x2010, 0x2013]);
const INF_PENALTY = 10000;
const FILL = 1e9;

function resolveFont(opts) {
  const f = opts.font == null ? 'Inter' : opts.font;
  return typeof f === 'string' ? getFont(f, opts.style || 'regular') : f;
}

/**
 * Shape one paragraph (no newlines) into glyph records in em units.
 */
function shape(text, offset, font, fallbacks, opts) {
  const out = [];
  const spacing = opts.letterSpacing || 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    const len = cp > 0xffff ? 2 : 1;
    const ch = String.fromCodePoint(cp);
    const space = cp === 0x20 || cp === 0xa0 || cp === 0x3000 || cp === 9;
    let f = font;
    let gid = font.glyphIndex(cp === 9 ? 0x20 : cp);
    if (!gid && !space) {
      for (const fb of fallbacks) {
        const g = fb.glyphIndex(cp);
        if (g) {
          f = fb;
          gid = g;
          break;
        }
      }
    }
    let adv = f.advance(gid) / f.unitsPerEm;
    if (cp === 9) adv *= opts.tabSize == null ? 4 : opts.tabSize;
    out.push({ ch, cp, font: f, gid, adv: adv + spacing, cluster: offset + i, space, hyphen: HYPHENS.has(cp) });
    i += len;
  }
  if (opts.kerning !== false) {
    for (let k = 0; k + 1 < out.length; k++) {
      const a = out[k];
      const b = out[k + 1];
      if (a.font === b.font && !a.space && !b.space) a.adv += a.font.kerning(a.gid, b.gid) / a.font.unitsPerEm;
    }
  }
  return out;
}

/**
 * Build Knuth-Plass items (boxes, glue, penalties) for a shaped paragraph.
 * Widths are in em. Words wider than the line get break points between
 * characters so no line has to overflow.
 */
function buildItems(glyphs, lineWidth, spacing) {
  const items = [];
  let k = 0;
  while (k < glyphs.length) {
    const g = glyphs[k];
    if (g.space) {
      const w = g.adv;
      const base = w - spacing;
      items.push({ type: 'glue', width: w, stretch: base * 0.5, shrink: base / 3, glyphs: [k] });
      k++;
      continue;
    }
    let end = k;
    while (end < glyphs.length && !glyphs[end].space) end++;
    const word = [];
    let cur = [];
    for (let j = k; j < end; j++) {
      cur.push(j);
      if (glyphs[j].hyphen && j + 1 < end) {
        word.push(cur);
        cur = [];
      }
    }
    word.push(cur);
    word.forEach((frag, fi) => {
      const width = frag.reduce((s, j) => s + glyphs[j].adv, 0);
      if (width > lineWidth) {
        frag.forEach((j, ci) => {
          if (ci > 0) items.push({ type: 'penalty', width: 0, penalty: 1000, flagged: false });
          items.push({ type: 'box', width: glyphs[j].adv, glyphs: [j] });
        });
      } else {
        items.push({ type: 'box', width, glyphs: frag });
      }
      if (fi < word.length - 1) items.push({ type: 'penalty', width: 0, penalty: 50, flagged: true });
    });
    k = end;
  }
  while (items.length && items[items.length - 1].type === 'glue') items.pop();
  items.push({ type: 'glue', width: 0, stretch: FILL, shrink: 0, glyphs: [] });
  items.push({ type: 'penalty', width: 0, penalty: -INF_PENALTY, flagged: true });
  return items;
}

/**
 * Knuth-Plass optimal line breaking.
 * @returns {{breaks: number[], ratios: number[]}|null} Break item indices and each line's adjustment ratio, or null if no feasible set exists at this tolerance.
 */
function knuthPlass(items, lineWidth, tolerance) {
  const linePenalty = 10;
  const flaggedDemerits = 100;
  const fitnessDemerits = 3000;
  const sum = { width: 0, stretch: 0, shrink: 0 };
  let active = [{ pos: 0, demerits: 0, ratio: 0, line: 0, fitness: 1, totals: { width: 0, stretch: 0, shrink: 0 }, prev: null }];

  const ratioFor = (a, i) => {
    let width = sum.width - a.totals.width;
    if (items[i].type === 'penalty') width += items[i].width;
    if (width < lineWidth) {
      const st = sum.stretch - a.totals.stretch;
      return st > 0 ? (lineWidth - width) / st : Infinity;
    }
    if (width > lineWidth) {
      const sh = sum.shrink - a.totals.shrink;
      return sh > 0 ? (lineWidth - width) / sh : -Infinity;
    }
    return 0;
  };

  const totalsAfter = (i) => {
    const t = { ...sum };
    for (let j = i; j < items.length; j++) {
      const it = items[j];
      if (it.type === 'glue') {
        t.width += it.width;
        t.stretch += it.stretch;
        t.shrink += it.shrink;
      } else if (it.type === 'box' || (it.type === 'penalty' && it.penalty === -INF_PENALTY && j > i)) break;
    }
    return t;
  };

  const tryBreak = (i) => {
    const it = items[i];
    const best = [null, null, null, null];
    const next = [];
    for (const a of active) {
      const r = ratioFor(a, i);
      const forced = it.type === 'penalty' && it.penalty === -INF_PENALTY;
      if (!(r < -1 || forced)) next.push(a);
      if (r >= -1 && r <= tolerance) {
        const bad = 100 * Math.abs(r) ** 3;
        let d;
        const p = it.type === 'penalty' ? it.penalty : 0;
        if (p >= 0) d = (linePenalty + bad) ** 2 + p * p;
        else if (p > -INF_PENALTY) d = (linePenalty + bad) ** 2 - p * p;
        else d = (linePenalty + bad) ** 2;
        const prevItem = items[a.pos];
        if (it.flagged && prevItem && prevItem.type === 'penalty' && prevItem.flagged && a.pos > 0) d += flaggedDemerits;
        const fit = r < -0.5 ? 0 : r <= 0.5 ? 1 : r <= 1 ? 2 : 3;
        if (Math.abs(fit - a.fitness) > 1) d += fitnessDemerits;
        d += a.demerits;
        if (!best[fit] || d < best[fit].demerits) best[fit] = { demerits: d, a, r, fit };
      }
    }
    active = next;
    const totals = totalsAfter(i);
    for (const c of best) {
      if (!c) continue;
      active.push({ pos: i, demerits: c.demerits, ratio: c.r, line: c.a.line + 1, fitness: c.fit, totals, prev: c.a });
    }
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'box') {
      sum.width += it.width;
    } else if (it.type === 'glue') {
      if (i > 0 && items[i - 1].type === 'box') tryBreak(i);
      sum.width += it.width;
      sum.stretch += it.stretch;
      sum.shrink += it.shrink;
    } else if (it.penalty < INF_PENALTY) {
      tryBreak(i);
    }
    if (!active.length) return null;
  }
  let best = null;
  for (const a of active) if (!best || a.demerits < best.demerits) best = a;
  if (!best || best.pos !== items.length - 1) return null;
  const breaks = [];
  const ratios = [];
  for (let n = best; n && n.prev; n = n.prev) {
    breaks.unshift(n.pos);
    ratios.unshift(n.ratio);
  }
  return { breaks, ratios };
}

/** First-fit line breaking over the same items: each line takes the last break that still fits. */
function greedy(items, lineWidth) {
  const cum = [0];
  for (const it of items) cum.push(cum[cum.length - 1] + (it.type === 'penalty' ? 0 : it.width));
  const candidate = (j) =>
    items[j].type === 'glue' ? j > 0 && items[j - 1].type === 'box' : items[j].type === 'penalty' && items[j].penalty < INF_PENALTY;
  const breaks = [];
  let s = 0;
  for (;;) {
    while (s < items.length - 1 && items[s].type !== 'box') s++;
    let fit = -1;
    for (let j = s; j < items.length; j++) {
      if (!candidate(j)) continue;
      const w = cum[j] - cum[s] + (items[j].type === 'penalty' ? items[j].width : 0);
      if (w <= lineWidth + 1e-9) {
        fit = j;
        if (items[j].type === 'penalty' && items[j].penalty === -INF_PENALTY) break;
      } else {
        if (fit < 0) fit = j;
        break;
      }
    }
    breaks.push(fit);
    if (fit >= items.length - 1) return breaks;
    s = fit + 1;
  }
}

/**
 * Fonts tried for characters the main font lacks: Inter, then the KaTeX
 * faces that carry Greek letters and math symbols. Only loaded fonts are used.
 * @param {Font} font
 * @returns {Font[]}
 */
function defaultFallbacks(font) {
  const out = [];
  for (const [family, style] of [['Inter', 'regular'], ['KaTeX_Main', 'regular'], ['KaTeX_Math', 'italic'], ['KaTeX_AMS', 'regular']]) {
    if (!hasFont(family, style)) continue;
    const f = getFont(family, style);
    if (f !== font) out.push(f);
  }
  return out;
}

/**
 * Lay out text into positioned glyph outlines.
 * @param {string} str The text. `\n` starts a new paragraph.
 * @param {TextOptions} [opts]
 * @returns {TextLayout}
 */
export function layoutText(str, opts = {}) {
  const font = resolveFont(opts);
  const fallbacks = opts.fallbacks || defaultFallbacks(font);
  const size = opts.size == null ? 1 : opts.size;
  const lineHeight = opts.lineHeight == null ? 1.2 : opts.lineHeight;
  const maxWidth = opts.maxWidth == null ? Infinity : opts.maxWidth;
  const align = opts.align || 'left';
  const spacing = opts.letterSpacing || 0;
  const mode = opts.breaking || (align === 'justify' ? 'optimal' : 'greedy');
  const lineWidthEm = maxWidth / size;
  const ascent = font.ascender / font.unitsPerEm;
  const descent = -font.descender / font.unitsPerEm;

  /** @type {{glyphs: object[], placed: {g: object, x: number}[], width: number, start: number, end: number}[]} */
  const lines = [];
  let offset = 0;
  for (const para of str.split('\n')) {
    const glyphs = shape(para, offset, font, fallbacks, opts);
    const items = buildItems(glyphs, lineWidthEm, spacing);
    let breaks;
    let ratios = null;
    if (mode === 'optimal' && Number.isFinite(lineWidthEm)) {
      const kp = knuthPlass(items, lineWidthEm, 2) || knuthPlass(items, lineWidthEm, 10) || knuthPlass(items, lineWidthEm, 1e6);
      if (kp) {
        breaks = kp.breaks;
        ratios = kp.ratios;
      }
    }
    if (!breaks) breaks = Number.isFinite(lineWidthEm) ? greedy(items, lineWidthEm) : [items.length - 1];
    let from = 0;
    breaks.forEach((b, li) => {
      let s = from;
      while (s < b && items[s].type !== 'box') s++;
      const last = li === breaks.length - 1;
      let ratio = 0;
      if (align === 'justify' && !last) {
        if (ratios) ratio = ratios[li];
        else {
          let w = 0;
          let st = 0;
          let sh = 0;
          for (let j = s; j < b; j++) {
            const it = items[j];
            if (it.type === 'box') w += it.width;
            else if (it.type === 'glue') {
              w += it.width;
              st += it.stretch;
              sh += it.shrink;
            }
          }
          ratio = w < lineWidthEm ? (st > 0 ? (lineWidthEm - w) / st : 0) : sh > 0 ? Math.max(-1, (lineWidthEm - w) / sh) : 0;
        }
      }
      const placed = [];
      let x = 0;
      for (let j = s; j < b; j++) {
        const it = items[j];
        if (it.type === 'box') {
          for (const gi of it.glyphs) {
            placed.push({ g: glyphs[gi], x });
            x += glyphs[gi].adv;
          }
        } else if (it.type === 'glue') {
          const w = it.width + (ratio >= 0 ? ratio * it.stretch : ratio * it.shrink);
          for (const gi of it.glyphs) placed.push({ g: glyphs[gi], x });
          x += w;
        }
      }
      const lastInk = [...placed].reverse().find((p) => !p.g.space);
      const width = lastInk ? lastInk.x + lastInk.g.adv - spacing : 0;
      const startC = placed.length ? placed[0].g.cluster : offset;
      const endC = placed.length ? placed[placed.length - 1].g.cluster + placed[placed.length - 1].g.ch.length : offset;
      lines.push({ placed, width, start: startC, end: endC, justified: align === 'justify' && !last });
      from = b + 1;
    });
    offset += para.length + 1;
  }

  const natural = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const boxWidth = Number.isFinite(lineWidthEm) && align !== 'left' ? lineWidthEm : natural;
  const s = size;
  const baseline0 = -ascent * s;
  /** @type {PositionedGlyph[]} */
  const paths = [];
  /** @type {LayoutLine[]} */
  const outLines = [];
  lines.forEach((l, li) => {
    let dx = 0;
    if (align === 'center') dx = (boxWidth - l.width) / 2;
    else if (align === 'right') dx = boxWidth - l.width;
    else if (align === 'justify' && !l.justified) dx = 0;
    const y = baseline0 - li * lineHeight * s;
    const idx = [];
    for (const p of l.placed) {
      if (p.g.space) continue;
      const f = p.g.font;
      const k = s / f.unitsPerEm;
      const x = (p.x + dx) * s;
      idx.push(paths.length);
      paths.push({
        char: p.g.ch,
        glyphId: p.g.gid,
        path: transformPath(f.glyphPath(p.g.gid), [k, 0, 0, k, x, y]),
        x,
        y,
        advance: p.g.adv * s,
        cluster: p.g.cluster,
        line: li,
      });
    }
    outLines.push({ start: l.start, end: l.end, x: dx * s, y, width: l.width * s, glyphs: idx });
  });
  const n = Math.max(1, lines.length);
  return {
    paths,
    width: boxWidth * s,
    height: (ascent + descent + (n - 1) * lineHeight) * s,
    baseline: baseline0,
    lines: outLines,
  };
}

/**
 * @typedef {Object} TextPath
 * @property {Path} path All glyph outlines merged into one Path.
 * @property {(PositionedGlyph & {subpaths: [number, number]})[]} glyphs Per-glyph records; `subpaths` is the half-open range of this glyph's subpaths inside `path`.
 * @property {number} width
 * @property {number} height
 * @property {number} baseline
 * @property {LayoutLine[]} lines
 */

/**
 * Lay out text and merge the glyphs into one Path, keeping per-glyph
 * addressing so glyph i can be animated on its own.
 * @param {string} str
 * @param {TextOptions} [opts]
 * @returns {TextPath}
 */
export function textToPath(str, opts = {}) {
  const lay = layoutText(str, opts);
  let n = 0;
  const glyphs = lay.paths.map((g) => {
    const range = /** @type {[number, number]} */ ([n, n + g.path.subpaths.length]);
    n += g.path.subpaths.length;
    return { ...g, subpaths: range };
  });
  return {
    path: mergePaths(...lay.paths.map((g) => g.path)),
    glyphs,
    width: lay.width,
    height: lay.height,
    baseline: lay.baseline,
    lines: lay.lines,
  };
}
