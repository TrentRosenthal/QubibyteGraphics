/**
 * Font registry. Bundled faces (Inter for text, the KaTeX families for math)
 * load through {@link loadDefaultFonts}; user fonts join with
 * {@link registerFont}. Lookups are synchronous once loading has finished, so
 * layout code can run inside a render loop.
 *
 * Family names: `Inter` (styles `regular`, `medium`, `semibold`, `italic`) and
 * the KaTeX families under their CSS names, e.g. `KaTeX_Main` (`regular`,
 * `bold`, `italic`, `bolditalic`), `KaTeX_Math` (`italic`, `bolditalic`),
 * `KaTeX_Size1` .. `KaTeX_Size4` (`regular`), `KaTeX_AMS` (`regular`).
 *
 * @module text/fonts
 */

import { loadBinary } from './assets.js';
import { parseFont, unwrapFont } from './ttf.js';

/** @typedef {import('./ttf.js').Font} Font */

/** @type {Map<string, Font>} */
const registry = new Map();

const INTER = [
  ['regular', 'Inter-Regular.ttf'],
  ['medium', 'Inter-Medium.ttf'],
  ['semibold', 'Inter-SemiBold.ttf'],
  ['italic', 'Inter-Italic.ttf'],
];

const KATEX = [
  'AMS-Regular', 'Caligraphic-Bold', 'Caligraphic-Regular', 'Fraktur-Bold', 'Fraktur-Regular', 'Main-Bold',
  'Main-BoldItalic', 'Main-Italic', 'Main-Regular', 'Math-BoldItalic', 'Math-Italic', 'SansSerif-Bold',
  'SansSerif-Italic', 'SansSerif-Regular', 'Script-Regular', 'Size1-Regular', 'Size2-Regular', 'Size3-Regular',
  'Size4-Regular', 'Typewriter-Regular',
];

const key = (family, style) => `${family}|${style.toLowerCase()}`;

/** @type {Promise<void>|null} */
let defaultsPromise = null;

async function loadInto(family, style, rel) {
  const font = parseFont(await unwrapFont(await loadBinary(rel)));
  registry.set(key(family, style), font);
}

/**
 * Load the bundled fonts (four Inter styles and all KaTeX faces). Safe to call
 * repeatedly; the work happens once.
 * @returns {Promise<void>}
 */
export function loadDefaultFonts() {
  if (!defaultsPromise) {
    const jobs = INTER.map(([style, file]) => loadInto('Inter', style, `vendor/fonts/inter/${file}`));
    for (const name of KATEX) {
      const [fam, style] = name.split('-');
      jobs.push(loadInto(`KaTeX_${fam}`, style, `vendor/fonts/katex/KaTeX_${name}.ttf`));
    }
    defaultsPromise = Promise.all(jobs).then(() => undefined, (err) => {
      defaultsPromise = null;
      throw err;
    });
  }
  return defaultsPromise;
}

/**
 * Look up a loaded font.
 * @param {string} family Family name, e.g. `Inter` or `KaTeX_Main`.
 * @param {string} [style='regular'] Style name, case-insensitive.
 * @returns {Font}
 */
export function getFont(family, style = 'regular') {
  const f = registry.get(key(family, style));
  if (f) return f;
  const loaded = [...registry.keys()].filter((k) => k.startsWith(family + '|')).map((k) => k.split('|')[1]);
  if (loaded.length) throw new Error(`getFont: "${family}" has no style "${style}" (loaded: ${loaded.join(', ')})`);
  throw new Error(`getFont: font "${family}" is not loaded; await loadDefaultFonts() or registerFont() first`);
}

/**
 * Whether a font is loaded.
 * @param {string} family
 * @param {string} [style='regular']
 * @returns {boolean}
 */
export function hasFont(family, style = 'regular') {
  return registry.has(key(family, style));
}

/**
 * Register a user font from its file bytes. TTF, OTF (CFF outlines), TTC,
 * WOFF and WOFF2 are accepted; WOFF2 needs Brotli, which Node always has and
 * browsers expose only where `DecompressionStream('brotli')` exists.
 * @param {string} name Family name to register under.
 * @param {ArrayBuffer} bytes Font file contents.
 * @param {string} [style='regular'] Style name.
 * @returns {Promise<Font>} The parsed font.
 */
export async function registerFont(name, bytes, style = 'regular') {
  const font = parseFont(await unwrapFont(bytes));
  registry.set(key(name, style), font);
  return font;
}
