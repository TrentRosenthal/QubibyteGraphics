/**
 * Hershey single-stroke fonts. Each glyph is a list of polylines in the
 * order the pen draws them, which is what a handwriting animation needs.
 *
 * JHF format, one glyph per record: columns 0-4 glyph number, 5-7 vertex
 * count (including the bounds pair), then the left and right bounds and the
 * vertices as character pairs offset from 'R' (x right, y down). The pair
 * " R" lifts the pen. Records in the bundled files follow ASCII from 32.
 *
 * @module text/hershey
 */

import { loadText } from './assets.js';

/**
 * @typedef {Object} HersheyGlyph
 * @property {number} left Left bound (font units, relative to the glyph center).
 * @property {number} right Right bound.
 * @property {number} advance right - left.
 * @property {[number, number][][]} strokes Polylines in pen order, font units, y up, origin at the left bound on the baseline.
 */

/**
 * @typedef {Object} HersheyFont
 * @property {string} name
 * @property {Map<number, HersheyGlyph>} glyphs Keyed by code point.
 */

/**
 * @typedef {Object} Stroke
 * @property {number[][]} points Polyline vertices `[x, y]` in world units, y up.
 * @property {number} glyphIndex Index of the glyph (visible character) in the input string.
 * @property {number} strokeIndex Stroke number within that glyph, in pen order.
 */

/** Hershey baseline (y = 9 in the y-down file coordinates) and cap height (21 units). */
const BASELINE = 9;
const CAP = 21;

/** The fonts shipped in `vendor/fonts/hershey`. */
export const HERSHEY_FONTS = ['cursive', 'futural', 'futuram', 'gothiceng', 'greek', 'rowmand', 'rowmans', 'scriptc', 'scripts', 'timesg', 'timesi', 'timesr'];

/**
 * Contents of the Latin letter slots of `greek.jhf` and `timesg.jhf` (read
 * off the rendered glyphs). A dot marks a slot left unmapped because it holds
 * a non-letter mark in the uppercase set; lowercase j and v hold the times
 * and division signs.
 */
const GREEK_UPPER = 'ΑΒΧΔΕΦΓΗΙ.ΚΛΜΝΟΠΘΡΣΤΥ.ΩΞΨΖ';
const GREEK_LOWER = 'αβχδεφγηι×κλμνοπθρστυ÷ωξψζ';

/**
 * Parse JHF text into glyph records in file order.
 * @param {string} text
 * @returns {HersheyGlyph[]}
 */
export function parseJHF(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i++];
    if (!line.trim()) continue;
    const count = parseInt(line.slice(5, 8), 10);
    if (!Number.isFinite(count)) throw new Error(`parseJHF: bad record on line ${i}`);
    let data = line.slice(8);
    while (data.length < count * 2 && i < lines.length) {
      line = lines[i++];
      data += line;
    }
    const R = 82;
    const left = data.charCodeAt(0) - R;
    const right = data.charCodeAt(1) - R;
    const strokes = [];
    let cur = [];
    for (let k = 1; k < count; k++) {
      const a = data[k * 2];
      const b = data[k * 2 + 1];
      if (a === ' ' && b === 'R') {
        if (cur.length) strokes.push(cur);
        cur = [];
        continue;
      }
      const x = a.charCodeAt(0) - R - left;
      const y = BASELINE - (b.charCodeAt(0) - R);
      cur.push([x, y]);
    }
    if (cur.length) strokes.push(cur);
    out.push({ left, right, advance: right - left, strokes });
  }
  return out;
}

/** @type {Map<string, Promise<HersheyFont>>} */
const cache = new Map();
/** @type {Map<string, HersheyFont>} */
const loaded = new Map();

/**
 * Load a bundled Hershey font. ASCII fonts map record k to code point 32 + k;
 * `greek` and `timesg` map their letter slots to Greek code points instead
 * (so a Latin "a" is not available in them, but "α" is).
 * @param {string} name One of {@link HERSHEY_FONTS}.
 * @returns {Promise<HersheyFont>}
 */
export function loadHershey(name) {
  if (!HERSHEY_FONTS.includes(name)) throw new Error(`loadHershey: unknown font "${name}" (have ${HERSHEY_FONTS.join(', ')})`);
  let p = cache.get(name);
  if (!p) {
    p = loadText(`vendor/fonts/hershey/${name}.jhf`).then((txt) => {
      const f = buildFont(name, txt);
      loaded.set(name, f);
      return f;
    });
    cache.set(name, p);
  }
  return p;
}

/**
 * Build a font from JHF text already in memory.
 * @param {string} name Font name; `greek` or `timesg` selects the Greek letter mapping.
 * @param {string} text JHF contents.
 * @returns {HersheyFont}
 */
export function buildFont(name, text) {
  const recs = parseJHF(text);
  const glyphs = new Map();
  const greek = name === 'greek' || name === 'timesg';
  recs.forEach((g, k) => {
    const code = 32 + k;
    if (greek && code >= 65 && code <= 90) {
      if (GREEK_UPPER[code - 65] !== '.') glyphs.set(GREEK_UPPER.codePointAt(code - 65), g);
    } else if (greek && code >= 97 && code <= 122) glyphs.set(GREEK_LOWER.codePointAt(code - 97), g);
    else glyphs.set(code, g);
  });
  if (greek) {
    for (const [alias, base] of [['ϕ', 'φ'], ['ϑ', 'θ'], ['ϵ', 'ε']]) glyphs.set(alias.codePointAt(0), glyphs.get(base.codePointAt(0)));
  }
  return { name, glyphs };
}

/**
 * Load every bundled Hershey font.
 * @returns {Promise<HersheyFont[]>}
 */
export function loadHersheyFonts() {
  return Promise.all(HERSHEY_FONTS.map(loadHershey));
}

function resolve(f) {
  if (typeof f !== 'string') return f;
  const r = loaded.get(f);
  if (!r) throw new Error(`strokeText: Hershey font "${f}" is not loaded; await loadHershey("${f}") first`);
  return r;
}

/**
 * Lay out a string as pen strokes, in pen order, glyph by glyph.
 * @param {string} str Text. Characters the font lacks are taken from `fallback` (default: the `greek` font when loaded, which covers Greek letters for math), else advance like a space.
 * @param {{font?: string|HersheyFont, size?: number, fallback?: string|HersheyFont, letterSpacing?: number}} [opts] `font` defaults to `futural`; `size` is the cap height in world units (default 1); `letterSpacing` is in cap heights.
 * @returns {{strokes: Stroke[], width: number}} Strokes in world units, y up, starting at x = 0 on the baseline.
 */
export function strokeText(str, opts = {}) {
  const font = resolve(opts.font || 'futural');
  const fallback = opts.fallback ? resolve(opts.fallback) : loaded.get('greek') || null;
  const size = opts.size == null ? 1 : opts.size;
  const k = size / CAP;
  const spacing = (opts.letterSpacing || 0) * CAP;
  const space = font.glyphs.get(32);
  const strokes = [];
  let x = 0;
  let glyphIndex = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    let g = font.glyphs.get(cp);
    if (!g && fallback) g = fallback.glyphs.get(cp);
    if (!g) g = space;
    if (g && g.strokes.length) {
      g.strokes.forEach((s, strokeIndex) => {
        strokes.push({ points: s.map(([px, py]) => [(x + px) * k, py * k]), glyphIndex, strokeIndex });
      });
      glyphIndex++;
    }
    x += (g ? g.advance : 16) + spacing;
  }
  return { strokes, width: Math.max(0, x - spacing) * k };
}
