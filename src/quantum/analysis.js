/**
 * Analysis of live quantum states: Bloch vectors (reduced by partial trace
 * for multi-qubit states), Q-sphere layout, Schmidt decomposition,
 * entanglement measures, fidelities and distances, observables, CHSH, Born
 * rule projections, and state geodesics. Circuit unitaries and gate
 * decompositions live in `decompose.js`; exact-value and Dirac formatting in
 * `notation.js`. Both are re-exported here so this module is the single
 * entry point for analysis.
 *
 * Functions accept any of these as a state:
 * - a StatevectorSimulator or `{re, im}` amplitude arrays (pure),
 * - a DensityMatrixSimulator or a square CMatrix density matrix (mixed),
 * - a 2^n x 1 CMatrix column vector (pure).
 *
 * @module quantum/analysis
 */

import * as C from './cmatrix.js';
import { DensityMatrixSimulator, vonNeumannEntropy } from './density.js';
import { applyMatrix } from './kernel.js';
import { checkWires, gateMatrix } from './gates.js';
import { parsePauli, pauliPhase, popcount } from './pauli.js';
import { gateOp } from './decompose.js';
import { describeState } from './state.js';

export {
  circuitUnitary, unitarySteps, decomposeZYZ, uGateParams, eulerDecompose,
  decomposeControlled, decomposeTwoQubit, unitaryPath, gateOp,
} from './decompose.js';
export { exactForm, diracTerms, formatDirac, diracOptionsFromSettings } from './notation.js';
export { vonNeumannEntropy } from './density.js';
export { describeState } from './state.js';

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */
/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('./pauli.js').PauliSpec} PauliSpec */

/** @typedef {import('./state.js').StateLike} StateLike */

/**
 * @typedef {Object} BlochVector
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * Density matrix of a state (|psi><psi| for a pure one).
 * @param {StateLike} state
 * @returns {CMatrix}
 */
export function densityMatrixOf(state) {
  const s = describeState(state);
  if (!s.pure) return s.rho;
  return DensityMatrixSimulator.fromAmplitudes(s).densityMatrix();
}

/**
 * Reduced density matrix on `wires` (wires[0] is its least significant
 * qubit). For pure states it is computed straight from the amplitudes in
 * O(2^n 4^k) without forming the full density matrix.
 * @param {StateLike} state
 * @param {number[]} wires
 * @returns {CMatrix}
 */
export function reducedDensityMatrix(state, wires) {
  const s = describeState(state);
  checkWires(wires, s.numQubits, 'reducedDensityMatrix');
  if (!s.pure) return C.partialTrace(s.rho, s.numQubits, wires);
  const rest = [];
  for (let q = 0; q < s.numQubits; q++) if (!wires.includes(q)) rest.push(q);
  const keepOff = C.wireOffsets(wires);
  const envOff = C.wireOffsets(rest);
  const k = keepOff.length;
  const out = C.zeros(k);
  const ar = new Float64Array(k);
  const ai = new Float64Array(k);
  for (let e = 0; e < envOff.length; e++) {
    for (let i = 0; i < k; i++) {
      ar[i] = s.re[envOff[e] | keepOff[i]];
      ai[i] = s.im[envOff[e] | keepOff[i]];
    }
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        out.re[i * k + j] += ar[i] * ar[j] + ai[i] * ai[j];
        out.im[i * k + j] += ai[i] * ar[j] - ar[i] * ai[j];
      }
    }
  }
  return out;
}

/**
 * Bloch vector of one qubit (of the reduced state for multi-qubit states).
 * Length 1 for a pure qubit, less when it is mixed or entangled.
 * @param {StateLike} state
 * @param {number} [wire=0]
 * @returns {BlochVector}
 */
export function blochVector(state, wire = 0) {
  const rho = reducedDensityMatrix(state, [wire]);
  return { x: 2 * rho.re[1], y: -2 * rho.im[1], z: rho.re[0] - rho.re[3] };
}

/**
 * Reduced Bloch vector of every qubit.
 * @param {StateLike} state
 * @returns {BlochVector[]} Entry q is qubit q.
 */
export function blochVectors(state) {
  const n = describeState(state).numQubits;
  return Array.from({ length: n }, (_, q) => blochVector(state, q));
}

/**
 * Spherical angles of a Bloch vector: theta from +z (|0>), phi from +x.
 * @param {BlochVector} v
 * @returns {{theta: number, phi: number, r: number}}
 */
export function blochAngles(v) {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r < 1e-15) return { theta: 0, phi: 0, r: 0 };
  let phi = Math.atan2(v.y, v.x);
  if (Math.hypot(v.x, v.y) < 1e-12) phi = 0;
  if (phi < 0) phi += 2 * Math.PI;
  return { theta: Math.acos(Math.max(-1, Math.min(1, v.z / r))), phi, r };
}

/**
 * Bloch coordinates and angles of one qubit of a state.
 * @param {StateLike} state
 * @param {number} [wire=0]
 * @returns {BlochVector & {theta: number, phi: number, r: number}}
 */
export function stateToBloch(state, wire = 0) {
  const v = blochVector(state, wire);
  return { ...v, ...blochAngles(v) };
}

function formatAngle(radians, unit, decimals) {
  const round = (x) => {
    const v = Number(x.toFixed(decimals));
    return Object.is(v, -0) ? 0 : v;
  };
  switch (unit) {
    case 'piradians': case 'pirad': return String(round(radians / Math.PI));
    case 'radians': case 'rad': return `${round(radians)}rad`;
    case 'degrees': case 'deg': return `${round((radians * 180) / Math.PI)}deg`;
    default: throw new Error(`Angle unit must be piradians, radians, or degrees, got "${unit}"`);
  }
}

/**
 * Gates that prepare the Bloch point (theta, phi) from |0>: RY(theta) then
 * RZ(phi) (equal to the target state up to global phase). The Qubi text uses
 * bare numbers in piradians by default, the default CodeAngleUnit; other
 * units carry a `rad` or `deg` suffix so the text reads correctly under any
 * CodeAngleUnit. Zero rotations are left out.
 *
 * Example: P(|0>) = 0.8 means theta = 2 acos(sqrt(0.8)), giving `RY 0 0.295`.
 * @param {number} theta Polar angle in radians.
 * @param {number} phi Azimuth in radians.
 * @param {{wire?: number, angleUnit?: 'piradians'|'radians'|'degrees', decimals?: number}} [options]
 * @returns {{ry: number, rz: number, ops: Op[], qubi: string}}
 */
export function blochToPreparation(theta, phi, options = {}) {
  const { wire = 0, angleUnit = 'piradians', decimals = 3 } = options;
  const ops = [];
  const lines = [];
  for (const [name, angle] of [['RY', theta], ['RZ', phi]]) {
    const text = formatAngle(angle, angleUnit, decimals);
    if (/^-?0(rad|deg)?$/.test(text)) continue;
    ops.push(gateOp(name, [wire], [angle]));
    lines.push(`${name} ${wire} ${text}`);
  }
  return { ry: theta, rz: phi, ops, qubi: lines.join('\n') };
}

function binomial(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * @typedef {Object} QSpherePoint
 * @property {number} index Basis index.
 * @property {string} bitstring MSB-first label.
 * @property {number} weight Hamming weight (number of 1s).
 * @property {number} theta Latitude angle: pi * weight / n (|0..0> at the north pole).
 * @property {number} phi Longitude: states of equal weight spread evenly, in index order.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} re Amplitude, real part.
 * @property {number} im Amplitude, imaginary part.
 * @property {number} probability
 * @property {number} phase Amplitude phase in [0, 2 pi), for coloring.
 */

/**
 * Q-sphere layout of a pure state: each basis state with non-negligible
 * probability sits on a latitude set by its Hamming weight.
 * @param {StateLike} state Pure state.
 * @param {{minProbability?: number}} [options]
 * @returns {QSpherePoint[]}
 */
export function qsphere(state, { minProbability = 1e-10 } = {}) {
  const s = describeState(state);
  if (!s.pure) throw new Error('The Q-sphere needs a pure state');
  const n = s.numQubits;
  const seen = new Array(n + 1).fill(0);
  const out = [];
  for (let i = 0; i < s.re.length; i++) {
    const w = popcount(i);
    const slot = seen[w]++;
    const probability = s.re[i] * s.re[i] + s.im[i] * s.im[i];
    if (probability < minProbability) continue;
    const theta = n === 0 ? 0 : (Math.PI * w) / n;
    const phi = (2 * Math.PI * slot) / binomial(n, w);
    let phase = Math.atan2(s.im[i], s.re[i]);
    if (phase < 0) phase += 2 * Math.PI;
    out.push({
      index: i,
      bitstring: n ? i.toString(2).padStart(n, '0') : '',
      weight: w,
      theta,
      phi,
      x: Math.sin(theta) * Math.cos(phi),
      y: Math.sin(theta) * Math.sin(phi),
      z: Math.cos(theta),
      re: s.re[i],
      im: s.im[i],
      probability,
      phase,
    });
  }
  return out;
}

/**
 * Schmidt decomposition of a pure state across the bipartition
 * (wiresA | rest): |psi> = sum_k s_k |a_k>|b_k>. Computed by an SVD of the
 * amplitude matrix M[a][b].
 * @param {StateLike} state Pure state.
 * @param {number[]} wiresA Wires of part A (wiresA[0] is the least significant qubit of the a_k vectors).
 * @returns {{coefficients: number[], rank: number, wiresA: number[], wiresB: number[], vectorsA: Array<{re: Float64Array, im: Float64Array}>, vectorsB: Array<{re: Float64Array, im: Float64Array}>}}
 */
export function schmidtDecomposition(state, wiresA) {
  const s = describeState(state);
  if (!s.pure) throw new Error('Schmidt decomposition needs a pure state');
  checkWires(wiresA, s.numQubits, 'schmidtDecomposition');
  const wiresB = [];
  for (let q = 0; q < s.numQubits; q++) if (!wiresA.includes(q)) wiresB.push(q);
  const offA = C.wireOffsets(wiresA);
  const offB = C.wireOffsets(wiresB);
  const m = C.zeros(offA.length, offB.length);
  for (let a = 0; a < offA.length; a++) {
    for (let b = 0; b < offB.length; b++) {
      m.re[a * offB.length + b] = s.re[offA[a] | offB[b]];
      m.im[a * offB.length + b] = s.im[offA[a] | offB[b]];
    }
  }
  const { u, s: sv, v } = C.svd(m);
  const coefficients = [];
  const vectorsA = [];
  const vectorsB = [];
  for (let k = 0; k < sv.length; k++) {
    if (sv[k] < 1e-12) continue;
    coefficients.push(sv[k]);
    const va = { re: new Float64Array(u.rows), im: new Float64Array(u.rows) };
    for (let i = 0; i < u.rows; i++) {
      va.re[i] = u.re[i * u.cols + k];
      va.im[i] = u.im[i * u.cols + k];
    }
    // psi = sum s_k u_k conj(v_k), so the B vector is the conjugate of column k of v.
    const vb = { re: new Float64Array(v.rows), im: new Float64Array(v.rows) };
    for (let i = 0; i < v.rows; i++) {
      vb.re[i] = v.re[i * v.cols + k];
      vb.im[i] = -v.im[i * v.cols + k];
    }
    vectorsA.push(va);
    vectorsB.push(vb);
  }
  return { coefficients, rank: coefficients.length, wiresA: wiresA.slice(), wiresB, vectorsA, vectorsB };
}

/**
 * Entanglement entropy (von Neumann entropy in bits) of the reduced state on
 * `wires`. For a pure global state this measures entanglement across the cut.
 * @param {StateLike} state
 * @param {number[]} wires
 * @returns {number}
 */
export function entanglementEntropy(state, wires) {
  return vonNeumannEntropy(reducedDensityMatrix(state, wires));
}

/**
 * Quantum mutual information I(a:b) = S(a) + S(b) - S(ab), in bits.
 * @param {StateLike} state
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function mutualInformation(state, a, b) {
  const v = entanglementEntropy(state, [a]) + entanglementEntropy(state, [b]) - entanglementEntropy(state, [a, b]);
  return Math.max(0, v);
}

/**
 * Mutual information for every qubit pair (symmetric, zero diagonal).
 * @param {StateLike} state
 * @returns {number[][]}
 */
export function mutualInformationMatrix(state) {
  const n = describeState(state).numQubits;
  const single = Array.from({ length: n }, (_, q) => entanglementEntropy(state, [q]));
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      out[a][b] = out[b][a] = Math.max(0, single[a] + single[b] - entanglementEntropy(state, [a, b]));
    }
  }
  return out;
}

/**
 * Wootters concurrence of two qubits (of the reduced state on `wires`):
 * 1 for a Bell state, 0 for any separable state.
 * @param {StateLike} state
 * @param {[number, number]} [wires=[0, 1]]
 * @returns {number}
 */
export function concurrence(state, wires = [0, 1]) {
  const rho = reducedDensityMatrix(state, wires);
  const yy = C.kron(gateMatrix('Y'), gateMatrix('Y'));
  const tilde = C.multiplyAll(yy, C.conjugate(rho), yy);
  const sq = C.sqrtPsd(rho);
  const { values } = C.hermitianEigen(C.multiplyAll(sq, tilde, sq));
  const l = Array.from(values, (x) => Math.sqrt(Math.max(0, x))).sort((a, b) => b - a);
  return Math.max(0, l[0] - l[1] - l[2] - l[3]);
}

/**
 * Purity Tr(rho^2).
 * @param {StateLike} state
 * @returns {number}
 */
export function purity(state) {
  const s = describeState(state);
  if (s.pure) return 1;
  let p = 0;
  for (let k = 0; k < s.rho.re.length; k++) p += s.rho.re[k] ** 2 + s.rho.im[k] ** 2;
  return p;
}

function innerProduct(a, b) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.re.length; i++) {
    re += a.re[i] * b.re[i] + a.im[i] * b.im[i];
    im += a.re[i] * b.im[i] - a.im[i] * b.re[i];
  }
  return { re, im };
}

function braKet(amps, rho) {
  const d = rho.rows;
  let f = 0;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      const rr = rho.re[i * d + j];
      const ri = rho.im[i * d + j];
      const tr = rr * amps.re[j] - ri * amps.im[j];
      const ti = rr * amps.im[j] + ri * amps.re[j];
      f += amps.re[i] * tr + amps.im[i] * ti;
    }
  }
  return f;
}

/**
 * Fidelity between two states, in the squared (Uhlmann-Jozsa) convention:
 * |<a|b>|^2 for pure states, <psi|rho|psi> for pure against mixed, and
 * (Tr sqrt(sqrt(rho) sigma sqrt(rho)))^2 for two mixed states.
 * @param {StateLike} a
 * @param {StateLike} b
 * @returns {number} Between 0 and 1.
 */
export function fidelity(a, b) {
  const sa = describeState(a);
  const sb = describeState(b);
  if (sa.numQubits !== sb.numQubits) throw new Error('fidelity: states have different qubit counts');
  if (sa.pure && sb.pure) {
    const ip = innerProduct(sa, sb);
    return ip.re * ip.re + ip.im * ip.im;
  }
  if (sa.pure) return braKet(sa, sb.rho);
  if (sb.pure) return braKet(sb, sa.rho);
  const sq = C.sqrtPsd(sa.rho);
  const { values } = C.hermitianEigen(C.multiplyAll(sq, sb.rho, sq));
  let t = 0;
  for (const v of values) t += Math.sqrt(Math.max(0, v));
  return t * t;
}

/**
 * Trace distance (1/2) ||rho - sigma||_1.
 * @param {StateLike} a
 * @param {StateLike} b
 * @returns {number} Between 0 and 1.
 */
export function traceDistance(a, b) {
  const { values } = C.hermitianEigen(C.subtract(densityMatrixOf(a), densityMatrixOf(b)));
  let s = 0;
  for (const v of values) s += Math.abs(v);
  return s / 2;
}

/**
 * Expectation value of a Pauli observable.
 * @param {StateLike} state
 * @param {PauliSpec} pauli
 * @returns {number}
 */
export function pauliExpectation(state, pauli) {
  const s = describeState(state);
  const p = parsePauli(pauli, s.numQubits);
  let sum = 0;
  if (s.pure) {
    for (let i = 0; i < s.re.length; i++) {
      const j = i ^ p.xMask;
      const [fr, fi] = pauliPhase(p, i);
      sum += s.re[j] * (fr * s.re[i] - fi * s.im[i]) + s.im[j] * (fr * s.im[i] + fi * s.re[i]);
    }
    return sum;
  }
  const d = s.rho.rows;
  for (let i = 0; i < d; i++) {
    const k = i * d + (i ^ p.xMask);
    const [fr, fi] = pauliPhase(p, i);
    sum += s.rho.re[k] * fr - s.rho.im[k] * fi;
  }
  return sum;
}

/**
 * Variance of a Pauli observable: 1 - <P>^2, since P^2 = I.
 * @param {StateLike} state
 * @param {PauliSpec} pauli
 * @returns {number}
 */
export function pauliVariance(state, pauli) {
  const e = pauliExpectation(state, pauli);
  return Math.max(0, 1 - e * e);
}

/**
 * Expectation value <O> of a Hermitian observable acting on `wires`.
 * @param {StateLike} state
 * @param {CMatrix} observable 2^k x 2^k, wires[0] its least significant qubit.
 * @param {number[]} wires
 * @returns {number}
 */
export function expectationValue(state, observable, wires) {
  const s = describeState(state);
  checkWires(wires, s.numQubits, 'expectationValue');
  if (observable.rows !== 1 << wires.length) throw new Error('Observable size does not match the wires');
  if (s.pure) {
    const re = Float64Array.from(s.re);
    const im = Float64Array.from(s.im);
    applyMatrix(re, im, s.numQubits, observable, wires);
    return innerProduct(s, { re, im }).re;
  }
  return C.trace(C.multiply(C.partialTrace(s.rho, s.numQubits, wires), observable)).re;
}

/**
 * Variance <O^2> - <O>^2 of a Hermitian observable on `wires`.
 * @param {StateLike} state
 * @param {CMatrix} observable
 * @param {number[]} wires
 * @returns {number}
 */
export function observableVariance(state, observable, wires) {
  const e = expectationValue(state, observable, wires);
  return Math.max(0, expectationValue(state, C.multiply(observable, observable), wires) - e * e);
}

/**
 * Commutator [A, B] = AB - BA.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @returns {CMatrix}
 */
export function commutator(a, b) {
  return C.subtract(C.multiply(a, b), C.multiply(b, a));
}

/**
 * Anticommutator {A, B} = AB + BA.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @returns {CMatrix}
 */
export function anticommutator(a, b) {
  return C.add(C.multiply(a, b), C.multiply(b, a));
}

const AXES = ['X', 'Y', 'Z'];

function unit3(v) {
  const n = Math.hypot(...v);
  return n < 1e-12 ? [0, 0, 1] : v.map((x) => x / n);
}

/**
 * CHSH Bell value S = E(a,b) + E(a,b') + E(a',b) - E(a',b') for two qubits,
 * where E(u, v) = <(u . sigma) (x) (v . sigma)>. Classical theories give
 * |S| <= 2; a Bell state reaches 2 sqrt(2).
 *
 * Without angles, returns the optimum over all measurement directions
 * (Horodecki: 2 sqrt(m1 + m2) with m1, m2 the two largest eigenvalues of
 * T^T T) and directions achieving it. With angles, each observable is
 * cos(t) Z + sin(t) X in the X-Z plane.
 * @param {StateLike} state
 * @param {{wires?: [number, number], angles?: {a: number, a2: number, b: number, b2: number}}} [options]
 * @returns {{value: number, correlation: number[][], directions: {a: number[], a2: number[], b: number[], b2: number[]}}}
 */
export function chsh(state, options = {}) {
  const wires = options.wires ?? [0, 1];
  const rho = reducedDensityMatrix(state, wires);
  // T[i][j] = <sigma_i on wires[0], sigma_j on wires[1]>; in the reduced
  // state wires[0] is qubit 0, the rightmost letter of the Pauli string.
  const t = AXES.map((pa) => AXES.map((pb) => pauliExpectation(rho, pb + pa)));
  const apply = (v) => t.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const corr = (u, v) => {
    const tv = apply(v);
    return u[0] * tv[0] + u[1] * tv[1] + u[2] * tv[2];
  };
  let dirs;
  if (options.angles) {
    const d = (x) => [Math.sin(x), 0, Math.cos(x)];
    const { a, a2, b, b2 } = options.angles;
    dirs = { a: d(a), a2: d(a2), b: d(b), b2: d(b2) };
  } else {
    const m = C.zeros(3);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += t[k][i] * t[k][j];
        m.re[i * 3 + j] = s;
      }
    }
    const { values, vectors } = C.hermitianEigen(m);
    const col = (k) => [0, 1, 2].map((i) => vectors.re[i * 3 + k]);
    const l1 = Math.max(0, values[2]);
    const l2 = Math.max(0, values[1]);
    const c1 = col(2);
    const c2 = col(1);
    const ang = Math.atan2(Math.sqrt(l2), Math.sqrt(l1));
    const b = c1.map((x, i) => Math.cos(ang) * x + Math.sin(ang) * c2[i]);
    const b2 = c1.map((x, i) => Math.cos(ang) * x - Math.sin(ang) * c2[i]);
    const sum = b.map((x, i) => x + b2[i]);
    const diff = b.map((x, i) => x - b2[i]);
    dirs = { a: unit3(apply(sum)), a2: unit3(apply(diff)), b, b2 };
  }
  const value = corr(dirs.a, dirs.b) + corr(dirs.a, dirs.b2) + corr(dirs.a2, dirs.b) - corr(dirs.a2, dirs.b2);
  return { value, correlation: t, directions: dirs };
}

/**
 * Born rule for a projector on `wires`: probability p = <psi|P|psi> (or
 * Tr(P rho)) and the normalized post-measurement state P|psi>/sqrt(p) (or
 * P rho P / p). The projector can be a matrix or a bitstring (MSB first
 * over `wires`, so its rightmost character is wires[0]).
 * @param {StateLike} state
 * @param {CMatrix|string} projector
 * @param {number[]} wires
 * @returns {{probability: number, state: {re: Float64Array, im: Float64Array}|CMatrix|null}}
 *   `state` is null when the probability is zero.
 */
export function bornRule(state, projector, wires) {
  const s = describeState(state);
  checkWires(wires, s.numQubits, 'bornRule');
  let proj = projector;
  if (typeof projector === 'string') {
    if (!/^[01]+$/.test(projector) || projector.length !== wires.length) {
      throw new Error(`Projector bitstring "${projector}" must have one 0/1 per wire`);
    }
    proj = C.zeros(1 << wires.length);
    const k = parseInt(projector, 2);
    proj.re[k * proj.cols + k] = 1;
  }
  if (s.pure) {
    const re = Float64Array.from(s.re);
    const im = Float64Array.from(s.im);
    applyMatrix(re, im, s.numQubits, proj, wires);
    let p = 0;
    for (let i = 0; i < re.length; i++) p += re[i] * re[i] + im[i] * im[i];
    if (p < 1e-15) return { probability: 0, state: null };
    const inv = 1 / Math.sqrt(p);
    for (let i = 0; i < re.length; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
    return { probability: p, state: { re, im } };
  }
  const sim = DensityMatrixSimulator.fromMatrix(s.rho);
  sim.conjugateBy(proj, wires);
  const p = sim.trace();
  if (p < 1e-15) return { probability: 0, state: null };
  return { probability: p, state: C.scale(sim.densityMatrix(), 1 / p) };
}

/**
 * Point at fraction t along the Fubini-Study geodesic between two pure
 * states (the global phase of b is aligned to a first). t = 0 gives a,
 * t = 1 gives b up to global phase.
 * @param {StateLike} a Pure state.
 * @param {StateLike} b Pure state.
 * @param {number} t
 * @returns {{re: Float64Array, im: Float64Array}}
 */
export function geodesic(a, b, t) {
  const sa = describeState(a);
  const sb = describeState(b);
  if (!sa.pure || !sb.pure) throw new Error('geodesic needs pure states');
  if (sa.numQubits !== sb.numQubits) throw new Error('geodesic: states have different qubit counts');
  const ip = innerProduct(sa, sb);
  const mag = Math.hypot(ip.re, ip.im);
  // Rotate b by the conjugate phase of <a|b> so the overlap is real and positive.
  const pr = mag > 1e-15 ? ip.re / mag : 1;
  const pi = mag > 1e-15 ? -ip.im / mag : 0;
  const omega = Math.acos(Math.min(1, mag));
  const wa = omega < 1e-9 ? 1 - t : Math.sin((1 - t) * omega) / Math.sin(omega);
  const wb = omega < 1e-9 ? t : Math.sin(t * omega) / Math.sin(omega);
  const n = sa.re.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const br = sb.re[i] * pr - sb.im[i] * pi;
    const bi = sb.re[i] * pi + sb.im[i] * pr;
    re[i] = wa * sa.re[i] + wb * br;
    im[i] = wa * sa.im[i] + wb * bi;
    norm += re[i] * re[i] + im[i] * im[i];
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] *= inv;
  }
  return { re, im };
}
