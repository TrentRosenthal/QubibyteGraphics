/**
 * Aaronson-Gottesman (CHP) stabilizer tableau simulator. Clifford circuits
 * on thousands of qubits run in polynomial time: gates cost O(n), a
 * measurement O(n^2 / 32) with bit-packed rows.
 *
 * Tableau rows 0..n-1 are destabilizers, rows n..2n-1 stabilizers, row 2n
 * is scratch. Each row stores x and z bits packed in 32-bit words and a sign
 * bit r. The pair (x, z) = (1, 1) on a qubit denotes Y.
 *
 * @module quantum/stabilizer
 */

import { popcount } from './pauli.js';
import { checkWires } from './gates.js';
import { createRng } from './rng.js';

/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('../qubi/ir.js').Circuit} Circuit */
/** @typedef {import('./rng.js').Rng} Rng */

const ONE_QUBIT = new Set(['I', 'H', 'S', 'SDG', 'X', 'Y', 'Z']);
const TWO_QUBIT_CONTROLLED = new Set(['CX', 'CY', 'CZ']);

/**
 * True when an op is supported by the stabilizer simulator.
 * @param {Op} op
 * @returns {boolean}
 */
function isCliffordOp(op) {
  if (op.kind === 'barrier') return true;
  if (op.kind === 'measure' || op.name === 'MEASURE') return true;
  if (op.kind === 'if') {
    return op.branches.every((b) => b.ops.every(isCliffordOp)) && (op.elseOps ?? []).every(isCliffordOp);
  }
  if (op.matrix) return false;
  const controls = op.controls ?? [];
  if (ONE_QUBIT.has(op.name)) return controls.length === 0;
  if (TWO_QUBIT_CONTROLLED.has(op.name)) return controls.length === 1 && op.targets.length === 1;
  if (op.name === 'SWAP') return controls.length === 0 && op.targets.length === 2;
  return false;
}

/**
 * True when every op of the circuit is one the stabilizer simulator runs:
 * H, S, SDG, X, Y, Z, I, CX, CY, CZ (one control), SWAP, MEASURE, barriers,
 * and `if` ops whose branches are Clifford.
 * @param {Circuit|{ops: Op[]}} circuit
 * @returns {boolean}
 */
export function isClifford(circuit) {
  return circuit.ops.every(isCliffordOp);
}

export class StabilizerSimulator {
  /**
   * Starts in |0...0>.
   * @param {number} numQubits
   * @param {{seed?: number}} [options]
   */
  constructor(numQubits, { seed = 1 } = {}) {
    if (!Number.isInteger(numQubits) || numQubits < 1) throw new Error(`Need at least one qubit, got ${numQubits}`);
    /** @type {number} */
    this.numQubits = numQubits;
    /** @type {number} Words per row. */
    this.words = (numQubits + 31) >>> 5;
    const rows = 2 * numQubits + 1;
    /** @type {Uint32Array} */
    this.x = new Uint32Array(rows * this.words);
    /** @type {Uint32Array} */
    this.z = new Uint32Array(rows * this.words);
    /** @type {Uint8Array} */
    this.r = new Uint8Array(rows);
    for (let i = 0; i < numQubits; i++) {
      this.x[i * this.words + (i >>> 5)] |= 1 << (i & 31);
      this.z[(i + numQubits) * this.words + (i >>> 5)] |= 1 << (i & 31);
    }
    /** @type {Rng} */
    this.rng = createRng(seed);
  }

  /**
   * X bit of a tableau row on qubit q.
   * @param {number} row
   * @param {number} q
   * @returns {number}
   */
  xBit(row, q) {
    return (this.x[row * this.words + (q >>> 5)] >>> (q & 31)) & 1;
  }

  /**
   * Z bit of a tableau row on qubit q.
   * @param {number} row
   * @param {number} q
   * @returns {number}
   */
  zBit(row, q) {
    return (this.z[row * this.words + (q >>> 5)] >>> (q & 31)) & 1;
  }

  /** @param {number} a */
  h(a) {
    const w = a >>> 5;
    const s = a & 31;
    for (let i = 0; i < 2 * this.numQubits; i++) {
      const k = i * this.words + w;
      const xb = (this.x[k] >>> s) & 1;
      const zb = (this.z[k] >>> s) & 1;
      this.r[i] ^= xb & zb;
      if (xb !== zb) {
        this.x[k] ^= 1 << s;
        this.z[k] ^= 1 << s;
      }
    }
  }

  /** @param {number} a */
  s(a) {
    const w = a >>> 5;
    const s = a & 31;
    for (let i = 0; i < 2 * this.numQubits; i++) {
      const k = i * this.words + w;
      const xb = (this.x[k] >>> s) & 1;
      const zb = (this.z[k] >>> s) & 1;
      this.r[i] ^= xb & zb;
      if (xb) this.z[k] ^= 1 << s;
    }
  }

  /** @param {number} a */
  sdg(a) {
    const w = a >>> 5;
    const s = a & 31;
    for (let i = 0; i < 2 * this.numQubits; i++) {
      const k = i * this.words + w;
      const xb = (this.x[k] >>> s) & 1;
      const zb = (this.z[k] >>> s) & 1;
      this.r[i] ^= xb & (zb ^ 1);
      if (xb) this.z[k] ^= 1 << s;
    }
  }

  /**
   * Pauli gate on qubit a: flips the sign of rows that anticommute with it.
   * @param {'X'|'Y'|'Z'} p
   * @param {number} a
   */
  pauli(p, a) {
    for (let i = 0; i < 2 * this.numQubits; i++) {
      const xb = this.xBit(i, a);
      const zb = this.zBit(i, a);
      this.r[i] ^= p === 'X' ? zb : p === 'Z' ? xb : xb ^ zb;
    }
  }

  /**
   * @param {number} a Control.
   * @param {number} b Target.
   */
  cx(a, b) {
    const wa = a >>> 5;
    const sa = a & 31;
    const wb = b >>> 5;
    const sb = b & 31;
    for (let i = 0; i < 2 * this.numQubits; i++) {
      const base = i * this.words;
      const xa = (this.x[base + wa] >>> sa) & 1;
      const za = (this.z[base + wa] >>> sa) & 1;
      const xb = (this.x[base + wb] >>> sb) & 1;
      const zb = (this.z[base + wb] >>> sb) & 1;
      this.r[i] ^= xa & zb & (xb ^ za ^ 1);
      if (xa) this.x[base + wb] ^= 1 << sb;
      if (zb) this.z[base + wa] ^= 1 << sa;
    }
  }

  /**
   * @param {number} a
   * @param {number} b
   */
  swap(a, b) {
    for (let i = 0; i < 2 * this.numQubits; i++) {
      for (const arr of [this.x, this.z]) {
        const base = i * this.words;
        const va = (arr[base + (a >>> 5)] >>> (a & 31)) & 1;
        const vb = (arr[base + (b >>> 5)] >>> (b & 31)) & 1;
        if (va !== vb) {
          arr[base + (a >>> 5)] ^= 1 << (a & 31);
          arr[base + (b >>> 5)] ^= 1 << (b & 31);
        }
      }
    }
  }

  /**
   * Row h becomes the product of rows i and h, with the phase tracked
   * exactly (the CHP rowsum).
   * @param {number} h
   * @param {number} i
   */
  rowsum(h, i) {
    let sum = 2 * this.r[h] + 2 * this.r[i];
    const W = this.words;
    for (let w = 0; w < W; w++) {
      const x1 = this.x[i * W + w];
      const z1 = this.z[i * W + w];
      const x2 = this.x[h * W + w];
      const z2 = this.z[h * W + w];
      const plus = (x1 & z1 & z2 & ~x2) | (x1 & ~z1 & z2 & x2) | (~x1 & z1 & x2 & ~z2);
      const minus = (x1 & z1 & x2 & ~z2) | (x1 & ~z1 & z2 & ~x2) | (~x1 & z1 & x2 & z2);
      sum += popcount(plus) - popcount(minus);
      this.x[h * W + w] = x2 ^ x1;
      this.z[h * W + w] = z2 ^ z1;
    }
    this.r[h] = ((sum % 4) + 4) % 4 === 0 ? 0 : 1;
  }

  /**
   * @param {number} dst
   * @param {number} src
   */
  copyRow(dst, src) {
    const W = this.words;
    this.x.copyWithin(dst * W, src * W, src * W + W);
    this.z.copyWithin(dst * W, src * W, src * W + W);
    this.r[dst] = this.r[src];
  }

  /** @param {number} row */
  clearRow(row) {
    const W = this.words;
    this.x.fill(0, row * W, row * W + W);
    this.z.fill(0, row * W, row * W + W);
    this.r[row] = 0;
  }

  /**
   * True when measuring `a` has a determined outcome.
   * @param {number} a
   * @returns {boolean}
   */
  isDeterministic(a) {
    for (let p = this.numQubits; p < 2 * this.numQubits; p++) if (this.xBit(p, a)) return false;
    return true;
  }

  /**
   * Measures one qubit in the computational basis and collapses.
   * @param {number} a
   * @param {Rng} [rng]
   * @returns {number}
   */
  measureQubit(a, rng = this.rng) {
    const n = this.numQubits;
    let p = -1;
    for (let row = n; row < 2 * n; row++) {
      if (this.xBit(row, a)) {
        p = row;
        break;
      }
    }
    if (p >= 0) {
      for (let i = 0; i < 2 * n; i++) if (i !== p && this.xBit(i, a)) this.rowsum(i, p);
      this.copyRow(p - n, p);
      this.clearRow(p);
      this.z[p * this.words + (a >>> 5)] |= 1 << (a & 31);
      const outcome = rng() < 0.5 ? 1 : 0;
      this.r[p] = outcome;
      return outcome;
    }
    const scratch = 2 * n;
    this.clearRow(scratch);
    for (let i = 0; i < n; i++) if (this.xBit(i, a)) this.rowsum(scratch, i + n);
    return this.r[scratch];
  }

  /**
   * @param {number[]} wires
   * @param {Rng} [rng]
   * @returns {number[]}
   */
  measure(wires, rng = this.rng) {
    checkWires(wires, this.numQubits, 'MEASURE');
    return wires.map((w) => this.measureQubit(w, rng));
  }

  /**
   * Applies a Clifford op (see {@link isClifford}); measurements return bits.
   * @param {Op} op
   * @param {Rng} [rng]
   * @returns {number[]|undefined}
   */
  applyOp(op, rng) {
    if (op.kind === 'measure' || op.name === 'MEASURE') return this.measure(op.targets, rng);
    if (op.kind === 'if') throw new Error('An if op needs classical registers; use executeCircuit');
    if (!isCliffordOp(op)) {
      throw new Error(`The stabilizer simulator runs Clifford gates only (H S SDG X Y Z I CX CY CZ SWAP); got ${op.name}`);
    }
    if (op.kind === 'barrier') return undefined;
    const controls = op.controls ?? [];
    checkWires([...controls, ...op.targets], this.numQubits, op.name);
    const [t, t2] = op.targets;
    switch (op.name) {
      case 'I': break;
      case 'H': op.targets.forEach((q) => this.h(q)); break;
      case 'S': op.targets.forEach((q) => this.s(q)); break;
      case 'SDG': op.targets.forEach((q) => this.sdg(q)); break;
      case 'X': case 'Y': case 'Z': op.targets.forEach((q) => this.pauli(op.name, q)); break;
      case 'CX': this.cx(controls[0], t); break;
      case 'CZ': this.h(t); this.cx(controls[0], t); this.h(t); break;
      case 'CY': this.sdg(t); this.cx(controls[0], t); this.s(t); break;
      default: this.swap(t, t2);
    }
    return undefined;
  }

  /**
   * The stabilizer generators as signed Pauli strings, MSB first (the
   * rightmost letter acts on qubit 0), for example `"+XX"`, `"-ZZ"`.
   * @returns {string[]}
   */
  stabilizers() {
    const n = this.numQubits;
    const out = [];
    for (let row = n; row < 2 * n; row++) {
      let s = this.r[row] ? '-' : '+';
      for (let q = n - 1; q >= 0; q--) {
        const xb = this.xBit(row, q);
        const zb = this.zBit(row, q);
        s += xb && zb ? 'Y' : xb ? 'X' : zb ? 'Z' : 'I';
      }
      out.push(s);
    }
    return out;
  }
}
