/**
 * Palette helper: build a complete, coherent theme palette from one seed
 * color or a short description like "pastel green" or "dark warm amber".
 * Colors are built in OKLCH so lightness steps are even, and every text and
 * accent pair is checked against WCAG contrast.
 * @module themes/palette
 */

import { parseColor, rgbToOklch, oklchToRgb, toHex, contrast } from '../core/color.js';

/** Hue angles (OKLCH degrees) for color words. */
export const HUE_WORDS = {
  red: 25, crimson: 18, rose: 5, pink: 355, magenta: 330, fuchsia: 325, purple: 305, violet: 295, indigo: 275,
  blue: 258, sky: 235, cyan: 210, teal: 190, mint: 170, green: 145, emerald: 158, lime: 125, olive: 110,
  yellow: 98, amber: 78, gold: 85, orange: 55, coral: 38, brown: 55, sand: 80, slate: 250, gray: 250, grey: 250,
};

/** Mood words and their effect on lightness (L) and chroma (C). */
export const MOOD_WORDS = {
  pastel: { C: 0.07, L: 0.78, bgL: 0.965, dark: false },
  soft: { C: 0.08, L: 0.72 },
  muted: { C: 0.06, L: 0.66 },
  vivid: { C: 0.17, L: 0.66 },
  neon: { C: 0.2, L: 0.82, bgL: 0.13, dark: true },
  deep: { C: 0.12, L: 0.5 },
  dark: { dark: true },
  light: { dark: false },
  warm: { warm: 1 },
  cool: { warm: -1 },
};

/**
 * Parse a description into a seed color and options.
 * @param {string} text for example "pastel green", "dark vivid blue", or "#4a90e2 dark"
 * @returns {{seed: string, dark: boolean|null, mood: Record<string, any>}}
 */
export function parseDescription(text) {
  const words = String(text).toLowerCase().split(/[\s,]+/).filter(Boolean);
  let hue = null;
  let explicit = null;
  const mood = {};
  let dark = null;
  let gray = false;
  for (const w of words) {
    if (/^#?[0-9a-f]{6}$/.test(w) || /^#[0-9a-f]{3}$/.test(w)) explicit = w.startsWith('#') ? w : `#${w}`;
    else if (HUE_WORDS[w] != null) {
      hue = HUE_WORDS[w];
      if (w === 'gray' || w === 'grey' || w === 'slate') gray = true;
      if (w === 'brown' || w === 'sand') Object.assign(mood, { C: 0.07, L: 0.55 });
    } else if (MOOD_WORDS[w]) {
      const m = MOOD_WORDS[w];
      if (m.dark != null) dark = m.dark;
      if (m.warm) mood.warm = (mood.warm || 0) + m.warm;
      for (const k of ['C', 'L', 'bgL']) if (m[k] != null) mood[k] = m[k];
    }
  }
  if (explicit) return { seed: explicit, dark, mood };
  const H = hue ?? 258;
  const C = gray ? 0.025 : mood.C ?? 0.13;
  const L = mood.L ?? 0.64;
  return { seed: toHex(oklchToRgb(L, C, H)), dark, mood };
}

/**
 * Move a color along lightness until it reaches a contrast target against
 * a background.
 * @param {{L: number, C: number, H: number}} lch
 * @param {string} bg
 * @param {number} target
 * @param {1|-1} dir direction to move lightness (1 lighter, -1 darker)
 * @returns {string}
 */
function ensureContrast(lch, bg, target, dir) {
  let { L } = lch;
  for (let i = 0; i < 60; i++) {
    const hex = toHex(oklchToRgb(L, lch.C, lch.H));
    if (contrast(hex, bg) >= target) return hex;
    L = Math.max(0, Math.min(1, L + dir * 0.01));
  }
  return toHex(oklchToRgb(L, lch.C, lch.H));
}

/**
 * @typedef {Object} PaletteResult
 * @property {Record<string, string>} colors theme color tokens
 * @property {boolean} dark
 * @property {Record<string, number>} contrasts contrast ratios of text and accent pairs against the background
 * @property {string[]} warnings pairs that could not reach their target
 */

/**
 * Build a full palette from a seed color or description.
 * @param {string} seedOrDescription
 * @param {{dark?: boolean}} [opts]
 * @returns {PaletteResult}
 */
export function paletteFrom(seedOrDescription, opts = {}) {
  const parsed = /^#?[0-9a-f]{3,8}$/i.test(String(seedOrDescription).trim()) ? { seed: String(seedOrDescription).trim().replace(/^([^#])/, '#$1'), dark: null, mood: {} } : parseDescription(seedOrDescription);
  const seed = rgbToOklch(parseColor(parsed.seed));
  const dark = opts.dark ?? parsed.dark ?? false;
  const warm = parsed.mood.warm ?? 0;
  // Neutrals carry a whisper of the seed hue (or of warm or cool) so the palette feels related.
  const nh = warm > 0 ? 70 : warm < 0 ? 250 : seed.H;
  const nc = Math.min(0.018, 0.006 + seed.C * 0.06) + Math.abs(warm) * 0.006;
  const bgL = parsed.mood.bgL ?? (dark ? 0.17 : 0.975);
  const bg = toHex(oklchToRgb(bgL, nc, nh));
  const surface = toHex(oklchToRgb(dark ? bgL + 0.04 : Math.min(1, bgL + 0.015), nc, nh));
  const ink = ensureContrast({ L: dark ? 0.93 : 0.22, C: nc * 0.8, H: nh }, bg, 12, dark ? 1 : -1);
  const muted = ensureContrast({ L: dark ? 0.7 : 0.5, C: nc, H: nh }, bg, 4.6, dark ? 1 : -1);
  const faint = toHex(oklchToRgb(dark ? 0.42 : 0.78, nc, nh));
  const grid = toHex(oklchToRgb(dark ? bgL + 0.09 : bgL - 0.085, nc, nh));
  const accentL = dark ? Math.max(0.62, seed.L) : Math.min(0.6, seed.L);
  const accent = ensureContrast({ L: accentL, C: Math.min(0.2, Math.max(seed.C, 0.05)), H: seed.H }, bg, 3.2, dark ? 1 : -1);
  // Second accent: a split complement at lower chroma, never a rainbow.
  const h2 = (seed.H + (seed.H > 180 ? -155 : 155) + 360) % 360;
  const accent2 = ensureContrast({ L: accentL + (dark ? 0.06 : 0.04), C: Math.min(0.15, Math.max(0.05, seed.C * 0.85)), H: h2 }, bg, 3, dark ? 1 : -1);
  const positive = ensureContrast({ L: accentL, C: 0.11, H: 150 }, bg, 3, dark ? 1 : -1);
  const negative = ensureContrast({ L: accentL, C: 0.13, H: 30 }, bg, 3, dark ? 1 : -1);
  const phaseLike = ensureContrast({ L: accentL, C: Math.min(0.12, seed.C), H: (seed.H + 60) % 360 }, bg, 3, dark ? 1 : -1);
  const rotLike = ensureContrast({ L: accentL, C: Math.min(0.1, seed.C), H: (seed.H - 60 + 360) % 360 }, bg, 3, dark ? 1 : -1);
  const colors = {
    background: bg, surface, ink, muted, faint, grid, accent, accent2, positive, negative,
    ket0: accent, ket1: accent2,
    gateHadamard: accent, gatePauli: ink, gatePhase: phaseLike, gateRotation: rotLike,
    gateControlled: ink, gateSwap: ink, gateMeasure: muted, gateUser: accent2,
  };
  const contrasts = {
    ink: contrast(ink, bg),
    muted: contrast(muted, bg),
    accent: contrast(accent, bg),
    accent2: contrast(accent2, bg),
  };
  const warnings = [];
  if (contrasts.ink < 7) warnings.push(`ink on background is ${contrasts.ink.toFixed(2)}:1 (target 7:1)`);
  if (contrasts.muted < 4.5) warnings.push(`muted on background is ${contrasts.muted.toFixed(2)}:1 (target 4.5:1)`);
  if (contrasts.accent < 3) warnings.push(`accent on background is ${contrasts.accent.toFixed(2)}:1 (target 3:1)`);
  return { colors, dark, contrasts, warnings };
}

/**
 * A complete theme object from a description, ready for registerTheme.
 * @param {string} id
 * @param {string} description
 * @param {{name?: string, dark?: boolean, extends?: string}} [opts]
 * @returns {Record<string, any>}
 */
export function themeFrom(id, description, opts = {}) {
  const p = paletteFrom(description, { dark: opts.dark });
  const pastel = /pastel|soft/.test(String(description).toLowerCase());
  return {
    id,
    name: opts.name ?? description,
    dark: p.dark,
    extends: opts.extends,
    colors: p.colors,
    ...(pastel ? { stroke: { regular: 5, bold: 7 }, radius: { small: 0.08, medium: 0.16, large: 0.28 }, texture: { grain: 0.3 } } : {}),
  };
}
