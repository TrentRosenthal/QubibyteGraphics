/**
 * Colors. Parsing, conversion to and from OKLab and OKLCH, perceptual mixing,
 * and WCAG contrast. Colors are plain objects {r, g, b, a} with channels in
 * [0, 1] (sRGB, not premultiplied).
 * @module core/color
 */

/** @typedef {{r: number, g: number, b: number, a: number}} RGBA */

const NAMED = {
  black: '#000000', white: '#ffffff', transparent: '#00000000',
  red: '#d9534f', green: '#4a9d5b', blue: '#3b6fd1', yellow: '#e2b93b', orange: '#e0843a',
  purple: '#8a63c9', cyan: '#3aa7b8', magenta: '#c4589e', gray: '#8a8a8a', grey: '#8a8a8a',
  pink: '#e08aa8', teal: '#2f8f89', brown: '#8b6040',
};

/**
 * Parse a CSS-like color: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(),
 * hsl(), hsla(), oklch(), or a small set of named colors tuned to be muted.
 * @param {string|RGBA} input
 * @returns {RGBA}
 */
export function parseColor(input) {
  if (typeof input === 'object' && input) return { r: input.r, g: input.g, b: input.b, a: input.a ?? 1 };
  if (typeof input !== 'string') throw new Error(`Not a color: ${String(input)}`);
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) throw new Error(`Bad hex color: ${input}`);
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  const m = /^(rgba?|hsla?|oklch)\(([^)]*)\)$/.exec(s);
  if (!m) throw new Error(`Unrecognized color: ${input}`);
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  const num = (p, scale) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / scale);
  if (m[1].startsWith('rgb')) {
    return { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255), a: parts[3] != null ? num(parts[3], 1) : 1 };
  }
  if (m[1].startsWith('hsl')) {
    const h = parseFloat(parts[0]);
    const sat = num(parts[1], 100);
    const l = num(parts[2], 100);
    const [r, g, b] = hslToRgb(h, sat, l);
    return { r, g, b, a: parts[3] != null ? num(parts[3], 1) : 1 };
  }
  const L = num(parts[0], 1);
  const C = parseFloat(parts[1]);
  const H = parseFloat(parts[2]);
  const rgb = oklchToRgb(L, C, H);
  return { ...rgb, a: parts[3] != null ? num(parts[3], 1) : 1 };
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Format as #rrggbb or #rrggbbaa.
 * @param {RGBA} c
 * @returns {string}
 */
export function toHex(c) {
  const h = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b) + (c.a < 1 ? h(c.a) : '');
}

/**
 * Format as a CSS rgba() string, optionally multiplying alpha.
 * @param {RGBA} c
 * @param {number} [alpha=1]
 * @returns {string}
 */
export function toCSS(c, alpha = 1) {
  const a = clamp01(c.a * alpha);
  const r = Math.round(clamp01(c.r) * 255);
  const g = Math.round(clamp01(c.g) * 255);
  const b = Math.round(clamp01(c.b) * 255);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+a.toFixed(4)})`;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * sRGB to OKLab.
 * @param {RGBA} c
 * @returns {{L: number, a: number, b: number, alpha: number}}
 */
export function rgbToOklab(c) {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: c.a,
  };
}

/**
 * OKLab to sRGB (clamped to gamut).
 * @param {number} L @param {number} A @param {number} B @param {number} [alpha=1]
 * @returns {RGBA}
 */
export function oklabToRgb(L, A, B, alpha = 1) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return { r: clamp01(toGamma(r)), g: clamp01(toGamma(g)), b: clamp01(toGamma(b)), a: alpha };
}

/**
 * OKLCH to sRGB. Chroma is reduced until the color fits the sRGB gamut, so
 * hue and lightness are preserved.
 * @param {number} L lightness in [0, 1]
 * @param {number} C chroma, roughly [0, 0.37]
 * @param {number} H hue in degrees
 * @returns {RGBA}
 */
export function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  let c = C;
  for (let i = 0; i < 24; i++) {
    const A = c * Math.cos(h);
    const B = c * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const eps = 1e-4;
    if (r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps) break;
    c *= 0.9;
  }
  return oklabToRgb(L, c * Math.cos(h), c * Math.sin(h));
}

/**
 * sRGB to OKLCH.
 * @param {RGBA} c
 * @returns {{L: number, C: number, H: number}}
 */
export function rgbToOklch(c) {
  const { L, a, b } = rgbToOklab(c);
  const H = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), H: (H + 360) % 360 };
}

/**
 * Perceptual mix in OKLab.
 * @param {string|RGBA} a
 * @param {string|RGBA} b
 * @param {number} t
 * @returns {RGBA}
 */
export function mix(a, b, t) {
  const A = parseColor(a);
  const B = parseColor(b);
  if (t <= 0) return A;
  if (t >= 1) return B;
  const la = rgbToOklab(A);
  const lb = rgbToOklab(B);
  return oklabToRgb(la.L + (lb.L - la.L) * t, la.a + (lb.a - la.a) * t, la.b + (lb.b - la.b) * t, A.a + (B.a - A.a) * t);
}

/**
 * WCAG relative luminance.
 * @param {string|RGBA} c
 * @returns {number}
 */
export function luminance(c) {
  const { r, g, b } = parseColor(c);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * WCAG contrast ratio between two colors, in [1, 21].
 * @param {string|RGBA} a
 * @param {string|RGBA} b
 * @returns {number}
 */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Return a copy with a different alpha.
 * @param {string|RGBA} c
 * @param {number} a
 * @returns {RGBA}
 */
export function withAlpha(c, a) {
  const p = parseColor(c);
  return { ...p, a };
}

/**
 * Hue for a complex phase, on a perceptually even OKLCH ring.
 * @param {number} phase radians
 * @param {{L?: number, C?: number, offset?: number}} [opts]
 * @returns {RGBA}
 */
export function phaseColor(phase, opts = {}) {
  const deg = ((phase * 180) / Math.PI + (opts.offset ?? 0) + 360 * 4) % 360;
  return oklchToRgb(opts.L ?? 0.7, opts.C ?? 0.13, deg);
}
