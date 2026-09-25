import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, setup, openPage, pixels } from './helpers.js';

let env;

before(async () => {
  if (skipReason) return;
  env = await setup();
});

after(async () => {
  if (env) await env.close();
});

async function openEditor() {
  const o = await openPage(env.browser, { width: 1600, height: 1000 });
  await o.page.addInitScript(() => localStorage.clear());
  await o.page.goto(`${env.url}index.html`);
  await o.page.waitForSelector('#code-host .ce-ta');
  await o.page.click('#tab-editor');
  await o.page.waitForSelector('.ve-frame canvas');
  await o.page.waitForFunction(() => document.querySelectorAll('.tl-row').length >= 4);
  await o.page.waitForTimeout(800);
  return o;
}

function codeText(page) {
  return page.inputValue('.ve-code .ce-ta');
}

test('dragging a block from the library onto the canvas creates it and the code view follows', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor();
  await page.click('.ve-toolbar [data-act=code]');
  await page.waitForSelector('.ve-code .ce-ta');
  assert.ok(!(await codeText(page)).includes('"circle1"'));
  const frame = await page.locator('.ve-frame').boundingBox();
  await page.dragAndDrop('.lib-tile[data-type=circle]', '.ve-frame', { targetPosition: { x: frame.width * 0.2, y: frame.height * 0.8 } });
  await page.waitForSelector('.tl-row[data-id=circle1]');
  await page.waitForFunction(() => document.querySelector('.ve-code .ce-ta').value.includes('"id": "circle1"'));
  const code = await codeText(page);
  const block = JSON.parse(code.slice(code.indexOf('{'), code.lastIndexOf('}') + 1)).blocks.find((b) => b.id === 'circle1');
  assert.equal(block.type, 'circle');
  // The drop point maps to world coordinates: left of center and below it.
  assert.ok(block.props.x < -3 && block.props.y < -1.5, JSON.stringify(block.props));
  await page.waitForSelector('.ve-sel');
  // Undo removes it again.
  await page.locator('.ve-frame').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !document.querySelector('.tl-row[data-id=circle1]'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('editing the code view updates the canvas', { skip: skipReason }, async () => {
  const { page, context } = await openEditor();
  await page.click('.ve-toolbar [data-act=code]');
  await page.waitForSelector('.ve-code .ce-ta');
  const before = await pixels(page.locator('.ve-frame'));
  const orange = [0xe0, 0x8a, 0x2e];
  assert.equal(before.match(orange, 20), 0);
  const code = await codeText(page);
  const doc = JSON.parse(code.slice(code.indexOf('{'), code.lastIndexOf('}') + 1));
  doc.blocks.push({ id: 'disc', type: 'circle', props: { x: -5.5, y: -2.8, radius: 0.7, fill: '#e08a2e', stroke: null } });
  await page.fill('.ve-code .ce-ta', `export default ${JSON.stringify(doc, null, 2)};\n`);
  await page.waitForSelector('.tl-row[data-id=disc]', { timeout: 10000 });
  await page.waitForTimeout(800);
  const after = await pixels(page.locator('.ve-frame'));
  assert.ok(after.match(orange, 20) > 500, 'the new circle is drawn');
  await context.close();
});

test('selecting, moving, and the wire layer work on the starter document', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor();
  await page.click('.tl-row[data-id=bloch] .tl-label');
  await page.waitForSelector('.ve-sel');
  const box = await page.locator('.ve-sel').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height * 0.8 + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const x = Number(await page.inputValue('.bi [data-key=x] input'));
  assert.ok(x > 0.5, `moved right: x = ${x}`);
  await page.keyboard.press('w');
  await page.waitForSelector('.ve-wires .ve-wire');
  assert.equal(await page.locator('.ve-wires .ve-wire').count(), 2);
  assert.ok(await page.locator('.ve-port[data-port="prog.state"]').count());
  // The Bloch handle is exposed on the canvas.
  assert.equal(await page.locator('.ve-knob').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});
