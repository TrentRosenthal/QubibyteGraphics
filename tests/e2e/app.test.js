import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skipReason, hasFFprobe, setup, openPage, pixels, probe } from './helpers.js';
import { encodePermalink } from '../../src/playground/permalink.js';

let env;
let dir;

before(async () => {
  if (skipReason) return;
  env = await setup();
  dir = mkdtempSync(join(tmpdir(), 'qg-e2e-'));
});

after(async () => {
  if (env) await env.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function openEditor(query = '', hash = '') {
  const o = await openPage(env.browser);
  // Init scripts also run in the sandboxed runtime iframe, which has no storage.
  await o.page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // no storage in this frame
    }
  });
  await o.page.goto(`${env.url}index.html${query}${hash}`);
  await o.page.waitForSelector('.ve-frame canvas');
  await o.page.waitForFunction(() => document.querySelectorAll('.tl-row').length >= 4);
  await o.page.waitForTimeout(600);
  return o;
}

/**
 * Shorten the starter document so exports stay quick. The scene still runs
 * until its last animation ends, so this returns the resulting duration.
 */
async function shorten(page) {
  const before = await page.textContent('.time-readout .total');
  await page.fill('[data-duration]', '1');
  await page.press('[data-duration]', 'Enter');
  await page.waitForFunction((b) => document.querySelector('.time-readout .total')?.textContent !== b, before);
  const [m, s] = (await page.textContent('.time-readout .total')).split(':').map(Number);
  return m * 60 + s;
}

const framesAt = (seconds, fps) => Math.max(1, Math.round(seconds * fps));

async function exportAs(page, format, { size = '640x360', fps = '30' } = {}) {
  if (await page.locator('#export-panel').isHidden()) await page.click('#export-btn');
  await page.check(`input[name=xp-format][value="${format}"]`);
  await page.selectOption('#export-panel [data-opt=size]', size);
  if (await page.locator('#export-panel [data-opt=fps]').count()) await page.selectOption('#export-panel [data-opt=fps]', fps);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#export-panel [data-go]')]);
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  await page.waitForSelector('#export-panel .xp-result');
  return { file, notes: await page.locator('#export-panel .xp-note').allTextContents() };
}

/** Decode the first frame of a file in the page's own <video> element and return pixels at points. */
async function playInBrowser(page, file, mime, points) {
  const b64 = readFileSync(file).toString('base64');
  return page.evaluate(async ({ b64, mime, points }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type: mime }));
    await new Promise((resolve, reject) => {
      v.onloadeddata = resolve;
      v.onerror = () => reject(new Error(`the browser cannot play ${mime}: ${v.error && v.error.message}`));
    });
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    return { width: v.videoWidth, height: v.videoHeight, px: points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]) };
  }, { b64, mime, points });
}

test('the app is the editor: no code pane or mode switch, and no console errors', { skip: skipReason }, async () => {
  const { page, errors, context } = await openEditor();
  assert.equal(await page.locator('#code-host, .mode-switch, #tab-code, #run-btn, #problems').count(), 0);
  assert.equal(await page.isVisible('#editor-root'), true);
  const shot = await pixels(page.locator('.ve-frame'));
  assert.ok(shot.distinct > 20, 'the canvas draws the starter document');
  assert.deepEqual(errors, []);
  await context.close();
});

test('an old code link opens the editor with a note instead of failing', { skip: skipReason }, async () => {
  const { page, errors, context } = await openEditor('', await encodePermalink('code', 'export default async function () {}'));
  await page.waitForSelector('.toast');
  assert.match(await page.textContent('.toast'), /opens documents only/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Share puts the document in the link, and the link opens it again', { skip: skipReason }, async () => {
  const { page, context } = await openEditor();
  await page.click('.ve-frame', { position: { x: 5, y: 5 } });
  const title = page.getByLabel('Title', { exact: true });
  await title.fill('Shared title 42');
  await title.press('Enter');
  await page.waitForTimeout(300);
  await page.click('#share-btn');
  await page.waitForFunction(() => location.hash.startsWith('#doc'));
  const hash = await page.evaluate(() => location.hash);
  const second = await openEditor('', hash);
  await second.page.click('.ve-frame', { position: { x: 5, y: 5 } });
  assert.equal(await second.page.getByLabel('Title', { exact: true }).inputValue(), 'Shared title 42');
  await second.context.close();
  await context.close();
});

test('a board swaps only the surface, not the theme', { skip: skipReason }, async () => {
  const { page, errors, context } = await openEditor();
  assert.equal(await page.inputValue('#board-select'), 'default');
  const theme = await page.inputValue('#theme-select');
  const corner = () => page.$eval('.ve-frame canvas', (c) => {
    const x = document.createElement('canvas');
    x.width = 1;
    x.height = 1;
    x.getContext('2d').drawImage(c, 3, 3, 1, 1, 0, 0, 1, 1);
    return [...x.getContext('2d').getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
  await page.selectOption('#board-select', 'chalkboard');
  await page.waitForFunction(async () => {
    const c = document.querySelector('.ve-frame canvas');
    const x = document.createElement('canvas');
    x.width = 1;
    x.height = 1;
    x.getContext('2d').drawImage(c, 3, 3, 1, 1, 0, 0, 1, 1);
    const d = x.getContext('2d').getImageData(0, 0, 1, 1).data;
    return d[1] > d[0] + 8 && d[1] > d[2];
  }, null, { timeout: 30000 });
  const after = await corner();
  assert.ok(after[1] > after[0], `the chalkboard surface is green, got ${after}`);
  assert.equal(await page.inputValue('#theme-select'), theme, 'the theme choice is kept');
  assert.deepEqual(errors, []);
  await context.close();
});

test('PNG, WebM, and MP4 exports come from WebCodecs with the right frames and size, and play back', { skip: skipReason || (!hasFFprobe && 'ffprobe is not installed'), timeout: 600000 }, async () => {
  const { page, context } = await openEditor();
  const frames = framesAt(await shorten(page), 30);
  const png = await exportAs(page, 'png');
  const [still] = probe(png.file);
  assert.equal(still.width, 640);
  assert.equal(still.height, 360);

  const webm = await exportAs(page, 'webm');
  const [vw] = probe(webm.file);
  assert.equal(vw.codec_name, 'vp9');
  assert.equal(vw.width, 640);
  assert.equal(vw.height, 360);
  assert.equal(Number(vw.nb_read_frames), frames);
  assert.ok(webm.notes.some((n) => /WebCodecs/.test(n)));
  assert.equal((await playInBrowser(page, webm.file, 'video/webm', [])).width, 640);

  const mp4 = await exportAs(page, 'mp4');
  const [vm] = probe(mp4.file);
  // This Chromium has no H.264 encoder, so the MP4 falls back to AV1 (then VP9) and says so.
  assert.ok(['h264', 'av1', 'vp9'].includes(vm.codec_name), vm.codec_name);
  if (vm.codec_name !== 'h264') assert.ok(mp4.notes.some((n) => /no H\.264 encoder/.test(n)), mp4.notes.join(' | '));
  assert.equal(vm.width, 640);
  assert.equal(vm.height, 360);
  assert.equal(Number(vm.nb_read_frames), frames);
  const ftyp = readFileSync(mp4.file).subarray(4, 8).toString('latin1');
  assert.equal(ftyp, 'ftyp');
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', mp4.file, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(decode.status, 0);
  assert.equal(decode.stderr.trim(), '', 'ffmpeg decodes the MP4 without errors');
  assert.equal((await playInBrowser(page, mp4.file, 'video/mp4', [])).height, 360);
  assert.ok(statSync(mp4.file).size > 1000);
  await context.close();
});

test('a transparent WebM keeps its alpha in ffmpeg and in the browser', { skip: skipReason || (!hasFFprobe && 'ffprobe is not installed'), timeout: 600000 }, async () => {
  const { page, context } = await openEditor();
  const T = await shorten(page);
  const frames = framesAt(T, 30);
  const alpha = await exportAs(page, 'webm-alpha');
  const [va] = probe(alpha.file);
  assert.ok(['vp8', 'vp9'].includes(va.codec_name));
  assert.equal(Number(va.nb_read_frames), frames);
  const tags = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=alpha_mode', '-of', 'csv=p=0', alpha.file], { encoding: 'utf8' });
  assert.equal(tags.stdout.trim(), '1', 'the WebM declares an alpha channel');
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-c:v', va.codec_name === 'vp8' ? 'libvpx' : 'libvpx-vp9', '-ss', String(Math.max(0, T - 0.1)), '-i', alpha.file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 });
  const rgba = decoded.stdout;
  assert.equal(rgba.length, 640 * 360 * 4);
  assert.ok(rgba[3] < 8, 'the corner pixel is transparent');
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 247) opaque++;
  assert.ok(opaque > 500, `drawn content is opaque (${opaque} pixels)`);
  const inBrowser = await playInBrowser(page, alpha.file, 'video/webm', [[2, 2]]);
  assert.ok(inBrowser.px[0][3] < 8, `the browser decodes the corner as transparent, got ${inBrowser.px[0]}`);
  await context.close();
});

test('GIF and APNG exports decode with every frame', { skip: skipReason || (!hasFFprobe && 'ffprobe is not installed'), timeout: 300000 }, async () => {
  const { page, context } = await openEditor();
  const frames = framesAt(await shorten(page), 24);
  const gif = await exportAs(page, 'gif', { size: '640x360', fps: '24' });
  const [g] = probe(gif.file);
  assert.equal(g.codec_name, 'gif');
  assert.equal(Number(g.nb_read_frames), frames);
  const apng = await exportAs(page, 'apng', { size: '640x360', fps: '24' });
  const [a] = probe(apng.file, ['-f', 'apng']);
  assert.equal(a.codec_name, 'apng');
  assert.equal(Number(a.nb_read_frames), frames);
  await context.close();
});

test('the embed element loads, plays, pauses, and seeks', { skip: skipReason }, async () => {
  const { page, context, errors } = await openPage(env.browser);
  await page.goto(`${env.url}examples/embed.html`);
  await page.waitForFunction(() => {
    const el = document.getElementById('first');
    return el && el.duration > 0 && !el.paused && el.currentTime > 0.3;
  }, null, { timeout: 30000 });
  const state = await page.evaluate(async () => {
    const el = document.getElementById('first');
    const events = [];
    for (const t of ['pause', 'timeupdate']) el.addEventListener(t, () => events.push(t));
    el.pause();
    el.seek(1.25);
    return { paused: el.paused, t: el.currentTime, d: el.duration, events };
  });
  assert.equal(state.paused, true);
  assert.equal(state.t, 1.25);
  assert.equal(state.d, 7.5);
  assert.deepEqual(state.events, ['pause', 'timeupdate']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('without OffscreenCanvas transfer, the sandboxed iframe runtime renders the editor canvas', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor('?runtime=iframe');
  const sandbox = await page.getAttribute('iframe[sandbox]', 'sandbox');
  assert.equal(sandbox, 'allow-scripts');
  await page.waitForTimeout(800);
  const shot = await pixels(page.locator('.ve-frame'));
  assert.ok(shot.distinct > 20, 'frames arrive as ImageBitmaps');
  assert.deepEqual(errors, [], errors.join(' | '));
  await context.close();
});
