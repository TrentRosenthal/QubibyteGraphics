/**
 * Theme token model. A theme is plain data: colors, type, strokes, spacing,
 * motion, texture, and lighting. Every renderer reads tokens from the active
 * theme; objects can override any token for themselves and their children.
 * @module themes/tokens
 */

import { parseColor } from '../core/color.js';

/**
 * @typedef {Object} Theme
 * @property {string} id
 * @property {string} name
 * @property {boolean} dark
 * @property {Record<string, string>} colors
 * @property {{text: string, math: string, hand: string, scale: Record<string, number>, weight: Record<string, string>}} type
 * @property {Record<string, number>} stroke Stroke widths in pixels at 1080p.
 * @property {Record<string, number>} radius Corner radii in world units.
 * @property {number[]} space Spacing scale in world units.
 * @property {{ease: string, duration: number, lagRatio: number}} motion
 * @property {{kind: string, [key: string]: any}} background
 * @property {{grain: number}} texture
 * @property {{glow: number, scanlines: number}} effects Theme-specific finishing: glow (neon) and scanlines (terminal).
 * @property {string} light 3D lighting preset.
 * @property {string|null} board Board renderer id, or null for clean vector output.
 * @property {Record<string, any>} [boardOptions]
 */

/** Keys every theme's `colors` must define. */
export const COLOR_KEYS = [
  'background', 'surface', 'ink', 'muted', 'faint', 'grid', 'accent', 'accent2',
  'positive', 'negative', 'ket0', 'ket1',
  'gateHadamard', 'gatePauli', 'gatePhase', 'gateRotation', 'gateControlled', 'gateSwap', 'gateMeasure', 'gateUser',
];

/**
 * Fill in defaults for a partial theme and validate colors.
 * @param {Partial<Theme>} t
 * @param {Theme} [base]
 * @returns {Theme}
 */
export function normalizeTheme(t, base) {
  const b = base ?? BASE;
  const out = {
    id: t.id ?? b.id,
    name: t.name ?? b.name,
    dark: t.dark ?? b.dark,
    colors: { ...b.colors, ...(t.colors || {}) },
    type: { ...b.type, ...(t.type || {}), scale: { ...b.type.scale, ...((t.type && t.type.scale) || {}) }, weight: { ...b.type.weight, ...((t.type && t.type.weight) || {}) } },
    stroke: { ...b.stroke, ...(t.stroke || {}) },
    radius: { ...b.radius, ...(t.radius || {}) },
    space: t.space ?? b.space,
    motion: { ...b.motion, ...(t.motion || {}) },
    background: { ...(t.background ?? b.background) },
    texture: { ...b.texture, ...(t.texture || {}) },
    effects: { ...b.effects, ...(t.effects || {}) },
    light: t.light ?? b.light,
    board: t.board !== undefined ? t.board : b.board,
    boardOptions: { ...(b.boardOptions || {}), ...(t.boardOptions || {}) },
  };
  for (const k of COLOR_KEYS) {
    if (!out.colors[k]) throw new Error(`Theme "${out.id}" is missing color "${k}"`);
    parseColor(out.colors[k]);
  }
  return out;
}

/**
 * Base token set. Built-in themes start from it.
 * @type {Theme}
 */
export const BASE = {
  id: 'base',
  name: 'Base',
  dark: true,
  colors: {
    background: '#111113',
    surface: '#1a1a1d',
    ink: '#ece9e3',
    muted: '#9a968f',
    faint: '#55534f',
    grid: '#3a3936',
    accent: '#5b8def',
    accent2: '#d9a441',
    positive: '#6fb58a',
    negative: '#d8735f',
    ket0: '#5b8def',
    ket1: '#d9a441',
    gateHadamard: '#5b8def',
    gatePauli: '#ece9e3',
    gatePhase: '#9d8cd6',
    gateRotation: '#6fb5a8',
    gateControlled: '#ece9e3',
    gateSwap: '#ece9e3',
    gateMeasure: '#9a968f',
    gateUser: '#d9a441',
  },
  type: {
    text: 'Inter',
    math: 'KaTeX',
    hand: 'futural',
    scale: { caption: 0.26, label: 0.32, body: 0.4, heading: 0.52, title: 0.66, display: 0.92 },
    weight: { body: 'Regular', label: 'Medium', title: 'SemiBold' },
  },
  stroke: { hairline: 1.5, thin: 2.5, regular: 4, bold: 6, grid: 1.5, axis: 2.5 },
  radius: { small: 0.04, medium: 0.08, large: 0.16 },
  space: [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3],
  motion: { ease: 'smooth', duration: 1, lagRatio: 0.1 },
  background: { kind: 'solid' },
  texture: { grain: 0 },
  effects: { glow: 0, scanlines: 0 },
  light: 'studio',
  board: null,
  boardOptions: {},
};

/**
 * Resolve a color value against a theme and a chain of object token
 * overrides. Values can be theme keys ('accent'), hex, or CSS color strings.
 * @param {any} value
 * @param {Theme} theme
 * @param {Record<string, any>} [overrides]
 * @returns {import('../core/color.js').RGBA|null}
 */
export function resolveColor(value, theme, overrides) {
  if (value == null) return null;
  if (typeof value === 'object' && 'r' in value) return value;
  if (typeof value === 'string') {
    if (overrides && overrides[value] != null && overrides[value] !== value) return resolveColor(overrides[value], theme, null);
    const t = theme.colors[value];
    if (t != null) return parseColor(t);
    return parseColor(value);
  }
  throw new Error(`Cannot resolve color ${String(value)}`);
}
