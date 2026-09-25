#!/usr/bin/env node
/**
 * Render gallery stills for grading and for the docs: for each example, the
 * first frame, 25%, 50%, 75%, and the last frame at 1920x1080 (or the
 * example's own size), a poster (the 75% frame, or the example's
 * `posterTime`), and a contact strip of all five at reduced size.
 *
 *   node tools/render-gallery.js [name-filter] [--theme id] [--board style] [--out dir]
 */

import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { loadSceneModule, buildFromModule, renderFrameCanvas, sceneTheme } from '../cli/render.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { theme: { type: 'string' }, board: { type: 'string' }, out: { type: 'string' }, width: { type: 'string' } } });
const filter = positionals[0] ?? '';
const outDir = values.out ?? 'docs/renders/gallery';
mkdirSync(outDir, { recursive: true });

const files = readdirSync('examples').filter((f) => /^\d\d-.*\.js$/.test(f) && f.includes(filter)).sort();
for (const f of files) {
  const name = basename(f, '.js');
  const started = Date.now();
  const mod = await loadSceneModule(join('examples', f));
  const overrides = {};
  if (values.theme) overrides.theme = values.theme;
  if (values.board) overrides.board = values.board;
  const suffix = [values.theme, values.board].filter(Boolean).map((v) => `-${v}`).join('');
  const scene = await buildFromModule(mod, overrides);
  const theme = sceneTheme(scene);
  const n = scene.frameCount;
  const picks = [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1];
  const dir = join(outDir, name + suffix);
  mkdirSync(dir, { recursive: true });
  const stripW = 480;
  const stripH = Math.round((stripW * scene.height) / scene.width);
  const strip = createCanvas(stripW * picks.length + 8 * (picks.length - 1), stripH);
  const sctx = strip.getContext('2d');
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, strip.width, strip.height);
  for (let i = 0; i < picks.length; i++) {
    const canvas = renderFrameCanvas(scene, picks[i], { theme });
    const png = await canvas.encode('png');
    writeFileSync(join(dir, `frame-${['00', '25', '50', '75', '100'][i]}.png`), png);
    const img = await loadImage(png);
    sctx.drawImage(img, i * (stripW + 8), 0, stripW, stripH);
  }
  const posterFrame = mod.config.posterTime != null ? Math.round(mod.config.posterTime * scene.fps) : picks[3];
  const poster = renderFrameCanvas(scene, Math.min(n - 1, posterFrame), { theme });
  writeFileSync(join(outDir, `${name}${suffix}.png`), await poster.encode('png'));
  writeFileSync(join(dir, 'strip.png'), await strip.encode('png'));
  console.log(`${name}: ${n} frames, ${scene.duration.toFixed(1)} s, rendered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
