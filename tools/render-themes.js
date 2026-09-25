#!/usr/bin/env node
/**
 * Render the five reference scenes in every built-in theme and compose one
 * contact sheet per theme (docs/renders/themes/<theme>.png) for grading.
 * Each scene is drawn at its poster frame.
 *
 *   node tools/render-themes.js [theme-filter]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { loadSceneModule, buildFromModule, renderFrameCanvas, sceneTheme } from '../cli/render.js';
import { listThemes } from '../src/index.js';

const REFERENCE = ['09-taylor-series', '08-roots-of-unity', '11-derivative', '22-bell-state', '40-platonic-solids'];
const filter = process.argv[2] ?? '';
const out = 'docs/renders/themes';
mkdirSync(out, { recursive: true });

const modules = [];
for (const name of REFERENCE) modules.push([name, await loadSceneModule(join('examples', `${name}.js`))]);

const W = 960;
const H = 540;
const GAP = 12;
for (const t of listThemes()) {
  if (!t.id.includes(filter)) continue;
  const started = Date.now();
  const sheet = createCanvas(W * 3 + GAP * 2, H * 2 + GAP);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < modules.length; i++) {
    const [, mod] = modules[i];
    const scene = await buildFromModule(mod, { theme: t.id });
    const theme = sceneTheme(scene);
    const frame = Math.min(scene.frameCount - 1, Math.round((mod.config.posterTime ?? scene.duration * 0.75) * scene.fps));
    const canvas = renderFrameCanvas(scene, frame, { theme });
    const img = await loadImage(await canvas.encode('png'));
    ctx.drawImage(img, (i % 3) * (W + GAP), Math.floor(i / 3) * (H + GAP), W, H);
  }
  ctx.fillStyle = '#e8e6e1';
  ctx.font = '28px sans-serif';
  ctx.fillText(t.id, 2 * (W + GAP) + 40, H + GAP + H / 2);
  writeFileSync(join(out, `${t.id}.png`), await sheet.encode('png'));
  console.log(`${t.id}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
