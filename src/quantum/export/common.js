/**
 * Helpers shared by the exporters: angle text, classical bit layout for
 * measurements, and flattening ops through the lowering pass.
 *
 * @module quantum/export/common
 */

import { lowerOp } from '../lower.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

/**
 * Angle as text: a short multiple of pi (`pi/4`, `-3*pi/2`) when exact,
 * otherwise the shortest round-trip decimal.
 * @param {number} x Radians.
 * @returns {string}
 */
export function piAngle(x) {
  for (const d of [1, 2, 3, 4, 6, 8, 12, 16]) {
    const k = Math.round((x * d) / Math.PI);
    if (Math.abs(x - (k * Math.PI) / d) < 1e-12) {
      if (k === 0) return '0';
      const num = k === 1 ? 'pi' : k === -1 ? '-pi' : `${k}*pi`;
      return d === 1 ? num : `${num}/${d}`;
    }
  }
  return String(x);
}

/**
 * Classical bit for each measured wire. An op register `c[2]` writes bits
 * from index 2 of `c`; a register `m` writes from index 0 of `m`; a
 * measurement without a register writes wire w to bit w of `c`.
 * @param {Op} op A measurement op.
 * @returns {Array<{wire: number, reg: string, bit: number}>}
 */
export function measurementBits(op) {
  if (!op.register) return op.targets.map((w) => ({ wire: w, reg: 'c', bit: w }));
  const m = /^(.*)\[(\d+)\]$/.exec(op.register);
  const reg = m ? m[1] : op.register;
  const offset = m ? Number(m[2]) : 0;
  return op.targets.map((w, k) => ({ wire: w, reg, bit: offset + k }));
}

/**
 * Sizes of every classical register the circuit's measurements write.
 * @param {Op[]} ops
 * @returns {Map<string, number>}
 */
export function classicalRegisters(ops) {
  const regs = new Map();
  for (const op of ops) {
    if (op.kind !== 'measure' && op.name !== 'MEASURE') continue;
    for (const { reg, bit } of measurementBits(op)) regs.set(reg, Math.max(regs.get(reg) ?? 0, bit + 1));
  }
  return regs;
}

/**
 * Flattens a circuit's ops into ops the format supports. `if` ops are
 * rejected: the target formats' classical control does not match Qubi's
 * conditions.
 * @param {Circuit} circuit
 * @param {(op: Op) => boolean} supports
 * @param {string} formatName
 * @returns {Op[]}
 */
export function exportableOps(circuit, supports, formatName) {
  const out = [];
  circuit.ops.forEach((op, i) => {
    if (op.kind === 'if') throw new Error(`${formatName}: op ${i} is a classical if, which is not exported`);
    out.push(...lowerOp(op, supports, formatName));
  });
  return out;
}
