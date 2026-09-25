import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../src/index.js';
import { parseMathRequest, derivationFor, rationalLatex, MatrixView } from '../../src/explainers/derivation.js';

test('single-expression requests parse into the right kind', () => {
  assert.equal(parseMathRequest('d/dx x^2 sin(x)').kind, 'derivative');
  assert.deepEqual(parseMathRequest('int_0^1 x e^x dx'), { kind: 'definite', lower: '0', upper: '1', expr: 'x e^x', variable: 'x' });
  assert.equal(parseMathRequest('int x cos(x) dx').kind, 'integral');
  assert.equal(parseMathRequest('solve x^2 - 5x + 6 = 0').variable, 'x');
  assert.deepEqual(parseMathRequest('[[1,2],[3,4]] * [[5,6],[7,8]]').b, [[5, 6], [7, 8]]);
  assert.equal(parseMathRequest('eigen [[2,1],[1,2]]').kind, 'eigen');
  assert.equal(parseMathRequest('(x^2-1)/(x-1)').kind, 'simplify');
});

test('derivations chain with = only for expression steps', () => {
  const d = derivationFor(parseMathRequest('d/dx x^2 sin(x)'));
  assert.equal(d.steps[0].chain, false);
  assert.ok(d.steps.slice(1).every((s) => s.chain));
  const s = derivationFor(parseMathRequest('solve 2x + 3 = 11'));
  assert.ok(s.steps.every((st) => !st.chain));
  assert.equal(s.steps[s.steps.length - 1].latex, 'x = 4');
  assert.equal(rationalLatex({ n: '-3', d: '4' }), '-\\tfrac{3}{4}');
});

test('math explainers build scenes with captions', async () => {
  for (const src of ['d/dx x^2 sin(x)', 'int_0^1 x e^x dx', '[[1,2],[3,4]] * [[5,6],[7,8]]', 'eigen [[2,1],[1,2]]']) {
    const scene = await Q.buildScene(Q.explainMath(src));
    assert.ok(scene.duration > 6, `${src}: ${scene.duration}`);
    assert.ok(scene.captions.length >= 2, src);
  }
});

test('matrix views place entries on a grid', async () => {
  await Q.preload();
  const m = new MatrixView([['1', '2'], ['3', '4']]);
  assert.ok(m.entry(0, 0).center()[0] < m.entry(0, 1).center()[0]);
  assert.ok(m.entry(0, 0).center()[1] > m.entry(1, 0).center()[1]);
});
