/**
 * Units and dimensional analysis. Quantities carry an SI value and a
 * dimension vector over the SI base dimensions (length, mass, time, current,
 * temperature, amount, luminous intensity). Unit strings such as "kg*m/s^2",
 * "km/h", "J/(mol K)" or "N m" are parsed with metric prefixes. Adding or
 * converting incompatible dimensions throws a DimensionError that names both
 * dimensions. Also: significant-figure parsing and arithmetic rules.
 * @module math/units
 */

const DIM_NAMES = ['length', 'mass', 'time', 'current', 'temperature', 'amount', 'luminous intensity'];
const DIM_SYMBOLS = ['L', 'M', 'T', 'I', 'Θ', 'N', 'J'];

/** Error for dimension mismatches. */
export class DimensionError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DimensionError';
  }
}

const D = (l = 0, m = 0, t = 0, i = 0, k = 0, n = 0, j = 0) => [l, m, t, i, k, n, j];

/** @type {Record<string, {factor: number, dim: number[], offset?: number}>} */
const UNITS = {
  m: { factor: 1, dim: D(1) },
  g: { factor: 1e-3, dim: D(0, 1) },
  s: { factor: 1, dim: D(0, 0, 1) },
  A: { factor: 1, dim: D(0, 0, 0, 1) },
  K: { factor: 1, dim: D(0, 0, 0, 0, 1) },
  mol: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) },
  cd: { factor: 1, dim: D(0, 0, 0, 0, 0, 0, 1) },
  N: { factor: 1, dim: D(1, 1, -2) },
  J: { factor: 1, dim: D(2, 1, -2) },
  W: { factor: 1, dim: D(2, 1, -3) },
  Pa: { factor: 1, dim: D(-1, 1, -2) },
  C: { factor: 1, dim: D(0, 0, 1, 1) },
  V: { factor: 1, dim: D(2, 1, -3, -1) },
  ohm: { factor: 1, dim: D(2, 1, -3, -2) },
  'Ω': { factor: 1, dim: D(2, 1, -3, -2) },
  Hz: { factor: 1, dim: D(0, 0, -1) },
  F: { factor: 1, dim: D(-2, -1, 4, 2) },
  H: { factor: 1, dim: D(2, 1, -2, -2) },
  T: { factor: 1, dim: D(0, 1, -2, -1) },
  Wb: { factor: 1, dim: D(2, 1, -2, -1) },
  S: { factor: 1, dim: D(-2, -1, 3, 2) },
  L: { factor: 1e-3, dim: D(3) },
  min: { factor: 60, dim: D(0, 0, 1) },
  h: { factor: 3600, dim: D(0, 0, 1) },
  day: { factor: 86400, dim: D(0, 0, 1) },
  yr: { factor: 365.25 * 86400, dim: D(0, 0, 1) },
  eV: { factor: 1.602176634e-19, dim: D(2, 1, -2) },
  cal: { factor: 4.184, dim: D(2, 1, -2) },
  atm: { factor: 101325, dim: D(-1, 1, -2) },
  bar: { factor: 1e5, dim: D(-1, 1, -2) },
  in: { factor: 0.0254, dim: D(1) },
  ft: { factor: 0.3048, dim: D(1) },
  mi: { factor: 1609.344, dim: D(1) },
  lb: { factor: 0.45359237, dim: D(0, 1) },
  rad: { factor: 1, dim: D() },
  deg: { factor: Math.PI / 180, dim: D() },
  degC: { factor: 1, dim: D(0, 0, 0, 0, 1), offset: 273.15 },
  degF: { factor: 5 / 9, dim: D(0, 0, 0, 0, 1), offset: 459.67 * (5 / 9) },
};

const PREFIXES = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};

function lookup(name) {
  if (UNITS[name]) return UNITS[name];
  for (const p of Object.keys(PREFIXES).sort((a, b) => b.length - a.length)) {
    if (name.startsWith(p) && UNITS[name.slice(p.length)] && !UNITS[name.slice(p.length)].offset) {
      const u = UNITS[name.slice(p.length)];
      return { factor: u.factor * PREFIXES[p], dim: u.dim };
    }
  }
  throw new DimensionError('Unknown unit "' + name + '"');
}

/**
 * Parse a unit string into its SI factor and dimension vector.
 * @param {string} text
 * @returns {{factor: number, dim: number[], offset: number}}
 */
export function parseUnit(text) {
  const src = text.trim();
  if (src === '' || src === '1') return { factor: 1, dim: D(), offset: 0 };
  const toks = src.match(/[A-Za-zµΩ]+|-?\d+(?:\.\d+)?|[*/^()·]|\s+/g) || [];
  if (toks.join('') !== src) throw new DimensionError('Cannot parse unit "' + text + '"');
  const list = toks.filter((t) => !/^\s+$/.test(t) || true);
  let p = 0;
  const peek = () => list[p];
  const skipSpace = () => {
    while (p < list.length && /^\s+$/.test(list[p])) p++;
  };
  const combine = (a, b, sign) => ({ factor: sign > 0 ? a.factor * b.factor : a.factor / b.factor, dim: a.dim.map((d, i) => d + sign * b.dim[i]), offset: 0 });
  const atom = () => {
    skipSpace();
    const t = list[p++];
    let u;
    if (t === '(') {
      u = product();
      skipSpace();
      if (list[p++] !== ')') throw new DimensionError('Missing ) in unit "' + text + '"');
    } else if (/^\d/.test(t) && t === '1') u = { factor: 1, dim: D(), offset: 0 };
    else if (/^[A-Za-zµΩ]+$/.test(t)) {
      const base = lookup(t);
      u = { factor: base.factor, dim: base.dim.slice(), offset: base.offset || 0 };
    } else throw new DimensionError('Unexpected "' + t + '" in unit "' + text + '"');
    skipSpace();
    if (peek() === '^') {
      p++;
      skipSpace();
      const e = Number(list[p++]);
      if (!Number.isFinite(e)) throw new DimensionError('Bad exponent in unit "' + text + '"');
      u = { factor: Math.pow(u.factor, e), dim: u.dim.map((d) => d * e), offset: 0 };
    } else if (p < list.length && /^-?\d+$/.test(peek())) {
      const e = Number(list[p++]);
      u = { factor: Math.pow(u.factor, e), dim: u.dim.map((d) => d * e), offset: 0 };
    }
    return u;
  };
  const product = () => {
    let u = atom();
    for (;;) {
      skipSpace();
      const t = peek();
      if (t === '*' || t === '·') {
        p++;
        u = combine(u, atom(), 1);
      } else if (t === '/') {
        p++;
        u = combine(u, atom(), -1);
      } else if (t !== undefined && t !== ')') {
        u = combine(u, atom(), 1);
      } else break;
    }
    return u;
  };
  const u = product();
  if (p < list.length) throw new DimensionError('Trailing input in unit "' + text + '"');
  return u;
}

/**
 * Human-readable dimension, e.g. "length / time^2".
 * @param {number[]} dim
 * @returns {string}
 */
export function describeDimension(dim) {
  const num = [];
  const den = [];
  dim.forEach((d, i) => {
    if (d > 0) num.push(DIM_NAMES[i] + (d !== 1 ? '^' + d : ''));
    if (d < 0) den.push(DIM_NAMES[i] + (d !== -1 ? '^' + -d : ''));
  });
  if (!num.length && !den.length) return 'dimensionless';
  return (num.length ? num.join(' ') : '1') + (den.length ? ' / ' + den.join(' ') : '');
}

/**
 * Dimension formula such as "M L T^-2".
 * @param {number[]} dim
 * @returns {string}
 */
export function dimensionFormula(dim) {
  const parts = [];
  for (const i of [1, 0, 2, 3, 4, 5, 6]) if (dim[i]) parts.push(DIM_SYMBOLS[i] + (dim[i] !== 1 ? '^' + dim[i] : ''));
  return parts.join(' ') || '1';
}

const sameDim = (a, b) => a.every((d, i) => Math.abs(d - b[i]) < 1e-12);

const NAMED = ['N', 'J', 'W', 'Pa', 'C', 'V', 'ohm', 'Hz', 'T', 'F', 'H', 'Wb'];

function siUnitString(dim) {
  for (const n of NAMED) if (sameDim(UNITS[n].dim, dim)) return n;
  const base = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'];
  const num = [];
  const den = [];
  dim.forEach((d, i) => {
    if (d > 0) num.push(base[i] + (d !== 1 ? '^' + d : ''));
    if (d < 0) den.push(base[i] + (d !== -1 ? '^' + -d : ''));
  });
  if (!num.length && !den.length) return '';
  return (num.join('*') || '1') + (den.length ? '/' + (den.length > 1 ? '(' + den.join('*') + ')' : den[0]) : '');
}

/** A value with a unit. */
export class Quantity {
  /**
   * @param {number} si value in SI base units
   * @param {number[]} dim dimension vector
   * @param {string} [unit] display unit
   */
  constructor(si, dim, unit) {
    /** @type {number} */
    this.si = si;
    /** @type {number[]} */
    this.dim = dim;
    /** @type {string} */
    this.unit = unit ?? siUnitString(dim);
  }

  /** @returns {number} value in the display unit */
  get value() {
    const u = parseUnit(this.unit || '1');
    return (this.si - (u.offset || 0)) / u.factor;
  }

  /**
   * Convert to another unit with the same dimension.
   * @param {string} unit
   * @returns {Quantity}
   */
  to(unit) {
    const u = parseUnit(unit);
    if (!sameDim(u.dim, this.dim)) {
      throw new DimensionError('Cannot convert ' + (this.unit || 'a dimensionless value') + ' (' + describeDimension(this.dim) + ') to ' + unit + ' (' + describeDimension(u.dim) + ')');
    }
    return new Quantity(this.si, this.dim, unit);
  }

  /**
   * @param {Quantity} other
   * @returns {Quantity}
   */
  add(other) {
    if (!sameDim(this.dim, other.dim)) throw new DimensionError('Cannot add ' + describeDimension(this.dim) + ' and ' + describeDimension(other.dim));
    return new Quantity(this.si + other.si, this.dim, this.unit);
  }

  /**
   * @param {Quantity} other
   * @returns {Quantity}
   */
  sub(other) {
    if (!sameDim(this.dim, other.dim)) throw new DimensionError('Cannot subtract ' + describeDimension(other.dim) + ' from ' + describeDimension(this.dim));
    return new Quantity(this.si - other.si, this.dim, this.unit);
  }

  /**
   * @param {Quantity|number} other
   * @returns {Quantity}
   */
  mul(other) {
    if (typeof other === 'number') return new Quantity(this.si * other, this.dim, this.unit);
    return new Quantity(this.si * other.si, this.dim.map((d, i) => d + other.dim[i]));
  }

  /**
   * @param {Quantity|number} other
   * @returns {Quantity}
   */
  div(other) {
    if (typeof other === 'number') return new Quantity(this.si / other, this.dim, this.unit);
    return new Quantity(this.si / other.si, this.dim.map((d, i) => d - other.dim[i]));
  }

  /**
   * @param {number} e
   * @returns {Quantity}
   */
  pow(e) {
    return new Quantity(Math.pow(this.si, e), this.dim.map((d) => d * e));
  }

  /** @returns {string} e.g. "9.81 m/s^2" */
  toString() {
    return String(Number(this.value.toPrecision(12))) + (this.unit ? ' ' + this.unit : '');
  }

  /** @returns {string} LaTeX with an upright unit */
  toLatex() {
    const u = this.unit.replace(/\^(-?\d+)/g, '^{$1}').replace(/\*/g, '\\cdot ').replace(/ohm/g, '\\Omega');
    return String(Number(this.value.toPrecision(12))) + (u ? '\\,\\mathrm{' + u + '}' : '');
  }
}

/**
 * Make a quantity from a value and unit string.
 * @param {number} value
 * @param {string} [unit='']
 * @returns {Quantity}
 */
export function quantity(value, unit = '') {
  const u = parseUnit(unit);
  return new Quantity(value * u.factor + (u.offset || 0), u.dim, unit);
}

/**
 * Convert a value between units, e.g. convert(100, 'km/h', 'm/s').
 * @param {number} value
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function convert(value, from, to) {
  return quantity(value, from).to(to).value;
}

/**
 * Throw a DimensionError unless the quantity has the expected dimension.
 * @param {Quantity} q
 * @param {string} unitOfExpectedDimension any unit with the expected dimension
 * @returns {void}
 */
export function assertDimension(q, unitOfExpectedDimension) {
  const u = parseUnit(unitOfExpectedDimension);
  if (!sameDim(u.dim, q.dim)) {
    throw new DimensionError('Expected ' + describeDimension(u.dim) + ' but got ' + describeDimension(q.dim));
  }
}

/**
 * Significant figures of a number written as a string. Leading zeros never
 * count; trailing zeros count only when a decimal point is present
 * ("1200" has 2, "1200." has 4, "0.00450" has 3).
 * @param {string} text
 * @returns {number}
 */
export function sigFigs(text) {
  const m = /^[+-]?(\d*)(\.(\d*))?(?:[eE][+-]?\d+)?$/.exec(text.trim());
  if (!m) throw new RangeError('Not a number: ' + text);
  const intPart = m[1];
  const hasPoint = m[2] !== undefined;
  const frac = m[3] || '';
  const digits = (intPart + frac).replace(/^0+/, '');
  if (!digits) return hasPoint ? Math.max(1, frac.length) : 1;
  if (hasPoint) return digits.length;
  return digits.replace(/0+$/, '').length;
}

/**
 * Decimal places written in a number string ("12.30" has 2).
 * @param {string} text
 * @returns {number}
 */
export function decimalPlaces(text) {
  const m = /\.(\d*)/.exec(text.split(/[eE]/)[0]);
  const exp = /[eE]([+-]?\d+)/.exec(text);
  return Math.max(0, (m ? m[1].length : 0) - (exp ? Number(exp[1]) : 0));
}

/**
 * Round to n significant figures, returned as a string that shows them
 * (trailing zeros kept; scientific notation when needed to show them).
 * @param {number} x
 * @param {number} n
 * @returns {string}
 */
export function roundSig(x, n) {
  if (x === 0) return n > 1 ? '0.' + '0'.repeat(n - 1) : '0';
  const s = x.toPrecision(n);
  if (s.includes('e')) return s;
  const intDigits = Math.floor(Math.log10(Math.abs(Number(s)))) + 1;
  if (!s.includes('.') && intDigits > n && /0$/.test(s)) return Number(s).toExponential(n - 1);
  return s;
}

/**
 * Apply the significant-figure rules: products and quotients keep the fewest
 * significant figures; sums and differences keep the fewest decimal places.
 * @param {'+'|'-'|'*'|'/'} op
 * @param {string[]} operands numbers written as strings
 * @returns {{value: number, text: string, sigFigs: number, rule: string}}
 */
export function sigFigArithmetic(op, operands) {
  const vals = operands.map(Number);
  if (op === '*' || op === '/') {
    const value = vals.slice(1).reduce((a, b) => (op === '*' ? a * b : a / b), vals[0]);
    const n = Math.min(...operands.map(sigFigs));
    return { value, text: roundSig(value, n), sigFigs: n, rule: 'Multiplication and division keep the fewest significant figures (' + n + ')' };
  }
  const value = vals.slice(1).reduce((a, b) => (op === '+' ? a + b : a - b), vals[0]);
  const places = Math.min(...operands.map(decimalPlaces));
  const text = value.toFixed(places);
  return { value, text, sigFigs: sigFigs(text), rule: 'Addition and subtraction keep the fewest decimal places (' + places + ')' };
}
