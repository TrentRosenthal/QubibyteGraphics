/**
 * Materials and OKLab shading. Shading changes lightness in OKLab and keeps
 * most of the chroma, so dark sides stay colored instead of sliding to gray.
 * @module three/materials
 */

import { parseColor, rgbToOklab, oklabToRgb, rgbToOklch, oklchToRgb } from '../core/color.js';

/**
 * @typedef {Object} Material
 * @property {'flat'|'matte'|'glossy'|'glass'|'wireframe'|'ink'} kind
 * @property {boolean} faces Draw faces.
 * @property {'none'|'lambert'|'phong'} shading
 * @property {number} alpha Face alpha before opacity.
 * @property {number} rim Extra alpha at grazing angles (glass Fresnel rim).
 * @property {number} specular Highlight strength.
 * @property {number} shininess Blinn-Phong exponent.
 * @property {'auto'|'feature'|'all'|'silhouette'|'none'} edges Which edges to draw.
 * @property {number} featureAngle Dihedral angle in degrees above which an edge counts as a feature.
 * @property {number} edgeOpacity
 * @property {number} silhouetteOpacity
 * @property {number} edgeWidth Pixels at 1080p.
 * @property {'hide'|'dim'|'dash'} backEdges How edges on the far side are drawn when visible at all.
 * @property {boolean} occluder Faces fill with the background color (hidden line removal for line styles).
 * @property {string|null} edgeColor Edge color token; null uses ink.
 */

const BASE = {
  faces: true, shading: 'lambert', alpha: 1, rim: 0, specular: 0, shininess: 32,
  edges: 'auto', featureAngle: 30, edgeOpacity: 0.25, silhouetteOpacity: 0.4, edgeWidth: 1.5,
  backEdges: 'hide', occluder: false, edgeColor: null,
};

/** Built-in materials. @type {Record<string, Partial<Material>>} */
export const MATERIALS = {
  flat: { kind: 'flat', shading: 'none' },
  matte: { kind: 'matte', shading: 'lambert' },
  glossy: { kind: 'glossy', shading: 'phong', specular: 0.55, shininess: 48 },
  glass: { kind: 'glass', shading: 'lambert', alpha: 0.12, rim: 0.32, specular: 0.35, shininess: 64, edgeOpacity: 0.18, silhouetteOpacity: 0.35, backEdges: 'dim' },
  wireframe: { kind: 'wireframe', faces: false, edges: 'all', edgeOpacity: 0.85, silhouetteOpacity: 0.85, edgeWidth: 2, backEdges: 'dim' },
  ink: { kind: 'ink', shading: 'none', occluder: true, edgeOpacity: 1, silhouetteOpacity: 1, edgeWidth: 2.5, edges: 'auto' },
};

/**
 * Build a material from a name and overrides, or pass a material through.
 * @param {string|Partial<Material>} [kind='matte']
 * @param {Partial<Material>} [overrides]
 * @returns {Material}
 */
export function material(kind = 'matte', overrides = {}) {
  if (typeof kind === 'object' && kind) return /** @type {Material} */ ({ ...BASE, ...MATERIALS[kind.kind ?? 'matte'], ...kind, ...overrides });
  const m = MATERIALS[kind];
  if (!m) throw new Error(`Unknown material "${kind}". Known: ${Object.keys(MATERIALS).join(', ')}`);
  return /** @type {Material} */ ({ ...BASE, ...m, ...overrides });
}

/**
 * Adapt a material to a light preset: board presets turn solids into ink
 * drawings (hidden line removal, bright lines, no shading); blueprint also
 * shows hidden edges dashed, as drafting does.
 * @param {Material} m
 * @param {string} preset
 * @returns {Material}
 */
export function presetMaterial(m, preset) {
  if (preset === 'studio' || m.kind === 'wireframe') return m;
  if (m.kind === 'glass') return { ...m, shading: 'none', alpha: 0.06, rim: 0, specular: 0, edgeOpacity: 0.55, silhouetteOpacity: 0.95, edgeWidth: 2.5 };
  const dash = preset === 'blueprint';
  return { ...m, kind: 'ink', shading: 'none', occluder: true, specular: 0, alpha: 1, rim: 0, edgeOpacity: 0.9, silhouetteOpacity: 1, edgeWidth: dash ? 2 : 2.5, backEdges: dash ? 'dash' : 'hide' };
}

/**
 * The default surface color: the theme accent with its chroma reduced.
 * @param {import('../core/color.js').RGBA} accent
 * @param {number} [chroma=0.72] chroma multiplier
 * @returns {import('../core/color.js').RGBA}
 */
export function softenColor(accent, chroma = 0.72) {
  const { L, C, H } = rgbToOklch(accent);
  return { ...oklchToRgb(L, C * chroma, H), a: accent.a };
}

const labCache = new Map();

function toLab(c) {
  const key = `${c.r},${c.g},${c.b}`;
  let lab = labCache.get(key);
  if (!lab) {
    lab = rgbToOklab(c);
    if (labCache.size > 4096) labCache.clear();
    labCache.set(key, lab);
  }
  return lab;
}

/**
 * Shade a base color. Diffuse near 1 returns the base color; lower values
 * darken lightness in OKLab while keeping most chroma; specular blends toward
 * a bright, low-chroma version of the same hue.
 * @param {import('../core/color.js').RGBA|string} base
 * @param {number} diffuse
 * @param {number} [specular=0]
 * @returns {import('../core/color.js').RGBA}
 */
export function shade(base, diffuse, specular = 0) {
  const c = parseColor(base);
  const lab = toLab(c);
  const k = Math.max(0, Math.min(1.3, diffuse));
  let L = lab.L * (0.4 + 0.6 * k);
  const chroma = 0.8 + 0.2 * Math.min(1, k);
  let A = lab.a * chroma;
  let B = lab.b * chroma;
  const s = Math.max(0, Math.min(0.85, specular));
  if (s > 0) {
    L += (0.97 - L) * s;
    A *= 1 - 0.75 * s;
    B *= 1 - 0.75 * s;
  }
  return oklabToRgb(Math.min(0.985, L), A, B, c.a);
}

/** A color value with an alpha multiplier, resolved at render time. */
export class AlphaColor {
  /** @param {any} color theme token, hex, RGBA, or ColorMix @param {number} alpha */
  constructor(color, alpha) {
    this.color = color;
    this.alpha = alpha;
  }
}
