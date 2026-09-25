/**
 * Finite Markov chains: n-step distributions (with the full history for
 * animation), the stationary distribution (exact when the transition
 * probabilities are rational), and absorption probabilities and expected
 * absorption times via the fundamental matrix N = (I - Q)^-1.
 * Row convention: P[i][j] is the probability of moving from i to j.
 * @module math/markov
 */
import { matrix, solveLinear, inverse, matMul, Matrix } from './linalg.js';
import { F } from './scalar.js';
import { R0, R1 } from './rational.js';

/** @typedef {import('./scalar.js').Scalar} Scalar */

/**
 * @typedef {object} MarkovChain
 * @property {string[]} states
 * @property {Matrix} P transition matrix
 * @property {(start: Array<number|string>, steps: number) => {history: number[][], final: number[]}} evolve
 * @property {() => {distribution: Scalar[], numeric: number[], unique: boolean}} stationary
 * @property {() => {absorbing: string[], transient: string[], probabilities: number[][], exact: Scalar[][], expectedSteps: number[]}} absorption
 */

/**
 * Build a Markov chain from a row-stochastic matrix (entries may be numbers
 * or rational strings such as "1/3").
 * @param {Array<Array<number|string>>} P
 * @param {string[]} [states]
 * @returns {MarkovChain}
 */
export function markovChain(P, states) {
  const M = matrix(P);
  const n = M.rows;
  if (M.cols !== n) throw new RangeError('Transition matrix must be square');
  for (let i = 0; i < n; i++) {
    let s = R0;
    for (let j = 0; j < n; j++) s = F.add(s, M.data[i][j]);
    if (Math.abs(F.toNumber(s) - 1) > 1e-9) throw new RangeError('Row ' + (i + 1) + ' does not sum to 1');
  }
  const names = states || Array.from({ length: n }, (_, i) => 'S' + (i + 1));
  const Pn = M.toNumbers();
  return {
    states: names,
    P: M,
    evolve(start, steps) {
      let d = start.map((v) => F.toNumber(matrix([[v]]).data[0][0]));
      const history = [d.slice()];
      for (let s = 0; s < steps; s++) {
        const next = new Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) next[j] += d[i] * Pn[i][j];
        d = next;
        history.push(d.slice());
      }
      return { history, final: d };
    },
    stationary() {
      // Solve pi (P - I) = 0 with sum(pi) = 1: transpose into A x = b.
      const rows = [];
      const rhs = [];
      for (let j = 0; j < n; j++) {
        rows.push(Array.from({ length: n }, (_, i) => F.sub(M.data[i][j], i === j ? R1 : R0)));
        rhs.push(R0);
      }
      rows.push(Array.from({ length: n }, () => R1));
      rhs.push(R1);
      const sol = solveLinear(new Matrix(rows), rhs);
      if (sol.kind === 'none') throw new RangeError('No stationary distribution');
      return { distribution: sol.solution, numeric: sol.solution.map((x) => F.toNumber(x)), unique: sol.kind === 'unique' };
    },
    absorption() {
      const absorbing = [];
      const transient = [];
      for (let i = 0; i < n; i++) (F.eq(M.data[i][i], R1) ? absorbing : transient).push(i);
      if (!absorbing.length) throw new RangeError('The chain has no absorbing states');
      const Q = new Matrix(transient.map((i) => transient.map((j) => F.sub(i === j ? R1 : R0, M.data[i][j]))));
      const inv = inverse(Q);
      if (!inv.ok) throw new RangeError('Some transient states never reach an absorbing state');
      const R = new Matrix(transient.map((i) => absorbing.map((j) => M.data[i][j])));
      const B = matMul(inv.inverse, R);
      const t = inv.inverse.data.map((row) => row.reduce((s, x) => F.add(s, x), R0));
      return {
        absorbing: absorbing.map((i) => names[i]),
        transient: transient.map((i) => names[i]),
        exact: B.data,
        probabilities: B.toNumbers(),
        expectedSteps: t.map((x) => F.toNumber(x)),
      };
    },
  };
}
