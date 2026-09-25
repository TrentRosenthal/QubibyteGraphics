#!/usr/bin/env node
/**
 * Measure build time, sample time per frame, and raster time per frame at
 * 1080p for a set of example scenes, and print a Markdown table.
 *
 *   node tools/benchmark.js [--frames 60]
 */

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cpus } from 'node:os';
import { createCanvas } from '@napi-rs/canvas';
import { loadSceneModule, buildFromModule, sceneTheme } from '../cli/render.js';
import { sampleFrame } from '../src/core/sampler.js';
import { renderFrame } from '../src/render/canvas.js';

const { values } = parseArgs({ options: { frames: { type: 'string' } } });
const FRAMES = Number(values.frames ?? 60);
const CASES = [
  ['09-taylor-series', {}],
  ['20-grover-explainer', {}],
  ['07-phase-portrait', {}],
  ['40-platonic-solids', {}],
  ['41-surface-plot', {}],
  ['30-pythagoras-boards', { board: 'chalkboard' }],
];

const rows = [];
for (const [name, overrides] of CASES) {
  const mod = await loadSceneModule(join('examples', `${name}.js`));
  let t0 = performance.now();
  const scene = await buildFromModule(mod, overrides);
  const build = performance.now() - t0;
  const theme = sceneTheme(scene);
  const canvas = createCanvas(scene.width, scene.height);
  const g = canvas.getContext('2d');
  const step = Math.max(1, Math.floor(scene.frameCount / FRAMES));
  let sample = 0;
  let raster = 0;
  let n = 0;
  for (let f = 0; f < scene.frameCount && n < FRAMES; f += step, n++) {
    t0 = performance.now();
    const frame = sampleFrame(scene, scene.frameTime(f), theme);
    const t1 = performance.now();
    renderFrame(g, frame, { assets: scene.assets });
    raster += performance.now() - t1;
    sample += t1 - t0;
  }
  const per = (sample + raster) / n;
  rows.push(`| ${name}${overrides.board ? ` (${overrides.board})` : ''} | ${scene.frameCount} | ${build.toFixed(0)} | ${(sample / n).toFixed(1)} | ${(raster / n).toFixed(1)} | ${(1000 / per).toFixed(0)} |`);
}
console.log(`Node ${process.version}, ${cpus()[0].model}, ${FRAMES} frames sampled evenly per scene, 1920x1080, one thread.\n`);
console.log('| Scene | Frames | Build (ms) | Sample (ms/frame) | Raster (ms/frame) | Frames per second |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(r);
