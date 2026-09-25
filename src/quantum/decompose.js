/**
 * Unitaries of circuits and their decompositions: circuit to unitary (whole
 * or step by step for animation), ZYZ and other Euler forms of one-qubit
 * gates, an exact decomposition of any two-qubit unitary into three CX plus
 * one-qubit U gates (magic-basis KAK), controlled one-qubit gates as two CX
 * plus rotations, and fractional powers of unitaries so animations can
 * sweep a gate's action continuously.
 *
 * @module quantum/decompose
 */

import * as C from './cmatrix.js';
import { gateMatrix, opActions, checkWires } from './gates.js';
import { applyMatrix } from './kernel.js';

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */
/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('../qubi/ir.js').Circuit} Circuit */

/**
 * Builds a gate op.
 * @param {string} name
 * @param {number[]} targets
 * @param {number[]} [params=[]]
 * @param {number[]} [controls=[]]
 * @returns {Op}
 */
export function gateOp(name, targets, params = [], controls = []) {
  return { kind: 'gate', name, targets, controls, params };
}

function checkUnitaryCircuit(circuit, fn) {
  circuit.ops.forEach((op, i) => {
    if (op.kind !== 'gate' && op.kind !== 'barrier') {
      throw new Error(`${fn} needs a circuit without measurements or if ops; op ${i} is ${op.kind === 'if' ? 'an if' : op.name}`);
    }
  });
  if (circuit.numQubits > 12) throw new Error(`${fn} is limited to 12 qubits (got ${circuit.numQubits})`);
}

function columnsToMatrix(cols) {
  const n = cols.length;
  const m = C.zeros(n, n);
  cols.forEach((col, k) => {
    for (let i = 0; i < n; i++) {
      m.re[i * n + k] = col.re[i];
      m.im[i * n + k] = col.im[i];
    }
  });
  return m;
}

function unitaryColumns(numQubits) {
  const dim = 1 << numQubits;
  return Array.from({ length: dim }, (_, k) => {
    const re = new Float64Array(dim);
    re[k] = 1;
    return { re, im: new Float64Array(dim) };
  });
}

function applyToColumns(cols, numQubits, op) {
  for (const a of opActions(op)) {
    checkWires([...a.targets, ...a.controls], numQubits, op.name);
    for (const col of cols) applyMatrix(col.re, col.im, numQubits, a.matrix, a.targets, a.controls);
  }
}

/**
 * The unitary a circuit implements, built column by column: column k is the
 * state the circuit produces from basis state |k>.
 * @param {Circuit|{numQubits: number, ops: Op[]}} circuit Gates and barriers only.
 * @returns {CMatrix}
 */
export function circuitUnitary(circuit) {
  checkUnitaryCircuit(circuit, 'circuitUnitary');
  const cols = unitaryColumns(circuit.numQubits);
  for (const op of circuit.ops) applyToColumns(cols, circuit.numQubits, op);
  return columnsToMatrix(cols);
}

/**
 * Running products of a circuit's unitary, for animating how the operator
 * builds up. Entry 0 is the identity (before any op, `opIndex` -1); entry
 * k + 1 is the product after ops[0..k].
 * @param {Circuit|{numQubits: number, ops: Op[]}} circuit Gates and barriers only.
 * @returns {Array<{opIndex: number, op: Op|null, unitary: CMatrix}>}
 */
export function unitarySteps(circuit) {
  checkUnitaryCircuit(circuit, 'unitarySteps');
  const cols = unitaryColumns(circuit.numQubits);
  const out = [{ opIndex: -1, op: null, unitary: columnsToMatrix(cols) }];
  circuit.ops.forEach((op, i) => {
    applyToColumns(cols, circuit.numQubits, op);
    out.push({ opIndex: i, op, unitary: columnsToMatrix(cols) });
  });
  return out;
}

function wrapAngle(a) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * ZYZ decomposition of a one-qubit unitary:
 * U = e^{i phase} RZ(beta) RY(gamma) RZ(delta).
 * @param {CMatrix} u 2x2 unitary.
 * @returns {{phase: number, beta: number, gamma: number, delta: number}}
 */
export function decomposeZYZ(u) {
  if (u.rows !== 2 || u.cols !== 2) throw new Error('decomposeZYZ needs a 2x2 matrix');
  const det = C.determinant(u);
  const phase = Math.atan2(det.im, det.re) / 2;
  // V = e^{-i phase} U has determinant 1.
  const v = C.scale(u, Math.cos(phase), -Math.sin(phase));
  const a00 = Math.hypot(v.re[0], v.im[0]);
  const a10 = Math.hypot(v.re[2], v.im[2]);
  const gamma = 2 * Math.atan2(a10, a00);
  const argSum = 2 * Math.atan2(v.im[3], v.re[3]);
  const argDiff = 2 * Math.atan2(v.im[2], v.re[2]);
  let beta;
  let delta;
  if (a10 < 1e-12) {
    beta = argSum;
    delta = 0;
  } else if (a00 < 1e-12) {
    beta = argDiff;
    delta = 0;
  } else {
    beta = (argSum + argDiff) / 2;
    delta = (argSum - argDiff) / 2;
  }
  beta = wrapAngle(beta);
  delta = wrapAngle(delta);
  // Halving the phase angles leaves a sign ambiguity; fix it against U itself.
  const rebuilt = C.multiplyAll(gateMatrix('RZ', [beta]), gateMatrix('RY', [gamma]), gateMatrix('RZ', [delta]));
  const overlap = C.trace(C.multiply(C.adjoint(rebuilt), v));
  const fixedPhase = overlap.re < 0 ? phase + Math.PI : phase;
  return { phase: wrapAngle(fixedPhase), beta, gamma, delta };
}

/**
 * Parameters of Qubi's U gate for a one-qubit unitary:
 * matrix = e^{i phase} U(theta, phi, lambda).
 * @param {CMatrix} u 2x2 unitary.
 * @returns {{theta: number, phi: number, lambda: number, phase: number}}
 */
export function uGateParams(u) {
  const { phase, beta, gamma, delta } = decomposeZYZ(u);
  return { theta: gamma, phi: beta, lambda: delta, phase: wrapAngle(phase - (beta + delta) / 2) };
}

const PAULI = { X: gateMatrix('X'), Y: gateMatrix('Y'), Z: gateMatrix('Z') };

function pauliSign(m, axis) {
  if (C.equals(m, PAULI[axis], 1e-12)) return 1;
  if (C.equals(m, C.scale(PAULI[axis], -1), 1e-12)) return -1;
  return 0;
}

const eulerFrames = new Map();

/**
 * Finds a Clifford W with W Z W^dagger = sA sigma_outer and
 * W Y W^dagger = sB sigma_inner, by breadth-first search over words in H and S.
 */
function eulerFrame(outer, inner) {
  const key = outer + inner;
  if (eulerFrames.has(key)) return eulerFrames.get(key);
  const gens = [gateMatrix('H'), gateMatrix('S')];
  let layer = [C.identity(2)];
  for (let depth = 0; depth < 7; depth++) {
    for (const w of layer) {
      const wd = C.adjoint(w);
      const sA = pauliSign(C.multiplyAll(w, PAULI.Z, wd), outer);
      const sB = pauliSign(C.multiplyAll(w, PAULI.Y, wd), inner);
      if (sA && sB) {
        const frame = { w, sA, sB };
        eulerFrames.set(key, frame);
        return frame;
      }
    }
    layer = layer.flatMap((w) => gens.map((g) => C.multiply(g, w)));
  }
  throw new Error(`No Euler frame for ${key}`);
}

/**
 * Euler decomposition of a one-qubit unitary about two rotation axes:
 * U = e^{i phase} R_outer(a) R_inner(b) R_outer(c) for a basis such as
 * 'ZYZ', 'ZXZ', 'XYX', 'XZX', 'YZY', 'YXY'. `ops` lists the rotations in
 * time order (R_outer(c) first).
 * @param {CMatrix} u 2x2 unitary.
 * @param {string} [basis='ZYZ']
 * @param {number} [wire=0] Wire for the returned ops.
 * @returns {{basis: string, phase: number, angles: [number, number, number], ops: Op[]}}
 */
export function eulerDecompose(u, basis = 'ZYZ', wire = 0) {
  const b = basis.toUpperCase();
  if (!/^[XYZ]{3}$/.test(b) || b[0] !== b[2] || b[0] === b[1]) {
    throw new Error(`Euler basis must look like ZYZ or XZX, got "${basis}"`);
  }
  const { w, sA, sB } = eulerFrame(b[0], b[1]);
  const z = decomposeZYZ(C.multiplyAll(C.adjoint(w), u, w));
  const angles = [sA * z.beta, sB * z.gamma, sA * z.delta];
  const ops = [gateOp('R' + b[0], [wire], [angles[2]]), gateOp('R' + b[1], [wire], [angles[1]]), gateOp('R' + b[0], [wire], [angles[0]])];
  return { basis: b, phase: z.phase, angles, ops };
}

/**
 * Controlled one-qubit gate as two CX plus rotations (the standard A X B X C
 * construction). The ops reproduce the controlled matrix exactly, including
 * the relative phase, which lands on the control as a P gate.
 * @param {CMatrix} v 2x2 unitary applied to `target` when `control` is 1.
 * @param {number} control
 * @param {number} target
 * @returns {Op[]} Time-ordered RZ, RY, CX, P ops.
 */
export function decomposeControlled(v, control, target) {
  const { phase, beta, gamma, delta } = decomposeZYZ(v);
  const rot = (name, angle) => (Math.abs(wrapAngle(angle)) > 1e-12 ? [gateOp(name, [target], [angle])] : []);
  return [
    ...rot('RZ', (delta - beta) / 2),
    gateOp('CX', [target], [], [control]),
    ...rot('RZ', -(delta + beta) / 2),
    ...rot('RY', -gamma / 2),
    gateOp('CX', [target], [], [control]),
    ...rot('RY', gamma / 2),
    ...rot('RZ', beta),
    ...(Math.abs(wrapAngle(phase)) > 1e-12 ? [gateOp('P', [control], [phase])] : []),
  ];
}

const S2 = Math.SQRT1_2;
/** Magic basis: M^dagger (A kron B) M is real orthogonal for A, B in SU(2). */
const MAGIC = C.scale(C.fromArray([[1, [0, 1], 0, 0], [0, 0, [0, 1], 1], [0, 0, [0, 1], -1], [1, [0, -1], 0, 0]]), S2);
const MAGIC_DAG = C.adjoint(MAGIC);
/** Diagonals of M^dagger XX M, M^dagger YY M, M^dagger ZZ M. */
const MAGIC_XX = [1, -1, 1, -1];
const MAGIC_YY = [-1, 1, 1, -1];
const MAGIC_ZZ = [1, 1, -1, -1];

/** Real symmetric eigenvectors of a symmetric unitary via Re + alpha Im. */
function realOrthogonalEigenvectors(m) {
  for (const alpha of [0.5772156649015329, 1.4142135623730951, 0.3183098861837907]) {
    const h = C.zeros(4);
    for (let k = 0; k < 16; k++) h.re[k] = m.re[k] + alpha * m.im[k];
    const vecs = C.hermitianEigen(h).vectors;
    const p = C.zeros(4);
    for (let k = 0; k < 16; k++) p.re[k] = vecs.re[k];
    // Gram-Schmidt to remove rounding drift.
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < j; i++) {
        let dot = 0;
        for (let k = 0; k < 4; k++) dot += p.re[k * 4 + i] * p.re[k * 4 + j];
        for (let k = 0; k < 4; k++) p.re[k * 4 + j] -= dot * p.re[k * 4 + i];
      }
      let nrm = 0;
      for (let k = 0; k < 4; k++) nrm += p.re[k * 4 + j] ** 2;
      nrm = Math.sqrt(nrm);
      for (let k = 0; k < 4; k++) p.re[k * 4 + j] /= nrm;
    }
    const d = C.multiplyAll(C.transpose(p), m, p);
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) off += d.re[i * 4 + j] ** 2 + d.im[i * 4 + j] ** 2;
    if (off < 1e-18) return { p, d };
  }
  throw new Error('Two-qubit decomposition failed to diagonalize; the matrix may not be unitary');
}

/**
 * Splits a 4x4 matrix that is a tensor product into its factors:
 * m = kron(a, b) with a on the high qubit and b on the low qubit.
 * Both factors come back unitary with determinant 1 when m is local.
 */
function splitKron(m) {
  let best = -1;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      let s = 0;
      for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) s += Math.hypot(m.re[(2 * i + k) * 4 + 2 * j + l], m.im[(2 * i + k) * 4 + 2 * j + l]) ** 2;
      if (s > best) {
        best = s;
        bi = i;
        bj = j;
      }
    }
  }
  const block = (i, j) => {
    const out = C.zeros(2);
    for (let k = 0; k < 2; k++) {
      for (let l = 0; l < 2; l++) {
        out.re[k * 2 + l] = m.re[(2 * i + k) * 4 + 2 * j + l];
        out.im[k * 2 + l] = m.im[(2 * i + k) * 4 + 2 * j + l];
      }
    }
    return out;
  };
  let b = block(bi, bj);
  const det = C.determinant(b);
  const mag = Math.sqrt(Math.hypot(det.re, det.im));
  const ang = Math.atan2(det.im, det.re) / 2;
  b = C.scale(b, Math.cos(-ang) / mag, Math.sin(-ang) / mag);
  const bd = C.adjoint(b);
  const a = C.zeros(2);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const t = C.trace(C.multiply(bd, block(i, j)));
      a.re[i * 2 + j] = t.re / 2;
      a.im[i * 2 + j] = t.im / 2;
    }
  }
  return { a, b };
}

/**
 * Exact decomposition of a two-qubit unitary into at most three CX and
 * one-qubit U gates, by the magic-basis (KAK) method:
 * U = (A1 kron B1) exp(i(a XX + b YY + c ZZ)) (A2 kron B2), with the
 * nonlocal core realized by three CX and rotations.
 * @param {CMatrix} u 4x4 unitary on `wires` (wires[0] is its least significant qubit).
 * @param {[number, number]} [wires=[0, 1]]
 * @returns {{ops: Op[], phase: number, cxCount: number}} The ops multiply to e^{-i phase} u,
 *   that is u = e^{i phase} (product of ops).
 */
export function decomposeTwoQubit(u, wires = [0, 1]) {
  if (u.rows !== 4 || u.cols !== 4) throw new Error('decomposeTwoQubit needs a 4x4 matrix');
  if (!C.isUnitary(u, 1e-8)) throw new Error('decomposeTwoQubit needs a unitary matrix');
  const det = C.determinant(u);
  const q = Math.atan2(det.im, det.re) / 4;
  const su = C.scale(u, Math.cos(q), -Math.sin(q));
  const up = C.multiplyAll(MAGIC_DAG, su, MAGIC);
  const { p, d } = realOrthogonalEigenvectors(C.multiply(C.transpose(up), up));
  if (C.determinant(p).re < 0) for (let k = 0; k < 4; k++) p.re[k * 4] = -p.re[k * 4];
  const theta = [0, 1, 2, 3].map((i) => Math.atan2(d.im[i * 5], d.re[i * 5]) / 2);
  const kOf = () => {
    const dinv = C.zeros(4);
    theta.forEach((t, i) => {
      dinv.re[i * 5] = Math.cos(t);
      dinv.im[i * 5] = -Math.sin(t);
    });
    return C.multiplyAll(up, p, dinv);
  };
  let k = kOf();
  if (C.determinant(k).re < 0) {
    theta[0] += Math.PI;
    k = kOf();
  }
  const left = splitKron(C.multiplyAll(MAGIC, k, MAGIC_DAG));
  const right = splitKron(C.multiplyAll(MAGIC, C.transpose(p), MAGIC_DAG));
  // theta_i = g + a XX_i + b YY_i + c ZZ_i; the sign patterns are orthogonal.
  const coef = (pattern) => theta.reduce((s, t, i) => s + t * pattern[i], 0) / 4;
  const a = coef(MAGIC_XX);
  const b = coef(MAGIC_YY);
  const c = coef(MAGIC_ZZ);
  const [w0, w1] = wires;
  const h = Math.PI / 2;
  const raw = [
    { m: right.b, w: w0 },
    { m: right.a, w: w1 },
    { m: gateMatrix('RZ', [-h]), w: w0 },
    { cx: [w0, w1] },
    { m: gateMatrix('RZ', [-2 * c - h]), w: w1 },
    { m: gateMatrix('RY', [2 * a + h]), w: w0 },
    { cx: [w1, w0] },
    { m: gateMatrix('RY', [-2 * b - h]), w: w0 },
    { cx: [w0, w1] },
    { m: gateMatrix('RZ', [h]), w: w1 },
    { m: left.b, w: w0 },
    { m: left.a, w: w1 },
  ];
  const ops = [];
  const pending = new Map();
  const flush = (w) => {
    const m = pending.get(w);
    if (!m) return;
    pending.delete(w);
    const par = uGateParams(m);
    if (Math.abs(par.theta) < 1e-12 && Math.abs(wrapAngle(par.phi + par.lambda)) < 1e-12) return;
    ops.push(gateOp('U', [w], [par.theta, par.phi, par.lambda]));
  };
  for (const step of raw) {
    if (step.cx) {
      flush(step.cx[0]);
      flush(step.cx[1]);
      ops.push(gateOp('CX', [step.cx[1]], [], [step.cx[0]]));
    } else {
      pending.set(step.w, pending.has(step.w) ? C.multiply(step.m, pending.get(step.w)) : step.m);
    }
  }
  flush(w0);
  flush(w1);
  const local = { numQubits: 2, ops: ops.map((o) => ({ ...o, targets: o.targets.map((t) => (t === w0 ? 0 : 1)), controls: o.controls.map((t) => (t === w0 ? 0 : 1)) })) };
  const v = circuitUnitary(local);
  const tr = C.trace(C.multiply(C.adjoint(v), u));
  return { ops, phase: Math.atan2(tr.im, tr.re), cxCount: 3 };
}

/**
 * Fractional power U^t of a unitary through its eigen-decomposition, using
 * the principal branch of each eigenphase (in (-pi, pi]). U^0 = I and
 * U^1 = U; intermediate t traces a continuous path, so an animated Bloch
 * vector sweeps instead of jumping.
 * @param {CMatrix} u
 * @param {number} t
 * @returns {CMatrix}
 */
export function unitaryPath(u, t) {
  const { values, vectors } = C.unitaryEigen(u);
  const n = u.rows;
  const d = C.zeros(n);
  for (let i = 0; i < n; i++) {
    let ang = Math.atan2(values.im[i], values.re[i]);
    if (ang <= -Math.PI + 1e-12) ang = Math.PI;
    d.re[i * n + i] = Math.cos(t * ang);
    d.im[i * n + i] = Math.sin(t * ang);
  }
  return C.multiplyAll(vectors, d, C.adjoint(vectors));
}
