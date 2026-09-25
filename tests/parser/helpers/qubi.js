import assert from 'node:assert/strict';
import { evaluate } from '../../../src/qubi/index.js';

/** Evaluate source and return the circuit. */
export function ev(src, opts) {
  return evaluate(src, opts);
}

/** Compact op form: 'NAME c1,c2>t1,t2' plus params rounded to 6 places. */
export function compact(op) {
  const wires = op.controls.length ? `${op.controls.join(',')}>${op.targets.join(',')}` : op.targets.join(',');
  const params = op.params.length ? `(${op.params.map((p) => Number(p.toFixed(6))).join(',')})` : '';
  return `${op.name}${params} ${wires}`;
}

/** Compact op list of a program. */
export function opsOf(src, opts) {
  return evaluate(src, opts).ops.map(compact);
}

/** Assert that evaluating (or parsing) src throws a QubiError whose message matches re. */
export function rejects(src, re, opts) {
  assert.throws(() => evaluate(src, opts), (e) => {
    assert.equal(e.name, 'QubiError', `expected a QubiError, got ${e.name}: ${e.message}`);
    assert.match(e.message, re);
    return true;
  });
}

/** The wires targeted by single-target ops, in order. */
export function targetsOf(src, opts) {
  return evaluate(src, opts).ops.map((op) => op.targets[0]);
}
