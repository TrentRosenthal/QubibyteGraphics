/**
 * Exact-value recognition and Dirac notation terms for typesetting states.
 *
 * `exactForm` recognizes amplitudes whose squared magnitude is a small
 * rational p/q (so 1/2, 1/sqrt(2), sqrt(3)/2, 1/sqrt(3), sqrt(2/3), 1/4,
 * 1/sqrt(8), ...) and whose phase is a rational multiple of pi with a small
 * denominator (e^{i k pi/4}, e^{i k pi/3}, ...).
 *
 * @module quantum/notation
 */

import { describeState } from './state.js';

/**
 * @typedef {Object} ExactForm
 * @property {boolean} exact True when a closed form was recognized.
 * @property {string} plain Unicode text, for example `1/√2`, `-i/2`, `e^(iπ/4)/√2`.
 * @property {string} latex For example `\frac{1}{\sqrt{2}}`.
 */

const PHASE_DENOMINATORS = [1, 2, 4, 3, 6, 8, 12, 16];

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

function isSquare(n) {
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}

function recognizeMagnitude(mag, tol) {
  const sq = mag * mag;
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(sq * q);
    if (p <= 0 || p > 64 * q) continue;
    if (Math.abs(Math.sqrt(p / q) - mag) < tol) {
      const g = gcd(p, q);
      return { p: p / g, q: q / g };
    }
  }
  return null;
}

function recognizePhase(phase, tol) {
  for (const d of PHASE_DENOMINATORS) {
    const k = Math.round((phase * d) / Math.PI);
    if (Math.abs(phase - (k * Math.PI) / d) < tol) {
      let kk = k % (2 * d);
      if (kk > d) kk -= 2 * d;
      if (kk <= -d) kk += 2 * d;
      const g = gcd(kk, d) || 1;
      return { k: kk / g, d: d / g };
    }
  }
  return null;
}

function formatDecimal(x, decimals) {
  let s = x.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (/^-0$/.test(s)) s = '0';
  return s;
}

/**
 * Plain decimal text for a complex number.
 * @param {number} re
 * @param {number} im
 * @param {number} decimals
 * @returns {string}
 */
function decimalComplex(re, im, decimals) {
  const eps = 0.5 * 10 ** -decimals;
  const r = formatDecimal(re, decimals);
  const i = formatDecimal(Math.abs(im), decimals);
  if (Math.abs(im) < eps) return r;
  if (Math.abs(re) < eps) return `${im < 0 ? '-' : ''}${i}i`;
  return `(${r}${im < 0 ? '-' : '+'}${i}i)`;
}

/**
 * Recognizes a closed form for a complex number.
 * @param {{re: number, im: number}|number} z
 * @param {{tolerance?: number, decimals?: number}} [options] `decimals` sets
 *   the fallback decimal text when no closed form is found.
 * @returns {ExactForm}
 */
export function exactForm(z, { tolerance = 1e-9, decimals = 3 } = {}) {
  const re = typeof z === 'number' ? z : z.re;
  const im = typeof z === 'number' ? 0 : z.im ?? 0;
  const mag = Math.hypot(re, im);
  if (mag < tolerance) return { exact: true, plain: '0', latex: '0' };
  const m = recognizeMagnitude(mag, tolerance);
  const ph = recognizePhase(Math.atan2(im, re), tolerance / mag);
  if (!m || !ph) {
    const text = decimalComplex(re, im, decimals);
    return { exact: false, plain: text, latex: text };
  }
  // Phase factor: sign and unit ('', 'i', or an exponential).
  let sign = '';
  let unitPlain = '';
  let unitLatex = '';
  const { k, d } = ph;
  if (k === 0) {
    sign = '';
  } else if (k === d) {
    sign = '-';
  } else if (2 * k === d) {
    unitPlain = unitLatex = 'i';
  } else if (2 * k === -d) {
    sign = '-';
    unitPlain = unitLatex = 'i';
  } else {
    const kk = Math.abs(k);
    const coef = kk === 1 ? '' : String(kk);
    const neg = k < 0 ? '-' : '';
    const den = d === 1 ? '' : `/${d}`;
    unitPlain = `e^(${neg}${coef}iπ${den})`;
    unitLatex = `e^{${neg}${coef}i\\pi${den}}`;
  }
  const { p, q } = m;
  let plain;
  let latex;
  if (!isSquare(p) && !isSquare(q)) {
    plain = `${unitPlain}√(${p}/${q})`;
    latex = `${unitLatex}\\sqrt{\\frac{${p}}{${q}}}`;
  } else {
    const numPlain = isSquare(p) ? String(Math.sqrt(p)) : `√${p}`;
    const numLatex = isSquare(p) ? String(Math.sqrt(p)) : `\\sqrt{${p}}`;
    const topPlain = unitPlain ? unitPlain + (numPlain === '1' ? '' : numPlain) : numPlain;
    const topLatex = unitLatex ? unitLatex + (numLatex === '1' ? '' : numLatex) : numLatex;
    if (q === 1) {
      plain = topPlain;
      latex = topLatex;
    } else {
      const denPlain = isSquare(q) ? String(Math.sqrt(q)) : `√${q}`;
      const denLatex = isSquare(q) ? String(Math.sqrt(q)) : `\\sqrt{${q}}`;
      plain = `${topPlain}/${denPlain}`;
      latex = `\\frac{${topLatex}}{${denLatex}}`;
    }
  }
  return { exact: true, plain: sign + plain, latex: sign + latex };
}

/**
 * @typedef {Object} DiracOptions
 * @property {number} [decimalPlaces=3] Digits for decimal coefficients (DecimalPlaces).
 * @property {boolean} [hideNegligibles=true] Drop terms whose amplitude rounds
 *   to zero at `decimalPlaces` (HideNegligibles).
 * @property {boolean} [symbolic=false] Use exact closed forms where recognized (SymbolicNotation).
 * @property {'state'|'probability'|'amplitude'|'phase'} [sortBy='state'] (SortBy)
 *   - `state`: basis index order (|00>, |01>, |10>, ...).
 *   - `probability`: by |amplitude|^2.
 *   - `amplitude`: by the signed amplitude, real part first, then imaginary
 *     part, so negative-amplitude terms (marked states in phase oracles)
 *     group apart from positive ones.
 *   - `phase`: by the amplitude's phase in [0, 2 pi).
 * @property {'ascending'|'descending'} [sortOrder='ascending'] (SortOrder)
 *   Direction of the primary key. Ties always fall back to ascending basis index.
 */

/**
 * @typedef {Object} DiracTerm
 * @property {number} index Basis index.
 * @property {string} label MSB-first bitstring (rightmost character is qubit 0).
 * @property {number} re
 * @property {number} im
 * @property {number} probability
 * @property {number} phase In [0, 2 pi).
 * @property {ExactForm} coefficient Display text of the amplitude.
 */

/**
 * Terms of a pure state in Dirac notation, ready for typesetting.
 * @param {import('./state.js').StateLike} state Pure state.
 * @param {DiracOptions} [options]
 * @returns {DiracTerm[]}
 */
export function diracTerms(state, options = {}) {
  const { decimalPlaces = 3, hideNegligibles = true, symbolic = false, sortBy = 'state', sortOrder = 'ascending' } = options;
  const s = describeState(state);
  if (!s.pure) throw new Error('Dirac notation needs a pure state');
  if (!['state', 'probability', 'amplitude', 'phase'].includes(sortBy)) {
    throw new Error(`SortBy must be state, probability, amplitude, or phase; got "${sortBy}"`);
  }
  if (sortOrder !== 'ascending' && sortOrder !== 'descending') {
    throw new Error(`SortOrder must be ascending or descending; got "${sortOrder}"`);
  }
  const eps = 0.5 * 10 ** -decimalPlaces;
  const terms = [];
  for (let i = 0; i < s.re.length; i++) {
    const re = s.re[i];
    const im = s.im[i];
    const mag = Math.hypot(re, im);
    if (hideNegligibles ? mag < eps : mag === 0) continue;
    let phase = Math.atan2(im, re);
    if (phase < 0) phase += 2 * Math.PI;
    const coefficient = symbolic
      ? exactForm({ re, im }, { decimals: decimalPlaces })
      : { exact: false, plain: decimalComplex(re, im, decimalPlaces), latex: decimalComplex(re, im, decimalPlaces) };
    terms.push({
      index: i,
      label: s.numQubits ? i.toString(2).padStart(s.numQubits, '0') : '',
      re,
      im,
      probability: mag * mag,
      phase,
      coefficient,
    });
  }
  const key = {
    state: (t) => [t.index],
    probability: (t) => [t.probability],
    amplitude: (t) => [t.re, t.im],
    phase: (t) => [t.phase],
  }[sortBy];
  const dir = sortOrder === 'descending' ? -1 : 1;
  const close = (a, b) => Math.abs(a - b) < 1e-12;
  terms.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let j = 0; j < ka.length; j++) if (!close(ka[j], kb[j])) return dir * (ka[j] - kb[j]);
    return a.index - b.index;
  });
  return terms;
}

/**
 * Joins Dirac terms into one expression, for example `1/√2|00⟩ + 1/√2|11⟩`
 * or `\frac{1}{\sqrt{2}}|00\rangle + ...`. Unit coefficients are omitted.
 * @param {DiracTerm[]} terms
 * @param {{format?: 'plain'|'latex'}} [options]
 * @returns {string}
 */
export function formatDirac(terms, { format = 'plain' } = {}) {
  if (!terms.length) return '0';
  const latex = format === 'latex';
  return terms
    .map((t, i) => {
      let c = latex ? t.coefficient.latex : t.coefficient.plain;
      let neg = false;
      if (c.startsWith('-')) {
        neg = true;
        c = c.slice(1);
      }
      if (c === '1') c = '';
      const ket = latex ? `|${t.label}\\rangle` : `|${t.label}⟩`;
      const body = c + ket;
      if (i === 0) return (neg ? '-' : '') + body;
      return (neg ? ' - ' : ' + ') + body;
    })
    .join('');
}

function settingBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(s)) return true;
  if (['false', 'off', 'no', '0'].includes(s)) return false;
  throw new Error(`Expected true or false, got "${v}"`);
}

/**
 * Maps resolved `#settings` values (SymbolicNotation, HideNegligibles,
 * DecimalPlaces, SortBy, SortOrder) to {@link diracTerms} options.
 * @param {Record<string, any>} settings
 * @returns {DiracOptions}
 */
export function diracOptionsFromSettings(settings = {}) {
  const get = (name) => {
    const k = Object.keys(settings).find((key) => key.toLowerCase() === name.toLowerCase());
    return k === undefined ? undefined : settings[k];
  };
  const dp = get('DecimalPlaces');
  return {
    decimalPlaces: dp === undefined ? 3 : Number(dp),
    hideNegligibles: settingBool(get('HideNegligibles'), true),
    symbolic: settingBool(get('SymbolicNotation'), false),
    sortBy: String(get('SortBy') ?? 'state').toLowerCase(),
    sortOrder: String(get('SortOrder') ?? 'ascending').toLowerCase(),
  };
}
