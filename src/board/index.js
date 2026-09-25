/**
 * Board styles: chalkboard, whiteboard, paper, blueprint. Importing this
 * module registers the Canvas2D and SVG board renderers. Board styles are
 * renderer themes: the same scene renders clean or hand-drawn by switching
 * the theme (or `scene.board`).
 * @module board
 */

import './boards.js';
import './svg.js';

export { handStrokes, hatchPath, pathArea } from './hand.js';
export { HAND_STYLES, drawRibbon, drawRuling } from './boards.js';
export { Erase, erase, zigzag } from './erase.js';
export { PageFlip, pageFlip, PageScroll, pageScroll } from './pages.js';
export { DimensionLine } from './dimension.js';
export { fbm, grainMask, surface } from './textures.js';
