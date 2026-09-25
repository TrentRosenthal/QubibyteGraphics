/**
 * Text and math typesetting as vector paths.
 *
 * Typical use:
 *
 *   await loadDefaultFonts();
 *   const label = textToPath('Hello', { size: 0.5 });        // merged Path + per-glyph ranges
 *   const eq = texToPaths('e^{i\\pi} + 1 = 0', { size: 0.6 }); // positioned glyphs, rules, shapes
 *   eq.part('e^{i\\pi}');                                      // item indices of a sub-expression
 *
 * @module text
 */

export { loadBinary, registerFontBytes } from './assets.js';
export { Font, parseFont, unwrapFont } from './ttf.js';
export { loadDefaultFonts, getFont, hasFont, registerFont } from './fonts.js';
export { layoutText, textToPath } from './layout.js';
export { texToPaths, texPart, colorByToken, matchTokens, tokenize } from './tex.js';
export { HERSHEY_FONTS, parseJHF, buildFont, loadHershey, loadHersheyFonts, strokeText } from './hershey.js';
export { rasterizePath, thin, skeletonize, outlineStrokes } from './skeleton.js';
