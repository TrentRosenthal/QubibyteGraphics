/**
 * Theme registry.
 * @module themes
 */

import { normalizeTheme, BASE } from './tokens.js';
import { BUILTIN_THEMES } from './builtin.js';

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
