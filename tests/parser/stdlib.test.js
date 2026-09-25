import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, rejects } from './helpers/qubi.js';
import { STDLIB_NAMES } from '../../src/qubi/index.js';
import { simulate, probabilities, probOf, marginal, registerProb, amplitude, zeroState } from './helpers/refsim.js';

const run = (src) => simulate(ev(src));
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) < tol, `${msg} expected ${b}, got ${a}`);

/** Probabilities above 1e-9 as {bitstring: p}. */
function dist(src) {
  const c = ev(src);
  const p = probabilities(simulate(c));
  const out = {};
  p.forEach((v, i) => { if (v > 1e-9) out[i.toString(2).padStart(c.numQubits, '0')] = Number(v.toFixed(9)); });
  return out;
}

test('STDLIB_NAMES lists the reference library', () => {
  assert.deepEqual([...STDLIB_NAMES], ['Bell', 'GHZ', 'W', 'Superdense', 'Teleport', 'Deutsch', 'BV', 'Grover', 'QFT', 'IQFT', 'Shor',
    'PhaseKickback', 'PhaseOracle', 'SwapTest', 'StatePreparation', 'QubitPreparation', 'BitFlip', 'QPE', 'Stego']);
});

test('stdlib ops are tagged with a group naming the call', () => {
  const c = ev('X 3\nQFT(0..2)');
  const g = c.ops[1].group;
  assert.deepEqual([g.name, g.kind, g.callText, g.wires, g.blackbox], ['QFT', 'stdlib', 'QFT(0..2)', [0, 1, 2], false]);
  assert.ok(c.ops.slice(1).every((o) => o.group === g));
  assert.equal(c.ops[0].group, undefined);
});

test('Bell gives 50/50 on 00 and 11', () => {
  assert.deepEqual(dist('Bell'), { '00': 0.5, '11': 0.5 });
  assert.deepEqual(dist('Bell(2,3)'), { '0000': 0.5, '1100': 0.5 });
  assert.deepEqual(dist('Bell((1,0))'), { '00': 0.5, '11': 0.5 });
  rejects('Bell(0,1,2)', /Bell takes at most 2 arguments/);
});

test('GHZ(0..3) gives 0000 and 1111', () => {
  assert.deepEqual(dist('GHZ(0..3)'), { '0000': 0.5, '1111': 0.5 });
  assert.deepEqual(dist('GHZ'), { '000': 0.5, '111': 0.5 });
});

test('W(0..2) gives 1/3 each on 001, 010, 100', () => {
  const d = dist('W(0..2)');
  assert.deepEqual(Object.keys(d).sort(), ['001', '010', '100']);
  for (const p of Object.values(d)) near(p, 1 / 3, 1e-9);
  const d4 = dist('W(0..3)');
  assert.deepEqual(Object.keys(d4).sort(), ['0001', '0010', '0100', '1000']);
  for (const p of Object.values(d4)) near(p, 0.25, 1e-9);
});

test('Grover(0b110) finds 110 with probability above 0.9 and never X-preps the marked state', () => {
  const c = ev('Grover(0b110)');
  assert.ok(probOf(simulate(c), '110') > 0.9);
  assert.deepEqual(c.ops.slice(0, 3).map((o) => `${o.name} ${o.targets[0]}`), ['H 0', 'H 1', 'H 2']);
  const mcz = c.ops.filter((o) => o.name === 'CZ');
  assert.equal(mcz.length, 4, 'two iterations, one oracle and one diffusion each');
  assert.ok(mcz.every((o) => o.controls.length === 2 && o.targets.length === 1), 'multi-controls stay one op');
});

test('Grover over other widths, lists of marked states, and explicit iterations', () => {
  assert.ok(probOf(run('Grover(0b01)'), '01') > 0.99);
  assert.ok(probOf(run('Grover(0b1010)'), '1010') > 0.9);
  const two = probabilities(run('Grover((0b011, 0b101))'));
  assert.ok(two[0b011] + two[0b101] > 0.9);
  assert.equal(ev('Grover(0b110, 1)').ops.filter((o) => o.name === 'CZ').length, 2);
  assert.ok(probOf(run('Grover(0b11, 1, (2,3))'), '1100') > 0.99);
  rejects('Grover(6)', /Grover takes a bitstring literal for the marked state, as in Grover\(0b110\)/);
  rejects('Grover((0b1, 0b10))', /marked states need the same bit width/);
});

test('QFT on a basis state gives uniform magnitudes with phases e^(2 pi i x k / N)', () => {
  const s = run('X (1,2,4)\nQFT(0..4)');
  const x = 0b10110;
  const N = 32;
  for (let k = 0; k < N; k++) {
    const a = amplitude(s, k);
    near(a.re, Math.cos((2 * Math.PI * x * k) / N) / Math.sqrt(N), 1e-12, `re k=${k}`);
    near(a.im, Math.sin((2 * Math.PI * x * k) / N) / Math.sqrt(N), 1e-12, `im k=${k}`);
  }
});

test('QFT matches the definition for every 3-qubit basis state', () => {
  for (let x = 0; x < 8; x++) {
    const prep = [0, 1, 2].filter((q) => (x >> q) & 1).map((q) => `X ${q}`).join('\n');
    const s = run(`${prep}\nQFT(0..2)`);
    for (let k = 0; k < 8; k++) {
      const a = amplitude(s, k);
      near(a.re, Math.cos((2 * Math.PI * x * k) / 8) / Math.sqrt(8), 1e-12);
      near(a.im, Math.sin((2 * Math.PI * x * k) / 8) / Math.sqrt(8), 1e-12);
    }
  }
});

test('QFT uses H, CP, and final swaps; IQFT(0..2) undoes QFT(0..2)', () => {
  const names = new Set(ev('QFT(0..3)').ops.map((o) => o.name));
  assert.deepEqual([...names].sort(), ['CP', 'H', 'SWAP']);
  assert.deepEqual(dist('X (0,2)\nQFT(0..2)\nIQFT(0..2)'), { 101: 1 });
  assert.deepEqual(dist('X 1\nIQFT(0..2)\nQFT(0..2)'), { '010': 1 });
});

test('StatePreparation(0b101, 0.4) puts 0.4 on 101 and the rest on 000', () => {
  assert.deepEqual(dist('StatePreparation(0b101, 0.4)'), { '000': 0.6, 101: 0.4 });
});

test('StatePreparation((0b101..0b111), (0.2,0.3,0.4))', () => {
  assert.deepEqual(dist('StatePreparation((0b101..0b111), (0.2,0.3,0.4))'), { '000': 0.1, 101: 0.2, 110: 0.3, 111: 0.4 });
});

test('StatePreparation named states and a trailing wire range', () => {
  assert.deepEqual(dist('StatePreparation("bell")'), { '00': 0.5, '11': 0.5 });
  assert.deepEqual(dist('StatePreparation("ghz")'), { '000': 0.5, 111: 0.5 });
  assert.deepEqual(dist('StatePreparation("GHZ", 0..3)'), { '0000': 0.5, 1111: 0.5 });
  const sup = dist('StatePreparation("superposition")');
  assert.equal(Object.keys(sup).length, 8);
  assert.deepEqual(dist('StatePreparation(0b101, 0.5, 1..3)'), { '0000': 0.5, 1010: 0.5 });
  rejects('StatePreparation("plus")', /StatePreparation names are "bell", "ghz", and "superposition"/);
});

test('StatePreparation of arbitrary distributions uses controlled RY and is exact', () => {
  const probs = [0.05, 0.1, 0.15, 0.0, 0.2, 0.25, 0.05, 0.2];
  const states = probs.map((_, i) => `0b${i.toString(2).padStart(3, '0')}`).join(', ');
  const c = ev(`StatePreparation((${states}), (${probs.join(', ')}))`);
  const p = probabilities(simulate(c));
  probs.forEach((q, i) => near(p[i], q, 1e-12, `state ${i}`));
  assert.ok(c.ops.some((o) => o.name === 'RY' && o.controls.length === 2), 'uniformly controlled RY with two controls');
});

test('StatePreparation of a single basis state is X gates', () => {
  const c = ev('StatePreparation(0b101)');
  assert.deepEqual(c.ops.map((o) => `${o.name} ${o.targets[0]}`), ['X 0', 'X 2']);
});

test('StatePreparation argument errors', () => {
  rejects('StatePreparation((0b01, 0b10), (0.8, 0.5))', /probabilities add up to 1\.3, more than 1/);
  rejects('StatePreparation((0b01, 0b10), (0.5))', /got 2 states but 1 probabilities/);
  rejects('StatePreparation(5, 0.5)', /takes bitstrings such as 0b101/);
  rejects('StatePreparation(0b101, 0.5, (0,1))', /3 bits wide but only 2 wires/);
  rejects('StatePreparation()', /StatePreparation needs states/);
});

test('QubitPreparation sets per-qubit P(|1>) with RY(2 asin(sqrt p))', () => {
  const s = run('QubitPreparation((0.2, 0.5, 0.8))');
  [0.2, 0.5, 0.8].forEach((p, q) => near(marginal(s, q), p, 1e-12));
  const t = run('QubitPreparation((0.2.0.1.0.5))');
  [0.2, 0.3, 0.4, 0.5].forEach((p, q) => near(marginal(t, q), p, 1e-12));
  const op = ev('QubitPreparation(0.25)').ops[0];
  near(op.params[0], 2 * Math.asin(0.5), 1e-15);
  rejects('QubitPreparation((0.2, 1.5))', /probabilities are numbers from 0 to 1/);
});

test('Deutsch reads 0 for constant and 1 for balanced oracles', () => {
  for (const [oracle, bit] of [['constant0', 0], ['constant1', 0], ['balanced', 1], ['balanced-inverted', 1]]) {
    near(marginal(run(`Deutsch("${oracle}")`), 0), bit, 1e-12, oracle);
  }
  near(marginal(run('Deutsch'), 0), 1, 1e-12, 'default oracle is balanced');
  rejects('Deutsch("random")', /Deutsch oracles are/);
});

test('BV recovers the secret', () => {
  assert.deepEqual(dist('BV(0b1011)'), { 1011: 1 });
  assert.deepEqual(dist('BV(0b01, (2,3))'), { '0100': 1 });
});

test('Teleport moves an arbitrary state from wire 0 to wire 2', () => {
  for (const [t, p, l] of [[0.3, 0.7, 0], [1.1, -0.4, 0.25], [0.5, 0, 0]]) {
    const s = run(`U(${t}, ${p}, ${l}) 0\nTeleport\nU(${-t}, ${-l}, ${-p}) 2`);
    near(marginal(s, 2), 0, 1e-12, `Bob's qubit returns to |0> after the inverse (${t},${p},${l})`);
  }
});

test('Superdense delivers each 2-bit message', () => {
  for (const m of ['00', '01', '10', '11']) assert.deepEqual(dist(`Superdense(0b${m})`), { [m]: 1 });
  rejects('Superdense(0b100)', /Superdense sends 2 bits/);
});

test('Shor order finding for a = 7, N = 15 peaks at multiples of 2^t / r', () => {
  const s = run('Shor');
  for (const v of [0, 2, 4, 6]) near(registerProb(s, [0, 1, 2], v), 0.25, 1e-9, `peak ${v}`);
  const s4 = run('Shor(15, 7, 4)');
  for (const v of [0, 4, 8, 12]) near(registerProb(s4, [0, 1, 2, 3], v), 0.25, 1e-9, `peak ${v}`);
  const s11 = run('Shor(15, 11)');
  for (const v of [0, 4]) near(registerProb(s11, [0, 1, 2], v), 0.5, 1e-9, `order 2 peak ${v}`);
  assert.ok(ev('Shor').ops.some((o) => o.name === 'CSWAP' && o.controls.length === 1));
});

test('Shor modular multiplication maps y to a*y mod 15 on the work register', () => {
  for (const a of [2, 4, 7, 8, 11, 13, 14]) {
    for (let y = 1; y < 15; y++) {
      const init = zeroState(5);
      init.re[0] = 0;
      init.re[1 + (y << 1)] = 1;
      const c = ev(`Shor(15, ${a}, 1)`);
      const work = c.ops.filter((o) => o.name === 'CSWAP' || (o.name === 'CX' && o.controls[0] === 0));
      const s = simulate({ numQubits: 5, ops: work }, init);
      const out = probabilities(s).findIndex((p) => p > 0.5);
      assert.equal(out, 1 + (((a * y) % 15) << 1), `a=${a} y=${y}`);
    }
  }
  rejects('Shor(21)', /supports the toy modulus N = 15/);
  rejects('Shor(15, 5)', /a must be coprime with 15/);
});

test('QPE reads the phase of P into the counting register', () => {
  near(registerProb(run('QPE(0.5)'), [0, 1, 2], 2), 1, 1e-9);
  near(registerProb(run('QPE(0.25, 4)'), [0, 1, 2, 3], 2), 1, 1e-9);
  near(registerProb(run('#settings CodeAngleUnit degrees\nQPE(270)'), [0, 1, 2], 6), 1, 1e-9);
});

test('PhaseKickback takes only "CX" or "CZ" and kicks the control to |1>', () => {
  near(marginal(run('PhaseKickback("CX")'), 0), 1, 1e-12);
  near(marginal(run('PhaseKickback("CZ")'), 0), 1, 1e-12);
  for (const bad of ['"CY"', '"cx"', '0', '']) rejects(`PhaseKickback(${bad})`, /PhaseKickback takes "CX" or "CZ"/);
});

test('PhaseOracle flips the sign of the marked state only', () => {
  const s = run('H (0..2)\nPhaseOracle(0b101)');
  for (let i = 0; i < 8; i++) near(amplitude(s, i).re, (i === 5 ? -1 : 1) / Math.sqrt(8), 1e-12);
});

test('SwapTest measures overlap on the ancilla; "similar" prepares close states', () => {
  near(marginal(run('SwapTest'), 0), 0, 1e-12, 'identical registers');
  near(marginal(run('X 2\nSwapTest'), 0), 0.5, 1e-12, 'orthogonal registers');
  const p0 = 1 - marginal(run('SwapTest("similar")'), 0);
  assert.ok(p0 > 0.95 && p0 < 1, `P(0) = ${p0}`);
  near(marginal(run('X (3,4)\nSwapTest((0..4))'), 0), 0.5, 1e-12, 'two-qubit registers');
  rejects('SwapTest("different")', /SwapTest option is "similar"/);
  rejects('SwapTest((0,1))', /SwapTest takes an ancilla and two equal registers/);
});

test('BitFlip corrects a single bit flip on any code qubit', () => {
  for (const err of [-1, 0, 1, 2]) {
    const s = run(`RY 0 0.3\nBitFlip(${err})`);
    near(marginal(s, 0), Math.sin(0.15 * Math.PI) ** 2, 1e-12, `data after error ${err}`);
    const syndrome = { '-1': 0, 0: 3, 1: 1, 2: 2 }[err];
    near(registerProb(s, [1, 2], syndrome), 1, 1e-12, `syndrome ${err}`);
  }
  rejects('BitFlip(3)', /BitFlip error position is 0, 1, 2, or -1 for none/);
});

test('Stego hides a bitstring in phases and reveals it', () => {
  const hidden = probabilities(run('Stego(0b101)'));
  hidden.forEach((p) => near(p, 1 / 8, 1e-12));
  assert.deepEqual(dist('Stego(0b101, "reveal")'), { 101: 1 });
  rejects('Stego(0b1, "shout")', /Stego mode is "hide" or "reveal"/);
});

test('stdlib calls work in statement form with a parenthesized list', () => {
  assert.deepEqual(dist('StatePreparation (0b01, 0.5)'), { '00': 0.5, '01': 0.5 });
  assert.deepEqual(dist('GHZ (0..2)'), { '000': 0.5, 111: 0.5 });
});

test('stdlib arguments cannot depend on measurements while tracing', () => {
  rejects('m = MEASURE 0\nBV(m)', /BV arguments depend on a measurement result/);
});
