/**
 * Theme registry.
 * @module themes
 */

import { normalizeTheme, BASE } from './tokens.js';
import { BUILTIN_THEMES } from './builtin.js';
import { contrast, mix, toHex } from '../core/color.js';

/** @type {Map<string, import('./tokens.js').Theme>} */
const registry = new Map();

for (const t of BUILTIN_THEMES) registry.set(t.id, normalizeTheme(t, t.extends ? registry.get(t.extends) : BASE));

/**
 * Get a theme by id, or normalize a theme object.
 * @param {string|Object} idOrTheme
 * @returns {import('./tokens.js').Theme}
 */
export function getTheme(idOrTheme) {
  if (idOrTheme && typeof idOrTheme === 'object') {
    const base = idOrTheme.extends ? getTheme(idOrTheme.extends) : BASE;
    return normalizeTheme(idOrTheme, base);
  }
  const t = registry.get(idOrTheme ?? 'qubibyte');
  if (!t) throw new Error(`Unknown theme "${idOrTheme}". Available: ${[...registry.keys()].join(', ')}`);
  return t;
}

/**
 * Register (or replace) a theme. It may extend another theme by id.
 * @param {Object} theme
 * @returns {import('./tokens.js').Theme}
 */
export function registerTheme(theme) {
  const t = getTheme(theme);
  registry.set(t.id, t);
  return t;
}

/** @returns {Array<{id: string, name: string, dark: boolean, board: string|null}>} */
export function listThemes() {
  return [...registry.values()].map((t) => ({ id: t.id, name: t.name, dark: t.dark, board: t.board }));
}

/**
 * Serialize a theme to a JSON string for export.
 * @param {import('./tokens.js').Theme} theme
 * @returns {string}
 */
export function exportTheme(theme) {
  return JSON.stringify(theme, null, 2);
}

/**
 * Parse and register a theme from JSON text.
 * @param {string} json
 * @returns {import('./tokens.js').Theme}
 */
export function importTheme(json) {
  return registerTheme(JSON.parse(json));
}

/** Board names mapped to the theme that supplies each board's surface. */
export const BOARD_THEMES = { whiteboard: 'whiteboard', chalkboard: 'chalkboard', paper: 'paper', blueprint: 'board-blueprint' };

/** Colors that belong to the board surface rather than to the drawing. */
const SURFACE_KEYS = ['background', 'surface', 'ink', 'muted', 'faint', 'grid'];

/**
 * Put a theme on a board. The theme keeps its accents and element colors
 * (nudged toward the board's ink where they would be hard to read) and
 * takes the board's surface, ink, texture, and stroke weights.
 * `default` (or nothing) keeps the theme's own board; `clean` draws
 * the theme's colors without a board.
 * @param {import('./tokens.js').Theme} theme
 * @param {string|null|undefined} board
 * @returns {import('./tokens.js').Theme}
 */
export function themeWithBoard(theme, board) {
  if (!board || board === 'default') return theme;
  if (board === 'clean') return theme.board ? { ...theme, board: null } : theme;
  const id = BOARD_THEMES[board] ?? board;
  if (!registry.has(id)) return theme;
  const bt = registry.get(id);
  if (theme.board === bt.board && theme.boardOptions?.variant === bt.boardOptions?.variant) return theme;
  const colors = { ...theme.colors };
  for (const k of SURFACE_KEYS) colors[k] = bt.colors[k];
  const bg = bt.colors.background;
  for (const [k, c] of Object.entries(colors)) {
    if (SURFACE_KEYS.includes(k) || typeof c !== 'string') continue;
    let out = c;
    for (let t = 0.15; contrast(out, bg) < 3 && t <= 1; t += 0.15) out = toHex(mix(c, bt.colors.ink, t));
    colors[k] = out;
  }
  return {
    ...theme,
    dark: bt.dark,
    colors,
    type: { ...theme.type, hand: bt.type.hand },
    stroke: { ...theme.stroke, ...bt.stroke },
    background: { ...bt.background },
    texture: { ...bt.texture },
    effects: { glow: 0, scanlines: 0 },
    board: bt.board,
    boardOptions: { ...bt.boardOptions },
  };
}
