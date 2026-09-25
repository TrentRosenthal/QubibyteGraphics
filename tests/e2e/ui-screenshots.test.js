/**
 * UI screenshots for the visual quality log, written to docs/renders/ui-*.png.
 * Runs with QGFX_SHOTS=1 (and Chromium present), for example:
 *   QGFX_E2E=1 QGFX_SHOTS=1 node --test tests/e2e/ui-screenshots.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { skipReason, setup, openPage } from './helpers.js';

const OUT = new URL('../../docs/renders/', import.meta.url);
const skip = skipReason || (process.env.QGFX_SHOTS !== '1' && 'screenshots are written with QGFX_SHOTS=1');
const SIZES = [[1920, 1080], [1280, 800]];

let env;

before(async () => {
  if (skip) return;
  env = await setup();
  mkdirSync(OUT, { recursive: true });
});

after(async () => {
  if (env) await env.close();
});

async function page(w, h, scheme = 'dark') {
  const o = await openPage(env.browser, { width: w, height: h, colorScheme: scheme });
  await o.page.addInitScript(() => localStorage.clear());
  await o.page.goto(`${env.url}index.html?mode=code`);
  await o.page.waitForFunction(() => /Frame \d+ of [1-9]/.test(document.querySelector('.frame-readout')?.textContent || ''), null, { timeout: 30000 });
  await o.page.waitForFunction(() => !document.querySelector('.gallery-thumb.is-loading'), null, { timeout: 60000 }).catch(() => {});
  return o;
}

async function shot(p, name, w, h) {
  const path = new URL(`ui-${name}-${w}x${h}.png`, OUT);
  await p.screenshot({ path: path.pathname });
}

async function pauseAt(p, t) {
  await p.evaluate(() => document.querySelector('[data-act=play][aria-label=Pause]')?.click());
  await p.evaluate((time) => {
    const scrub = document.querySelector('.scrubber');
    const r = scrub.getBoundingClientRect();
    const total = Number(scrub.getAttribute('aria-valuemax'));
    const x = r.left + (time / total) * r.width;
    scrub.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: r.top + 4, bubbles: true, pointerId: 1 }));
    scrub.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: r.top + 4, bubbles: true, pointerId: 1 }));
  }, t);
  await p.waitForTimeout(500);
}

for (const [w, h] of SIZES) {
  for (const scheme of ['dark', 'light']) {
    test(`code mode, ${scheme} interface, ${w}x${h}`, { skip }, async () => {
      const { page: p, context, errors } = await page(w, h, scheme);
      await pauseAt(p, 7.2);
      await shot(p, `code-${scheme}`, w, h);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  test(`editor with Qubi to Bloch to matrix wiring, ${w}x${h}`, { skip }, async () => {
    const { page: p, context, errors } = await page(w, h);
    await p.click('#tab-editor');
    await p.waitForFunction(() => document.querySelectorAll('.tl-row').length >= 4);
    await p.waitForTimeout(900);
    await p.click('.tl-row[data-id=bloch] .tl-label');
    await p.keyboard.press('w');
    await p.waitForTimeout(700);
    await shot(p, 'editor-wires', w, h);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`export panel, ${w}x${h}`, { skip }, async () => {
    const { page: p, context } = await page(w, h);
    await pauseAt(p, 7.2);
    await p.click('#export-btn');
    await p.check('input[name=xp-format][value=mp4]');
    await p.waitForTimeout(300);
    await shot(p, 'export', w, h);
    await context.close();
  });

  test(`theme panel with a palette from "pastel green", ${w}x${h}`, { skip }, async () => {
    const { page: p, context } = await page(w, h);
    await p.click('#tab-editor');
    await p.waitForFunction(() => document.querySelectorAll('.tl-row').length >= 4);
    await p.click('.ve-side [data-tab=theme]');
    await p.fill('.tp [data-words]', 'pastel green');
    await p.click('.tp [data-gen] button');
    await p.waitForTimeout(1500);
    await shot(p, 'theme', w, h);
    await context.close();
  });

  test(`embed demo, ${w}x${h}`, { skip }, async () => {
    const o = await openPage(env.browser, { width: w, height: h });
    await o.page.goto(`${env.url}examples/embed.html`);
    await o.page.waitForFunction(() => document.getElementById('first')?.currentTime > 6.8, null, { timeout: 30000 });
    await o.page.evaluate(() => document.getElementById('first').pause());
    await o.page.waitForTimeout(300);
    await shot(o.page, 'embed', w, h);
    await o.context.close();
  });
}
