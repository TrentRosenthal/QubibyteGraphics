import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../src/index.js';
import { buildDocument, newDocument, normalizeDocument, evaluateGraph, stringifyDocument, documentToModule, moduleToDocument, ANIMATIONS } from '../../src/editor/document.js';
import { BLOCKS, blockLibrary, withVariables } from '../../src/editor/blocks.js';

await Q.preload();

function bellDoc() {
  const doc = newDocument({ duration: 3 });
  doc.blocks.push({ id: 'prog', type: 'qubi', props: { source: 'RY 0 a\nCX [0,1]' } });
  doc.blocks.push({ id: 's', type: 'slider', props: { label: 'a', value: 0.5 } });
  doc.blocks.push({ id: 'bars', type: 'amplitudes', props: { x: 3 }, enter: { anim: 'fadeIn', at: 1, duration: 0.5 }, keyframes: [{ t: 2.5, props: { x: 2 }, duration: 1 }] });
  doc.wires.push({ from: 's.value', to: 'prog.var:a' }, { from: 'prog.state', to: 'bars.state' });
  return doc;
}

test('slider values flow through the Qubi program into views', () => {
  const doc = normalizeDocument(bellDoc());
  const out = evaluateGraph(doc);
  const p = out.get('prog').probabilities;
  // RY(0.5 piradians) gives P(0) = cos^2(pi/4) = 0.5, then CX copies it.
  assert.ok(Math.abs(p[0] - 0.5) < 1e-9 && Math.abs(p[3] - 0.5) < 1e-9);
  const out2 = evaluateGraph(doc, { s: { value: 0 } });
  assert.ok(Math.abs(out2.get('prog').probabilities[0] - 1) < 1e-9);
});

test('documents build scenes with entrances and keyframes', async () => {
  const scene = await buildDocument(bellDoc());
  assert.equal(scene.duration, 3);
  const bars = scene.root.children.find((n) => n.meta.blockId === 'bars');
  assert.equal(scene.evaluateAt(0.5, () => bars.visible), false);
  assert.equal(scene.evaluateAt(1.2, () => bars.visible), true);
  const x0 = scene.evaluateAt(1.4, () => bars.center()[0]);
  const x1 = scene.evaluateAt(2.9, () => bars.center()[0]);
  assert.ok(Math.abs(x0 - 3) < 1e-6 && Math.abs(x1 - 2) < 1e-6);
});

test('the JS view round-trips with stable formatting and drops default props', () => {
  const doc = bellDoc();
  const js = documentToModule(doc);
  assert.equal(stringifyDocument(moduleToDocument(js)), stringifyDocument(doc));
  assert.ok(!js.includes('"shots"'), 'default props are omitted');
  assert.throws(() => moduleToDocument('export default { nope'), /not valid JSON/);
});

test('wire validation and loops are reported', () => {
  const doc = bellDoc();
  doc.wires.push({ from: 'ghost.value', to: 'prog.var:b' });
  assert.throws(() => normalizeDocument(doc), /unknown source block "ghost"/);
  const loop = newDocument();
  loop.blocks.push({ id: 'a', type: 'expression', props: { expr: 'a+1', vars: 'a' } }, { id: 'b', type: 'expression', props: { expr: 'a*2', vars: 'a' } });
  loop.wires.push({ from: 'a.value', to: 'b.a' }, { from: 'b.value', to: 'a.a' });
  assert.throws(() => evaluateGraph(normalizeDocument(loop)), /loop/);
});

test('every registered block has a category, defaults, and a library entry', () => {
  const lib = blockLibrary();
  for (const d of Object.values(BLOCKS)) {
    assert.ok(d.category && d.label && d.defaults, d.type);
    assert.ok(lib[d.category].includes(d));
  }
  assert.ok(Object.keys(ANIMATIONS).includes('write'));
  assert.equal(withVariables('#settings MaxQubits 2\nH 0', { t: 0.25 }), '#settings MaxQubits 2\nt=0.25\nH 0');
});
