/**
 * Small dense statevector reference used only by the parser tests to check
 * that evaluated circuits (stdlib expansions in particular) are correct.
 * It is written independently of the product simulator.
 *
 * Conventions match src/qubi/ir.js: qubit q is bit q of the basis index.
 * Gate matrices: RX(t) = exp(-i t X / 2), RY(t) = exp(-i t Y / 2),
 * RZ(t) = diag(e^{-it/2}, e^{it/2}), P(l) = diag(1, e^{il}),
 * U(t, p, l) = [[cos(t/2), -e^{il} sin(t/2)], [e^{ip} sin(t/2), e^{i(p+l)} cos(t/2)]].
 * Two-target matrices use targets[0] as the low bit of the matrix index.
 */

const c = (re, im = 0) => ({ re, im });
const eip = (t) => c(Math.cos(t), Math.sin(t));
const S2 = Math.SQRT1_2;

function single(name, p) {
  switch (name) {
    case 'I': return [[c(1), c(0)], [c(0), c(1)]];
    case 'H': return [[c(S2), c(S2)], [c(S2), c(-S2)]];
    case 'X': return [[c(0), c(1)], [c(1), c(0)]];
    case 'Y': return [[c(0), c(0, -1)], [c(0, 1), c(0)]];
    case 'Z': return [[c(1), c(0)], [c(0), c(-1)]];
    case 'S': return [[c(1), c(0)], [c(0), c(0, 1)]];
    case 'SDG': return [[c(1), c(0)], [c(0), c(0, -1)]];
    case 'T': return [[c(1), c(0)], [c(0), eip(Math.PI / 4)]];
    case 'TDG': return [[c(1), c(0)], [c(0), eip(-Math.PI / 4)]];
    case 'RX': return [[c(Math.cos(p[0] / 2)), c(0, -Math.sin(p[0] / 2))], [c(0, -Math.sin(p[0] / 2)), c(Math.cos(p[0] / 2))]];
    case 'RY': return [[c(Math.cos(p[0] / 2)), c(-Math.sin(p[0] / 2))], [c(Math.sin(p[0] / 2)), c(Math.cos(p[0] / 2))]];
    case 'RZ': return [[eip(-p[0] / 2), c(0)], [c(0), eip(p[0] / 2)]];
    case 'P': return [[c(1), c(0)], [c(0), eip(p[0])]];
    case 'U': {
      const [t, ph, l] = p;
      const k = (z, s) => c(z.re * s, z.im * s);
      return [[c(Math.cos(t / 2)), k(eip(l), -Math.sin(t / 2))], [k(eip(ph), Math.sin(t / 2)), k(eip(ph + l), Math.cos(t / 2))]];
    }
    default: return null;
  }
}

function double(name) {
  const I = c(1);
  const O = c(0);
  switch (name) {
    case 'SWAP': return [[I, O, O, O], [O, O, I, O], [O, I, O, O], [O, O, O, I]];
    case 'ISWAP': return [[I, O, O, O], [O, O, c(0, 1), O], [O, c(0, 1), O, O], [O, O, O, I]];
    case 'SQRTSWAP': {
      const a = c(0.5, 0.5);
      const b = c(0.5, -0.5);
      return [[I, O, O, O], [O, a, b, O], [O, b, a, O], [O, O, O, I]];
    }
    default: return null;
  }
}

const BASE = { CX: 'X', CY: 'Y', CZ: 'Z', CP: 'P', CSWAP: 'SWAP' };

function matrixFor(op) {
  if (op.matrix) {
    const n = op.matrix.rows;
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, k) => c(op.matrix.re[r * n + k], op.matrix.im[r * n + k])));
  }
  const name = BASE[op.name] ?? op.name;
  const m = single(name, op.params) ?? double(name);
  if (!m) throw new Error(`refsim has no gate ${op.name}`);
  return m;
}

/** A statevector on n qubits starting in |0...0>. */
export function zeroState(n) {
  const re = new Float64Array(2 ** n);
  const im = new Float64Array(2 ** n);
  re[0] = 1;
  return { n, re, im };
}

/** Apply one gate op in place. */
export function applyOp(state, op) {
  const m = matrixFor(op);
  const t = op.targets;
  const k = t.length;
  const dim = 2 ** k;
  let cmask = 0;
  for (const q of op.controls) cmask |= 1 << q;
  let tmask = 0;
  for (const q of t) tmask |= 1 << q;
  const size = 2 ** state.n;
  const idx = new Array(dim);
  const vre = new Float64Array(dim);
  const vim = new Float64Array(dim);
  for (let base = 0; base < size; base++) {
    if ((base & tmask) !== 0 || (base & cmask) !== cmask) continue;
    for (let j = 0; j < dim; j++) {
      let x = base;
      for (let b = 0; b < k; b++) if ((j >> b) & 1) x |= 1 << t[b];
      idx[j] = x;
      vre[j] = state.re[x];
      vim[j] = state.im[x];
    }
    for (let r = 0; r < dim; r++) {
      let sr = 0;
      let si = 0;
      for (let j = 0; j < dim; j++) {
        const a = m[r][j];
        sr += a.re * vre[j] - a.im * vim[j];
        si += a.re * vim[j] + a.im * vre[j];
      }
      state.re[idx[r]] = sr;
      state.im[idx[r]] = si;
    }
  }
}

/** Run every gate op of a circuit (measurements are skipped) from |0...0>. */
export function simulate(circuit, init) {
  const state = init ?? zeroState(circuit.numQubits);
  for (const op of circuit.ops) {
    if (op.kind === 'gate') applyOp(state, op);
    else if (op.kind !== 'measure') throw new Error(`refsim cannot run ${op.kind} ops`);
  }
  return state;
}

/** Probability of every basis state. */
export function probabilities(state) {
  return Array.from(state.re, (r, i) => r * r + state.im[i] * state.im[i]);
}

/** Probability of the basis state written as a bitstring (MSB first). */
export function probOf(state, bits) {
  return probabilities(state)[parseInt(bits, 2)];
}

/** P(qubit q = 1). */
export function marginal(state, q) {
  return probabilities(state).reduce((acc, p, i) => acc + (((i >> q) & 1) ? p : 0), 0);
}

/** Probability that the listed wires read `value` (wires[k] is bit k of value). */
export function registerProb(state, wires, value) {
  return probabilities(state).reduce((acc, p, i) => {
    const v = wires.reduce((s, w, k) => s + (((i >> w) & 1) << k), 0);
    return acc + (v === value ? p : 0);
  }, 0);
}

/** Amplitude of basis index i as {re, im}. */
export function amplitude(state, i) {
  return { re: state.re[i], im: state.im[i] };
}

/**
 * Execute-mode backend over this simulator. `rng` returns numbers in [0, 1).
 * Measurement collapses the state and returns one bit per wire.
 */
export function makeBackend(rng = Math.random) {
  const backend = {
    state: null,
    applied: [],
    measured: [],
    begin(n) {
      backend.state = zeroState(n);
    },
    applyOp(op) {
      backend.applied.push(op);
      applyOp(backend.state, op);
    },
    measure(wires) {
      const bits = [];
      for (const w of wires) {
        const p1 = marginal(backend.state, w);
        const bit = rng() < p1 ? 1 : 0;
        const keep = bit ? p1 : 1 - p1;
        const norm = 1 / Math.sqrt(keep);
        for (let i = 0; i < backend.state.re.length; i++) {
          if (((i >> w) & 1) === bit) {
            backend.state.re[i] *= norm;
            backend.state.im[i] *= norm;
          } else {
            backend.state.re[i] = 0;
            backend.state.im[i] = 0;
          }
        }
        bits.push(bit);
      }
      backend.measured.push({ wires: wires.slice(), bits });
      return bits;
    },
  };
  return backend;
}
