import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
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

const SLIDER_SCENE = `import { Circle, ValueTracker } from 'qubibyte-graphics';

export const config = { fps: 30 };

export default async function (scene) {
  const r = new ValueTracker(0.4);
  scene.control({ kind: 'slider', label: 'radius', min: 0.2, max: 3, step: 0.01, tracker: r });
  const c = scene.add(new Circle({ radius: 1, fill: '#5b8def', stroke: null }));
  scene.always(() => c.set('scale', r.value));
  scene.label('middle');
  scene.tone({ from: 440, to: 660, duration: 0.4 });
  await scene.wait(1);
  scene.click();
  await scene.wait(1);
}
`;

async function readyPage(hash = '') {
  const o = await openPage(env.browser);
  await o.page.goto(`${env.url}index.html${hash}`);
  await o.page.waitForFunction(() => /Frame \d+ of [1-9]/.test(document.querySelector('.frame-readout')?.textContent || ''), null, { timeout: 30000 });
  return o;
}

test('the playground loads without console errors and plays the default example', { skip: skipReason }, async () => {
  const { page, errors, context } = await readyPage();
  const code = await page.inputValue('#code-host .ce-ta');
  assert.match(code, /export default async function build\(scene\)/);
  const f0 = await page.textContent('.fcur');
  await page.waitForTimeout(700);
  const f1 = await page.textContent('.fcur');
  assert.notEqual(f0, f1, 'frames advance while playing');
  assert.equal(await page.textContent('.ftotal'), '450');
  const shot = await pixels(page.locator('#code-frame'));
  assert.ok(shot.distinct > 20, 'the preview draws the scene');
  assert.ok(await page.locator('.gallery-item').count() >= 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Qubi diagnostics underline CX (0,1) and list the error', { skip: skipReason }, async () => {
  const { page, context } = await readyPage();
  await page.click('#src-qubi');
  await page.fill('#code-host .ce-ta', 'CX (0,1)');
  await page.waitForSelector('#problems .problem:not(.is-warning)');
  const msg = await page.textContent('#problems .problem');
  assert.match(msg, /1:\d/);
  assert.match(msg, /bracket|register|\[/i);
  assert.ok(await page.locator('#code-host .ce-diag.ce-error').count() >= 1, 'the error is underlined');
  assert.equal(await page.getAttribute('#code-host .ce-ln:first-child', 'class'), 'ce-ln has-error is-active');
  await context.close();
});

test('the Qubi tab renders Grover(0b110)', { skip: skipReason }, async () => {
  const { page, context, errors } = await readyPage();
  await page.click('#src-qubi');
  await page.fill('#code-host .ce-ta', 'Grover(0b110)');
  await page.waitForFunction(() => document.querySelector('#problems-count').textContent === '0' && Number(document.querySelector('.ftotal').textContent) > 600, null, { timeout: 30000 });
  await page.click('[data-act=end]');
  await page.waitForTimeout(400);
  const shot = await pixels(page.locator('#code-frame'));
  assert.ok(shot.distinct > 30, 'the explainer draws');
  await page.click('#qubi-view [data-view=circuit]');
  await page.waitForFunction(() => Number(document.querySelector('.ftotal').textContent) < 600, null, { timeout: 30000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('a slider from scene.control overrides the value and re-renders', { skip: skipReason }, async () => {
  const { page, context } = await readyPage(await encodePermalink('code', SLIDER_SCENE));
  await page.waitForSelector('#code-controls input[type=range]');
  await page.click('[data-act=start]');
  await page.waitForTimeout(300);
  const blue = [0x5b, 0x8d, 0xef];
  const before = (await pixels(page.locator('#code-frame'))).match(blue);
  await page.locator('#code-controls input[type=range]').fill('2.5');
  await page.waitForTimeout(600);
  const afterCount = (await pixels(page.locator('#code-frame'))).match(blue);
  assert.ok(afterCount > before * 10, `the circle grows: ${before} -> ${afterCount} pixels`);
  assert.match(await page.textContent('#code-controls .value'), /^2\.50?$/);
  await context.close();
});

test('permalinks round-trip the code through the URL fragment', { skip: skipReason }, async () => {
  const { page, context } = await readyPage();
  const marker = `// permalink ${Date.now()}`;
  const text = `${marker}\n${await page.inputValue('#code-host .ce-ta')}`;
  await page.fill('#code-host .ce-ta', text);
  await page.click('#share-btn');
  await page.waitForFunction(() => location.hash.startsWith('#code='));
  const url = await page.evaluate(() => location.href);
  const second = await openPage(env.browser);
  await second.page.goto(url);
  await second.page.waitForFunction((m) => document.querySelector('#code-host .ce-ta')?.value.startsWith(m), marker, { timeout: 20000 });
  assert.equal(await second.page.inputValue('#code-host .ce-ta'), text);
  await second.context.close();
  await context.close();
});

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

test('PNG, MP4, and WebM exports are accepted by ffprobe with the right frames and size', { skip: skipReason || (!hasFFprobe && 'ffprobe is not installed'), timeout: 600000 }, async () => {
  const { page, context } = await readyPage(await encodePermalink('code', SLIDER_SCENE));
  await page.click('[data-act=start]');
  const png = await exportAs(page, 'png');
  assert.match(png.file, /\.png$/);
  const [still] = probe(png.file);
  assert.equal(still.width, 640);
  assert.equal(still.height, 360);

  const webm = await exportAs(page, 'webm');
  const [vw, aw] = probe(webm.file);
  assert.equal(aw && aw.codec_name, 'opus', 'the tone and click are muxed as Opus');
  assert.equal(vw.codec_name, 'vp9');
  assert.equal(vw.width, 640);
  assert.equal(vw.height, 360);
  assert.equal(Number(vw.nb_read_frames), 60);

  const mp4 = await exportAs(page, 'mp4');
  const [vm, am] = probe(mp4.file);
  assert.equal(am && am.codec_name, 'aac', 'the MP4 carries AAC audio');
  assert.equal(vm.codec_name, 'h264');
  assert.equal(vm.width, 640);
  assert.equal(vm.height, 360);
  assert.equal(Number(vm.nb_read_frames), 60);
  assert.ok(statSync(mp4.file).size > 1000);

  const alpha = await exportAs(page, 'webm-alpha');
  const [va] = probe(alpha.file);
  assert.ok(['vp8', 'vp9'].includes(va.codec_name));
  assert.equal(Number(va.nb_read_frames), 60);
  const tags = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=alpha_mode', '-of', 'csv=p=0', alpha.file], { encoding: 'utf8' });
  assert.equal(tags.stdout.trim(), '1', 'the WebM carries an alpha channel');
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-c:v', va.codec_name === 'vp8' ? 'libvpx' : 'libvpx-vp9', '-i', alpha.file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 });
  assert.equal(decoded.stdout[3], 0, 'the corner pixel is transparent');
  await context.close();
});

test('GIF and APNG exports decode with every frame', { skip: skipReason || (!hasFFprobe && 'ffprobe is not installed'), timeout: 300000 }, async () => {
  const { page, context } = await readyPage(await encodePermalink('code', SLIDER_SCENE));
  const gif = await exportAs(page, 'gif', { size: '640x360', fps: '24' });
  const [g] = probe(gif.file);
  assert.equal(g.codec_name, 'gif');
  assert.equal(Number(g.nb_read_frames), 48);
  const apng = await exportAs(page, 'apng', { size: '640x360', fps: '24' });
  const [a] = probe(apng.file, ['-f', 'apng']);
  assert.equal(a.codec_name, 'apng');
  assert.equal(Number(a.nb_read_frames), 48);
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

test('without OffscreenCanvas transfer, the sandboxed iframe runtime renders the scene', { skip: skipReason }, async () => {
  const { page, context, errors } = await openPage(env.browser);
  await page.goto(`${env.url}index.html?runtime=iframe`);
  await page.waitForFunction(() => /Frame \d+ of [1-9]/.test(document.querySelector('.frame-readout')?.textContent || ''), null, { timeout: 30000 });
  const sandbox = await page.getAttribute('iframe[sandbox]', 'sandbox');
  assert.equal(sandbox, 'allow-scripts');
  await page.waitForTimeout(800);
  const shot = await pixels(page.locator('#code-frame'));
  assert.ok(shot.distinct > 20, 'frames arrive as ImageBitmaps');
  assert.deepEqual(errors, []);
  await context.close();
});

test('clicking an object in the preview shows it in the inspector', { skip: skipReason }, async () => {
  const { page, context } = await readyPage();
  await page.click('[data-act=end]');
  await page.waitForTimeout(400);
  const frame = await page.locator('#code-frame').boundingBox();
  // The formula sits on the left, a third of the way down.
  await page.mouse.click(frame.x + frame.width * 0.13, frame.y + frame.height * 0.36);
  await page.waitForSelector('#inspector-panel .inspector-type');
  const type = await page.textContent('#inspector-panel .inspector-type');
  assert.ok(type.length > 0);
  assert.ok(await page.locator('#inspector-panel .props dt').count() > 5);
  assert.equal(await page.isVisible('#pick-outline'), true);
  await context.close();
});

test('the preview scrubber drags cleanly: time follows, no text is selected, and the drag ends on release', { skip: skipReason }, async () => {
  const { page, errors, context } = await readyPage();
  const bar = await page.locator('.scrubber').boundingBox();
  const frameNo = async () => Number((await page.textContent('.fcur')).trim());
  const y = bar.y + bar.height / 2;
  await page.mouse.move(bar.x + bar.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.5, y - 250, { steps: 6 });
  await page.mouse.move(bar.x + bar.width * 0.5, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const at = await frameNo();
  const total = Number((await page.textContent('.frame-readout')).match(/of (\d+)/)[1]);
  assert.ok(Math.abs(at - total / 2) <= 2, `frame ${at} of ${total}`);
  assert.equal(await page.evaluate(() => String(window.getSelection())), '');
  await page.mouse.move(bar.x + bar.width * 0.9, y, { steps: 5 });
  await page.waitForTimeout(200);
  assert.equal(await frameNo(), at, 'hovering after release does not seek');
  assert.deepEqual(errors, []);
  await context.close();
});
