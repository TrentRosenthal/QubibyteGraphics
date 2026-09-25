import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatevectorSimulator } from '../../src/quantum/statevector.js';
import { DensityMatrixSimulator } from '../../src/quantum/density.js';
import { StabilizerSimulator } from '../../src/quantum/stabilizer.js';
import { circuitUnitary } from '../../src/quantum/decompose.js';
import { createRng } from '../../src/quantum/rng.js';
import * as C from '../../src/quantum/cmatrix.js';
import { refState, refUnitary, refToRows, randomOps, lcg } from './helpers/quantum-ref.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('statevector, density matrix, circuit unitary and the naive reference agree on random circuits', () => {
  const rnd = lcg(123);
  for (let trial = 0; trial < 30; trial++) {
    const n = 1 + Math.floor(rnd() * 4);
    const ops = randomOps(n, 5 + Math.floor(rnd() * 25), rnd);
    const ref = refState(n, ops);
    const sv = new StatevectorSimulator(n);
    const dm = new DensityMatrixSimulator(n);
    for (const op of ops) {
      sv.applyOp(op);
      dm.applyOp(op);
    }
    const d = 1 << n;
    for (let i = 0; i < d; i++) {
      close(sv.re[i], ref.re[i]);
      close(sv.im[i], ref.im[i]);
      for (let j = 0; j < d; j++) {
        close(dm.re[i * d + j], ref.re[i] * ref.re[j] + ref.im[i] * ref.im[j]);
        close(dm.im[i * d + j], ref.im[i] * ref.re[j] - ref.re[i] * ref.im[j]);
      }
    }
    if (n <= 3) {
      const u = circuitUnitary({ numQubits: n, ops });
      assert.ok(C.equals(u, C.fromArray(refToRows(refUnitary(n, ops))), 1e-9));
    }
  }
});

test('random Clifford circuits: stabilizer, statevector and reference agree on measurement statistics', () => {
  const rnd = lcg(55);
  for (let trial = 0; trial < 15; trial++) {
    const n = 2 + Math.floor(rnd() * 3);
    const ops = randomOps(n, 25, rnd, { clifford: true });
    const ref = refState(n, ops);
    const probs = ref.re.map((r, i) => r * r + ref.im[i] * ref.im[i]);
    // Stabilizer states are uniform over their support.
    const support = probs.filter((p) => p > 1e-9);
    for (const p of support) close(p, 1 / support.length);
    const rng = createRng(trial + 1);
    const counts = new Map();
    const shots = 400;
    for (let s = 0; s < shots; s++) {
      const t = new StabilizerSimulator(n);
      ops.forEach((op) => t.applyOp(op));
      const bits = t.measure(Array.from({ length: n }, (_, q) => q), rng);
      const idx = bits.reduce((acc, b, q) => acc | (b << q), 0);
      assert.ok(probs[idx] > 1e-9, 'stabilizer outcome has zero probability in the reference');
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
    for (const [idx, c] of counts) close(c / shots, probs[idx], 0.12);
    const sv = new StatevectorSimulator(n);
    ops.forEach((op) => sv.applyOp(op));
    for (let i = 0; i < probs.length; i++) close(sv.probabilities()[i], probs[i]);
  }
});

test('measurement statistics of the statevector match Born probabilities', () => {
  const rnd = lcg(8);
  const ops = randomOps(3, 20, rnd);
  const ref = refState(3, ops);
  const probs = ref.re.map((r, i) => r * r + ref.im[i] * ref.im[i]);
  const rng = createRng(77);
  const counts = new Array(8).fill(0);
  const shots = 6000;
  for (let s = 0; s < shots; s++) {
    const sv = new StatevectorSimulator(3);
    ops.forEach((op) => sv.applyOp(op));
    const bits = sv.measure([2, 0, 1], rng);
    counts[bits[0] * 4 + bits[1] + bits[2] * 2]++;
  }
  for (let i = 0; i < 8; i++) {
    const sigma = Math.sqrt((probs[i] * (1 - probs[i])) / shots);
    close(counts[i] / shots, probs[i], 5 * sigma + 1e-3);
  }
});
