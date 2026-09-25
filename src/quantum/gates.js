/**
 * Gate matrices, defined in exactly one place. Every simulator, the unitary
 * builder, and the exporters get their matrices from here.
 *
 * A gate matrix acts on the op's targets in order: targets[0] is the least
 * significant qubit of the small matrix. Controls are never part of the
 * matrix; a controlled op applies its base gate on basis states where every
 * control is 1.
 *
 * @module quantum/gates
 */

import { GATE_INFO } from '../qubi/ir.js';
import { fromArray } from './cmatrix.js';

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */
/** @typedef {import('../qubi/ir.js').Op} Op */

/**
 * One matrix application produced from an op.
 * @typedef {Object} Action
 * @property {CMatrix} matrix Acts on `targets`, targets[0] least significant.
 * @property {number[]} targets
 * @property {number[]} controls
 */

const R = Math.SQRT1_2;

/** Base gate of each controlled name. */
const CONTROLLED_BASE = Object.freeze({ CX: 'X', CY: 'Y', CZ: 'Z', CP: 'P', CSWAP: 'SWAP' });

const FIXED = {
  I: [[1, 0], [0, 1]],
  H: [[R, R], [R, -R]],
  X: [[0, 1], [1, 0]],
  Y: [[0, [0, -1]], [[0, 1], 0]],
  Z: [[1, 0], [0, -1]],
  S: [[1, 0], [0, [0, 1]]],
  SDG: [[1, 0], [0, [0, -1]]],
  T: [[1, 0], [0, [R, R]]],
  TDG: [[1, 0], [0, [R, -R]]],
  SWAP: [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]],
  ISWAP: [[1, 0, 0, 0], [0, 0, [0, 1], 0], [0, [0, 1], 0, 0], [0, 0, 0, 1]],
  SQRTSWAP: [
    [1, 0, 0, 0],
    [0, [0.5, 0.5], [0.5, -0.5], 0],
    [0, [0.5, -0.5], [0.5, 0.5], 0],
    [0, 0, 0, 1],
  ],
};

const fixedCache = new Map();

/**
 * The base gate a (possibly controlled) Qubi gate name applies to its
 * targets: CX gives X, CZ gives Z, CP gives P, CSWAP gives SWAP, CY gives Y.
 * Other names are returned unchanged.
 * @param {string} name
 * @returns {string}
 */
export function baseGateName(name) {
  return CONTROLLED_BASE[name] ?? name;
}

/**
 * Matrix of a native Qubi gate on its targets. Controlled names return their
 * base gate (CX returns X). Missing angle parameters take the gate's default
 * from GATE_INFO (pi/2 for RX, RY, RZ, P, CP).
 *
 * - RX(t) = exp(-i t X / 2), RY(t) = exp(-i t Y / 2), RZ(t) = diag(e^{-it/2}, e^{it/2})
 * - P(l) = diag(1, e^{il})
 * - U(theta, phi, lambda) = [[cos(theta/2), -e^{i lambda} sin(theta/2)],
 *   [e^{i phi} sin(theta/2), e^{i(phi+lambda)} cos(theta/2)]]
 *
 * @param {string} name Qubi gate name.
 * @param {number[]} [params=[]] Angles in radians.
 * @returns {CMatrix}
 */
export function gateMatrix(name, params = []) {
  const base = baseGateName(name);
  if (FIXED[base]) {
    if (!fixedCache.has(base)) fixedCache.set(base, fromArray(FIXED[base]));
    return fixedCache.get(base);
  }
  const info = GATE_INFO[base];
  if (!info || base === 'MEASURE' || base === 'SWAPSEQ') {
    throw new Error(`No matrix for gate "${name}"`);
  }
  const p = params.length ? params : info.defaultParams ?? [];
  if (p.length < info.params) {
    throw new Error(`Gate ${name} needs ${info.params} angle parameter${info.params === 1 ? '' : 's'}, got ${p.length}`);
  }
  const c = (t) => Math.cos(t);
  const s = (t) => Math.sin(t);
  switch (base) {
    case 'RX': {
      const h = p[0] / 2;
      return fromArray([[c(h), [0, -s(h)]], [[0, -s(h)], c(h)]]);
    }
    case 'RY': {
      const h = p[0] / 2;
      return fromArray([[c(h), -s(h)], [s(h), c(h)]]);
    }
    case 'RZ': {
      const h = p[0] / 2;
      return fromArray([[[c(h), -s(h)], 0], [0, [c(h), s(h)]]]);
    }
    case 'P':
      return fromArray([[1, 0], [0, [c(p[0]), s(p[0])]]]);
    case 'U': {
      const [theta, phi, lam] = p;
      const ct = c(theta / 2);
      const st = s(theta / 2);
      return fromArray([
        [ct, [-c(lam) * st, -s(lam) * st]],
        [[c(phi) * st, s(phi) * st], [c(phi + lam) * ct, s(phi + lam) * ct]],
      ]);
    }
    default:
      throw new Error(`No matrix for gate "${name}"`);
  }
}

/**
 * Checks that wires are integers in range and pairwise distinct.
 * @param {number[]} wires
 * @param {number} numQubits
 * @param {string} what Description for error messages.
 */
export function checkWires(wires, numQubits, what) {
  const seen = new Set();
  for (const w of wires) {
    if (!Number.isInteger(w) || w < 0 || w >= numQubits) {
      throw new Error(`${what}: wire ${w} is outside the ${numQubits}-qubit register`);
    }
    if (seen.has(w)) throw new Error(`${what}: wire ${w} is used twice`);
    seen.add(w);
  }
}

/**
 * Resolves a gate op into matrix applications. Handles user matrices,
 * SWAPSEQ (a SWAP per mirrored pair of target wires), broadcast of
 * one-qubit gates over several targets, and controls. Barriers resolve to
 * nothing.
 * @param {Op} op
 * @returns {Action[]}
 */
export function opActions(op) {
  if (op.kind === 'barrier') return [];
  if (op.kind !== 'gate') throw new Error(`Op kind "${op.kind}" has no matrix`);
  const controls = op.controls ?? [];
  const targets = op.targets ?? [];
  if (op.matrix) {
    if (op.matrix.rows !== 1 << targets.length || op.matrix.cols !== op.matrix.rows) {
      throw new Error(`Gate ${op.name}: a ${op.matrix.rows}x${op.matrix.cols} matrix does not fit ${targets.length} target wire(s)`);
    }
    return [{ matrix: op.matrix, targets, controls }];
  }
  if (op.name === 'SWAPSEQ') {
    const swap = gateMatrix('SWAP');
    const out = [];
    for (let i = 0, j = targets.length - 1; i < j; i++, j--) {
      out.push({ matrix: swap, targets: [targets[i], targets[j]], controls });
    }
    return out;
  }
  const info = GATE_INFO[op.name];
  if (info && info.controlled && controls.length === 0) {
    throw new Error(`Gate ${op.name} needs at least one control wire`);
  }
  const matrix = gateMatrix(op.name, op.params ?? []);
  const width = Math.log2(matrix.rows);
  if (width === 1 && targets.length > 1) {
    return targets.map((t) => ({ matrix, targets: [t], controls }));
  }
  if (targets.length !== width) {
    throw new Error(`Gate ${op.name} acts on ${width} target wire(s), got ${targets.length}`);
  }
  return [{ matrix, targets, controls }];
}
