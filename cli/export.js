/**
 * Vector and animated vector exports for the CLI: PDF stills, animated SVG,
 * and Lottie JSON.
 */

import { writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { sampleFrame } from '../src/core/sampler.js';
import { frameToPDF } from '../src/export/pdf.js';
import { toLottie, toAnimatedSVG } from '../src/export/animated.js';
import { treatImage } from '../src/render/canvas.js';
import { sceneTheme } from './render.js';

/**
 * JPEG-encode the scene's image assets for PDF embedding.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {any} theme
 * @param {any[]} items
 * @returns {Map<string, {jpeg: Uint8Array, width: number, height: number}>}
 */
function encodeImages(scene, theme, items) {
  const out = new Map();
  for (const it of items) {
    if (it.kind !== 'image' || out.has(it.source)) continue;
    const a = scene.assets.get(it.source);
    let img = a && a.decoded ? a.decoded : typeof it.source === 'object' ? it.source : null;
    if (!img) continue;
    if (it.treatment && it.treatment !== 'none') img = treatImage(img, it.treatment, theme);
    const c = createCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    out.set(it.source, { jpeg: c.toBuffer('image/jpeg', 92), width: img.width, height: img.height });
  }
  return out;
}

/**
 * Write a PDF still, an animated SVG, or Lottie JSON.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {'pdf'|'svg-animated'|'lottie'} format
 * @param {string} output
 * @param {{time?: number, transparent?: boolean, fps?: number}} [opts]
 * @returns {Promise<string>} a short report for the terminal
 */
export async function exportScene(scene, format, output, opts = {}) {
  const theme = sceneTheme(scene);
  if (format === 'pdf') {
    const frame = sampleFrame(scene, opts.time ?? 0, theme);
    const { bytes, rasterized } = frameToPDF(frame, { transparent: opts.transparent, images: encodeImages(scene, theme, frame.items) });
    writeFileSync(output, bytes);
    return `Wrote ${output}${rasterized.length ? `\nNot vector: ${rasterized.join('; ')}` : ''}`;
  }
  if (format === 'svg-animated') {
    const { svg, report } = toAnimatedSVG(scene, theme, { fps: opts.fps, transparent: opts.transparent });
    writeFileSync(output, svg);
    return `Wrote ${output}\n${report}`;
  }
  const { json, report } = toLottie(scene, theme, { fps: opts.fps, transparent: opts.transparent });
  writeFileSync(output, JSON.stringify(json));
  return `Wrote ${output}\n${report}`;
}
