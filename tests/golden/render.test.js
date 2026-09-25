import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { loadSceneModule, buildFromModule, renderFrameCanvas, sceneTheme } from '../../cli/render.js';

// Golden images: a few scenes rendered at 480x270 and compared with stored
// PNGs. Rendering is deterministic, so the tolerance only absorbs
// antialiasing differences between canvas builds. Refresh the fixtures
// after an intended visual change with QGFX_UPDATE_GOLDEN=1 npm run test:golden.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const UPDATE = process.env.QGFX_UPDATE_GOLDEN === '1';
const CASES = [
  ['09-taylor-series', {}],
  ['22-bell-state', {}],
  ['40-platonic-solids', {}],
  ['30-pythagoras-boards', { board: 'chalkboard' }],
  ['11-derivative', { theme: 'paper' }],
];

async function render(name, overrides) {
  const mod = await loadSceneModule(join(ROOT, 'examples', `${name}.js`));
  const scene = await buildFromModule(mod, { width: 480, height: 270, ...overrides });
  const n = Math.min(scene.frameCount - 1, Math.round((mod.config.posterTime ?? scene.duration * 0.75) * scene.fps));
  const canvas = renderFrameCanvas(scene, n, { theme: sceneTheme(scene) });
  return canvas;
}

function pixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

for (const [name, overrides] of CASES) {
  const tag = [name, ...Object.values(overrides)].join('-');
  test(`golden: ${tag}`, async () => {
    const canvas = await render(name, overrides);
    const file = join(HERE, 'fixtures', `${tag}.png`);
    if (UPDATE || !existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await canvas.encode('png'));
      if (!UPDATE) assert.fail(`wrote missing fixture ${file}; review it and rerun`);
      return;
    }
    const img = await loadImage(readFileSync(file));
    const ref = createCanvas(img.width, img.height);
    ref.getContext('2d').drawImage(img, 0, 0);
    assert.equal(canvas.width, img.width);
    const a = pixels(canvas);
    const b = pixels(ref);
    let sum = 0;
    let bad = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      sum += d;
      if (d > 96) bad++;
    }
    const mean = sum / (a.length / 4) / 3;
    const badShare = bad / (a.length / 4);
    assert.ok(mean < 1.5 && badShare < 0.004, `${tag}: mean channel difference ${mean.toFixed(3)}, ${(badShare * 100).toFixed(2)}% of pixels differ strongly`);
  });
}
