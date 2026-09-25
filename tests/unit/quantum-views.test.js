import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../src/index.js';
import { evaluate } from '../../src/qubi/index.js';
import { runCircuit } from '../../src/quantum/index.js';
import { CircuitDiagram, AmplitudeBars, diracLatex, op2full, angleTexFor, gateTex } from '../../src/quantum/views/index.js';
import { explainQubi, describeOp, turnFraction, staysReal } from '../../src/quantum/explainers.js';
import { highlightQubi, CodeBlock } from '../../src/text/code.js';

await Q.preload();

test('circuit diagram places gates by schedule column and draws measurement to the classical wire', () => {
  const c = evaluate('H 0\nCX [0,1]\nm = MEASURE (0,1)');
  const d = new CircuitDiagram(c, { scheduling: 'never' });
  assert.equal(d.columnNodes.length, 4);
  assert.ok(d.hasClassical);
  const types = d.children.map((n) => n.type);
  assert.ok(types.includes('target') && types.includes('control') && types.includes('meter') && types.includes('classicalDrop'));
  assert.ok(d.colX(1) > d.colX(0));
});

test('hidden qubits are not drawn and are noted', () => {
  const c = evaluate('#settings MaxQubits 5\n#settings VisibleQubits 3\nH (0..4)');
  const d = new CircuitDiagram(c);
  assert.equal(d.wires.length, 3);
  assert.equal(d.hidden, 2);
});

test('angle labels use exact fractions of pi and Qubi glyphs', () => {
  assert.equal(angleTexFor(Math.PI / 4, 'piradians', 3), '\\pi/4');
  assert.equal(angleTexFor(-Math.PI, 'piradians', 3), '-\\pi');
  assert.equal(gateTex('SDG'), 'S^{\\dagger}');
  assert.equal(gateTex('RY'), 'R_y');
});

test('Dirac notation factors a common magnitude', () => {
  const st = runCircuit(evaluate('H 0\nCX [0,1]'), { seed: 1 }).state;
  assert.equal(diracLatex(st), '\\lvert \\psi\\rangle = \\frac{1}{\\sqrt{2}}\\left(\\lvert 00\\rangle + \\lvert 11\\rangle\\right)');
});

test('op2full matches the simulator for a controlled gate', () => {
  const c = evaluate('H 0\nH 1\nCP(0.5) [0,1]');
  const st = runCircuit(c, { seed: 1 }).state;
  const U = op2full(c.ops[2], 2);
  const pre = runCircuit(evaluate('H 0\nH 1'), { seed: 1 }).state;
  for (let i = 0; i < 4; i++) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < 4; j++) {
      re += U.re[i * 4 + j] * pre.re[j] - U.im[i * 4 + j] * pre.im[j];
      im += U.re[i * 4 + j] * pre.im[j] + U.im[i * 4 + j] * pre.re[j];
    }
    assert.ok(Math.abs(re - st.re[i]) < 1e-12 && Math.abs(im - st.im[i]) < 1e-12);
  }
});

test('amplitude bars tween along the unitary path', async () => {
  let bars;
  const scene = await Q.buildScene(async (s) => {
    bars = s.add(new AmplitudeBars(1, null, {}));
    const op = evaluate('RX 0 1').ops[0];
    const before = runCircuit(evaluate('I 0'), { seed: 1 }).state;
    await s.play(new (await import('../../src/quantum/views/state.js')).ApplyGate(bars, op, before), { duration: 1, ease: 'linear' });
  });
  const mid = scene.evaluateAt(0.5, () => bars.amps());
  // Halfway through an RX(pi) rotation the populations are equal.
  assert.ok(Math.abs(mid[0] ** 2 + mid[1] ** 2 - 0.5) < 1e-9);
});

test('Qubi highlighting and code blocks', () => {
  const spans = highlightQubi('CX [0,1] // entangle');
  assert.equal(spans[0].kind, 'gate');
  assert.equal(spans[spans.length - 1].kind, 'comment');
  const cb = new CodeBlock('H 0\n\nCX [0,1]');
  assert.equal(cb.lines.length, 3);
  assert.equal(cb.line(1), null);
});

test('explainers build from a program with narration captions', async () => {
  for (const src of ['Grover(0b110)', 'X (1,2,4)\nQFT(0..4)', 'H 0\nCX [0,1]']) {
    const scene = await Q.buildScene(explainQubi(src));
    assert.ok(scene.duration > 8, `${src}: ${scene.duration}`);
    assert.ok(scene.captions.length >= 3);
  }
  assert.match(describeOp(evaluate('CX [0,1,2]').ops[0]), /are all 1/);
  assert.equal(turnFraction(22 / 32, 32), '\\tfrac{11}{16}');
  assert.equal(staysReal(evaluate('H 0\nCX [0,1]')), true);
  assert.equal(staysReal(evaluate('H 0\nT 0')), false);
});
