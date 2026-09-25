/**
 * Deliberately naive reference simulator for tests. It shares no code with
 * src/quantum: gate matrices are written out again from their formulas,
 * complex numbers are plain {re, im} objects, and every op becomes a full
 * 2^n x 2^n matrix built from Kronecker products.
 *
 * An operator on a wire set W is written as sum_{a,b} U_ab |a><b|_W, and
 * each |a><b|_W is a Kronecker product of 2x2 elementary matrices on W and
 * identities elsewhere. A controlled op is I - P + P (x) U, with P the
 * projector onto all controls being 1.
 */

const c = (re, im = 0) => ({ re, im });
const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);

function matZeros(n) {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => c(0)));
}

function matIdentity(n) {
  const m = matZeros(n);
  for (let i = 0; i < n; i++) m[i][i] = c(1);
  return m;
}

function matMul(a, b) {
  const n = a.length;
  const out = matZeros(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) out[i][j] = cadd(out[i][j], cmul(a[i][k], b[k][j]));
  return out;
}

function matAdd(a, b, s = c(1)) {
  return a.map((row, i) => row.map((v, j) => cadd(v, cmul(s, b[i][j]))));
}

function kron(a, b) {
  const n = a.length * b.length;
  const out = matZeros(n);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) {
      for (let k = 0; k < b.length; k++) {
        for (let l = 0; l < b.length; l++) out[i * b.length + k][j * b.length + l] = cmul(a[i][j], b[k][l]);
      }
    }
  }
  return out;
}

function elementary(a, b) {
  const m = matZeros(2);
  m[a][b] = c(1);
  return m;
}

/** Full operator of a small matrix `u` on `wires` (wires[0] its low bit). */
function embed(u, wires, n) {
  const dim = u.length;
  let total = matZeros(1 << n);
  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < dim; b++) {
      if (u[a][b].re === 0 && u[a][b].im === 0) continue;
      let term = [[c(1)]];
      for (let q = n - 1; q >= 0; q--) {
        const k = wires.indexOf(q);
        term = kron(term, k < 0 ? matIdentity(2) : elementary((a >> k) & 1, (b >> k) & 1));
      }
      total = matAdd(total, term, u[a][b]);
    }
  }
  return total;
}

const R = Math.SQRT1_2;
const e = (t) => c(Math.cos(t), Math.sin(t));

/** Gate matrices written from their definitions. */
export function refGate(name, p = []) {
  const [t, phi, lam] = p;
  switch (name) {
    case 'I': return [[c(1), c(0)], [c(0), c(1)]];
    case 'H': return [[c(R), c(R)], [c(R), c(-R)]];
    case 'X': return [[c(0), c(1)], [c(1), c(0)]];
    case 'Y': return [[c(0), c(0, -1)], [c(0, 1), c(0)]];
    case 'Z': return [[c(1), c(0)], [c(0), c(-1)]];
    case 'S': return [[c(1), c(0)], [c(0), c(0, 1)]];
    case 'SDG': return [[c(1), c(0)], [c(0), c(0, -1)]];
    case 'T': return [[c(1), c(0)], [c(0), e(Math.PI / 4)]];
    case 'TDG': return [[c(1), c(0)], [c(0), e(-Math.PI / 4)]];
    case 'RX': return [[c(Math.cos(t / 2)), c(0, -Math.sin(t / 2))], [c(0, -Math.sin(t / 2)), c(Math.cos(t / 2))]];
    case 'RY': return [[c(Math.cos(t / 2)), c(-Math.sin(t / 2))], [c(Math.sin(t / 2)), c(Math.cos(t / 2))]];
    case 'RZ': return [[e(-t / 2), c(0)], [c(0), e(t / 2)]];
    case 'P': return [[c(1), c(0)], [c(0), e(t)]];
    case 'U': return [
      [c(Math.cos(t / 2)), cmul(e(lam), c(-Math.sin(t / 2)))],
      [cmul(e(phi), c(Math.sin(t / 2))), cmul(e(phi + lam), c(Math.cos(t / 2)))],
    ];
    case 'SWAP': return [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]].map((r) => r.map((v) => c(v)));
    case 'ISWAP': return [[c(1), c(0), c(0), c(0)], [c(0), c(0), c(0, 1), c(0)], [c(0), c(0, 1), c(0), c(0)], [c(0), c(0), c(0), c(1)]];
    case 'SQRTSWAP': return [
      [c(1), c(0), c(0), c(0)],
      [c(0), c(0.5, 0.5), c(0.5, -0.5), c(0)],
      [c(0), c(0.5, -0.5), c(0.5, 0.5), c(0)],
      [c(0), c(0), c(0), c(1)],
    ];
    default: throw new Error(`reference has no gate ${name}`);
  }
}

const BASE = { CX: 'X', CY: 'Y', CZ: 'Z', CP: 'P', CSWAP: 'SWAP' };

/** Full 2^n x 2^n matrix of one gate op. */
export function refOpMatrix(op, n) {
  const base = refGate(BASE[op.name] ?? op.name, op.params ?? []);
  const controls = op.controls ?? [];
  const u = embed(base, op.targets, n);
  if (!controls.length) return u;
  let proj = [[c(1)]];
  for (let q = n - 1; q >= 0; q--) proj = kron(proj, controls.includes(q) ? elementary(1, 1) : matIdentity(2));
  // I - P + P U (P commutes with U since they act on different wires).
  return matAdd(matAdd(matIdentity(1 << n), proj, c(-1)), matMul(proj, u));
}

/** Full unitary of a gate list. */
export function refUnitary(n, ops) {
  let u = matIdentity(1 << n);
  for (const op of ops) u = matMul(refOpMatrix(op, n), u);
  return u;
}

/** Final amplitudes from |0...0>, as {re: number[], im: number[]}. */
export function refState(n, ops) {
  const u = refUnitary(n, ops);
  return { re: u.map((row) => row[0].re), im: u.map((row) => row[0].im) };
}

/** Converts the reference's nested matrix to rows of [re, im]. */
export function refToRows(m) {
  return m.map((row) => row.map((v) => [v.re, v.im]));
}

/**
 * Small seeded LCG so random circuits are reproducible without src code.
 * @param {number} seed
 */
export function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ONE = ['I', 'H', 'X', 'Y', 'Z', 'S', 'SDG', 'T', 'TDG'];
const ROT = ['RX', 'RY', 'RZ', 'P'];

/**
 * Random gate circuit over the full Qubi gate set (or only Clifford gates).
 * @param {number} n
 * @param {number} depth
 * @param {() => number} rnd
 * @param {{clifford?: boolean}} [opts]
 */
export function randomOps(n, depth, rnd, { clifford = false } = {}) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const wires = (k) => {
    const pool = Array.from({ length: n }, (_, i) => i);
    const out = [];
    for (let i = 0; i < k; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  };
  const ops = [];
  const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
  for (let d = 0; d < depth; d++) {
    const r = rnd();
    if (clifford) {
      if (r < 0.5 || n < 2) ops.push(g(pick(['H', 'S', 'SDG', 'X', 'Y', 'Z', 'I']), wires(1)));
      else if (r < 0.9) {
        const [a, b] = wires(2);
        ops.push(g(pick(['CX', 'CY', 'CZ']), [b], [a]));
      } else ops.push(g('SWAP', wires(2)));
      continue;
    }
    if (r < 0.35 || n < 2) ops.push(g(pick(ONE), wires(1)));
    else if (r < 0.55) ops.push(g(pick(ROT), wires(1), [], [rnd() * 6 - 3]));
    else if (r < 0.6) ops.push(g('U', wires(1), [], [rnd() * 3, rnd() * 6 - 3, rnd() * 6 - 3]));
    else if (r < 0.8) {
      const [a, b] = wires(2);
      const name = pick(['CX', 'CY', 'CZ', 'CP']);
      ops.push(g(name, [b], [a], name === 'CP' ? [rnd() * 6 - 3] : []));
    } else if (r < 0.9) ops.push(g(pick(['SWAP', 'ISWAP', 'SQRTSWAP']), wires(2)));
    else if (n >= 3) {
      const [a, b, t] = wires(3);
      if (rnd() < 0.5) ops.push(g('CX', [t], [a, b]));
      else ops.push(g('CSWAP', [b, t], [a]));
    }
  }
  return ops;
}
