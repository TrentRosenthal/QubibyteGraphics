/**
 * Step lists for derivations. Every operation with intermediate steps
 * returns an array of steps; each has the expression, its LaTeX, a short
 * rule name, the character span of every node in the LaTeX, and `matches`:
 * which subexpressions persist from the previous step (pairs of node ids,
 * found by structural equality of maximal subtrees) so a renderer can morph
 * matching terms.
 * @module math/steps
 */
import { key, walk } from './expr.js';
import { toLatexWithSpans, toText } from './latex.js';

/** @typedef {import('./expr.js').Expr} Expr */

/**
 * @typedef {object} TokenMatch
 * @property {string} from node id in the previous step's expression
 * @property {string} to node id in this step's expression
 * @property {string} latex LaTeX of the matched subexpression
 */

/**
 * @typedef {object} Step
 * @property {Expr} expr expression at this step
 * @property {string} latex LaTeX of the expression
 * @property {string} text plain-text form
 * @property {string} rule plain-English rule name, e.g. "Power rule"
 * @property {import('./latex.js').LatexSpan[]} spans node id ranges in `latex`
 * @property {TokenMatch[]} matches persisting subexpressions from the previous step
 * @property {string} [note] optional extra explanation
 */

/**
 * Pair up maximal structurally equal subtrees between two expressions.
 * Larger subtrees win; each node is used at most once, and nodes inside a
 * matched subtree are not matched again.
 * @param {Expr} before
 * @param {Expr} after
 * @returns {{from: string, to: string, key: string}[]}
 */
export function matchTokens(before, after) {
  const byKey = new Map();
  walk(before, (n) => {
    const k = key(n);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(n);
  });
  const used = new Set();
  const markUsed = (n) => walk(n, (m) => used.add(m));
  const out = [];
  const visit = (n) => {
    const cands = byKey.get(key(n));
    if (cands) {
      const c = cands.find((m) => !used.has(m));
      if (c) {
        markUsed(c);
        out.push({ from: c.id, to: n.id, key: key(n) });
        return;
      }
    }
    if (n.args) n.args.forEach(visit);
  };
  visit(after);
  return out;
}

/**
 * Build a step record for an expression.
 * @param {Expr} expr
 * @param {string} rule
 * @param {object} [extra] extra fields merged into the step (e.g. note)
 * @returns {Step}
 */
export function makeStep(expr, rule, extra = {}) {
  const { latex, spans } = toLatexWithSpans(expr);
  return { expr, latex, text: toText(expr), rule, spans, matches: [], ...extra };
}

/**
 * Fill in `matches` for consecutive steps and drop a step that repeats the
 * previous LaTeX without adding a note.
 * @param {Step[]} steps
 * @returns {Step[]}
 */
export function linkSteps(steps) {
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.latex === s.latex && !s.note) continue;
    if (prev) {
      const spanOf = new Map(s.spans.map((sp) => [sp.id, sp]));
      s.matches = matchTokens(prev.expr, s.expr).map((m) => {
        const sp = spanOf.get(m.to);
        return { from: m.from, to: m.to, latex: sp ? s.latex.slice(sp.start, sp.end) : '' };
      });
    }
    out.push(s);
  }
  return out;
}
