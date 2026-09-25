/**
 * Standard library expansions. Every call expands into native Qubi gates; the
 * evaluator wraps the result in a group so the renderer can draw one labeled
 * box or expand it.
 *
 * Conventions:
 * - Qubit 0 is the least significant bit. A register given as wires `w`
 *   holds the integer sum of bit(w[k]) * 2**k, so `w[0]` is its LSB.
 * - Multi-controlled gates are single ops with a `controls` list (`CX [c1,c2,t]`
 *   is one op with controls [c1,c2]); they are never decomposed.
 * - Rotations with controls (RY in StatePreparation and W) are `RY` ops with a
 *   `controls` list; the IR allows controls on any gate.
 * - Angles are radians in the returned ops.
 *
 * Signatures (arguments in brackets are optional):
 *
 * | Call | Meaning |
 * | --- | --- |
 * | `Bell([wires])` | H then CX on two wires, default (0,1): an equal superposition of 00 and 11 |
 * | `GHZ([wires])` | H then a CX chain, default (0,1,2) |
 * | `W([wires])` | W state (one excitation spread evenly), default (0,1,2) |
 * | `Superdense(message, [wires])` | 2-bit message (0b00 to 0b11) through a Bell pair on two wires, default (0,1); the wires end in the message, bit 0 on the first wire |
 * | `Teleport([wires])` | moves the state of wire 0 to wire 2 (default (0,1,2)), corrections as CX/CZ from the measured wires (deferred measurement) |
 * | `Deutsch([oracle], [wires])` | oracle "constant0", "constant1", "balanced" (f(x)=x, default) or "balanced-inverted" (f(x)=not x); wires (x, y) default (0,1); x ends in 1 for balanced, 0 for constant |
 * | `BV(secret, [wires])` | Bernstein-Vazirani with a phase oracle; the wires end in the secret |
 * | `Grover(marked, [iterations], [wires])` | marked bitstring (or a list of them); qubits = bit width; iterations default round(pi/(4*asin(sqrt(M/N))) - 1/2), which is round(pi/4*sqrt(N/M)) for large N |
 * | `QFT(wires)` / `IQFT(wires)` | quantum Fourier transform (and inverse), H and CP with swaps at the end |
 * | `Shor([N], [a], [counting], [wires])` | order finding for N = 15, a in {2,4,7,8,11,13,14} (default 7), counting qubits default 3; wires hold the counting register then the 4-qubit work register |
 * | `PhaseKickback(kind, [wires])` | kind "CX" or "CZ"; wires (control, target) default (0,1); the control ends in 1 |
 * | `PhaseOracle(marked, [wires])` | flips the sign of the marked basis state(s) |
 * | `SwapTest(["similar"], [wires])` | ancilla then two equal registers, default (0,1,2); "similar" first prepares two close states |
 * | `StatePreparation(states, [probabilities], [wires])` | basis states (bitstring or list) with probabilities; the rest goes to the all-zero state |
 * | `StatePreparation(name, [wires])` | name "bell", "ghz", or "superposition" |
 * | `QubitPreparation(probabilities, [wires])` | RY(2*asin(sqrt(p))) per qubit, so each qubit reads 1 with probability p |
 * | `BitFlip([error], [wires])` | 3-qubit bit-flip code on (data, a1, a2) default (0,1,2): encode, X on code qubit `error` (0 to 2, or -1 for none, default -1), decode, correct with CX [a1,a2,data] |
 * | `QPE(angle, [counting], [wires])` | phase estimation of P(angle) (angle in CodeAngleUnit) with counting qubits (default 3) then the target; the counting register reads angle/(2*pi) * 2**counting |
 * | `Stego(secret, ["hide"or"reveal"], [wires])` | hides a bitstring in the phases of a uniform superposition; "reveal" (default "hide") appends the decoding H layer |
 *
 * @module qubi/stdlib
 */

import { Bits, RegisterVal } from './values.js';

/**
 * Names of the standard library calls.
 * @type {ReadonlyArray<string>}
 */
export const STDLIB_NAMES = Object.freeze([
  'Bell', 'GHZ', 'W', 'Superdense', 'Teleport', 'Deutsch', 'BV', 'Grover', 'QFT', 'IQFT', 'Shor',
  'PhaseKickback', 'PhaseOracle', 'SwapTest', 'StatePreparation', 'QubitPreparation', 'BitFlip', 'QPE', 'Stego',
]);

const EPS = 1e-12;
const MAX_PREP_QUBITS = 16;

/**
 * @typedef {Object} OpSpec
 * @property {string} name
 * @property {number[]} targets
 * @property {number[]} controls
 * @property {number[]} params Radians.
 */

/**
 * @typedef {Object} StdlibContext
 * @property {(msg: string) => never} fail Throw an error at the call site.
 * @property {(value: number) => number} angle Convert a CodeAngleUnit number to radians.
 */

const g = (name, targets, params = [], controls = []) => ({ name, targets, controls, params });

function range(n, from = 0) {
  return Array.from({ length: n }, (_, k) => from + k);
}

function isWireish(v) {
  return typeof v === 'number' || Array.isArray(v) || v instanceof RegisterVal;
}

function toWires(v, ctx, who) {
  const out = [];
  const walk = (x) => {
    if (x instanceof RegisterVal) x.wires.forEach(walk);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'number' && Number.isInteger(x) && x >= 0) out.push(x);
    else ctx.fail(`${who} takes wires as whole numbers, such as (0,1,2)`);
  };
  walk(v);
  if (new Set(out).size !== out.length) ctx.fail(`${who} lists a wire twice`);
  return out;
}

function wiresOr(v, def, ctx, who) {
  return v === undefined ? def : toWires(v, ctx, who);
}

function needCount(w, n, ctx, who, example) {
  if (w.length !== n) ctx.fail(`${who} takes ${n} wires, as in ${example}`);
}

function tooMany(args, n, ctx, who) {
  if (args.length > n) ctx.fail(`${who} takes at most ${n} argument${n === 1 ? '' : 's'}`);
}

/** Multi-controlled version of X, Z, or P; no controls gives the plain gate. */
function mc(base, controls, target, params = []) {
  if (!controls.length) return g(base, [target], params);
  return g('C' + base, [target], params, controls);
}

function bellOps(w) {
  return [g('H', [w[0]]), g('CX', [w[1]], [], [w[0]])];
}

function ghzOps(w) {
  const ops = [g('H', [w[0]])];
  for (let k = 1; k < w.length; k++) ops.push(g('CX', [w[k]], [], [w[k - 1]]));
  return ops;
}

function wOps(w) {
  const n = w.length;
  const ops = [g('X', [w[0]])];
  for (let k = 1; k < n; k++) {
    const theta = 2 * Math.acos(Math.sqrt(1 / (n - k + 1)));
    ops.push(g('RY', [w[k]], [theta], [w[k - 1]]));
    ops.push(g('CX', [w[k - 1]], [], [w[k]]));
  }
  return ops;
}

/** QFT with LSB = w[0]: |x> -> sum_k e^{2 pi i x k / 2^n} |k> / sqrt(2^n). */
function qftOps(w) {
  const n = w.length;
  const ops = [];
  for (let j = n - 1; j >= 0; j--) {
    ops.push(g('H', [w[j]]));
    for (let m = j - 1; m >= 0; m--) ops.push(g('CP', [w[j]], [Math.PI / 2 ** (j - m)], [w[m]]));
  }
  for (let k = 0; k < Math.floor(n / 2); k++) ops.push(g('SWAP', [w[k], w[n - 1 - k]]));
  return ops;
}

function inverse(ops) {
  return ops.slice().reverse().map((op) => ({ ...op, params: op.params.map((p) => -p) }));
}

function markedStates(v, ctx, who) {
  const list = Array.isArray(v) ? v : [v];
  if (!list.length || !list.every((b) => b instanceof Bits)) {
    ctx.fail(`${who} takes a bitstring literal for the marked state, as in ${who}(0b110)`);
  }
  const width = list[0].width;
  if (list.some((b) => b.width !== width)) ctx.fail(`${who}: marked states need the same bit width`);
  const values = list.map((b) => b.value);
  if (new Set(values).size !== values.length) ctx.fail(`${who} lists a marked state twice`);
  return { width, values };
}

function oracleOps(values, w) {
  const n = w.length;
  const ops = [];
  for (const m of values) {
    const zeros = w.filter((_, q) => Math.floor(m / 2 ** q) % 2 === 0);
    zeros.forEach((q) => ops.push(g('X', [q])));
    ops.push(mc('Z', w.slice(0, n - 1), w[n - 1]));
    zeros.forEach((q) => ops.push(g('X', [q])));
  }
  return ops;
}

function diffusionOps(w) {
  const n = w.length;
  return [
    ...w.map((q) => g('H', [q])),
    ...w.map((q) => g('X', [q])),
    mc('Z', w.slice(0, n - 1), w[n - 1]),
    ...w.map((q) => g('X', [q])),
    ...w.map((q) => g('H', [q])),
  ];
}

function bitsOrInt(v, ctx, who, example) {
  if (v instanceof Bits) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return new Bits(v, Math.max(1, Math.ceil(Math.log2(v + 1))));
  }
  return ctx.fail(`${who} takes a bitstring, as in ${example}`);
}

/**
 * Uniformly controlled RY cascade that prepares real, non-negative amplitudes.
 * Qubit n-1 (MSB of the register) is rotated first; each lower qubit is rotated
 * once per value of the qubits above it, with X on the controls that must read 0.
 */
function amplitudeOps(amp, w) {
  const n = w.length;
  const ops = [];
  for (let q = n - 1; q >= 0; q--) {
    const prefixes = 2 ** (n - 1 - q);
    for (let h = 0; h < prefixes; h++) {
      let p0 = 0;
      let p1 = 0;
      const block = 2 ** q;
      for (let low = 0; low < block; low++) {
        const x0 = h * 2 * block + low;
        p0 += amp[x0] ** 2;
        p1 += amp[x0 + block] ** 2;
      }
      if (p0 + p1 < EPS) continue;
      const theta = 2 * Math.atan2(Math.sqrt(p1), Math.sqrt(p0));
      if (Math.abs(theta) < EPS) continue;
      const controls = range(n - 1 - q, q + 1).map((k) => w[k]);
      const flips = controls.filter((_, j) => Math.floor(h / 2 ** j) % 2 === 0);
      flips.forEach((c) => ops.push(g('X', [c])));
      ops.push(g('RY', [w[q]], [theta], controls));
      flips.forEach((c) => ops.push(g('X', [c])));
    }
  }
  return ops;
}

function statePreparation(args, ctx) {
  const who = 'StatePreparation';
  if (!args.length) ctx.fail(`${who} needs states, as in ${who}(0b101, 0.4) or ${who}("bell")`);
  if (typeof args[0] === 'string') {
    tooMany(args, 2, ctx, who);
    const kind = args[0].toLowerCase();
    if (kind === 'bell') {
      const w = wiresOr(args[1], [0, 1], ctx, who);
      needCount(w, 2, ctx, who, `${who}("bell", (0,1))`);
      return bellOps(w);
    }
    if (kind === 'ghz') {
      const w = wiresOr(args[1], [0, 1, 2], ctx, who);
      if (w.length < 2) ctx.fail(`${who}("ghz") needs at least 2 wires`);
      return ghzOps(w);
    }
    if (kind === 'superposition') {
      const w = wiresOr(args[1], [0, 1, 2], ctx, who);
      return w.map((q) => g('H', [q]));
    }
    return ctx.fail(`${who} names are "bell", "ghz", and "superposition"`);
  }
  tooMany(args, 3, ctx, who);
  const stateList = Array.isArray(args[0]) ? args[0] : [args[0]];
  if (!stateList.length || !stateList.every((s) => s instanceof Bits)) {
    ctx.fail(`${who} takes bitstrings such as 0b101 or (0b101..0b111)`);
  }
  let probs;
  if (args[1] === undefined) {
    probs = stateList.map(() => 1 / stateList.length);
  } else {
    probs = Array.isArray(args[1]) ? args[1] : [args[1]];
    if (!probs.every((p) => typeof p === 'number' && p >= 0 && p <= 1)) ctx.fail(`${who} probabilities are numbers from 0 to 1`);
    if (probs.length !== stateList.length) ctx.fail(`${who} got ${stateList.length} states but ${probs.length} probabilities`);
  }
  const width = Math.max(...stateList.map((s) => s.width));
  const w = args[2] === undefined ? range(width) : toWires(args[2], ctx, who);
  if (w.length < width) ctx.fail(`${who} states are ${width} bits wide but only ${w.length} wires were given`);
  const n = w.length;
  if (n > MAX_PREP_QUBITS) ctx.fail(`${who} prepares at most ${MAX_PREP_QUBITS} qubits`);
  const values = stateList.map((s) => s.value);
  if (new Set(values).size !== values.length) ctx.fail(`${who} lists a state twice`);
  const total = probs.reduce((a, b) => a + b, 0);
  if (total > 1 + 1e-9) ctx.fail(`${who} probabilities add up to ${Number(total.toFixed(6))}, more than 1`);
  const p = new Float64Array(2 ** n);
  values.forEach((v, k) => { p[v] = probs[k]; });
  p[0] += Math.max(0, 1 - total);
  const nonzero = [...p.keys()].filter((x) => p[x] > EPS);
  if (nonzero.length === 1) {
    const x = nonzero[0];
    return w.filter((_, q) => Math.floor(x / 2 ** q) % 2 === 1).map((q) => g('X', [q]));
  }
  return amplitudeOps(Array.from(p, Math.sqrt), w);
}

function shor(args, ctx) {
  const who = 'Shor';
  tooMany(args, 4, ctx, who);
  const [N = 15, a = 7, t = 3, wv] = args;
  if (N !== 15) ctx.fail(`${who} supports the toy modulus N = 15`);
  const allowed = [2, 4, 7, 8, 11, 13, 14];
  if (!allowed.includes(a)) ctx.fail(`${who}: a must be coprime with 15 and one of ${allowed.join(', ')}`);
  if (!Number.isInteger(t) || t < 1 || t > 8) ctx.fail(`${who}: counting qubits must be a whole number from 1 to 8`);
  const w = wiresOr(wv, range(t + 4), ctx, who);
  needCount(w, t + 4, ctx, who, `${who}(15, 7, ${t}, 0..${t + 3})`);
  const count = w.slice(0, t);
  const work = w.slice(t);
  const ops = count.map((q) => g('H', [q]));
  ops.push(g('X', [work[0]]));
  const shift = { 1: 0, 2: 1, 4: 2, 8: 3, 7: 3, 11: 2, 13: 1, 14: 0 };
  const negate = new Set([7, 11, 13, 14]);
  let m = a;
  for (let k = 0; k < t; k++) {
    const c = count[k];
    for (let s = 0; s < shift[m]; s++) {
      ops.push(g('CSWAP', [work[2], work[3]], [], [c]));
      ops.push(g('CSWAP', [work[1], work[2]], [], [c]));
      ops.push(g('CSWAP', [work[0], work[1]], [], [c]));
    }
    if (negate.has(m)) work.forEach((q) => ops.push(g('CX', [q], [], [c])));
    m = (m * m) % 15;
  }
  ops.push(...inverse(qftOps(count)));
  return ops;
}

const EXPANDERS = {
  Bell(args, ctx) {
    tooMany(args, 2, ctx, 'Bell');
    const w = args.length === 2 ? toWires(args, ctx, 'Bell') : wiresOr(args[0], [0, 1], ctx, 'Bell');
    needCount(w, 2, ctx, 'Bell', 'Bell(0,1)');
    return bellOps(w);
  },
  GHZ(args, ctx) {
    const w = args.length > 1 ? toWires(args, ctx, 'GHZ') : wiresOr(args[0], [0, 1, 2], ctx, 'GHZ');
    if (w.length < 2) ctx.fail('GHZ needs at least 2 wires, as in GHZ(0..3)');
    return ghzOps(w);
  },
  W(args, ctx) {
    const w = args.length > 1 ? toWires(args, ctx, 'W') : wiresOr(args[0], [0, 1, 2], ctx, 'W');
    if (w.length < 2) ctx.fail('W needs at least 2 wires, as in W(0..2)');
    return wOps(w);
  },
  Superdense(args, ctx) {
    tooMany(args, 2, ctx, 'Superdense');
    if (args[0] === undefined) ctx.fail('Superdense needs a 2-bit message, as in Superdense(0b10)');
    const msg = bitsOrInt(args[0], ctx, 'Superdense', 'Superdense(0b10)');
    if (msg.value > 3) ctx.fail('Superdense sends 2 bits: 0b00, 0b01, 0b10, or 0b11');
    const w = wiresOr(args[1], [0, 1], ctx, 'Superdense');
    needCount(w, 2, ctx, 'Superdense', 'Superdense(0b10, (0,1))');
    const [a, b] = w;
    const ops = bellOps(w);
    if (msg.bit(1)) ops.push(g('X', [a]));
    if (msg.bit(0)) ops.push(g('Z', [a]));
    ops.push(g('CX', [b], [], [a]), g('H', [a]));
    return ops;
  },
  Teleport(args, ctx) {
    tooMany(args, 1, ctx, 'Teleport');
    const w = wiresOr(args[0], [0, 1, 2], ctx, 'Teleport');
    needCount(w, 3, ctx, 'Teleport', 'Teleport(0..2)');
    const [src, alice, bob] = w;
    return [
      g('H', [alice]), g('CX', [bob], [], [alice]),
      g('CX', [alice], [], [src]), g('H', [src]),
      g('CX', [bob], [], [alice]), g('CZ', [bob], [], [src]),
    ];
  },
  Deutsch(args, ctx) {
    tooMany(args, 2, ctx, 'Deutsch');
    let oracle = 'balanced';
    let rest = args;
    if (typeof args[0] === 'string') {
      oracle = args[0];
      rest = args.slice(1);
    }
    const kinds = ['constant0', 'constant1', 'balanced', 'balanced-inverted'];
    if (!kinds.includes(oracle)) ctx.fail(`Deutsch oracles are "${kinds.join('", "')}"`);
    const w = wiresOr(rest[0], [0, 1], ctx, 'Deutsch');
    needCount(w, 2, ctx, 'Deutsch', 'Deutsch("balanced", (0,1))');
    const [x, y] = w;
    const ops = [g('X', [y]), g('H', [x]), g('H', [y])];
    if (oracle === 'constant1') ops.push(g('X', [y]));
    if (oracle.startsWith('balanced')) ops.push(g('CX', [y], [], [x]));
    if (oracle === 'balanced-inverted') ops.push(g('X', [y]));
    ops.push(g('H', [x]));
    return ops;
  },
  BV(args, ctx) {
    tooMany(args, 2, ctx, 'BV');
    if (args[0] === undefined) ctx.fail('BV needs a secret bitstring, as in BV(0b1011)');
    const s = bitsOrInt(args[0], ctx, 'BV', 'BV(0b1011)');
    const w = wiresOr(args[1], range(s.width), ctx, 'BV');
    if (w.length < s.width) ctx.fail(`BV secret is ${s.width} bits wide but only ${w.length} wires were given`);
    return [
      ...w.map((q) => g('H', [q])),
      ...w.filter((_, q) => s.bit(q)).map((q) => g('Z', [q])),
      ...w.map((q) => g('H', [q])),
    ];
  },
  Grover(args, ctx) {
    tooMany(args, 3, ctx, 'Grover');
    if (args[0] === undefined) ctx.fail('Grover needs the marked state, as in Grover(0b110)');
    const { width, values } = markedStates(args[0], ctx, 'Grover');
    const theta = Math.asin(Math.sqrt(values.length / 2 ** width));
    let iterations = Math.max(1, Math.round(Math.PI / (4 * theta) - 0.5));
    let wv;
    if (args.length >= 2) {
      if (typeof args[1] === 'number' && args.length === 3) {
        iterations = args[1];
        wv = args[2];
      } else if (typeof args[1] === 'number' && args.length === 2) {
        iterations = args[1];
      } else {
        wv = args[1];
      }
    }
    if (!Number.isInteger(iterations) || iterations < 0) ctx.fail('Grover iterations must be a whole number of 0 or more');
    const w = wiresOr(wv, range(width), ctx, 'Grover');
    needCount(w, width, ctx, 'Grover', `Grover(0b${'0'.repeat(width)}, ${iterations}, 0..${width - 1})`);
    const ops = w.map((q) => g('H', [q]));
    for (let k = 0; k < iterations; k++) ops.push(...oracleOps(values, w), ...diffusionOps(w));
    return ops;
  },
  QFT(args, ctx) {
    if (!args.length) ctx.fail('QFT needs wires, as in QFT(0..4)');
    return qftOps(toWires(args, ctx, 'QFT'));
  },
  IQFT(args, ctx) {
    if (!args.length) ctx.fail('IQFT needs wires, as in IQFT(0..2)');
    return inverse(qftOps(toWires(args, ctx, 'IQFT')));
  },
  Shor: shor,
  PhaseKickback(args, ctx) {
    tooMany(args, 2, ctx, 'PhaseKickback');
    const kind = args[0];
    if (kind !== 'CX' && kind !== 'CZ') ctx.fail('PhaseKickback takes "CX" or "CZ"');
    const w = wiresOr(args[1], [0, 1], ctx, 'PhaseKickback');
    needCount(w, 2, ctx, 'PhaseKickback', 'PhaseKickback("CX", (0,1))');
    const [c, t] = w;
    if (kind === 'CX') {
      return [g('H', [c]), g('X', [t]), g('H', [t]), g('CX', [t], [], [c]), g('H', [c])];
    }
    return [g('H', [c]), g('X', [t]), g('CZ', [t], [], [c]), g('H', [c])];
  },
  PhaseOracle(args, ctx) {
    tooMany(args, 2, ctx, 'PhaseOracle');
    if (args[0] === undefined) ctx.fail('PhaseOracle needs the marked state, as in PhaseOracle(0b101)');
    const { width, values } = markedStates(args[0], ctx, 'PhaseOracle');
    const w = wiresOr(args[1], range(width), ctx, 'PhaseOracle');
    needCount(w, width, ctx, 'PhaseOracle', `PhaseOracle(0b${'1'.repeat(width)}, 0..${width - 1})`);
    return oracleOps(values, w);
  },
  SwapTest(args, ctx) {
    tooMany(args, 2, ctx, 'SwapTest');
    let similar = false;
    let wv;
    for (const a of args) {
      if (typeof a === 'string') {
        if (a !== 'similar') ctx.fail('SwapTest option is "similar"');
        similar = true;
      } else if (isWireish(a)) {
        wv = a;
      } else {
        ctx.fail('SwapTest takes wires and the option "similar"');
      }
    }
    const w = wiresOr(wv, [0, 1, 2], ctx, 'SwapTest');
    if (w.length < 3 || w.length % 2 === 0) ctx.fail('SwapTest takes an ancilla and two equal registers: 3, 5, 7, ... wires');
    const k = (w.length - 1) / 2;
    const anc = w[0];
    const A = w.slice(1, 1 + k);
    const B = w.slice(1 + k);
    const ops = [];
    if (similar) {
      A.forEach((q) => ops.push(g('RY', [q], [0.4 * Math.PI])));
      B.forEach((q) => ops.push(g('RY', [q], [0.5 * Math.PI])));
    }
    ops.push(g('H', [anc]));
    A.forEach((q, j) => ops.push(g('CSWAP', [q, B[j]], [], [anc])));
    ops.push(g('H', [anc]));
    return ops;
  },
  StatePreparation: statePreparation,
  QubitPreparation(args, ctx) {
    tooMany(args, 2, ctx, 'QubitPreparation');
    if (args[0] === undefined) ctx.fail('QubitPreparation needs probabilities, as in QubitPreparation((0.2, 0.5, 0.8))');
    const ps = Array.isArray(args[0]) ? args[0] : [args[0]];
    if (!ps.every((p) => typeof p === 'number' && p >= 0 && p <= 1)) ctx.fail('QubitPreparation probabilities are numbers from 0 to 1');
    const w = wiresOr(args[1], range(ps.length), ctx, 'QubitPreparation');
    if (w.length !== ps.length) ctx.fail(`QubitPreparation got ${ps.length} probabilities but ${w.length} wires`);
    return ps.map((p, k) => ({ p, q: w[k] })).filter(({ p }) => p > 0)
      .map(({ p, q }) => g('RY', [q], [2 * Math.asin(Math.sqrt(p))]));
  },
  BitFlip(args, ctx) {
    tooMany(args, 2, ctx, 'BitFlip');
    const err = args[0] === undefined ? -1 : args[0];
    if (!Number.isInteger(err) || err < -1 || err > 2) ctx.fail('BitFlip error position is 0, 1, 2, or -1 for none');
    const w = wiresOr(args[1], [0, 1, 2], ctx, 'BitFlip');
    needCount(w, 3, ctx, 'BitFlip', 'BitFlip(1, (0,1,2))');
    const [d, a1, a2] = w;
    const ops = [g('CX', [a1], [], [d]), g('CX', [a2], [], [d])];
    if (err >= 0) ops.push(g('X', [w[err]]));
    ops.push(g('CX', [a1], [], [d]), g('CX', [a2], [], [d]), g('CX', [d], [], [a1, a2]));
    return ops;
  },
  QPE(args, ctx) {
    tooMany(args, 3, ctx, 'QPE');
    if (typeof args[0] !== 'number') ctx.fail('QPE needs the phase angle of P, as in QPE(0.5, 3)');
    const phi = ctx.angle(args[0]);
    const t = args[1] === undefined ? 3 : args[1];
    if (!Number.isInteger(t) || t < 1 || t > 12) ctx.fail('QPE counting qubits must be a whole number from 1 to 12');
    const w = wiresOr(args[2], range(t + 1), ctx, 'QPE');
    needCount(w, t + 1, ctx, 'QPE', `QPE(0.5, ${t}, 0..${t})`);
    const count = w.slice(0, t);
    const target = w[t];
    const ops = [g('X', [target]), ...count.map((q) => g('H', [q]))];
    count.forEach((q, k) => ops.push(g('CP', [target], [phi * 2 ** k], [q])));
    ops.push(...inverse(qftOps(count)));
    return ops;
  },
  Stego(args, ctx) {
    tooMany(args, 3, ctx, 'Stego');
    if (args[0] === undefined) ctx.fail('Stego needs a secret bitstring, as in Stego(0b101)');
    const s = bitsOrInt(args[0], ctx, 'Stego', 'Stego(0b101)');
    let mode = 'hide';
    let wv;
    for (const a of args.slice(1)) {
      if (typeof a === 'string') {
        if (a !== 'hide' && a !== 'reveal') ctx.fail('Stego mode is "hide" or "reveal"');
        mode = a;
      } else {
        wv = a;
      }
    }
    const w = wiresOr(wv, range(s.width), ctx, 'Stego');
    if (w.length < s.width) ctx.fail(`Stego secret is ${s.width} bits wide but only ${w.length} wires were given`);
    const ops = [...w.map((q) => g('H', [q])), ...w.filter((_, q) => s.bit(q)).map((q) => g('Z', [q]))];
    if (mode === 'reveal') ops.push(...w.map((q) => g('H', [q])));
    return ops;
  },
};

/**
 * Expand a standard library call into native gate ops.
 * @param {string} name One of {@link STDLIB_NAMES}.
 * @param {any[]} args Evaluated Qubi values (numbers, Bits, strings, lists, registers).
 * @param {StdlibContext} ctx
 * @returns {OpSpec[]}
 */
export function expandStdlib(name, args, ctx) {
  return EXPANDERS[name](args, ctx);
}
