import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenizeJS, tokenizeQubi } from '../../src/playground/editor/tokenize.js';
import { createCompletions } from '../../src/playground/editor/completions.js';
import { encodePermalink, decodePermalink } from '../../src/playground/permalink.js';
import { rewriteImports } from '../../src/playground/runtime-core.js';
import { qubiVariables, blockDefinition } from '../../src/editor/blocks.js';
import { snapBox } from '../../src/editor/ui/snapping.js';
import { History } from '../../src/editor/ui/history.js';
import { buildIndexes } from '../../tools/build-api-index.js';
import * as Q from '../../src/index.js';

const index = JSON.parse(readFileSync(new URL('../../src/playground/api-index.json', import.meta.url), 'utf8'));

const kinds = (line) => line.map((s) => `${s.kind}:${s.text}`);

test('JavaScript tokenizer: keywords, strings, comments, regex, numbers, and multi-line state', () => {
  const src = "import { Circle } from '../src/index.js';\nconst r = /a+b/g; // tail\n/* one\ntwo */ const t = `x\ny` + 0x1f + 1.5e3;";
  const lines = tokenizeJS(src, { known: new Set(['Circle']) });
  assert.equal(lines.length, 5);
  assert.deepEqual(kinds(lines[0]).slice(0, 4), ['keyword:import', 'plain: ', 'punct:{', 'plain: ']);
  assert.ok(kinds(lines[0]).includes('api:Circle'));
  assert.ok(kinds(lines[0]).includes("string:'../src/index.js'"));
  assert.ok(kinds(lines[1]).includes('string:/a+b/g'), 'regex literal after =');
  assert.ok(kinds(lines[1]).includes('comment:// tail'));
  assert.deepEqual(kinds(lines[2]), ['comment:/* one']);
  assert.equal(lines[3][0].kind, 'comment');
  assert.ok(kinds(lines[3]).includes('string:`x'));
  assert.ok(kinds(lines[4]).includes('number:0x1f') && kinds(lines[4]).includes('number:1.5e3'));
  // Division is not a regex.
  assert.ok(!tokenizeJS('a / b / c').flat().some((s) => s.kind === 'string'));
  // Every character is kept, in order.
  assert.equal(lines.map((l) => l.map((s) => s.text).join('')).join('\n'), src);
});

test('Qubi tokenizer marks gates, stdlib calls, settings, numbers, and comments', () => {
  const [a, b, c] = tokenizeQubi('#settings MaxQubits 3\nH 0 // note\nGrover(0b110)');
  assert.deepEqual(kinds(a).filter((k) => !k.startsWith('plain')), ['setting:#settings', 'number:3']);
  assert.ok(kinds(b).includes('gate:H') && kinds(b).includes('comment:// note'));
  assert.ok(kinds(c).includes('fn:Grover') && kinds(c).includes('number:0b110'));
});

test('the committed API index matches the sources and carries JSDoc summaries', () => {
  const { api } = buildIndexes();
  const names = new Set(index.exports.map((e) => e.name));
  assert.deepEqual([...names].sort(), api.exports.map((e) => e.name).sort(), 'the index lists exactly the current exports; run npm run build:api');
  for (const n of Object.keys(Q)) assert.ok(names.has(n), `index lists ${n}`);
  const circle = index.exports.find((e) => e.name === 'buildScene');
  assert.match(circle.summary, /^Build a scene/);
  assert.equal(circle.kind, 'function');
  assert.ok(index.scene.some((m) => m.name === 'play'));
  assert.ok(index.qubi.stdlib.some((s) => s.name === 'Grover' && s.signatures[0].includes('marked')));
});

test('JavaScript completions offer engine exports and Scene methods', () => {
  const c = createCompletions(index);
  const r = c.js('const c = new Cir');
  assert.equal(r.from, 'const c = new '.length);
  assert.equal(r.items[0].label, 'Circle');
  assert.ok(r.items[0].doc.length > 0);
  const s = c.js('  await scene.pl');
  assert.ok(s.items.some((i) => i.label === 'play' && i.kind === 'method'));
  assert.equal(c.js('foo.ba').items.length, 0, 'no guesses after other objects');
});

test('Qubi completions: gates with arity, settings keys and values, stdlib signatures', () => {
  const c = createCompletions(index);
  const cx = c.qubi('C').items.find((i) => i.label === 'CX');
  assert.match(cx.detail, /\[control, target\]/);
  assert.ok(!c.qubi('C').items.some((i) => /^CNOT$/.test(i.label)));
  const keys = c.qubi('#settings Sch');
  assert.deepEqual(keys.items.map((i) => i.label), ['Scheduling']);
  const vals = c.qubi('#settings Scheduling ');
  assert.ok(vals.items.some((i) => i.label === 'same_gate_continuous'));
  const g = c.qubi('Gro').items[0];
  assert.equal(g.label, 'Grover');
  assert.match(g.detail, /Grover\(marked/);
});

test('permalinks round-trip every kind, including Unicode and large sources', async () => {
  const code = `// θ and π\n${'await scene.play(create(c));\n'.repeat(400)}`;
  for (const [kind, text] of [['code', code], ['qubi', 'Grover(0b110)'], ['doc', JSON.stringify({ blocks: [], meta: { title: 'x' } })]]) {
    const hash = await encodePermalink(kind, text);
    assert.match(hash, new RegExp(`^#${kind}=[A-Za-z0-9_-]+$`));
    assert.deepEqual(await decodePermalink(hash), { kind, text });
  }
  const big = await encodePermalink('code', code);
  assert.ok(big.length < code.length / 5, 'compressed');
  assert.equal(await decodePermalink('#other=abc'), null);
});

test('scene module imports are rewritten to absolute engine URLs without moving lines', () => {
  const src = "import { Circle } from '../src/index.js';\nimport * as q from 'qubibyte-graphics/qubi';\nconst m = await import('./helper.js');";
  const out = rewriteImports(src, 'http://h/examples/a.js');
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /from '[^']*\/src\/index\.js'/);
  assert.ok(!lines[0].includes("'../src"));
  assert.match(lines[1], /\/src\/qubi\/index\.js'/);
  assert.match(lines[2], /import\('http:\/\/h\/examples\/helper\.js'\)/);
});

test('Qubi variables for var ports: read, never assigned, not gates or keywords', () => {
  assert.deepEqual(qubiVariables('RY 0 theta\nk = 2\nLOOP k { H 0 }\nfn F(q) { X q }\nRZ(phi*2) 1\nCX [0,1]'), ['theta', 'phi']);
  assert.deepEqual(qubiVariables('#settings MaxQubits 2\nGrover(0b11)'), []);
});

test('the Bloch block handle writes RY and RZ back into the wired Qubi program', () => {
  const bloch = blockDefinition('bloch');
  const props = { ...bloch.defaults };
  const prog = { id: 'prog', type: 'qubi', props: { source: '// prep\nH 1\nCX [1,0]' } };
  let patch = null;
  const ctx = { source: (port) => (port === 'state' ? { block: prog, port: 'state' } : null), update: (id, p) => (patch = { id, ...p }) };
  // The top of the sphere is |0>: theta 0.
  const top = bloch.handles(props, { vector: { x: 0, y: 0, z: 1 } })[0];
  bloch.onDrag(props, top, ctx);
  assert.equal(patch.id, 'prog');
  assert.equal(patch.source, '// prep\nRY(0) 0\nRZ(0) 0\nH 1\nCX [1,0]');
  // Dragging again updates the same lines instead of adding more.
  prog.props.source = patch.source;
  const side = bloch.handles(props, { vector: { x: 0, y: 1, z: 0 } })[0];
  bloch.onDrag(props, side, ctx);
  assert.equal(patch.source, '// prep\nRY(0.5) 0\nRZ(0.5) 0\nH 1\nCX [1,0]');
});

test('snapping aligns edges and centers with guides, else rounds to the grid', () => {
  const other = { x: 2, y: 0, w: 2, h: 1 };
  const s = snapBox({ x: 1.97, y: 3, w: 1, h: 1 }, [other], { threshold: 0.1 });
  assert.ok(Math.abs(s.dx - 0.03) < 1e-9);
  assert.equal(s.guides[0].axis, 'x');
  const g = snapBox({ x: 0.1, y: 0.12, w: 1, h: 1 }, [], { threshold: 0.05, grid: 0.25 });
  assert.ok(Math.abs(0.1 + g.dx + 0.5 - 0.5) < 1e-9 && Math.abs(0.12 + g.dy + 0.5 - 0.5) < 1e-9);
});

test('history undoes and redoes snapshots and drops the redo branch on a new edit', () => {
  const h = new History();
  h.reset({ n: 0 });
  h.push({ n: 1 });
  h.push({ n: 2 });
  assert.equal(h.push({ n: 2 }), false);
  assert.deepEqual(h.undo(), { n: 1 });
  assert.deepEqual(h.undo(), { n: 0 });
  assert.equal(h.undo(), null);
  assert.deepEqual(h.redo(), { n: 1 });
  h.push({ n: 5 });
  assert.equal(h.redo(), null);
});
