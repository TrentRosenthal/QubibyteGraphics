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
  // Wiring: drag from an output port to an input port.
  const center = (sel) => page.evaluate((q) => {
    const r = document.querySelector(q).getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, sel);
  await page.waitForTimeout(400);
  const from = await center('.ve-port[data-port="prog.probabilities"]');
  const to = await center('.ve-port[data-port="title.content"]');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.ve-wires .ve-wire').length === 3);
  // The Bloch handle writes RY and RZ angles back into the wired Qubi program.
  assert.equal(await page.locator('.ve-knob').count(), 1);
  await page.waitForTimeout(400);
  const knob = await center('.ve-knob');
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(knob.x - 40, knob.y + 50, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.click('.ve-toolbar [data-act=code]');
  await page.waitForSelector('.ve-code .ce-ta');
  const code = await page.inputValue('.ve-code .ce-ta');
  const doc = JSON.parse(code.slice(code.indexOf('{'), code.lastIndexOf('}') + 1));
  const src = doc.blocks.find((b) => b.id === 'prog').props.source;
  assert.match(src, /^RY\([\d.]+\) 0\nRZ\(-?[\d.]+\) 0$/);
  assert.notEqual(src, 'RY(0.3) 0\nRZ(0.6) 0');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a document slider drags through live overrides and commits on release', { skip: skipReason }, async () => {
  const { page, context } = await openEditor();
  await page.click('.ve-toolbar [data-act=code]');
  await page.waitForSelector('.ve-code .ce-ta');
  const code = await codeText(page);
  const doc = JSON.parse(code.slice(code.indexOf('{'), code.lastIndexOf('}') + 1));
  doc.blocks.find((b) => b.id === 'prog').props.source = 'RY 0 theta';
  doc.blocks.push({ id: 's', type: 'slider', props: { label: 'theta', min: 0, max: 1, step: 0.01, value: 0.1 } });
  doc.wires.push({ from: 's.value', to: 'prog.var:theta' });
  await page.fill('.ve-code .ce-ta', `export default ${JSON.stringify(doc, null, 2)};\n`);
  await page.waitForSelector('.ve-controls input[type=range]', { timeout: 10000 });
  await page.waitForTimeout(600);
  const before = await pixels(page.locator('.ve-frame'));
  await page.locator('.ve-controls input[type=range]').fill('0.9');
  await page.waitForTimeout(900);
  const after = await pixels(page.locator('.ve-frame'));
  let diff = 0;
  for (let i = 0; i < before.data.length; i += 4) if (Math.abs(before.data[i] - after.data[i]) > 40) diff++;
  assert.ok(diff > 200, `the render changed in ${diff} pixels`);
  await page.waitForFunction(() => /"value": 0.9/.test(document.querySelector('.ve-code .ce-ta').value));
  await context.close();
});

async function clearScene(page) {
  await page.click('.ve-frame', { position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 0);
}

const QUANTUM_TYPES = ['amplitudes', 'probabilities', 'phaseDisks', 'dirac', 'density', 'matrix', 'bloch', 'sweepPlot'];

test('a quantum block dropped with no program adds none, shows a placeholder, and deletes cleanly', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor();
  await clearScene(page);
  const frame = await page.locator('.ve-frame').boundingBox();
  for (const type of QUANTUM_TYPES) {
    const tile = page.locator(`.lib-tile[data-type=${type}]`);
    await tile.scrollIntoViewIfNeeded();
    await tile.dragTo(page.locator('.ve-frame'), { targetPosition: { x: frame.width * 0.5, y: frame.height * 0.5 } });
    await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 1);
    await page.waitForTimeout(400);
    const ids = await page.$$eval('.tl-row', (rs) => rs.map((r) => r.dataset.id));
    assert.ok(ids[0].startsWith(type), `${type}: only the dropped block is in the timeline, got ${ids}`);
    if (type === 'bloch') {
      // An unwired Bloch sphere still draws |0>, so it needs no placeholder; select it from its row.
      assert.equal(await page.locator('.ve-placeholder').count(), 0);
      await page.click(`.tl-label[data-select=${ids[0]}]`);
    } else {
      const box = await page.locator('.ve-placeholder').boundingBox({ timeout: 3000 });
      assert.ok(box, `${type} shows a placeholder where it was dropped`);
      // Select it by clicking its placeholder, then delete: the timeline row goes with it.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector('.ve-placeholder.is-selected');
    }
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 0 && !document.querySelector('.ve-placeholder'));
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('with one program every quantum block wires to it, with two it wires to neither', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor();
  await clearScene(page);
  const frame = await page.locator('.ve-frame').boundingBox();
  const drop = async (type, x, y) => {
    const tile = page.locator(`.lib-tile[data-type=${type}]`);
    await tile.scrollIntoViewIfNeeded();
    const n = await page.locator('.tl-row').count();
    await tile.dragTo(page.locator('.ve-frame'), { targetPosition: { x: frame.width * x, y: frame.height * y } });
    await page.waitForFunction((k) => document.querySelectorAll('.tl-row').length === k, n + 1);
    await page.waitForTimeout(400);
  };
  await drop('qubi', 0.3, 0.3);
  for (const type of QUANTUM_TYPES) {
    await drop(type, 0.7, 0.7);
    if (type === 'sweepPlot') {
      // Wired, but the starter program sweeps nothing, so it says what to add rather than asking for a wire.
      assert.match(await page.locator('.ve-placeholder').innerText(), /does not sweep/);
    } else {
      assert.equal(await page.locator('.ve-placeholder').count(), 0, `${type} wired to the one program and draws`);
    }
    assert.equal(await page.locator('.tl-row[data-id^=qubi]').count(), 1, 'no program was added');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 1);
  }
  await drop('qubi', 0.3, 0.7);
  await drop('amplitudes', 0.7, 0.3);
  assert.equal(await page.locator('.ve-placeholder').count(), 1, 'two programs: the block is left unwired');
  assert.equal(await page.locator('.tl-row[data-id^=qubi]').count(), 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a quantum block dropped next to an existing program wires to that program instead of adding one', { skip: skipReason }, async () => {
  const { page, context } = await openEditor();
  const programs = () => page.locator('.tl-row[data-id^=qubi], .tl-row[data-id^=prog]').count();
  const before = await programs();
  const frame = await page.locator('.ve-frame').boundingBox();
  await page.locator('.lib-tile[data-type=amplitudes]').dragTo(page.locator('.ve-frame'), { targetPosition: { x: frame.width * 0.75, y: frame.height * 0.8 } });
  await page.waitForSelector('.tl-row[data-id=amplitudes1]');
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.bi-error').count(), 0);
  assert.equal(await programs(), before, 'no new program was added');
  await context.close();
});

test('in wire mode a block with nothing drawn sits where it was dropped and can be dragged', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor();
  await page.keyboard.press('w');
  await page.waitForSelector('.ve-frame.is-wiring');
  await page.locator('.lib-tile[data-type=slider]').scrollIntoViewIfNeeded();
  let frame = await page.locator('.ve-frame').boundingBox();
  const drop = { x: frame.width * 0.7, y: frame.height * 0.3 };
  await page.locator('.lib-tile[data-type=slider]').dragTo(page.locator('.ve-frame'), { targetPosition: drop });
  await page.waitForSelector('.tl-row[data-id=slider1]');
  await page.waitForTimeout(500);
  frame = await page.locator('.ve-frame').boundingBox();
  const cardOf = async () => {
    const boxes = await page.$$eval('.ve-card.is-data', (gs) => gs.map((g) => {
      const t = g.querySelector('.ve-card-title').textContent;
      const r = g.querySelector('.ve-card-box').getBoundingClientRect();
      return { t, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }));
    return boxes.find((b) => b.t.includes('slider1'));
  };
  const c0 = await cardOf();
  assert.ok(c0, 'the slider has a card');
  assert.ok(Math.abs(c0.cx - (frame.x + drop.x)) < 12 && Math.abs(c0.cy - (frame.y + drop.y)) < 12, `card at ${c0.cx},${c0.cy}, dropped at ${frame.x + drop.x},${frame.y + drop.y}`);
  await page.mouse.move(c0.cx, c0.cy);
  await page.mouse.down();
  await page.mouse.move(c0.cx - 200, c0.cy + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const c1 = await cardOf();
  assert.ok(Math.abs(c1.cx - (c0.cx - 200)) < 12 && Math.abs(c1.cy - (c0.cy + 120)) < 12, `card moved to ${c1.cx},${c1.cy}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the timeline playhead drags from the line, the knob, the ruler, or an empty track without selecting text', { skip: skipReason }, async () => {
  const { page, context, errors } = await openEditor();
  const ruler = await page.locator('.tl-ruler').boundingBox();
  const readout = () => page.locator('.tl-head .cur').innerText();
  const selected = () => page.evaluate(() => String(window.getSelection()));
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    // Wander off the timeline and back, as a real drag does.
    await page.mouse.move(x1, y1 - 300, { steps: 6 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  // 1. Grab the playhead line in the middle of the tracks (it sits at 0 s).
  const head = await page.locator('.tl-playhead').boundingBox();
  await drag(head.x + head.width / 2, head.y + head.height * 0.6, ruler.x + ruler.width * 0.5, head.y + head.height * 0.6);
  assert.equal(await readout(), '0:03.00', 'dragging the line moves time to the middle');
  assert.equal(await selected(), '', 'no text was selected');
  // 2. Grab the knob.
  const knob = await page.locator('.tl-playhead-knob').boundingBox();
  await drag(knob.x + knob.width / 2, knob.y + knob.height / 2, ruler.x + ruler.width * 0.25, knob.y + knob.height / 2);
  assert.equal(await readout(), '0:01.50');
  // 3. Start on an empty stretch of a track (the title row after its write bar ends).
  const row = await page.locator('.tl-row[data-id=title] .tl-track').boundingBox();
  await drag(row.x + row.width * 0.9, row.y + row.height / 2, ruler.x + ruler.width * 0.75, row.y + row.height / 2);
  assert.equal(await readout(), '0:04.50');
  assert.equal(await selected(), '');
  // 4. After release, moving the mouse over the timeline no longer seeks.
  await page.mouse.move(ruler.x + ruler.width * 0.1, row.y + row.height / 2, { steps: 5 });
  assert.equal(await readout(), '0:04.50');
  assert.deepEqual(errors, []);
  await context.close();
});
