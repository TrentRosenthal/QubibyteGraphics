/**
 * Vector calculus and differential geometry: gradient, divergence and curl
 * (symbolic and numeric), line and surface integrals, tangent planes and
 * normals, curvature and torsion of curves, and geodesics on parametric
 * surfaces by integrating the geodesic equations.
 * @module math/vectorcalc
 */
import { num, add, mul, pow, sym, eq, fn, substitute } from './expr.js';
import { simplify } from './simplify.js';
import { ensureExpr } from './parse.js';
import { diff } from './diff.js';
import { compileReal } from './evaluate.js';
import { gaussKronrod, numericDerivative } from './quadrature.js';
import { rk4 } from './ode.js';
import { toLatex } from './latex.js';

/** @typedef {import('./expr.js').Expr} Expr */

const E = (v) => simplify(ensureExpr(v));

/**
 * Symbolic gradient.
 * @param {Expr|string} f
 * @param {string[]} vars
 * @returns {{components: Expr[], latex: string}}
 */
export function gradient(f, vars) {
  const g = E(f);
  const components = vars.map((v) => diff(g, v));
  return { components, latex: '\\left\\langle ' + components.map(toLatex).join(', ') + ' \\right\\rangle' };
}

/**
 * Symbolic divergence of a vector field.
 * @param {Array<Expr|string>} F components
 * @param {string[]} vars
 * @returns {{value: Expr, terms: Expr[], latex: string}}
 */
export function divergence(F, vars) {
  const terms = F.map((c, i) => diff(E(c), vars[i]));
  const value = simplify(add(...terms));
  return { value, terms, latex: toLatex(value) };
}

/**
 * Symbolic curl. Three components give a vector; two components give the
 * scalar curl dQ/dx - dP/dy.
 * @param {Array<Expr|string>} F
 * @param {string[]} vars
 * @returns {{components: Expr[], latex: string}}
 */
export function curl(F, vars) {
  const c = F.map(E);
  const d = (i, v) => diff(c[i], vars[v]);
  const minus = (a, b) => simplify(add(a, mul(num(-1), b)));
  if (c.length === 2) {
    const z = minus(d(1, 0), d(0, 1));
    return { components: [z], latex: toLatex(z) };
  }
  const components = [minus(d(2, 1), d(1, 2)), minus(d(0, 2), d(2, 0)), minus(d(1, 0), d(0, 1))];
  return { components, latex: '\\left\\langle ' + components.map(toLatex).join(', ') + ' \\right\\rangle' };
}

/**
 * Numeric gradient of a JavaScript function at a point.
 * @param {(...x: number[]) => number} f
 * @param {number[]} p
 * @returns {number[]}
 */
export function gradientNumeric(f, p) {
  return p.map((_, i) => numericDerivative((t) => f(...p.map((v, j) => (j === i ? t : v))), p[i]));
}

/**
 * Numeric divergence of a field given as a function returning a vector.
 * @param {(...x: number[]) => number[]} F
 * @param {number[]} p
 * @returns {number}
 */
export function divergenceNumeric(F, p) {
  return p.reduce((s, _, i) => s + numericDerivative((t) => F(...p.map((v, j) => (j === i ? t : v)))[i], p[i]), 0);
}

/**
 * Numeric curl of a 3D field.
 * @param {(x: number, y: number, z: number) => number[]} F
 * @param {number[]} p
 * @returns {number[]}
 */
export function curlNumeric(F, p) {
  const d = (comp, axis) => numericDerivative((t) => F(...p.map((v, j) => (j === axis ? t : v)))[comp], p[axis]);
  return [d(2, 1) - d(1, 2), d(0, 2) - d(2, 0), d(1, 0) - d(0, 1)];
}

function fieldFn(field, vars) {
  if (typeof field === 'function') return field;
  if (Array.isArray(field)) {
    const fs = field.map((c) => compileReal(E(c), vars));
    return (...x) => fs.map((g) => g(...x));
  }
  const g = compileReal(E(field), vars);
  return (...x) => g(...x);
}

function curveFns(r, t) {
  if (typeof r === 'function') {
    const dr = (s) => {
      const h = 1e-6 * Math.max(1, Math.abs(s));
      const a = r(s + h);
      const b = r(s - h);
      return a.map((v, i) => (v - b[i]) / (2 * h));
    };
    return { pos: r, vel: dr };
  }
  const comps = r.map(E);
  const pos = comps.map((c) => compileReal(c, [t]));
  const vel = comps.map((c) => compileReal(diff(c, t), [t]));
  return { pos: (s) => pos.map((g) => g(s)), vel: (s) => vel.map((g) => g(s)) };
}

/**
 * Line integral along a parametric curve. With a scalar field it is
 * integral f(r(t)) |r'(t)| dt; with a vector field it is integral F(r(t)) . r'(t) dt.
 * @param {Expr|string|Array<Expr|string>|((...x: number[]) => number|number[])} field
 * @param {Array<Expr|string>|((t: number) => number[])} r curve components (expressions in t) or a function
 * @param {number} t0
 * @param {number} t1
 * @param {{vars?: string[], param?: string, type?: 'scalar'|'vector'}} [opts]
 * @returns {{value: number, error: number}}
 */
export function lineIntegral(field, r, t0, t1, opts = {}) {
  const param = opts.param || 't';
  const { pos, vel } = curveFns(r, param);
  const dim = pos(t0).length;
  const vars = opts.vars || ['x', 'y', 'z'].slice(0, dim);
  const F = fieldFn(field, vars);
  const type = opts.type || (Array.isArray(field) ? 'vector' : 'scalar');
  const integrand = type === 'vector'
    ? (s) => {
      const Fv = F(...pos(s));
      const v = vel(s);
      return Fv.reduce((acc, c, i) => acc + c * v[i], 0);
    }
    : (s) => F(...pos(s)) * Math.hypot(...vel(s));
  const q = gaussKronrod(integrand, t0, t1, { tol: 1e-11 });
  return { value: q.value, error: q.error };
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Surface integral over a parametric surface r(u, v), u in [u0, u1],
 * v in [v0, v1]. Scalar fields give integral f |r_u x r_v| du dv; vector
 * fields give the flux integral F . (r_u x r_v) du dv.
 * @param {Expr|string|Array<Expr|string>|((x: number, y: number, z: number) => number|number[])} field
 * @param {Array<Expr|string>|((u: number, v: number) => number[])} r
 * @param {[number, number]} uRange
 * @param {[number, number]} vRange
 * @param {{type?: 'scalar'|'flux', params?: [string, string]}} [opts]
 * @returns {{value: number}}
 */
export function surfaceIntegral(field, r, uRange, vRange, opts = {}) {
  const [pu, pv] = opts.params || ['u', 'v'];
  const surf = surfaceFns(r, pu, pv);
  const F = fieldFn(field, ['x', 'y', 'z']);
  const type = opts.type || (Array.isArray(field) ? 'flux' : 'scalar');
  const integrand = (u, v) => {
    const n = cross(surf.ru(u, v), surf.rv(u, v));
    const p = surf.pos(u, v);
    if (type === 'flux') {
      const Fv = F(...p);
      return Fv[0] * n[0] + Fv[1] * n[1] + Fv[2] * n[2];
    }
    return F(...p) * Math.hypot(...n);
  };
  const outer = gaussKronrod((u) => gaussKronrod((v) => integrand(u, v), vRange[0], vRange[1], { tol: 1e-9 }).value, uRange[0], uRange[1], { tol: 1e-9 });
  return { value: outer.value };
}

function surfaceFns(r, pu, pv) {
  if (typeof r === 'function') {
    const h = 1e-6;
    return {
      pos: r,
      ru: (u, v) => r(u + h, v).map((a, i) => (a - r(u - h, v)[i]) / (2 * h)),
      rv: (u, v) => r(u, v + h).map((a, i) => (a - r(u, v - h)[i]) / (2 * h)),
    };
  }
  const comps = r.map(E);
  const pos = comps.map((c) => compileReal(c, [pu, pv]));
  const du = comps.map((c) => compileReal(diff(c, pu), [pu, pv]));
  const dv = comps.map((c) => compileReal(diff(c, pv), [pu, pv]));
  return {
    pos: (u, v) => pos.map((g) => g(u, v)),
    ru: (u, v) => du.map((g) => g(u, v)),
    rv: (u, v) => dv.map((g) => g(u, v)),
  };
}

/**
 * Tangent plane and upward normal of z = f(x, y) at (x0, y0).
 * @param {Expr|string} f
 * @param {number|Expr|string} x0
 * @param {number|Expr|string} y0
 * @returns {{point: Expr[], normal: Expr[], plane: Expr, latex: string}}
 */
export function tangentPlane(f, x0, y0) {
  const g = E(f);
  const a = E(x0);
  const b = E(y0);
  const at = (e) => simplify(substitute(e, { x: a, y: b }));
  const z0 = at(g);
  const fx = at(diff(g, 'x'));
  const fy = at(diff(g, 'y'));
  const X = sym('x');
  const Y = sym('y');
  const plane = simplify(add(z0, mul(fx, add(X, mul(num(-1), a))), mul(fy, add(Y, mul(num(-1), b)))));
  return {
    point: [a, b, z0],
    normal: [simplify(mul(num(-1), fx)), simplify(mul(num(-1), fy)), num(1)],
    plane,
    latex: toLatex(eq(sym('z'), plane)),
  };
}

/**
 * Normal vector r_u x r_v of a parametric surface (symbolic).
 * @param {Array<Expr|string>} r three components in u and v
 * @param {[string, string]} [params=['u', 'v']]
 * @returns {{normal: Expr[], ru: Expr[], rv: Expr[], latex: string}}
 */
export function surfaceNormal(r, params = ['u', 'v']) {
  const c = r.map(E);
  const ru = c.map((e) => diff(e, params[0]));
  const rv = c.map((e) => diff(e, params[1]));
  const m = (p, q) => mul(p, q);
  const normal = [
    simplify(add(m(ru[1], rv[2]), mul(num(-1), m(ru[2], rv[1])))),
    simplify(add(m(ru[2], rv[0]), mul(num(-1), m(ru[0], rv[2])))),
    simplify(add(m(ru[0], rv[1]), mul(num(-1), m(ru[1], rv[0])))),
  ];
  return { normal, ru, rv, latex: '\\left\\langle ' + normal.map(toLatex).join(', ') + ' \\right\\rangle' };
}

/**
 * Curvature (and torsion for space curves) of r(t), symbolic, with a
 * numeric evaluator. Plane curves use |x'y'' - y'x''| / (x'^2 + y'^2)^(3/2).
 * @param {Array<Expr|string>} r components in t
 * @param {string} [t='t']
 * @returns {{curvature: Expr, torsion: Expr|null, at: (s: number) => {curvature: number, torsion: number|null}}}
 */
export function curvature(r, t = 't') {
  const c = r.map(E);
  const d1 = c.map((e) => diff(e, t));
  const d2 = d1.map((e) => diff(e, t));
  let kappa;
  let tau = null;
  if (c.length === 2) {
    const numer = fn('abs', simplify(add(mul(d1[0], d2[1]), mul(num(-1), d1[1], d2[0]))));
    kappa = simplify(mul(numer, pow(add(pow(d1[0], num(2)), pow(d1[1], num(2))), num('-3/2'))));
  } else {
    const d3 = d2.map((e) => diff(e, t));
    const cr = [
      add(mul(d1[1], d2[2]), mul(num(-1), d1[2], d2[1])),
      add(mul(d1[2], d2[0]), mul(num(-1), d1[0], d2[2])),
      add(mul(d1[0], d2[1]), mul(num(-1), d1[1], d2[0])),
    ].map(simplify);
    const crNorm2 = simplify(add(...cr.map((q) => pow(q, num(2)))));
    const speed2 = simplify(add(...d1.map((q) => pow(q, num(2)))));
    kappa = simplify(mul(pow(crNorm2, num('1/2')), pow(speed2, num('-3/2'))));
    tau = simplify(mul(add(...cr.map((q, i) => mul(q, d3[i]))), pow(crNorm2, num(-1))));
  }
  const kf = compileReal(kappa, [t]);
  const tf = tau ? compileReal(tau, [t]) : null;
  return { curvature: kappa, torsion: tau, at: (s) => ({ curvature: kf(s), torsion: tf ? tf(s) : null }) };
}

/**
 * Geodesic on a parametric surface r(u, v): integrates
 * u'' = -(G^u_uu u'^2 + 2 G^u_uv u'v' + G^u_vv v'^2) and the same for v,
 * with Christoffel symbols from the first fundamental form, by RK4.
 * @param {Array<Expr|string>} r three components in u and v
 * @param {{u0: number, v0: number, du0: number, dv0: number, tEnd?: number, steps?: number, params?: [string, string]}} init
 * @returns {{params: {u: number, v: number}[], points: number[][], t: number[]}}
 */
export function geodesic(r, init) {
  const [pu, pv] = init.params || ['u', 'v'];
  const c = r.map(E);
  const ru = c.map((e) => diff(e, pu));
  const rv = c.map((e) => diff(e, pv));
  const dot = (a, b) => simplify(add(...a.map((q, i) => mul(q, b[i]))));
  const Ee = dot(ru, ru);
  const Fe = dot(ru, rv);
  const Ge = dot(rv, rv);
  const comp = (e) => compileReal(e, [pu, pv]);
  const [fE, fF, fG] = [Ee, Fe, Ge].map(comp);
  const [Eu, Ev, Fu, Fv, Gu, Gv] = [diff(Ee, pu), diff(Ee, pv), diff(Fe, pu), diff(Fe, pv), diff(Ge, pu), diff(Ge, pv)].map(comp);
  const rhs = (_, y) => {
    const [u, v, up, vp] = y;
    const e = fE(u, v);
    const f = fF(u, v);
    const g = fG(u, v);
    const eu = Eu(u, v);
    const ev = Ev(u, v);
    const fu = Fu(u, v);
    const fv = Fv(u, v);
    const gu = Gu(u, v);
    const gv = Gv(u, v);
    const den = 2 * (e * g - f * f);
    const Guu = (g * eu - 2 * f * fu + f * ev) / den;
    const Guv = (g * ev - f * gu) / den;
    const Gvv = (2 * g * fv - g * gu - f * gv) / den;
    const Vuu = (2 * e * fu - e * ev - f * eu) / den;
    const Vuv = (e * gu - f * ev) / den;
    const Vvv = (e * gv - 2 * f * fv + f * gu) / den;
    return [up, vp, -(Guu * up * up + 2 * Guv * up * vp + Gvv * vp * vp), -(Vuu * up * up + 2 * Vuv * up * vp + Vvv * vp * vp)];
  };
  const traj = rk4(rhs, [init.u0, init.v0, init.du0, init.dv0], 0, init.tEnd ?? 1, init.steps ?? 200);
  const pos = c.map(comp);
  return {
    t: traj.t,
    params: traj.y.map((y) => ({ u: y[0], v: y[1] })),
    points: traj.y.map((y) => pos.map((g) => g(y[0], y[1]))),
  };
}
