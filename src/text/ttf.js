/**
 * TrueType / OpenType font reader. Parses the tables needed to set text as
 * vector paths: metrics (head, hhea, OS/2, hmtx, maxp), character mapping
 * (cmap formats 0, 4, 6, 12), outlines (glyf with composite glyphs, and CFF
 * Type 2 charstrings for `.otf` fonts), kerning (kern format 0 and GPOS pair
 * adjustment, including extension lookups) and the family name.
 *
 * Wrapped formats (WOFF 1.0 and WOFF 2.0) are unwrapped to a plain sfnt by
 * {@link unwrapFont}, which is asynchronous because it needs zlib or Brotli.
 *
 * All glyph coordinates are in font units with y pointing up.
 *
 * @module text/ttf
 */

import { PathBuilder } from '../core/path.js';
import { inflate } from './assets.js';

/**
 * @typedef {import('../core/path.js').Path} Path
 */

/**
 * @typedef {Object} GlyphPoint
 * @property {number} x
 * @property {number} y
 * @property {boolean} on Whether the point is on the curve.
 */

const tagAt = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

/**
 * A parsed font. Construct with {@link parseFont}.
 */
export class Font {
  /**
   * @param {ArrayBuffer} buffer Plain sfnt bytes (TrueType or CFF-flavored OpenType).
   */
  constructor(buffer) {
    this.buffer = buffer;
    this.dv = new DataView(buffer);
    /** @type {Record<string, {offset: number, length: number}>} */
    this.tables = {};
    const dv = this.dv;
    let base = 0;
    if (tagAt(dv, 0) === 'ttcf') base = dv.getUint32(12);
    const version = tagAt(dv, base);
    if (version === 'wOFF' || version === 'wOF2') {
      throw new Error('parseFont: WOFF data must be unwrapped first; use unwrapFont() or registerFont()');
    }
    if (version !== 'OTTO' && version !== 'true' && dv.getUint32(base) !== 0x00010000) {
      throw new Error(`parseFont: unrecognized font signature "${version}"`);
    }
    const numTables = dv.getUint16(base + 4);
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16;
      this.tables[tagAt(dv, rec)] = { offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) };
    }
    for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'cmap']) {
      if (!this.tables[t]) throw new Error(`parseFont: missing required table "${t}"`);
    }
    if (this.tables.CFF2 && !this.tables['CFF '] && !this.tables.glyf) {
      throw new Error('parseFont: CFF2 (variable OpenType) outlines are not supported; use a static TTF or OTF instance');
    }
    this.outlineFormat = this.tables.glyf ? 'truetype' : this.tables['CFF '] ? 'cff' : null;
    if (!this.outlineFormat) throw new Error('parseFont: font has neither glyf nor CFF outlines');

    const head = this.tables.head.offset;
    /** Font design units per em. */
    this.unitsPerEm = dv.getUint16(head + 18);
    this.indexToLocFormat = dv.getInt16(head + 50);
    const hhea = this.tables.hhea.offset;
    /** Typographic ascender (hhea), font units above the baseline. */
    this.ascender = dv.getInt16(hhea + 4);
    /** Typographic descender (hhea), negative below the baseline. */
    this.descender = dv.getInt16(hhea + 6);
    /** Extra line gap (hhea). */
    this.lineGap = dv.getInt16(hhea + 8);
    this.numberOfHMetrics = dv.getUint16(hhea + 34);
    /** Number of glyphs in the font. */
    this.numGlyphs = dv.getUint16(this.tables.maxp.offset + 4);

    /** Cap height in font units (OS/2, or measured from "H"). */
    this.capHeight = 0;
    /** x-height in font units (OS/2, or measured from "x"). */
    this.xHeight = 0;
    if (this.tables['OS/2']) {
      const os2 = this.tables['OS/2'].offset;
      const ver = dv.getUint16(os2);
      if (ver >= 2 && this.tables['OS/2'].length >= 90) {
        this.xHeight = dv.getInt16(os2 + 86);
        this.capHeight = dv.getInt16(os2 + 88);
      }
    }

    this.cmap = this._parseCmap();
    /** Family name from the name table (typographic family preferred). */
    this.familyName = this._name(16) || this._name(1) || '';
    /** Subfamily (style) name from the name table. */
    this.subfamilyName = this._name(17) || this._name(2) || '';

    /** @type {Map<number, Path>} */
    this._pathCache = new Map();
    /** @type {Map<number, number>} */
    this._kernCache = new Map();
    this._kernTable = this._parseKern();
    this._gposLookups = this._parseGposKern();
    if (this.outlineFormat === 'cff') this.cff = parseCFF(dv, this.tables['CFF '].offset);

    if (!this.xHeight) this.xHeight = this._measureTop(0x78);
    if (!this.capHeight) this.capHeight = this._measureTop(0x48);
  }

  _measureTop(cp) {
    const g = this.glyphIndex(cp);
    if (!g) return 0;
    let top = 0;
    for (const s of this.glyphPath(g).subpaths) {
      for (let i = 1; i < s.points.length; i += 2) top = Math.max(top, s.points[i]);
    }
    return top;
  }

  _name(id) {
    const t = this.tables.name;
    if (!t) return '';
    const dv = this.dv;
    const count = dv.getUint16(t.offset + 2);
    const strings = t.offset + dv.getUint16(t.offset + 4);
    let mac = '';
    for (let i = 0; i < count; i++) {
      const r = t.offset + 6 + i * 12;
      const platform = dv.getUint16(r);
      const nameId = dv.getUint16(r + 6);
      if (nameId !== id) continue;
      const len = dv.getUint16(r + 8);
      const off = strings + dv.getUint16(r + 10);
      if (platform === 3 || platform === 0) {
        let s = '';
        for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(off + k));
        return s;
      }
      if (platform === 1 && !mac) {
        for (let k = 0; k < len; k++) mac += String.fromCharCode(dv.getUint8(off + k));
      }
    }
    return mac;
  }

  _parseCmap() {
    const dv = this.dv;
    const base = this.tables.cmap.offset;
    const n = dv.getUint16(base + 2);
    const rank = (p, e, fmt) => {
      if (fmt === 12 && (p === 3 && e === 10 || p === 0)) return 5;
      if (fmt === 4 && (p === 3 && e === 1 || p === 0)) return 4;
      if (fmt === 12 || fmt === 4) return 3;
      if (p === 3 && e === 0) return 2;
      if (fmt === 6 || fmt === 0) return 1;
      return 0;
    };
    let best = null;
    let bestRank = 0;
    for (let i = 0; i < n; i++) {
      const rec = base + 4 + i * 8;
      const p = dv.getUint16(rec);
      const e = dv.getUint16(rec + 2);
      const off = base + dv.getUint32(rec + 4);
      const fmt = dv.getUint16(off);
      const r = rank(p, e, fmt);
      if (r > bestRank) {
        bestRank = r;
        best = { off, fmt, symbol: p === 3 && e === 0 };
      }
    }
    if (!best) throw new Error('parseFont: no usable cmap subtable (formats 0, 4, 6, 12)');
    return best;
  }

  /**
   * Glyph id for a Unicode code point, or 0 (.notdef) when the font lacks it.
   * @param {number} cp Unicode code point.
   * @returns {number}
   */
  glyphIndex(cp) {
    const { off, fmt, symbol } = this.cmap;
    const dv = this.dv;
    let g = 0;
    if (fmt === 4) {
      g = cmap4(dv, off, cp);
      if (!g && symbol && cp < 0x100) g = cmap4(dv, off, cp + 0xf000);
    } else if (fmt === 12) {
      const n = dv.getUint32(off + 12);
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = off + 16 + mid * 12;
        const start = dv.getUint32(r);
        const end = dv.getUint32(r + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else {
          g = dv.getUint32(r + 8) + cp - start;
          break;
        }
      }
    } else if (fmt === 6) {
      const first = dv.getUint16(off + 6);
      const count = dv.getUint16(off + 8);
      if (cp >= first && cp < first + count) g = dv.getUint16(off + 10 + (cp - first) * 2);
    } else if (fmt === 0) {
      if (cp < 256) g = dv.getUint8(off + 6 + cp);
    }
    return g < this.numGlyphs ? g : 0;
  }

  /**
   * Advance width of a glyph in font units.
   * @param {number} gid Glyph id.
   * @returns {number}
   */
  advance(gid) {
    const i = Math.min(gid, this.numberOfHMetrics - 1);
    return this.dv.getUint16(this.tables.hmtx.offset + i * 4);
  }

  /**
   * Horizontal kerning adjustment between two glyphs in font units (usually
   * negative). GPOS `kern` feature pair adjustments take precedence; the
   * legacy `kern` table is used when the font has no GPOS kerning.
   * @param {number} left Glyph id of the left glyph.
   * @param {number} right Glyph id of the right glyph.
   * @returns {number}
   */
  kerning(left, right) {
    const key = left * 65536 + right;
    const hit = this._kernCache.get(key);
    if (hit !== undefined) return hit;
    let v = 0;
    if (this._gposLookups.length) {
      for (const subs of this._gposLookups) v += gposPairValue(this.dv, subs, left, right);
    } else if (this._kernTable) {
      v = this._kernTable.get(key) || 0;
    }
    this._kernCache.set(key, v);
    return v;
  }

  _parseKern() {
    const t = this.tables.kern;
    if (!t) return null;
    const dv = this.dv;
    const map = new Map();
    let p = t.offset;
    let nTables;
    let apple = false;
    if (dv.getUint16(p) === 0) {
      nTables = dv.getUint16(p + 2);
      p += 4;
    } else {
      apple = true;
      nTables = dv.getUint32(p + 4);
      p += 8;
    }
    for (let i = 0; i < nTables; i++) {
      let len;
      let format;
      let horizontal;
      let hdr;
      if (apple) {
        len = dv.getUint32(p);
        const cov = dv.getUint16(p + 4);
        format = cov & 0xff;
        horizontal = (cov & 0x8000) === 0 && (cov & 0x4000) === 0;
        hdr = 8;
      } else {
        len = dv.getUint16(p + 2);
        const cov = dv.getUint16(p + 4);
        format = cov >> 8;
        horizontal = (cov & 1) === 1 && (cov & 4) === 0;
        hdr = 6;
      }
      if (format === 0 && horizontal) {
        const nPairs = dv.getUint16(p + hdr);
        for (let k = 0; k < nPairs; k++) {
          const r = p + hdr + 8 + k * 6;
          map.set(dv.getUint16(r) * 65536 + dv.getUint16(r + 2), dv.getInt16(r + 4));
        }
      }
      p += len;
    }
    return map;
  }

  _parseGposKern() {
    const t = this.tables.GPOS;
    if (!t) return [];
    const dv = this.dv;
    const g = t.offset;
    const featureList = g + dv.getUint16(g + 6);
    const lookupList = g + dv.getUint16(g + 8);
    const lookupIdx = new Set();
    const nFeat = dv.getUint16(featureList);
    for (let i = 0; i < nFeat; i++) {
      const rec = featureList + 2 + i * 6;
      if (tagAt(dv, rec) !== 'kern') continue;
      const f = featureList + dv.getUint16(rec + 4);
      const n = dv.getUint16(f + 2);
      for (let k = 0; k < n; k++) lookupIdx.add(dv.getUint16(f + 4 + k * 2));
    }
    const out = [];
    for (const li of [...lookupIdx].sort((a, b) => a - b)) {
      const L = lookupList + dv.getUint16(lookupList + 2 + li * 2);
      const type = dv.getUint16(L);
      const n = dv.getUint16(L + 4);
      const subs = [];
      for (let k = 0; k < n; k++) {
        let s = L + dv.getUint16(L + 6 + k * 2);
        let st = type;
        if (type === 9) {
          st = dv.getUint16(s + 2);
          s += dv.getUint32(s + 4);
        }
        if (st === 2) subs.push(s);
      }
      if (subs.length) out.push(subs);
    }
    return out;
  }

  /**
   * Outline of a glyph as a cubic Path in font units, y up. Results are cached;
   * treat the returned path as read-only.
   * @param {number} gid Glyph id.
   * @returns {Path}
   */
  glyphPath(gid) {
    let p = this._pathCache.get(gid);
    if (p) return p;
    if (gid < 0 || gid >= this.numGlyphs) p = { subpaths: [] };
    else if (this.outlineFormat === 'truetype') p = contoursToPath(this._glyfContours(gid, 0));
    else p = cffGlyphPath(this.cff, gid);
    this._pathCache.set(gid, p);
    return p;
  }

  _locaRange(gid) {
    const dv = this.dv;
    const loca = this.tables.loca.offset;
    let a;
    let b;
    if (this.indexToLocFormat === 0) {
      a = dv.getUint16(loca + gid * 2) * 2;
      b = dv.getUint16(loca + gid * 2 + 2) * 2;
    } else {
      a = dv.getUint32(loca + gid * 4);
      b = dv.getUint32(loca + gid * 4 + 4);
    }
    return [this.tables.glyf.offset + a, b - a];
  }

  /**
   * Contours of a TrueType glyph with composite glyphs resolved.
   * @param {number} gid
   * @param {number} depth recursion guard
   * @returns {GlyphPoint[][]}
   */
  _glyfContours(gid, depth) {
    if (depth > 16) throw new Error('parseFont: composite glyph nesting too deep');
    const [off, len] = this._locaRange(gid);
    if (len === 0) return [];
    const dv = this.dv;
    const nContours = dv.getInt16(off);
    if (nContours >= 0) return readSimpleGlyph(dv, off, nContours);
    const out = [];
    let p = off + 10;
    let flags;
    do {
      flags = dv.getUint16(p);
      const sub = dv.getUint16(p + 2);
      p += 4;
      let a1;
      let a2;
      if (flags & 1) {
        a1 = flags & 2 ? dv.getInt16(p) : dv.getUint16(p);
        a2 = flags & 2 ? dv.getInt16(p + 2) : dv.getUint16(p + 2);
        p += 4;
      } else {
        a1 = flags & 2 ? dv.getInt8(p) : dv.getUint8(p);
        a2 = flags & 2 ? dv.getInt8(p + 1) : dv.getUint8(p + 1);
        p += 2;
      }
      let xx = 1;
      let xy = 0;
      let yx = 0;
      let yy = 1;
      const f2 = (o) => dv.getInt16(o) / 16384;
      if (flags & 8) {
        xx = yy = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        xx = f2(p);
        yy = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        xx = f2(p);
        xy = f2(p + 2);
        yx = f2(p + 4);
        yy = f2(p + 6);
        p += 8;
      }
      const comp = this._glyfContours(sub, depth + 1);
      const tx = (pt) => ({ x: xx * pt.x + yx * pt.y, y: xy * pt.x + yy * pt.y, on: pt.on });
      const moved = comp.map((c) => c.map(tx));
      let dx;
      let dy;
      if (flags & 2) {
        dx = a1;
        dy = a2;
        if (flags & 0x800 && !(flags & 0x1000)) {
          dx = a1 * Math.hypot(xx, xy);
          dy = a2 * Math.hypot(yx, yy);
        }
      } else {
        const parent = out.flat();
        const child = moved.flat();
        const pp = parent[a1];
        const cp = child[a2];
        dx = pp && cp ? pp.x - cp.x : 0;
        dy = pp && cp ? pp.y - cp.y : 0;
      }
      for (const c of moved) out.push(c.map((pt) => ({ x: pt.x + dx, y: pt.y + dy, on: pt.on })));
    } while (flags & 0x20);
    return out;
  }
}

function cmap4(dv, off, cp) {
  if (cp > 0xffff) return 0;
  const segX2 = dv.getUint16(off + 6);
  const ends = off + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  let lo = 0;
  let hi = segX2 / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const end = dv.getUint16(ends + mid * 2);
    const start = dv.getUint16(starts + mid * 2);
    if (cp > end) lo = mid + 1;
    else if (cp < start) hi = mid - 1;
    else {
      const delta = dv.getInt16(deltas + mid * 2);
      const ro = dv.getUint16(ranges + mid * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const gp = ranges + mid * 2 + ro + (cp - start) * 2;
      const g = dv.getUint16(gp);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
  }
  return 0;
}

function readSimpleGlyph(dv, off, nContours) {
  const ends = [];
  for (let i = 0; i < nContours; i++) ends.push(dv.getUint16(off + 10 + i * 2));
  const nPts = nContours ? ends[nContours - 1] + 1 : 0;
  let p = off + 10 + nContours * 2;
  p += 2 + dv.getUint16(p);
  const flags = new Uint8Array(nPts);
  for (let i = 0; i < nPts; ) {
    const f = dv.getUint8(p++);
    flags[i++] = f;
    if (f & 8) {
      let r = dv.getUint8(p++);
      while (r-- > 0 && i < nPts) flags[i++] = f;
    }
  }
  const xs = new Array(nPts);
  const ys = new Array(nPts);
  let v = 0;
  for (let i = 0; i < nPts; i++) {
    const f = flags[i];
    if (f & 2) {
      const d = dv.getUint8(p++);
      v += f & 16 ? d : -d;
    } else if (!(f & 16)) {
      v += dv.getInt16(p);
      p += 2;
    }
    xs[i] = v;
  }
  v = 0;
  for (let i = 0; i < nPts; i++) {
    const f = flags[i];
    if (f & 4) {
      const d = dv.getUint8(p++);
      v += f & 32 ? d : -d;
    } else if (!(f & 32)) {
      v += dv.getInt16(p);
      p += 2;
    }
    ys[i] = v;
  }
  const out = [];
  let s = 0;
  for (const e of ends) {
    const c = [];
    for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
    out.push(c);
    s = e + 1;
  }
  return out;
}

/**
 * Convert quadratic TrueType contours (with implied on-curve midpoints) to a
 * cubic Path.
 * @param {GlyphPoint[][]} contours
 * @returns {Path}
 */
function contoursToPath(contours) {
  const b = new PathBuilder();
  for (const c of contours) {
    const n = c.length;
    if (n < 2) continue;
    const s = c.findIndex((pt) => pt.on);
    const seq = s >= 0 ? c.slice(s).concat(c.slice(0, s)) : [{ x: (c[n - 1].x + c[0].x) / 2, y: (c[n - 1].y + c[0].y) / 2, on: true }, ...c];
    b.moveTo(seq[0].x, seq[0].y);
    let ctrl = null;
    for (let i = 1; i <= seq.length; i++) {
      const pt = i < seq.length ? seq[i] : seq[0];
      if (pt.on) {
        if (ctrl) b.quadTo(ctrl.x, ctrl.y, pt.x, pt.y);
        else b.lineTo(pt.x, pt.y);
        ctrl = null;
      } else {
        if (ctrl) b.quadTo(ctrl.x, ctrl.y, (ctrl.x + pt.x) / 2, (ctrl.y + pt.y) / 2);
        ctrl = pt;
      }
    }
    b.close();
  }
  return b.build();
}

function coverageIndex(dv, cov, gid) {
  const fmt = dv.getUint16(cov);
  const n = dv.getUint16(cov + 2);
  let lo = 0;
  let hi = n - 1;
  if (fmt === 1) {
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = dv.getUint16(cov + 4 + mid * 2);
      if (g < gid) lo = mid + 1;
      else if (g > gid) hi = mid - 1;
      else return mid;
    }
    return -1;
  }
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = cov + 4 + mid * 6;
    const s = dv.getUint16(r);
    const e = dv.getUint16(r + 2);
    if (gid < s) hi = mid - 1;
    else if (gid > e) lo = mid + 1;
    else return dv.getUint16(r + 4) + gid - s;
  }
  return -1;
}

function classOf(dv, cd, gid) {
  const fmt = dv.getUint16(cd);
  if (fmt === 1) {
    const start = dv.getUint16(cd + 2);
    const n = dv.getUint16(cd + 4);
    return gid >= start && gid < start + n ? dv.getUint16(cd + 6 + (gid - start) * 2) : 0;
  }
  const n = dv.getUint16(cd + 2);
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = cd + 4 + mid * 6;
    const s = dv.getUint16(r);
    const e = dv.getUint16(r + 2);
    if (gid < s) hi = mid - 1;
    else if (gid > e) lo = mid + 1;
    else return dv.getUint16(r + 4);
  }
  return 0;
}

const popcount = (v) => {
  let c = 0;
  for (let x = v; x; x >>= 1) c += x & 1;
  return c;
};

/** XAdvance of a GPOS ValueRecord at `p` with the given format (0 if absent). */
function xAdvance(dv, p, fmt) {
  if (!(fmt & 4)) return 0;
  return dv.getInt16(p + 2 * popcount(fmt & 3));
}

function gposPairValue(dv, subs, left, right) {
  for (const s of subs) {
    const fmt = dv.getUint16(s);
    const ci = coverageIndex(dv, s + dv.getUint16(s + 2), left);
    if (ci < 0) continue;
    const vf1 = dv.getUint16(s + 4);
    const vf2 = dv.getUint16(s + 6);
    const size1 = 2 * popcount(vf1);
    const size2 = 2 * popcount(vf2);
    if (fmt === 1) {
      const set = s + dv.getUint16(s + 10 + ci * 2);
      const n = dv.getUint16(set);
      const rec = 2 + size1 + size2;
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = set + 2 + mid * rec;
        const g = dv.getUint16(r);
        if (g < right) lo = mid + 1;
        else if (g > right) hi = mid - 1;
        else return xAdvance(dv, r + 2, vf1);
      }
    } else if (fmt === 2) {
      const c1 = classOf(dv, s + dv.getUint16(s + 8), left);
      const c2 = classOf(dv, s + dv.getUint16(s + 10), right);
      const n1 = dv.getUint16(s + 12);
      const n2 = dv.getUint16(s + 14);
      if (c1 >= n1 || c2 >= n2) return 0;
      return xAdvance(dv, s + 16 + (c1 * n2 + c2) * (size1 + size2), vf1);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// CFF (Compact Font Format) with Type 2 charstrings.

function readIndex(dv, p) {
  const count = dv.getUint16(p);
  if (count === 0) return { items: [], end: p + 2 };
  const offSize = dv.getUint8(p + 2);
  const rd = (o) => {
    let v = 0;
    for (let i = 0; i < offSize; i++) v = v * 256 + dv.getUint8(o + i);
    return v;
  };
  const offs = [];
  for (let i = 0; i <= count; i++) offs.push(rd(p + 3 + i * offSize));
  const data = p + 3 + (count + 1) * offSize - 1;
  const items = [];
  for (let i = 0; i < count; i++) items.push([data + offs[i], data + offs[i + 1]]);
  return { items, end: data + offs[count] };
}

function readDict(dv, start, end) {
  const dict = {};
  let ops = [];
  let p = start;
  while (p < end) {
    const b0 = dv.getUint8(p);
    if (b0 <= 21) {
      let op = b0;
      p++;
      if (b0 === 12) op = 1200 + dv.getUint8(p++);
      dict[op] = ops;
      ops = [];
    } else if (b0 === 28) {
      ops.push(dv.getInt16(p + 1));
      p += 3;
    } else if (b0 === 29) {
      ops.push(dv.getInt32(p + 1));
      p += 5;
    } else if (b0 === 30) {
      let s = '';
      p++;
      const nib = '0123456789.EE?-';
      for (;;) {
        const b = dv.getUint8(p++);
        const hi = b >> 4;
        const lo = b & 15;
        if (hi === 15) break;
        s += hi === 12 ? 'E-' : nib[hi];
        if (lo === 15) break;
        s += lo === 12 ? 'E-' : nib[lo];
      }
      ops.push(parseFloat(s));
    } else if (b0 >= 32 && b0 <= 246) {
      ops.push(b0 - 139);
      p++;
    } else if (b0 >= 247 && b0 <= 250) {
      ops.push((b0 - 247) * 256 + dv.getUint8(p + 1) + 108);
      p += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      ops.push(-(b0 - 251) * 256 - dv.getUint8(p + 1) - 108);
      p += 2;
    } else {
      p++;
    }
  }
  return dict;
}

function readPrivate(dv, cffStart, sizeOff) {
  if (!sizeOff || sizeOff.length < 2) return { subrs: [], defaultWidthX: 0, nominalWidthX: 0 };
  const [size, off] = sizeOff;
  const priv = readDict(dv, cffStart + off, cffStart + off + size);
  const subrs = priv[19] ? readIndex(dv, cffStart + off + priv[19][0]).items : [];
  return { subrs, defaultWidthX: priv[20] ? priv[20][0] : 0, nominalWidthX: priv[21] ? priv[21][0] : 0 };
}

function parseCFF(dv, start) {
  const hdrSize = dv.getUint8(start + 2);
  const names = readIndex(dv, start + hdrSize);
  const topDicts = readIndex(dv, names.end);
  const strings = readIndex(dv, topDicts.end);
  const gsubrs = readIndex(dv, strings.end);
  const [ts, te] = topDicts.items[0];
  const top = readDict(dv, ts, te);
  if (top[1206] && top[1206][0] !== 2) throw new Error('parseFont: only Type 2 charstrings are supported in CFF');
  const charStrings = readIndex(dv, start + top[17][0]).items;
  const cff = {
    dv,
    gsubrs: gsubrs.items,
    charStrings,
    privs: [readPrivate(dv, start, top[18])],
    fdSelect: null,
    charset: null,
  };
  if (top[1236]) {
    const fds = readIndex(dv, start + top[1236][0]).items;
    cff.privs = fds.map(([a, b]) => readPrivate(dv, start, readDict(dv, a, b)[18]));
    const fs = start + top[1237][0];
    const fmt = dv.getUint8(fs);
    const sel = new Uint8Array(charStrings.length);
    if (fmt === 0) {
      for (let i = 0; i < sel.length; i++) sel[i] = dv.getUint8(fs + 1 + i);
    } else if (fmt === 3) {
      const n = dv.getUint16(fs + 1);
      for (let r = 0; r < n; r++) {
        const first = dv.getUint16(fs + 3 + r * 3);
        const fd = dv.getUint8(fs + 5 + r * 3);
        const next = dv.getUint16(fs + 6 + r * 3);
        for (let g = first; g < next && g < sel.length; g++) sel[g] = fd;
      }
    }
    cff.fdSelect = sel;
  }
  const charsetOff = top[15] ? top[15][0] : 0;
  cff.charset = readCharset(dv, charsetOff ? start + charsetOff : 0, charStrings.length);
  return cff;
}

/** Glyph id to SID (or CID) table from a CFF charset; predefined charsets map identically. */
function readCharset(dv, p, nGlyphs) {
  const sids = new Uint16Array(nGlyphs);
  if (!p) {
    for (let i = 0; i < nGlyphs; i++) sids[i] = i;
    return sids;
  }
  const fmt = dv.getUint8(p);
  let q = p + 1;
  let g = 1;
  if (fmt === 0) {
    while (g < nGlyphs) {
      sids[g++] = dv.getUint16(q);
      q += 2;
    }
  } else {
    while (g < nGlyphs) {
      const first = dv.getUint16(q);
      const left = fmt === 1 ? dv.getUint8(q + 2) : dv.getUint16(q + 2);
      q += fmt === 1 ? 3 : 4;
      for (let k = 0; k <= left && g < nGlyphs; k++) sids[g++] = first + k;
    }
  }
  return sids;
}

/** Adobe StandardEncoding: character code to SID, used by the `seac` form of endchar. */
function standardEncodingSid(code) {
  if (code >= 32 && code <= 126) return code - 31;
  const hi = {
    161: 96, 162: 97, 163: 98, 164: 99, 165: 100, 166: 101, 167: 102, 168: 103, 169: 104, 170: 105,
    171: 106, 172: 107, 173: 108, 174: 109, 175: 110, 177: 111, 178: 112, 179: 113, 180: 114, 182: 115,
    183: 116, 184: 117, 185: 118, 186: 119, 187: 120, 188: 121, 189: 122, 191: 123, 193: 124, 194: 125,
    195: 126, 196: 127, 197: 128, 198: 129, 199: 130, 200: 131, 202: 132, 203: 133, 205: 134, 206: 135,
    207: 136, 208: 137, 225: 138, 227: 139, 232: 140, 233: 141, 234: 142, 235: 143, 241: 144, 245: 145,
    248: 146, 249: 147, 250: 148, 251: 149,
  };
  return hi[code] || 0;
}

const subrBias = (n) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

function cffGlyphPath(cff, gid) {
  const b = new PathBuilder();
  runCharstring(cff, gid, b, 0, 0);
  return b.build();
}

function runCharstring(cff, gid, b, ox, oy) {
  const { dv } = cff;
  const priv = cff.privs[cff.fdSelect ? cff.fdSelect[gid] : 0] || cff.privs[0];
  const lsubrs = priv.subrs;
  const gsubrs = cff.gsubrs;
  const lbias = subrBias(lsubrs.length);
  const gbias = subrBias(gsubrs.length);
  const stack = [];
  let nStems = 0;
  let haveWidth = false;
  let x = ox;
  let y = oy;
  let open = false;
  let done = false;
  const moveTo = (nx, ny) => {
    if (open) b.close();
    x = nx;
    y = ny;
    b.moveTo(x, y);
    open = true;
  };
  const lineTo = (nx, ny) => {
    x = nx;
    y = ny;
    b.lineTo(x, y);
  };
  const curveTo = (c1x, c1y, c2x, c2y, nx, ny) => {
    x = nx;
    y = ny;
    b.cubicTo(c1x, c1y, c2x, c2y, x, y);
  };
  const stems = () => {
    if (stack.length % 2 && !haveWidth) stack.shift();
    haveWidth = true;
    nStems += stack.length >> 1;
    stack.length = 0;
  };
  const exec = (start, end, depth) => {
    if (depth > 10) throw new Error('parseFont: CFF subroutine nesting too deep');
    let p = start;
    while (p < end && !done) {
      const v = dv.getUint8(p++);
      if (v >= 32 || v === 28) {
        if (v === 28) {
          stack.push(dv.getInt16(p));
          p += 2;
        } else if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + dv.getUint8(p++) + 108);
        else if (v <= 254) stack.push(-(v - 251) * 256 - dv.getUint8(p++) - 108);
        else {
          stack.push(dv.getInt32(p) / 65536);
          p += 4;
        }
        continue;
      }
      switch (v) {
        case 1:
        case 3:
        case 18:
        case 23:
          stems();
          break;
        case 19:
        case 20:
          stems();
          p += (nStems + 7) >> 3;
          break;
        case 21:
          if (stack.length > 2 && !haveWidth) stack.shift();
          haveWidth = true;
          moveTo(x + stack[0], y + stack[1]);
          stack.length = 0;
          break;
        case 22:
          if (stack.length > 1 && !haveWidth) stack.shift();
          haveWidth = true;
          moveTo(x + stack[0], y);
          stack.length = 0;
          break;
        case 4:
          if (stack.length > 1 && !haveWidth) stack.shift();
          haveWidth = true;
          moveTo(x, y + stack[0]);
          stack.length = 0;
          break;
        case 5:
          for (let i = 0; i + 1 < stack.length; i += 2) lineTo(x + stack[i], y + stack[i + 1]);
          stack.length = 0;
          break;
        case 6:
        case 7: {
          let horiz = v === 6;
          for (let i = 0; i < stack.length; i++) {
            if (horiz) lineTo(x + stack[i], y);
            else lineTo(x, y + stack[i]);
            horiz = !horiz;
          }
          stack.length = 0;
          break;
        }
        case 8:
          for (let i = 0; i + 5 < stack.length; i += 6) {
            const c1x = x + stack[i];
            const c1y = y + stack[i + 1];
            const c2x = c1x + stack[i + 2];
            const c2y = c1y + stack[i + 3];
            curveTo(c1x, c1y, c2x, c2y, c2x + stack[i + 4], c2y + stack[i + 5]);
          }
          stack.length = 0;
          break;
        case 24: {
          let i = 0;
          for (; i + 5 < stack.length - 2; i += 6) {
            const c1x = x + stack[i];
            const c1y = y + stack[i + 1];
            const c2x = c1x + stack[i + 2];
            const c2y = c1y + stack[i + 3];
            curveTo(c1x, c1y, c2x, c2y, c2x + stack[i + 4], c2y + stack[i + 5]);
          }
          lineTo(x + stack[i], y + stack[i + 1]);
          stack.length = 0;
          break;
        }
        case 25: {
          let i = 0;
          for (; i + 1 < stack.length - 6; i += 2) lineTo(x + stack[i], y + stack[i + 1]);
          const c1x = x + stack[i];
          const c1y = y + stack[i + 1];
          const c2x = c1x + stack[i + 2];
          const c2y = c1y + stack[i + 3];
          curveTo(c1x, c1y, c2x, c2y, c2x + stack[i + 4], c2y + stack[i + 5]);
          stack.length = 0;
          break;
        }
        case 26: {
          let i = 0;
          let dx1 = 0;
          if (stack.length % 2) dx1 = stack[i++];
          for (; i + 3 < stack.length; i += 4) {
            const c1x = x + dx1;
            const c1y = y + stack[i];
            const c2x = c1x + stack[i + 1];
            const c2y = c1y + stack[i + 2];
            curveTo(c1x, c1y, c2x, c2y, c2x, c2y + stack[i + 3]);
            dx1 = 0;
          }
          stack.length = 0;
          break;
        }
        case 27: {
          let i = 0;
          let dy1 = 0;
          if (stack.length % 2) dy1 = stack[i++];
          for (; i + 3 < stack.length; i += 4) {
            const c1x = x + stack[i];
            const c1y = y + dy1;
            const c2x = c1x + stack[i + 1];
            const c2y = c1y + stack[i + 2];
            curveTo(c1x, c1y, c2x, c2y, c2x + stack[i + 3], c2y);
            dy1 = 0;
          }
          stack.length = 0;
          break;
        }
        case 30:
        case 31: {
          let vert = v === 30;
          for (let i = 0; i + 3 < stack.length; i += 4) {
            const last = i + 5 === stack.length;
            if (vert) {
              const c1x = x;
              const c1y = y + stack[i];
              const c2x = c1x + stack[i + 1];
              const c2y = c1y + stack[i + 2];
              curveTo(c1x, c1y, c2x, c2y, c2x + stack[i + 3], c2y + (last ? stack[i + 4] : 0));
            } else {
              const c1x = x + stack[i];
              const c1y = y;
              const c2x = c1x + stack[i + 1];
              const c2y = c1y + stack[i + 2];
              curveTo(c1x, c1y, c2x, c2y, c2x + (last ? stack[i + 4] : 0), c2y + stack[i + 3]);
            }
            vert = !vert;
          }
          stack.length = 0;
          break;
        }
        case 10:
        case 29: {
          const idx = stack.pop() + (v === 10 ? lbias : gbias);
          const subr = (v === 10 ? lsubrs : gsubrs)[idx];
          if (!subr) throw new Error(`parseFont: CFF subroutine ${idx} out of range`);
          exec(subr[0], subr[1], depth + 1);
          break;
        }
        case 11:
          return;
        case 14:
          if (stack.length === 5 || stack.length === 1) {
            if (!haveWidth) stack.shift();
          }
          haveWidth = true;
          if (stack.length === 4) {
            const [adx, ady, bchar, achar] = stack;
            if (open) b.close();
            open = false;
            const find = (code) => {
              const sid = standardEncodingSid(code);
              const g = cff.charset.indexOf(sid);
              return g > 0 ? g : 0;
            };
            runCharstring(cff, find(bchar), b, ox, oy);
            runCharstring(cff, find(achar), b, ox + adx, oy + ady);
          }
          stack.length = 0;
          done = true;
          break;
        case 12: {
          const op = dv.getUint8(p++);
          const s = stack;
          if (op === 35) {
            const c1x = x + s[0];
            const c1y = y + s[1];
            const c2x = c1x + s[2];
            const c2y = c1y + s[3];
            const ex = c2x + s[4];
            const ey = c2y + s[5];
            curveTo(c1x, c1y, c2x, c2y, ex, ey);
            const d1x = ex + s[6];
            const d1y = ey + s[7];
            const d2x = d1x + s[8];
            const d2y = d1y + s[9];
            curveTo(d1x, d1y, d2x, d2y, d2x + s[10], d2y + s[11]);
          } else if (op === 34) {
            const y0 = y;
            const c1x = x + s[0];
            const c2x = c1x + s[1];
            const c2y = y + s[2];
            const ex = c2x + s[3];
            curveTo(c1x, y0, c2x, c2y, ex, c2y);
            const d1x = ex + s[4];
            const d2x = d1x + s[5];
            curveTo(d1x, c2y, d2x, y0, d2x + s[6], y0);
          } else if (op === 36) {
            const y0 = y;
            const c1x = x + s[0];
            const c1y = y + s[1];
            const c2x = c1x + s[2];
            const c2y = c1y + s[3];
            const ex = c2x + s[4];
            curveTo(c1x, c1y, c2x, c2y, ex, c2y);
            const d1x = ex + s[5];
            const d2x = d1x + s[6];
            const d2y = c2y + s[7];
            curveTo(d1x, c2y, d2x, d2y, d2x + s[8], y0);
          } else if (op === 37) {
            const x0 = x;
            const y0 = y;
            const c1x = x + s[0];
            const c1y = y + s[1];
            const c2x = c1x + s[2];
            const c2y = c1y + s[3];
            const ex = c2x + s[4];
            const ey = c2y + s[5];
            curveTo(c1x, c1y, c2x, c2y, ex, ey);
            const d1x = ex + s[6];
            const d1y = ey + s[7];
            const d2x = d1x + s[8];
            const d2y = d1y + s[9];
            if (Math.abs(d2x - x0) > Math.abs(d2y - y0)) curveTo(d1x, d1y, d2x, d2y, d2x + s[10], y0);
            else curveTo(d1x, d1y, d2x, d2y, x0, d2y + s[10]);
          }
          stack.length = 0;
          break;
        }
        default:
          stack.length = 0;
      }
    }
  };
  const cs = cff.charStrings[gid];
  if (cs) exec(cs[0], cs[1], 0);
  if (open) b.close();
}

// ---------------------------------------------------------------------------
// WOFF 1.0 and WOFF 2.0 unwrapping.

function buildSfnt(flavor, tables) {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  let size = 12 + 16 * n;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  dv.setUint16(6, 16 << es);
  dv.setUint16(8, es);
  dv.setUint16(10, n * 16 - (16 << es));
  let off = 12 + 16 * n;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) dv.setUint8(r + k, t.tag.charCodeAt(k));
    dv.setUint32(r + 8, off);
    dv.setUint32(r + 12, t.data.length);
    out.set(t.data, off);
    off += (t.data.length + 3) & ~3;
  });
  return out.buffer;
}

async function unwrapWoff1(buf) {
  const dv = new DataView(buf);
  const flavor = dv.getUint32(4);
  const n = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const off = dv.getUint32(r + 4);
    const comp = dv.getUint32(r + 8);
    const orig = dv.getUint32(r + 12);
    const raw = new Uint8Array(buf, off, comp);
    const data = comp < orig ? await inflate(raw) : raw.slice();
    if (data.length !== orig) throw new Error(`unwrapFont: WOFF table ${tagAt(dv, r)} has the wrong decompressed length`);
    tables.push({ tag: tagAt(dv, r), data });
  }
  return buildSfnt(flavor, tables);
}

const WOFF2_TAGS = ('cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern ' +
  'LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar ' +
  'fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill').match(/.{4}\s?/g).map((s) => s.slice(0, 4));

async function brotliDecompress(bytes) {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const zlib = await import('node:zlib');
    const out = zlib.brotliDecompressSync(bytes);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  let ds;
  try {
    ds = new DecompressionStream('brotli');
  } catch {
    throw new Error('unwrapFont: WOFF2 needs Brotli decompression, which this browser does not provide; convert the font to TTF, OTF or WOFF');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class ByteReader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.b = bytes;
    this.p = start;
    this.end = end;
  }
  u8() {
    if (this.p >= this.end) throw new Error('unwrapFont: WOFF2 stream overrun');
    return this.b[this.p++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  i16() {
    const v = this.u16();
    return v & 0x8000 ? v - 0x10000 : v;
  }
  u32() {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }
  base128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      if (i === 0 && b === 0x80) throw new Error('unwrapFont: bad UIntBase128');
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('unwrapFont: UIntBase128 too long');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
  bytes(n) {
    if (this.p + n > this.end) throw new Error('unwrapFont: WOFF2 stream overrun');
    const s = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  }
}

class ByteWriter {
  constructor() {
    this.parts = [];
    this.len = 0;
  }
  u16(v) {
    this.raw(new Uint8Array([(v >> 8) & 0xff, v & 0xff]));
  }
  raw(bytes) {
    this.parts.push(bytes);
    this.len += bytes.length;
  }
  pad4() {
    const pad = (4 - (this.len % 4)) % 4;
    if (pad) this.raw(new Uint8Array(pad));
  }
  concat() {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/** Rebuild glyf and loca from the WOFF2 transformed glyf table (section 5.1 of the WOFF2 spec). */
function reconstructGlyf(data) {
  const r = new ByteReader(data);
  r.u16();
  r.u16();
  const numGlyphs = r.u16();
  r.u16();
  const sizes = [];
  for (let i = 0; i < 7; i++) sizes.push(r.u32());
  let p = r.p;
  const streams = sizes.map((s) => {
    const st = new ByteReader(data, p, p + s);
    p += s;
    return st;
  });
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instrS] = streams;
  const bitmapLen = ((numGlyphs + 31) >> 5) << 2;
  const bboxBits = bboxS.bytes(bitmapLen);
  const withSign = (flag, v) => (flag & 1 ? v : -v);
  const glyf = new ByteWriter();
  const offsets = [];
  const xMins = new Int16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    offsets.push(glyf.len);
    const nc = nContourS.i16();
    const hasBbox = (bboxBits[g >> 3] & (0x80 >> (g & 7))) !== 0;
    if (nc === 0) continue;
    const head = new ByteWriter();
    if (nc === -1) {
      const start = compositeS.p;
      let flags;
      let haveInstr = false;
      do {
        flags = compositeS.u16();
        compositeS.u16();
        compositeS.bytes(flags & 1 ? 4 : 2);
        if (flags & 8) compositeS.bytes(2);
        else if (flags & 0x40) compositeS.bytes(4);
        else if (flags & 0x80) compositeS.bytes(8);
        if (flags & 0x100) haveInstr = true;
      } while (flags & 0x20);
      const comp = data.subarray(start, compositeS.p);
      const bbox = bboxS.bytes(8);
      head.u16(0xffff);
      head.raw(bbox);
      head.raw(comp);
      if (haveInstr) {
        const n = glyphS.u255();
        head.u16(n);
        head.raw(instrS.bytes(n));
      }
      xMins[g] = (bbox[0] << 8) | bbox[1];
      glyf.raw(head.concat());
      glyf.pad4();
      continue;
    }
    const ends = [];
    let total = 0;
    for (let c = 0; c < nc; c++) {
      total += nPointsS.u255();
      ends.push(total - 1);
    }
    const xs = new Int32Array(total);
    const ys = new Int32Array(total);
    const on = new Uint8Array(total);
    let x = 0;
    let y = 0;
    for (let i = 0; i < total; i++) {
      const fl = flagS.u8();
      on[i] = fl & 0x80 ? 0 : 1;
      const f = fl & 0x7f;
      let dx;
      let dy;
      if (f < 10) {
        dx = 0;
        dy = withSign(f, ((f & 14) << 7) + glyphS.u8());
      } else if (f < 20) {
        dx = withSign(f, (((f - 10) & 14) << 7) + glyphS.u8());
        dy = 0;
      } else if (f < 84) {
        const b0 = f - 20;
        const b1 = glyphS.u8();
        dx = withSign(f, 1 + (b0 & 0x30) + (b1 >> 4));
        dy = withSign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
      } else if (f < 120) {
        const b0 = f - 84;
        dx = withSign(f, 1 + (Math.floor(b0 / 12) << 8) + glyphS.u8());
        dy = withSign(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphS.u8());
      } else if (f < 124) {
        const a = glyphS.u8();
        const b2 = glyphS.u8();
        const c = glyphS.u8();
        dx = withSign(f, (a << 4) + (b2 >> 4));
        dy = withSign(f >> 1, ((b2 & 0x0f) << 8) + c);
      } else {
        const a = glyphS.u8();
        const b2 = glyphS.u8();
        const c = glyphS.u8();
        const d = glyphS.u8();
        dx = withSign(f, (a << 8) + b2);
        dy = withSign(f >> 1, (c << 8) + d);
      }
      x += dx;
      y += dy;
      xs[i] = x;
      ys[i] = y;
    }
    const nInstr = glyphS.u255();
    const instr = instrS.bytes(nInstr);
    let bbox;
    if (hasBbox) bbox = bboxS.bytes(8);
    else {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < total; i++) {
        x0 = Math.min(x0, xs[i]);
        x1 = Math.max(x1, xs[i]);
        y0 = Math.min(y0, ys[i]);
        y1 = Math.max(y1, ys[i]);
      }
      if (!total) x0 = y0 = x1 = y1 = 0;
      bbox = new Uint8Array(8);
      const bdv = new DataView(bbox.buffer);
      bdv.setInt16(0, x0);
      bdv.setInt16(2, y0);
      bdv.setInt16(4, x1);
      bdv.setInt16(6, y1);
    }
    xMins[g] = (bbox[0] << 8) | bbox[1];
    head.u16(nc);
    head.raw(bbox);
    for (const e of ends) head.u16(e);
    head.u16(nInstr);
    head.raw(instr);
    const fl = new Uint8Array(total);
    for (let i = 0; i < total; i++) fl[i] = on[i];
    head.raw(fl);
    const coords = new Uint8Array(total * 4);
    const cdv = new DataView(coords.buffer);
    for (let i = 0; i < total; i++) {
      cdv.setInt16(i * 2, xs[i] - (i ? xs[i - 1] : 0));
      cdv.setInt16(total * 2 + i * 2, ys[i] - (i ? ys[i - 1] : 0));
    }
    head.raw(coords);
    glyf.raw(head.concat());
    glyf.pad4();
  }
  offsets.push(glyf.len);
  const loca = new Uint8Array(offsets.length * 4);
  const ldv = new DataView(loca.buffer);
  offsets.forEach((o, i) => ldv.setUint32(i * 4, o));
  return { glyf: glyf.concat(), loca, xMins };
}

function reconstructHmtx(data, numGlyphs, numHMetrics, xMins) {
  const r = new ByteReader(data);
  const flags = r.u8();
  const adv = [];
  for (let i = 0; i < numHMetrics; i++) adv.push(r.u16());
  const lsb = [];
  for (let i = 0; i < numHMetrics; i++) lsb.push(flags & 1 ? xMins[i] : r.i16());
  for (let i = numHMetrics; i < numGlyphs; i++) lsb.push(flags & 2 ? xMins[i] : r.i16());
  const out = new Uint8Array(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < numHMetrics; i++) {
    dv.setUint16(i * 4, adv[i]);
    dv.setInt16(i * 4 + 2, lsb[i]);
  }
  for (let i = numHMetrics; i < numGlyphs; i++) dv.setInt16(numHMetrics * 4 + (i - numHMetrics) * 2, lsb[i]);
  return out;
}

async function unwrapWoff2(buf) {
  const bytes = new Uint8Array(buf);
  const hdr = new DataView(buf);
  const flavor = hdr.getUint32(4);
  if (flavor === 0x74746366) throw new Error('unwrapFont: WOFF2 font collections are not supported');
  const numTables = hdr.getUint16(12);
  const compressedSize = hdr.getUint32(20);
  const r = new ByteReader(bytes, 48);
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    const idx = flags & 63;
    const tag = idx === 63 ? String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8()) : WOFF2_TAGS[idx];
    const version = flags >> 6;
    const origLength = r.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? r.base128() : origLength;
    dir.push({ tag, origLength, transformed, length });
  }
  const data = await brotliDecompress(bytes.subarray(r.p, r.p + compressedSize));
  let off = 0;
  const raw = {};
  for (const t of dir) {
    raw[t.tag] = data.subarray(off, off + t.length);
    off += t.length;
  }
  const tables = [];
  let rebuilt = null;
  const glyfEntry = dir.find((t) => t.tag === 'glyf');
  if (glyfEntry && glyfEntry.transformed) rebuilt = reconstructGlyf(raw.glyf);
  for (const t of dir) {
    let d = raw[t.tag];
    if (t.tag === 'glyf' && rebuilt) d = rebuilt.glyf;
    else if (t.tag === 'loca' && rebuilt) d = rebuilt.loca;
    else if (t.tag === 'head' && rebuilt) {
      d = d.slice();
      new DataView(d.buffer, d.byteOffset, d.byteLength).setInt16(50, 1);
    } else if (t.tag === 'hmtx' && t.transformed) {
      if (!rebuilt) throw new Error('unwrapFont: transformed hmtx requires a transformed glyf table');
      const numGlyphs = new DataView(raw.maxp.buffer, raw.maxp.byteOffset).getUint16(4);
      const nh = new DataView(raw.hhea.buffer, raw.hhea.byteOffset).getUint16(34);
      d = reconstructHmtx(d, numGlyphs, nh, rebuilt.xMins);
    } else if (t.transformed) {
      throw new Error(`unwrapFont: unsupported WOFF2 transform on table ${t.tag}`);
    }
    tables.push({ tag: t.tag, data: d });
  }
  return buildSfnt(flavor, tables);
}

/**
 * Convert font bytes of any supported container to plain sfnt bytes that
 * {@link parseFont} accepts. TTF, OTF and TTC pass through; WOFF 1.0 tables are
 * inflated with zlib; WOFF 2.0 is Brotli-decoded (via `node:zlib` in Node, or
 * `DecompressionStream('brotli')` where a browser provides it) and its glyf,
 * loca and hmtx transforms are reversed.
 * @param {ArrayBuffer} buf Font file bytes.
 * @returns {Promise<ArrayBuffer>} sfnt bytes.
 */
export async function unwrapFont(buf) {
  const sig = tagAt(new DataView(buf), 0);
  if (sig === 'wOFF') return unwrapWoff1(buf);
  if (sig === 'wOF2') return unwrapWoff2(buf);
  return buf;
}

/**
 * Parse sfnt font bytes (TrueType `.ttf`, CFF-flavored OpenType `.otf`, or the
 * first face of a `.ttc`).
 * @param {ArrayBuffer} buffer
 * @returns {Font}
 */
export function parseFont(buffer) {
  return new Font(buffer);
}
