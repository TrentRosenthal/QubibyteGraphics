/**
 * Lowers ops that a target format cannot express into ops it can, using
 * exact decompositions: SWAPSEQ into SWAPs, broadcast one-qubit gates into
 * one op per wire, one-qubit matrices into U (or RZ RY RZ), two-qubit
 * matrices into three CX plus U gates, and singly controlled one-qubit gates
 * into two CX plus rotations. Used by the Qubi text emitter and the
 * exporters.
 *
 * Every rewrite is exact up to a global phase of the whole op, and exact
 * including phase whenever the op has controls.
 *
 * @module quantum/lower
 */

import { opActions } from './gates.js';
import { decomposeControlled, decomposeTwoQubit, decomposeZYZ, gateOp, uGateParams, unitaryPath } from './decompose.js';
import { adjoint } from './cmatrix.js';

/** @typedef {import('../qubi/ir.js').Op} Op */

/**
 * Qubi name for a base gate with controls added: X gains a C (CX), as do
 * Y, Z, P and SWAP; names that already have one keep it; other gates keep
 * their name and carry the controls.
 * @param {string} name
 * @returns {string}
 */
export function controlledName(name) {
  const map = { X: 'CX', Y: 'CY', Z: 'CZ', P: 'CP', SWAP: 'CSWAP' };
  return map[name] ?? name;
}

/**
 * Rewrites an op into ops accepted by `supports`.
 * @param {Op} op A gate op.
 * @param {(op: Op) => boolean} supports Whether the target format writes this op directly.
 * @param {string} formatName For error messages.
 * @returns {Op[]}
 */
export function lowerOp(op, supports, formatName) {
  const out = [];
  const visit = (o, depth) => {
    if (o.kind !== 'gate' || supports(o)) {
      out.push(o);
      return;
    }
    if (depth > 64) throw new Error(`${formatName}: cannot express gate ${o.name}`);
    const controls = o.controls ?? [];
    const actions = opActions(o);
    if (actions.length !== 1 || o.name === 'SWAPSEQ') {
      for (const a of actions) {
        const name = o.name === 'SWAPSEQ' ? (controls.length ? 'CSWAP' : 'SWAP') : o.name;
        const sub = { ...o, name, targets: a.targets, controls: a.controls };
        visit(sub, depth + 1);
      }
      return;
    }
    const { matrix, targets } = actions[0];
    if (controls.length === 0 && targets.length === 1) {
      const u = uGateParams(matrix);
      const asU = gateOp('U', targets, [u.theta, u.phi, u.lambda]);
      if (supports(asU)) {
        out.push(asU);
      } else {
        const z = decomposeZYZ(matrix);
        for (const [n, a] of [['RZ', z.delta], ['RY', z.gamma], ['RZ', z.beta]]) {
          if (Math.abs(a) > 1e-12) visit(gateOp(n, targets, [a]), depth + 1);
        }
      }
      return;
    }
    if (controls.length === 0 && targets.length === 2) {
      for (const sub of decomposeTwoQubit(matrix, targets).ops) visit(sub, depth + 1);
      return;
    }
    if (controls.length === 1 && targets.length === 1) {
      for (const sub of decomposeControlled(matrix, controls[0], targets[0])) visit(sub, depth + 1);
      return;
    }
    if ((o.name === 'CZ' || o.name === 'CY') && controls.length > 1) {
      // Multi-controlled Z and Y through multi-controlled X, conjugated on the target.
      const t = targets;
      const [pre, post] = o.name === 'CZ' ? [gateOp('H', t), gateOp('H', t)] : [gateOp('SDG', t), gateOp('S', t)];
      for (const sub of [pre, gateOp('CX', t, [], controls), post]) visit(sub, depth + 1);
      return;
    }
    if (controls.length > 1 && targets.length === 1) {
      // Barenco et al. 1995, Lemma 7.5, with W = sqrt(V):
      // C^k(V) = C^{k-1}(W), then C^{k-1}X onto the last control, C(W^dagger),
      // C^{k-1}X again, C(W) (time order), all on target t.
      const w = unitaryPath(matrix, 0.5);
      const wd = adjoint(w);
      const last = controls[controls.length - 1];
      const rest = controls.slice(0, -1);
      const user = (m, ctrls) => ({ kind: 'gate', name: `${o.name}_ROOT`, targets, controls: ctrls, params: [], matrix: m });
      for (const sub of [
        user(w, rest),
        gateOp('CX', [last], [], rest),
        user(wd, [last]),
        gateOp('CX', [last], [], rest),
        user(w, [last]),
      ]) visit(sub, depth + 1);
      return;
    }
    const what = controls.length ? `${o.name} with ${controls.length} control(s)` : `${targets.length}-qubit gate ${o.name}`;
    throw new Error(`${formatName}: cannot express ${what}`);
  };
  visit(op, 0);
  return out;
}
