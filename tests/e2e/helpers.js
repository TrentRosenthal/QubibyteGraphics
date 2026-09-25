/**
 * Shared setup for end-to-end tests: find Chromium, serve the repository,
 * and read pixels back from screenshots.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { startServer } from '../../tools/serve.js';

/** Path to a Chromium binary, or null. */
export function findChromium() {
  const candidates = [process.env.QGFX_CHROMIUM, process.env.CHROMIUM_PATH].filter(Boolean);
  for (const root of ['/opt/pw-browsers', join(process.env.HOME || '', '.cache/ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      candidates.push(join(root, d, 'chrome-linux', 'chrome'), join(root, d, 'chrome-linux64', 'chrome'));
    }
  }
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

const chrome = findChromium();
const enabled = process.env.QGFX_E2E === '1';

/** Why end-to-end tests are skipped, or false when they run. */
export const skipReason = !chrome ? 'Chromium is not installed (set QGFX_CHROMIUM to its path)' : !enabled ? 'end-to-end tests run with npm run test:e2e (QGFX_E2E=1)' : false;

/** Whether ffprobe is available for checking exported files. */
export const hasFFprobe = spawnSync('ffprobe', ['-version']).status === 0;

/**
 * Start the static server and a browser.
 * @returns {Promise<{url: string, browser: any, close: () => Promise<void>}>}
 */
export async function setup() {
  const server = await startServer({ port: 0 });
  const browser = await chromium.launch({ executablePath: chrome });
  return {
    url: server.url,
    browser,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * Open a page and collect console errors and uncaught exceptions.
 * @param {any} browser
 * @param {{width?: number, height?: number, colorScheme?: string}} [o]
 */
export async function openPage(browser, o = {}) {
  const context = await browser.newContext({ viewport: { width: o.width ?? 1440, height: o.height ?? 900 }, colorScheme: o.colorScheme ?? 'dark', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, context, errors };
}

/**
 * Pixel statistics of an element's screenshot.
 * @param {any} locator
 * @returns {Promise<{distinct: number, match: (rgb: number[], tol?: number) => number, data: Uint8ClampedArray, width: number, height: number}>}
 */
export async function pixels(locator) {
  const png = await locator.screenshot();
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 16) seen.add((data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3));
  return {
    distinct: seen.size,
    data,
    width: img.width,
    height: img.height,
    match: (rgb, tol = 24) => {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - rgb[0]) <= tol && Math.abs(data[i + 1] - rgb[1]) <= tol && Math.abs(data[i + 2] - rgb[2]) <= tol) n++;
      return n;
    },
  };
}

/**
 * Probe a media file.
 * @param {string} file
 * @param {string[]} [extra] extra ffprobe arguments before the file
 * @returns {{codec_name: string, width: number, height: number, nb_read_frames: string}[]}
 */
export function probe(file, extra = []) {
  const r = spawnSync('ffprobe', ['-v', 'error', ...extra, '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe rejected ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout).streams;
}
