/**
 * Registers the text module with the engine: fonts load before scenes
 * build, and axes use TeX for tick labels.
 * @module text/setup
 */

import { registerPreload } from '../core/scene.js';
import { setLabelFactory, setHandLabelFactory } from '../core/coords.js';
import { loadDefaultFonts } from './fonts.js';
import { loadHersheyFonts, strokeText } from './hershey.js';
import { texLabelGlyphs } from './nodes.js';

registerPreload(async () => {
  await Promise.all([loadDefaultFonts(), loadHersheyFonts()]);
});

setLabelFactory(texLabelGlyphs);

setHandLabelFactory((tex, size) => {
  const plain = tex.replace(/\\times/g, 'x').replace(/[{}]/g, '');
  if (!/^[-0-9A-Za-z.,+=()' ]+$/.test(plain)) return null;
  const cap = size * 0.72;
  const r = strokeText(plain, { size: cap });
  if (!r.strokes.length) return null;
  return { strokes: r.strokes.map((s) => s.points), width: r.width, height: cap };
});
