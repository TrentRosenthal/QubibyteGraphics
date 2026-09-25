/**
 * Evaluates a parsed Qubi program into the circuit IR (see ir.js).
 *
 * Wire keywords resolve as: `max` = MaxQubits - 1, `visiblemax` =
 * VisibleQubits - 1, `visible` = (0..VisibleQubits-1), `all` =
 * (0..MaxQubits-1). Inside a `sequence:` gate body they refer to the gate's
 * own qubits instead.
 *
 * Qubit count: `#settings MaxQubits` wins. Without it the count is inferred
 * as the highest wire used + 1, raised to at least 8 when the program uses
 * `max`, `all`, `visible`, or `visiblemax` (those need a count before any wire
 * is known), and to at least VisibleQubits when that is set. The program is
 * re-evaluated until the count is stable. VisibleQubits defaults to the
 * resolved count.
 *
 * Modes:
 * - `trace` (default): measurement results are unknown. An `if` whose
 *   condition depends on one becomes an op `{kind: 'if', branches, elseOps}`
 *   with every branch traced; variables assigned in those branches become
 *   unknown afterwards. Loop counts, wires, and angles must not depend on a
 *   measurement.
 * - `execute`: a `backend` `{applyOp(op), measure(wires) -> bits, begin?(numQubits)}`
 *   runs the program for real. `applyOp` receives every gate op in order
 *   (measurements go through `measure`), and `if` takes the branch the
 *   measured values select.
 *
 * A measurement assignment `m = MEASURE (a,b)` stores a bitstring whose bit k
 * is the k-th lowest measured wire, so the lowest listed wire is the LSB. Each
 * measure op names its bit as `register: 'm[k]'`.
 *
 * Sweeps: every sweep bracket is an axis in `circuit.sweeps`. `evaluate` uses
 * the point given by `sweepPoint` (axis key to value index), defaulting to the
 * first value of each axis.
 *
 * @module qubi/evaluator
 */

import { GATE_INFO } from './ir.js';
import { QubiError } from './grammar.js';
import { Bits, GateRef, RegisterVal, Unknown, MAX_BITS } from './values.js';
import { SETTING_DEFAULTS, angleToRadians, radiansToUnit } from './settings.js';
import { STDLIB_NAMES, expandStdlib } from './stdlib.js';
import { parseMatrix, isUnitary } from './matrix.js';

const DEFAULT_QUBITS = 8;
const MAX_OPS = 1_000_000;
const MAX_WHILE = 100_000;
const MAX_CALL_DEPTH = 64;
const MAX_LIST = 1_000_000;

/**
 * Collect settings from the top level and imported files, in order.
 * @param {object[]} body
 * @param {Record<string, any>} out
 */
function collectSettings(body, out) {
  for (const st of body) {
    if (st.type === 'Settings') out[st.key] = st.value;
    else if (st.type === 'Import') collectSettings(st.body, out);
  }
}

function truthy(v) {
  if (v instanceof Bits) return v.value !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof RegisterVal) return v.wires.length > 0;
  if (v instanceof GateRef) return true;
  return Boolean(v);
}

function typeName(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Bits) return 'bitstring';
  if (v instanceof GateRef) return 'gate';
  if (Array.isArray(v) || v instanceof RegisterVal) return 'list';
  return v instanceof Unknown && v.type ? v.type : 'unknown';
}

function listType(v) {
  if (v instanceof RegisterVal) return 'list-int';
  if (!Array.isArray(v)) return typeName(v);
  if (!v.length) return 'list';
  const types = v.map(listType);
  if (types.every((t) => t === types[0])) return 'list-' + types[0];
  if (types.every((t) => t === 'int' || t === 'float')) return 'list-float';
  return 'list';
}

function deepEqual(a, b) {
  const num = (x) => (x instanceof Bits ? x.value : x);
  if ((typeof a === 'number' || a instanceof Bits) && (typeof b === 'number' || b instanceof Bits)) return num(a) === num(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => deepEqual(x, b[k]));
  if (a instanceof GateRef && b instanceof GateRef) return a.name === b.name;
  if (a instanceof RegisterVal && b instanceof RegisterVal) return deepEqual(a.wires, b.wires);
  return a === b;
}

function roundClean(x) {
  return Number.isInteger(x) ? x : Number(x.toPrecision(12));
}

/** Plain JSON-friendly form of a value, for `circuit.variables` and sweep axes. */
function plain(v) {
  if (v instanceof Bits) return v.toString();
  if (v instanceof GateRef) return v.name;
  if (v instanceof RegisterVal) return v.wires.slice();
  if (v instanceof Unknown) return { unknown: v.text };
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

class Evaluator {
  constructor(program, opts, dims, settings) {
    this.program = program;
    this.mode = opts.mode ?? 'trace';
    this.backend = opts.backend;
    this.sweepPoint = opts.sweepPoint ?? {};
    this.settings = settings;
    this.codeUnit = settings.CodeAngleUnit;
    this.M = dims.M;
    this.V = dims.V;
    this.strict = dims.strict;
    this.ops = [];
    this.out = this.ops;
    this.captureDepth = 0;
    this.labels = [];
    this.annotations = [];
    this.loops = [];
    this.sweeps = [];
    this.sweepSites = new Map();
    this.globals = new Map();
    this.scopes = [this.globals];
    this.gateDefs = new Map();
    this.functions = new Map();
    this.groupStack = [];
    this.groups = [];
    this.groupWires = new Map();
    this.loopStack = [];
    this.wireMaps = [];
    this.hi = -1;
    this.usedDim = false;
    this.diagnostics = program.warnings.slice();
    this.nextGroupId = 1;
    this.nextLoopId = 1;
    this.callDepth = 0;
    this.opCount = 0;
  }

  fail(msg, node) {
    throw new QubiError(msg, node?.pos);
  }

  warn(msg, node) {
    this.diagnostics.push({ severity: 'warning', message: msg, pos: node?.pos });
  }

  // Definitions

  hoist(body) {
    for (const st of body) {
      if (st.type === 'Import') this.hoist(st.body);
      else if (st.type === 'GateDef') this.defineGate(st);
      else if (st.type === 'FunctionDef') this.defineFunction(st);
    }
  }

  checkNewName(name, node) {
    if (STDLIB_NAMES.includes(name)) this.fail(`${name} is a standard library name and cannot be redefined`, node);
    if (this.gateDefs.has(name)) this.fail(`Gate ${name} is already defined`, node);
    if (this.functions.has(name)) this.fail(`Function ${name} is already defined`, node);
  }

  defineGate(node) {
    const { name, props } = node;
    this.checkNewName(name, node);
    const def = {
      name,
      displayName: props.name ?? name,
      label: props.label ?? name,
      desc: props.desc,
      examples: props.examples,
      color: props.color,
      category: props.category,
      qubits: props.qubits ?? null,
      pos: node.pos,
    };
    if (props.matrix) {
      const m = parseMatrix(props.matrix.text, props.matrix.pos);
      const q = Math.log2(m.rows);
      if (def.qubits !== null && def.qubits !== q) {
        this.fail(`Gate ${name}: qubits is ${def.qubits} but the matrix is ${m.rows}x${m.rows} (${q} qubit${q === 1 ? '' : 's'})`, node);
      }
      def.qubits = q;
      def.matrix = m;
      def.matrixText = props.matrix.text.trim();
      if (!isUnitary(m)) this.warn(`Gate ${name}: the matrix is not unitary`, node);
    } else {
      def.sequence = props.sequence.body;
      def.sequenceText = props.sequence.text;
    }
    this.gateDefs.set(name, def);
  }

  defineFunction(node) {
    this.checkNewName(node.name, node);
    this.functions.set(node.name, node);
  }

  // Variables

  /** Function and sequence scopes see their own names, then the globals. */
  lookup(name) {
    const top = this.scopes[this.scopes.length - 1];
    if (top.has(name)) return { found: true, value: top.get(name) };
    if (top !== this.globals && this.globals.has(name)) return { found: true, value: this.globals.get(name) };
    return { found: false };
  }

  setVar(name, value) {
    this.scopes[this.scopes.length - 1].set(name, value);
  }

  // Ops

  mapWire(w, node) {
    const map = this.wireMaps[this.wireMaps.length - 1];
    let wire = w;
    if (map) {
      if (w >= map.wires.length) this.fail(`Gate ${map.name} has ${map.wires.length} qubit${map.wires.length === 1 ? '' : 's'}; its sequence uses wire ${w}`, node);
      wire = map.wires[w];
    } else if (this.strict && w >= this.M) {
      this.fail(`Wire ${w} is out of range: MaxQubits is ${this.M}`, node);
    }
    if (wire > this.hi) this.hi = wire;
    return wire;
  }

  emit(op, node) {
    if (++this.opCount > MAX_OPS) this.fail(`The circuit exceeds ${MAX_OPS} ops`, node);
    if (node?.pos && !op.pos) op.pos = node.pos;
    const group = this.groupStack[this.groupStack.length - 1];
    if (group) {
      op.group = group;
      const wires = opWires(op);
      for (const gr of this.groupStack) {
        const set = this.groupWires.get(gr.id);
        wires.forEach((w) => set.add(w));
      }
    }
    const loop = this.loopStack[this.loopStack.length - 1];
    if (loop) {
      op.loopId = loop.id;
      op.iteration = loop.iteration;
    }
    if (this.mode === 'execute' && op.kind === 'gate') this.backend.applyOp(op);
    this.out.push(op);
  }

  pushGroup(name, kind, node, blackbox = false) {
    const group = {
      id: this.nextGroupId++,
      name,
      callText: node.text ?? name,
      wires: [],
      kind,
      blackbox,
    };
    const parent = this.groupStack[this.groupStack.length - 1];
    if (parent) group.parent = parent;
    this.groups.push(group);
    this.groupWires.set(group.id, new Set());
    this.groupStack.push(group);
    return group;
  }

  popGroup() {
    this.groupStack.pop();
  }

  // Statements

  run() {
    this.hoist(this.program.body);
    this.execBlock(this.program.body);
    for (const gr of this.groups) gr.wires = [...this.groupWires.get(gr.id)].sort((a, b) => a - b);
  }

  execBlock(body) {
    for (const st of body) this.exec(st);
  }

  exec(st) {
    switch (st.type) {
      case 'Settings': case 'GateDef': case 'FunctionDef':
        return;
      case 'Import':
        return this.execBlock(st.body);
      case 'Assign':
        return this.setVar(st.name, this.ev(st.expr));
      case 'MeasureAssign':
        return this.measure(st, st.name);
      case 'IncDec': {
        const cur = this.lookup(st.name);
        if (!cur.found) this.fail(`${st.name} is not defined; assign it before ${st.delta > 0 ? '++' : '--'}`, st);
        if (cur.value instanceof Unknown) return this.setVar(st.name, new Unknown(st.name));
        const n = this.num(cur.value, st, st.delta > 0 ? '++' : '--');
        return this.setVar(st.name, n + st.delta);
      }
      case 'ExprStmt':
        this.ev(st.expr);
        return;
      case 'Call':
        return this.call(st);
      case 'Loop':
        return this.loop(st);
      case 'If':
        return this.ifStmt(st);
      case 'Label':
        return this.label(st);
      case 'Annotate':
        return this.annotate(st);
      default:
        return this.fail(`Unknown statement ${st.type}`, st);
    }
  }

  label(st) {
    const res = this.wires(st.wires, true);
    const text = this.interpolate(st.text);
    this.labels.push({ wires: res.wires, text, rawText: st.text.raw, opIndex: this.ops.length });
  }

  annotate(st) {
    const record = this.captureDepth === 0;
    const startOp = this.ops.length;
    this.execBlock(st.body);
    const id = this.interpolate(st.id);
    if (!record) return;
    const wires = new Set();
    for (let k = startOp; k < this.ops.length; k++) opWires(this.ops[k]).forEach((w) => wires.add(w));
    this.annotations.push({ id, startOp, endOp: this.ops.length, wires: [...wires].sort((a, b) => a - b) });
  }

  loop(st) {
    let count = null;
    let isWhile = false;
    let first = null;
    if (st.header.type === 'Sweep') {
      const v = this.sweepValue(st.header);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) this.fail(`${st.keyword} <...> sweeps whole iteration counts of 0 or more`, st.header);
      count = v;
    } else {
      const v = this.ev(st.header);
      if (v instanceof Unknown) this.fail(`${st.keyword} depends on a measurement result, which is unknown while tracing`, st.header);
      if (typeof v === 'boolean') {
        isWhile = true;
        first = v;
      } else if (typeof v === 'number') {
        if (!Number.isInteger(v) || v < 0) this.fail(`${st.keyword} count must be a whole number of 0 or more, got ${v}`, st.header);
        count = v;
      } else {
        this.fail(`${st.keyword} takes a count or a condition, got ${typeName(v)}`, st.header);
      }
    }
    const info = {
      id: this.nextLoopId++,
      keyword: st.keyword,
      headerText: st.headerText,
      iterations: 0,
      startOp: this.ops.length,
      endOp: this.ops.length,
      iterationStarts: [],
    };
    const record = this.captureDepth === 0;
    if (record) this.loops.push(info);
    const frame = { id: info.id, iteration: 0 };
    if (record) this.loopStack.push(frame);
    try {
      let k = 0;
      for (;;) {
        if (isWhile) {
          const c = k === 0 ? first : this.ev(st.header);
          if (c instanceof Unknown) this.fail(`${st.keyword} condition depends on a measurement result`, st.header);
          if (!truthy(c)) break;
          if (k >= MAX_WHILE) this.fail(`${st.keyword} condition is still true after ${MAX_WHILE} iterations`, st.header);
        } else if (k >= count) {
          break;
        }
        frame.iteration = k;
        info.iterationStarts.push(this.ops.length);
        this.execBlock(st.body);
        k++;
      }
      info.iterations = k;
    } finally {
      if (record) this.loopStack.pop();
    }
    info.endOp = this.ops.length;
  }

  ifStmt(st) {
    for (let k = 0; k < st.branches.length; k++) {
      const b = st.branches[k];
      const c = this.ev(b.cond);
      if (c instanceof Unknown) return this.traceIf(st, k);
      if (truthy(c)) return this.execBlock(b.body);
    }
    if (st.elseBody) this.execBlock(st.elseBody);
    return undefined;
  }

  capture(fn, changed) {
    const savedOut = this.out;
    const snapshot = this.scopes.map((s) => {
      const copy = new Map(s);
      copy.isolated = s.isolated;
      return copy;
    });
    this.out = [];
    this.captureDepth++;
    try {
      try {
        fn();
      } catch (e) {
        if (!(e instanceof BranchStop)) throw e;
        this.warn(`error("${e.text}") is reachable in a branch that depends on a measurement`, e.node);
      }
      return this.out;
    } finally {
      this.scopes.forEach((s, k) => {
        const before = snapshot[k];
        for (const [name, v] of s) if (!before.has(name) || before.get(name) !== v) changed.add(name);
      });
      this.scopes.forEach((s, k) => {
        s.clear();
        for (const [name, v] of snapshot[k]) s.set(name, v);
      });
      this.out = savedOut;
      this.captureDepth--;
    }
  }

  traceIf(st, from) {
    const branches = [];
    const changed = new Set();
    let elseBody = st.elseBody;
    for (let k = from; k < st.branches.length; k++) {
      const b = st.branches[k];
      if (k > from) {
        const c = this.ev(b.cond);
        if (!(c instanceof Unknown)) {
          if (!truthy(c)) continue;
          elseBody = b.body;
          break;
        }
      }
      const ops = this.capture(() => this.execBlock(b.body), changed);
      branches.push({ condText: b.condText, ops });
    }
    const elseOps = elseBody ? this.capture(() => this.execBlock(elseBody), changed) : [];
    for (const name of changed) this.setVar(name, new Unknown(name));
    const wires = new Set();
    for (const op of [...branches.flatMap((b) => b.ops), ...elseOps]) opWires(op).forEach((w) => wires.add(w));
    this.emit({
      kind: 'if', name: 'if', targets: [...wires].sort((a, b) => a - b), controls: [], params: [], branches, elseOps,
    }, st);
  }

  measure(st, register) {
    const res = this.wires(st.wires, false, 'MEASURE');
    if (res.register) this.fail('MEASURE takes parentheses, not brackets: MEASURE (0,1)', st);
    const wires = res.wires;
    if (!wires.length) this.fail('MEASURE needs at least one wire', st);
    const order = wires.slice().sort((a, b) => a - b);
    wires.forEach((w) => {
      const op = { kind: 'measure', name: 'MEASURE', targets: [w], controls: [], params: [] };
      if (register) op.register = `${register}[${order.indexOf(w)}]`;
      this.emit(op, st);
    });
    let value;
    if (this.mode === 'execute') {
      const bits = this.backend.measure(wires.slice());
      if (!Array.isArray(bits) || bits.length !== wires.length) this.fail('The backend returned the wrong number of measured bits', st);
      let v = 0;
      wires.forEach((w, k) => { if (bits[k]) v += 2 ** order.indexOf(w); });
      value = new Bits(v, wires.length);
    } else {
      value = new Unknown(register ?? 'MEASURE', 'bitstring');
    }
    if (register) this.setVar(register, value);
  }

  // Calls

  call(st) {
    let name = st.name;
    if (st.nameExpr) {
      const v = this.ev(st.nameExpr);
      if (!(v instanceof GateRef)) this.fail('A sweep in gate position lists gates, as in <H,X> 0', st.nameExpr);
      name = v.name;
    } else {
      const v = this.lookup(name);
      if (v.found) {
        if (!(v.value instanceof GateRef)) this.fail(`${name} is a variable, not a gate`, st);
        name = v.value.name;
      }
    }
    if (GATE_INFO[name]) return this.native(name, st);
    if (this.gateDefs.has(name)) return this.userGate(this.gateDefs.get(name), st);
    if (this.functions.has(name)) return this.callFunction(this.functions.get(name), st);
    if (STDLIB_NAMES.includes(name)) return this.stdlib(name, st);
    return this.fail(this.unknownGateMessage(name), st);
  }

  unknownGateMessage(name) {
    const upper = name.toUpperCase();
    if (GATE_INFO[upper]) return `Unknown gate ${name}. Gate names are case-sensitive: ${upper}`;
    const known = [...Object.keys(GATE_INFO), ...STDLIB_NAMES, ...this.gateDefs.keys(), ...this.functions.keys()];
    const near = known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? known.find((k) => editDistance(k, name) <= 1 && k.length > 1);
    return near ? `Unknown gate ${name}. Did you mean ${near}?` : `Unknown gate or function ${name}`;
  }

  angle(node, gate) {
    const v = this.ev(node);
    if (v instanceof Unknown) this.fail(`${gate} angle depends on a measurement result, which is unknown while tracing`, node);
    if (typeof v !== 'number' && !(v instanceof Bits)) this.fail(`${gate} angles are numbers, got ${typeName(v)}`, node);
    return angleToRadians(v instanceof Bits ? v.value : v, this.codeUnit);
  }

  native(name, st) {
    const info = GATE_INFO[name];
    if (st.angles && st.trailing.length) this.fail(`${name} has two angle lists; use ${name}(0.5) q or ${name} q 0.5`, st);
    const angleNodes = st.angles ?? (st.trailing.length ? st.trailing : null);
    let params = [];
    let paramText;
    if (angleNodes) {
      if (info.params === 0) this.fail(`${name} takes no angle`, st);
      if (angleNodes.length !== info.params) {
        this.fail(info.params === 3 ? `${name} takes 3 angles: ${name}(theta, phi, lambda) q` : `${name} takes 1 angle: ${name}(0.5) q`, st);
      }
      params = angleNodes.map((n) => this.angle(n, name));
      paramText = angleNodes.map((n) => n.text);
    } else if (info.params > 0) {
      if (!info.defaultParams) this.fail(`${name} takes ${info.params} angles: ${name}(theta, phi, lambda) q`, st);
      params = info.defaultParams.slice();
    }
    if (!st.wires) this.fail(`${name} needs wires, for example ${info.controlled ? `${name} [0,1]` : `${name} 0`}`, st);
    if (name === 'MEASURE') return this.measure(st, null);
    const res = this.wires(st.wires, true, name);
    const withParams = (op) => {
      if (paramText) op.paramText = paramText;
      return op;
    };
    if (info.controlled) {
      if (!res.register) this.fail(`Controlled gates take a bracket register: ${name} [c,t]`, st);
      const need = info.targets + 1;
      if (res.wires.length < need) this.fail(`${name} needs at least ${need} wires in its register: ${name} [${need === 2 ? 'c,t' : 'c,t1,t2'}]`, st);
      const split = res.wires.length - info.targets;
      return this.emit(withParams({
        kind: 'gate', name, targets: res.wires.slice(split), controls: res.wires.slice(0, split), params,
      }), st);
    }
    if (name === 'SWAPSEQ') {
      const w = res.wires;
      this.pushGroup('SWAPSEQ', 'gate', st);
      try {
        for (let k = 0; k < Math.floor(w.length / 2); k++) {
          this.emit({ kind: 'gate', name: 'SWAP', targets: [w[k], w[w.length - 1 - k]], controls: [], params: [] }, st);
        }
      } finally {
        this.popGroup();
      }
      return undefined;
    }
    if (info.targets === 2) {
      if (res.wires.length !== 2) this.fail(`${name} takes two wires: ${name} [a,b]`, st);
      return this.emit({ kind: 'gate', name, targets: res.wires, controls: [], params }, st);
    }
    if (res.register) this.fail(`${name} takes wires, not a bracket register; use ${name} (${res.wires.join(',')})`, st);
    for (const w of res.wires) this.emit(withParams({ kind: 'gate', name, targets: [w], controls: [], params: params.slice() }), st);
    return undefined;
  }

  callWireValue(st, name) {
    if (st.trailing.length) this.fail(`${name} takes no values after its wires`, st);
    if (st.args && st.wires) this.fail(`${name} takes its wires once: ${name}(0,1) or ${name} [0,1]`, st);
    if (st.args) return st.args.length === 1 ? this.ev(st.args[0]) : st.args.map((a) => this.ev(a));
    if (!st.wires) this.fail(`${name} needs wires, for example ${name} 0`, st);
    return null;
  }

  userGate(def, st) {
    const v = this.callWireValue(st, def.name);
    const res = v === null ? this.wires(st.wires, true, def.name) : this.wireValue(v, st, true, def.name);
    const q = def.qubits;
    let sets;
    if (q === 1 && !res.register) sets = res.wires.map((w) => [w]);
    else if (q === null) sets = [res.wires];
    else {
      if (res.wires.length !== q) {
        this.fail(q === 1 ? `${def.name} acts on 1 qubit: ${def.name} 0` : `${def.name} acts on ${q} qubits: ${def.name} [${range(q).join(',')}]`, st);
      }
      sets = [res.wires];
    }
    for (const wires of sets) {
      if (def.matrix) {
        const op = { kind: 'gate', name: def.name, targets: wires, controls: [], params: [], matrix: def.matrix, label: def.label };
        if (def.color) op.color = def.color;
        this.emit(op, st);
        continue;
      }
      if (this.callDepth >= MAX_CALL_DEPTH) this.fail(`Gate ${def.name} nests deeper than ${MAX_CALL_DEPTH} calls`, st);
      this.pushGroup(def.name, 'gate', st);
      this.wireMaps.push({ name: def.name, wires });
      const scope = new Map();
      scope.isolated = true;
      this.scopes.push(scope);
      this.callDepth++;
      try {
        this.execBlock(def.sequence);
      } finally {
        this.callDepth--;
        this.scopes.pop();
        this.wireMaps.pop();
        this.popGroup();
      }
    }
  }

  callArgs(st) {
    if (st.args && st.wires) this.fail(`${st.name} takes one argument list: ${st.name}(a, b)`, st);
    let args = [];
    if (st.args) args = st.args.map((a) => this.ev(a));
    else if (st.wires) {
      if (st.wires.type === 'List' && !st.wires.parenthesized) args = st.wires.items.map((a) => this.ev(a));
      else args = [this.ev(st.wires)];
    }
    return [...args, ...st.trailing.map((a) => this.ev(a))];
  }

  callFunction(fn, st) {
    const args = this.callArgs(st);
    if (args.length < fn.params.length) {
      this.fail(`${fn.name} expects ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'}, got ${args.length}`, st);
    }
    if (this.callDepth >= MAX_CALL_DEPTH) this.fail(`${fn.name} nests deeper than ${MAX_CALL_DEPTH} calls`, st);
    const scope = new Map();
    scope.isolated = true;
    fn.params.forEach((p, k) => scope.set(p, args[k]));
    const flat = [];
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x instanceof RegisterVal) x.wires.forEach(walk);
      else flat.push(x);
    };
    args.forEach(walk);
    scope.set('arg', flat);
    scope.set('argmax', flat.length - 1);
    this.pushGroup(fn.name, 'function', st, fn.modifiers.blackbox || fn.modifiers.encapsulate);
    this.scopes.push(scope);
    this.callDepth++;
    try {
      this.execBlock(fn.body);
    } finally {
      this.callDepth--;
      this.scopes.pop();
      this.popGroup();
    }
  }

  stdlib(name, st) {
    const args = this.callArgs(st);
    for (const a of args) if (a instanceof Unknown) this.fail(`${name} arguments depend on a measurement result, which is unknown while tracing`, st);
    const ctx = {
      fail: (msg) => this.fail(msg, st),
      angle: (v) => angleToRadians(v, this.codeUnit),
    };
    const ops = expandStdlib(name, args, ctx);
    this.pushGroup(name, 'stdlib', st);
    try {
      for (const spec of ops) {
        this.emit({
          kind: 'gate',
          name: spec.name,
          targets: spec.targets.map((w) => this.mapWire(w, st)),
          controls: spec.controls.map((w) => this.mapWire(w, st)),
          params: spec.params,
        }, st);
      }
    } finally {
      this.popGroup();
    }
  }

  // Wires

  wires(node, allowRegister, who) {
    return this.wireValue(this.ev(node), node, allowRegister, who);
  }

  wireValue(v, node, allowRegister, who = 'Wires') {
    let raw;
    let register = false;
    if (v instanceof RegisterVal) {
      if (!allowRegister) this.fail(`${who} takes parentheses, not brackets: ${who} (0,1)`, node);
      raw = v.wires;
      register = true;
    } else {
      raw = [];
      const walk = (x) => {
        if (Array.isArray(x)) x.forEach(walk);
        else raw.push(x);
      };
      walk(v);
    }
    const out = raw.map((w) => {
      if (w instanceof Unknown) this.fail('Wires cannot depend on a measurement result while tracing', node);
      if (w instanceof Bits) this.fail(`Wires are whole numbers, got bitstring ${w}; use (int) or tolist`, node);
      if (typeof w !== 'number' || !Number.isInteger(w) || w < 0) {
        this.fail(`Wires are whole numbers of 0 or more, got ${typeof w === 'number' ? w : typeName(w)}`, node);
      }
      return this.mapWire(w, node);
    });
    const seen = new Set();
    for (const w of out) {
      if (seen.has(w)) this.fail(`${who === 'Wires' ? 'The wire list' : who} lists wire ${w} twice`, node);
      seen.add(w);
    }
    return { wires: out, register };
  }

  // Expressions

  num(v, node, what) {
    if (typeof v === 'number') return v;
    if (v instanceof Bits) return v.value;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return this.fail(`${what} needs numbers, got ${typeName(v)}`, node);
  }

  dim(kind) {
    this.usedDim = true;
    const map = this.wireMaps[this.wireMaps.length - 1];
    if (map) return map.wires.length;
    return kind === 'max' ? this.M : this.V;
  }

  ident(node) {
    const name = node.name;
    switch (name) {
      case 'pi': case 'π': return Math.PI;
      case 'e': return Math.E;
      case 'max': return this.dim('max') - 1;
      case 'visiblemax': return this.dim('visible') - 1;
      case 'all': return range(this.dim('max'));
      case 'visible': return range(this.dim('visible'));
      default: break;
    }
    const v = this.lookup(name);
    if (v.found) return v.value;
    if (GATE_INFO[name] || this.gateDefs.has(name) || this.functions.has(name) || STDLIB_NAMES.includes(name)) return new GateRef(name);
    if (name === 'arg' || name === 'argmax') this.fail(`${name} is defined only inside a function`, node);
    return this.fail(`Unknown name ${name}`, node);
  }

  ev(node) {
    switch (node.type) {
      case 'Num': return node.value;
      case 'Bool': return node.value;
      case 'Bits': return new Bits(node.value, node.width);
      case 'Str': return this.interpolate(node);
      case 'Ident': return this.ident(node);
      case 'Unary': return this.unary(node);
      case 'Binary': return this.binary(node);
      case 'Ternary': {
        const c = this.ev(node.cond);
        if (c instanceof Unknown) return new Unknown(node.text);
        return truthy(c) ? this.ev(node.a) : this.ev(node.b);
      }
      case 'Range': return this.rangeValue(node);
      case 'Stepped': return this.steppedValue(node);
      case 'List': {
        const out = [];
        for (const item of node.items) {
          const v = this.ev(item);
          if ((item.type === 'Range' || item.type === 'Stepped') && !item.parenthesized) out.push(...v);
          else out.push(v);
        }
        return out;
      }
      case 'Register': {
        const wires = [];
        const walk = (x) => {
          if (Array.isArray(x)) x.forEach(walk);
          else if (x instanceof RegisterVal) x.wires.forEach(walk);
          else wires.push(x);
        };
        node.items.forEach((item) => walk(this.ev(item)));
        return new RegisterVal(wires);
      }
      case 'Index': return this.index(node);
      case 'Unit': {
        const v = this.ev(node.arg);
        if (v instanceof Unknown) return new Unknown(node.text);
        const r = angleToRadians(this.num(v, node, `The ${node.unit} suffix`), { deg: 'degrees', rad: 'radians', pirad: 'piradians' }[node.unit]);
        return radiansToUnit(r, this.codeUnit);
      }
      case 'Cast': return this.cast(node);
      case 'BuiltinCall': return this.builtin(node);
      case 'Sweep': return this.sweepValue(node);
      default: return this.fail(`Cannot evaluate ${node.type}`, node);
    }
  }

  interpolate(str) {
    return str.parts.map((p) => (typeof p === 'string' ? p : this.display(this.ev(p)))).join('');
  }

  display(v) {
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      return String(Number(v.toFixed(this.settings.DecimalPlaces)));
    }
    if (v instanceof Bits) return v.digits();
    if (Array.isArray(v)) return '(' + v.map((x) => this.display(x)).join(', ') + ')';
    return String(v);
  }

  unary(node) {
    const v = this.ev(node.arg);
    if (v instanceof Unknown) return new Unknown(node.text);
    switch (node.op) {
      case '-': return -this.num(v, node, 'Unary -');
      case '+': return this.num(v, node, 'Unary +');
      case '!': return !truthy(v);
      case '~':
        if (v instanceof Bits) return new Bits(Number(~BigInt(v.value) & ((1n << BigInt(v.width)) - 1n)), v.width);
        return ~this.int(v, node, '~');
      default: return this.fail(`Unknown operator ${node.op}`, node);
    }
  }

  int(v, node, what) {
    const n = this.num(v, node, what);
    if (!Number.isInteger(n)) this.fail(`${what} needs whole numbers, got ${n}`, node);
    return n;
  }

  binary(node) {
    const { op } = node;
    if (op === '&&' || op === '||') {
      const a = this.ev(node.left);
      if (!(a instanceof Unknown)) {
        if (op === '&&' && !truthy(a)) return false;
        if (op === '||' && truthy(a)) return true;
      }
      const b = this.ev(node.right);
      if (a instanceof Unknown || b instanceof Unknown) {
        if (!(b instanceof Unknown)) {
          if (op === '&&' && !truthy(b)) return false;
          if (op === '||' && truthy(b)) return true;
        }
        return new Unknown(node.text);
      }
      return truthy(b);
    }
    const a = this.ev(node.left);
    const b = this.ev(node.right);
    if (a instanceof Unknown || b instanceof Unknown) return new Unknown(node.text);
    switch (op) {
      case '^^': return truthy(a) !== truthy(b);
      case '==': return deepEqual(a, b);
      case '!=': return !deepEqual(a, b);
      case '<': case '>': case '<=': case '>=': {
        let x = a;
        let y = b;
        if (!(typeof a === 'string' && typeof b === 'string')) {
          x = this.num(a, node, `Comparison ${op}`);
          y = this.num(b, node, `Comparison ${op}`);
        }
        return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
      }
      case '&': case '|': case '^': {
        const bitsWidth = Math.max(a instanceof Bits ? a.width : 0, b instanceof Bits ? b.width : 0);
        const x = BigInt(this.int(a, node, op));
        const y = BigInt(this.int(b, node, op));
        if (x < 0n || y < 0n) this.fail(`${op} needs non-negative numbers`, node);
        const r = Number(op === '&' ? x & y : op === '|' ? x | y : x ^ y);
        return bitsWidth ? new Bits(r, Math.max(bitsWidth, r.toString(2).length)) : r;
      }
      case '+':
        if (typeof a === 'string' || typeof b === 'string') return this.display(a) + this.display(b);
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        return this.num(a, node, '+') + this.num(b, node, '+');
      case '-': return this.num(a, node, '-') - this.num(b, node, '-');
      case '*': return this.num(a, node, '*') * this.num(b, node, '*');
      case '/': case '%': case '//': {
        const x = this.num(a, node, op);
        const y = this.num(b, node, op);
        if (y === 0) this.fail(op === '%' ? 'Modulo by zero' : 'Division by zero', node);
        if (op === '/') return x / y;
        if (op === '%') return x % y;
        return Math.floor(x / y);
      }
      case '**': return this.num(a, node, '**') ** this.num(b, node, '**');
      default: return this.fail(`Unknown operator ${op}`, node);
    }
  }

  rangeValue(node) {
    const a = this.ev(node.start);
    const b = this.ev(node.end);
    return this.seq(a, 1, b, node, true);
  }

  steppedValue(node) {
    const a = this.ev(node.start);
    const s = this.ev(node.step);
    const b = this.ev(node.end);
    return this.seq(a, s, b, node, false);
  }

  seq(a, s, b, node, isRange) {
    for (const v of [a, s, b]) if (v instanceof Unknown) this.fail('Ranges cannot depend on a measurement result while tracing', node);
    const width = Math.max(a instanceof Bits ? a.width : 0, s instanceof Bits ? s.width : 0, b instanceof Bits ? b.width : 0);
    const start = this.num(a, node, isRange ? 'Range ..' : 'Stepped range');
    const end = this.num(b, node, isRange ? 'Range ..' : 'Stepped range');
    let step = this.num(s, node, 'Stepped range');
    if (isRange && end < start) step = -1;
    if (step === 0) this.fail('The step of a stepped range cannot be 0', node);
    const count = Math.floor((end - start) / step + 1e-9) + 1;
    if (count > MAX_LIST) this.fail(`Range has more than ${MAX_LIST} values`, node);
    const out = [];
    for (let k = 0; k < count; k++) {
      const v = roundClean(start + k * step);
      out.push(width ? new Bits(v, width) : v);
    }
    if (width && out.some((x) => x.value < 0 || !Number.isInteger(x.value) || x.value >= 2 ** MAX_BITS)) {
      this.fail('Bitstring ranges hold whole numbers of 0 or more', node);
    }
    return out;
  }

  index(node) {
    const obj = this.ev(node.obj);
    const idx = this.ev(node.index);
    if (obj instanceof Unknown || idx instanceof Unknown) {
      const bit = obj instanceof Unknown && obj.type === 'bitstring' && typeof idx === 'number';
      return new Unknown(node.text, bit ? 'int' : null);
    }
    let seqv;
    let kind;
    if (Array.isArray(obj)) { seqv = obj; kind = 'list'; }
    else if (obj instanceof RegisterVal) { seqv = obj.wires; kind = 'list'; }
    else if (typeof obj === 'string') { seqv = [...obj]; kind = 'string'; }
    else if (obj instanceof Bits) { seqv = range(obj.width).map((q) => obj.bit(q)); kind = 'bits'; }
    else this.fail(`Only lists, strings, and bitstrings can be indexed, got ${typeName(obj)}`, node);
    const pick = (i) => {
      const k = this.int(i, node, 'Index');
      const j = k < 0 ? seqv.length + k : k;
      if (j < 0 || j >= seqv.length) this.fail(`Index ${k} is out of range for length ${seqv.length}`, node);
      return seqv[j];
    };
    if (Array.isArray(idx)) {
      const items = idx.map(pick);
      if (kind === 'string') return items.join('');
      if (kind === 'bits') return new Bits(items.reduce((acc, bit, k) => acc + bit * 2 ** k, 0), items.length);
      return items;
    }
    return pick(idx);
  }

  cast(node) {
    const v = this.ev(node.arg);
    const to = node.to;
    if (v instanceof Unknown) return new Unknown(node.text, to === 'number' ? 'float' : to);
    const bad = () => this.fail(`Cannot cast ${typeName(v)} to ${to}`, node);
    const toInt = (x) => {
      if (typeof x === 'number') return Math.trunc(x);
      if (x instanceof Bits) return x.value;
      if (typeof x === 'boolean') return x ? 1 : 0;
      if (typeof x === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(x)) return Math.trunc(Number(x));
      if (typeof x === 'string' && /^\s*0b[01]+\s*$/.test(x)) return parseInt(x.trim().slice(2), 2);
      return bad();
    };
    switch (to) {
      case 'int': return toInt(v);
      case 'float': case 'number':
        if (typeof v === 'string') {
          const n = Number(v);
          return Number.isFinite(n) && v.trim() ? n : bad();
        }
        return typeof v === 'number' ? v : toInt(v);
      case 'string': return this.display(v);
      case 'boolean': return truthy(v);
      case 'bitstring': {
        if (v instanceof Bits) return v;
        if (typeof v === 'string' && /^(0b)?[01]+$/.test(v.trim())) {
          const d = v.trim().replace(/^0b/, '');
          return new Bits(parseInt(d, 2), d.length);
        }
        if (Array.isArray(v) && v.every((x) => x === 0 || x === 1)) {
          return new Bits(v.reduce((acc, bit, k) => acc + bit * 2 ** k, 0), v.length);
        }
        const n = toInt(v);
        if (n < 0) bad();
        return new Bits(n, Math.max(1, n.toString(2).length));
      }
      case 'qubit': case 'wire': {
        const n = toInt(v);
        if (n < 0) this.fail(`A wire is a whole number of 0 or more, got ${n}`, node);
        return n;
      }
      case 'list': return this.toList(v, node);
      case 'wirelist': case 'wires': case 'list-int': return this.toList(v, node).map(toInt);
      case 'list-list-int': return this.toList(v, node).map((x) => this.toList(x, node).map(toInt));
      default: return bad();
    }
  }

  toList(v, node) {
    if (Array.isArray(v)) return v.slice();
    if (v instanceof RegisterVal) return v.wires.slice();
    if (v instanceof Bits) return range(v.width).map((q) => v.bit(q));
    if (typeof v === 'string') return [...v];
    if (typeof v === 'number' || typeof v === 'boolean' || v instanceof GateRef) return [v];
    return this.fail(`Cannot make a list from ${typeName(v)}`, node);
  }

  builtin(node) {
    const name = node.name;
    const args = node.args.map((a) => this.ev(a));
    const arity = (lo, hi = lo) => {
      if (args.length < lo || args.length > hi) {
        this.fail(`${name} takes ${lo === hi ? lo : `${lo} or ${hi}`} argument${hi === 1 ? '' : 's'}`, node);
      }
    };
    if (name === 'error') {
      arity(1);
      if (this.captureDepth > 0) throw new BranchStop(this.display(args[0]), node);
      this.fail(this.display(args[0]), node);
    }
    if (name === 'typeof') {
      arity(1);
      return typeName(args[0]);
    }
    if (args.some((a) => a instanceof Unknown)) {
      return new Unknown(node.text, name === 'len' || name === 'length' || name === 'count' ? 'int' : null);
    }
    const x = args[0];
    switch (name) {
      case 'sqrt': {
        arity(1);
        const n = this.num(x, node, 'sqrt');
        if (n < 0) this.fail(`sqrt of a negative number (${n})`, node);
        return Math.sqrt(n);
      }
      case 'round': {
        arity(1);
        const n = this.num(x, node, 'round');
        return Math.sign(n) * Math.round(Math.abs(n));
      }
      case 'roundup': arity(1); return Math.ceil(this.num(x, node, 'roundup'));
      case 'rounddown': arity(1); return Math.floor(this.num(x, node, 'rounddown'));
      case 'sin': case 'cos': case 'tan': {
        arity(1);
        const r = angleToRadians(this.num(x, node, name), this.codeUnit);
        return roundTrig(Math[name](r));
      }
      case 'asin': case 'acos': {
        arity(1);
        const n = this.num(x, node, name);
        if (n < -1 || n > 1) this.fail(`${name} takes a number from -1 to 1, got ${n}`, node);
        return Math[name](n);
      }
      case 'atan': arity(1); return Math.atan(this.num(x, node, 'atan'));
      case 'len': case 'length':
        arity(1);
        if (Array.isArray(x)) return x.length;
        if (x instanceof RegisterVal) return x.wires.length;
        if (typeof x === 'string') return x.length;
        if (x instanceof Bits) return x.width;
        return this.fail(`${name} takes a list, string, or bitstring, got ${typeName(x)}`, node);
      case 'count': {
        arity(1, 2);
        if (args.length === 2) {
          const needle = args[1];
          if (typeof x === 'string') {
            if (typeof needle !== 'string' || !needle) this.fail('count(string, text) needs non-empty text', node);
            return x.split(needle).length - 1;
          }
          if (x instanceof Bits) return range(x.width).filter((q) => x.bit(q) === this.num(needle, node, 'count')).length;
          return this.toList(x, node).filter((e) => deepEqual(e, needle)).length;
        }
        if (x instanceof Bits) return range(x.width).filter((q) => x.bit(q)).length;
        if (Array.isArray(x)) return x.filter(truthy).length;
        if (x instanceof RegisterVal) return x.wires.length;
        return this.fail(`count takes a list or a bitstring, got ${typeName(x)}`, node);
      }
      case 'tolist': arity(1); return this.toList(x, node);
      case 'listtype': arity(1); return listType(x);
      default:
        return this.fail(`Unknown function ${name}`, node);
    }
  }

  sweepValue(node) {
    let axis = this.sweepSites.get(node.site);
    if (!axis) {
      const raw = [];
      for (const item of node.items) {
        if (item.type === 'Ident' && !this.lookup(item.name).found) {
          const n = item.name;
          if (GATE_INFO[n] || this.gateDefs.has(n) || this.functions.has(n) || STDLIB_NAMES.includes(n)) {
            raw.push(new GateRef(n));
            continue;
          }
        }
        const v = this.ev(item);
        if (v instanceof Unknown) this.fail('Sweep values cannot depend on a measurement result', item);
        if (Array.isArray(v)) raw.push(...v);
        else raw.push(v);
      }
      const gates = raw.filter((v) => v instanceof GateRef).length;
      if (gates && gates !== raw.length) this.fail('A sweep lists values or gates, not both', node);
      if (!raw.length) this.fail('Sweep has no values', node);
      const named = node.axisName && !node.axisName.startsWith('<');
      let key = named ? node.axisName : `${node.axisName}@${node.site}`;
      if (this.sweeps.some((s) => s.key === key)) key = `${node.axisName}@${node.site}`;
      axis = { key, name: node.axisName, kind: gates ? 'gate' : 'value', values: raw.map(plain), raw };
      this.sweepSites.set(node.site, axis);
      this.sweeps.push(axis);
    }
    const idx = this.sweepPoint[axis.key] ?? 0;
    if (!Number.isInteger(idx) || idx < 0 || idx >= axis.raw.length) this.fail(`Sweep point ${idx} is out of range for ${axis.key}`, node);
    return axis.raw[idx];
  }
}

/** Raised by error() inside a traced branch; the branch stops there. */
class BranchStop extends Error {
  constructor(text, node) {
    super(text);
    this.text = text;
    this.node = node;
  }
}

function roundTrig(x) {
  return Math.abs(x) < 1e-15 ? 0 : x;
}

function range(n) {
  return Array.from({ length: n }, (_, k) => k);
}

/** Edit distance counting insertions, deletions, substitutions, and adjacent swaps. */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * All wires an op touches: controls then targets. An `if` op's targets already
 * hold the union of its branches' wires.
 * @param {import('./ir.js').Op} op
 * @returns {number[]}
 */
export function opWires(op) {
  return [...op.controls, ...op.targets];
}

/**
 * @typedef {Object} EvaluateOptions
 * @property {'trace'|'execute'} [mode] Default 'trace'.
 * @property {{applyOp: (op: import('./ir.js').Op) => void, measure: (wires: number[]) => number[], begin?: (numQubits: number) => void}} [backend] Required for 'execute'.
 * @property {Record<string, number>} [sweepPoint] Sweep axis key to value index; missing axes use index 0.
 */

/**
 * Evaluate a parsed program into a circuit.
 * @param {import('./grammar.js').Program} program
 * @param {EvaluateOptions} [opts]
 * @returns {import('./ir.js').Circuit}
 * @throws {QubiError} On the first evaluation error.
 */
export function evaluateProgram(program, opts = {}) {
  if (program.errors?.length) throw program.errors[0];
  const mode = opts.mode ?? 'trace';
  if (mode !== 'trace' && mode !== 'execute') throw new QubiError(`Unknown mode ${mode}: use trace or execute`);
  if (mode === 'execute' && (!opts.backend || typeof opts.backend.applyOp !== 'function' || typeof opts.backend.measure !== 'function')) {
    throw new QubiError('Execute mode needs a backend with applyOp(op) and measure(wires)');
  }
  const settings = { ...SETTING_DEFAULTS };
  collectSettings(program.body, settings);
  const maxSet = settings.MaxQubits;
  const visSet = settings.VisibleQubits;
  const warnings = [];
  if (maxSet !== null && visSet !== null && visSet > maxSet) {
    warnings.push({ severity: 'warning', message: `VisibleQubits (${visSet}) is larger than MaxQubits (${maxSet}); using ${maxSet}` });
  }
  const dimsFor = (M) => ({ M, V: Math.min(visSet ?? M, M), strict: maxSet !== null });
  const traceOpts = { ...opts, mode: 'trace', backend: undefined };

  let M = maxSet ?? Math.max(DEFAULT_QUBITS, visSet ?? 0);
  let ev;
  let traceError = null;
  for (let iter = 0; iter < 6; iter++) {
    ev = new Evaluator(program, traceOpts, dimsFor(M), settings);
    try {
      ev.run();
    } catch (e) {
      if (mode !== 'execute') throw e;
      traceError = e;
      break;
    }
    const next = maxSet ?? Math.max(ev.hi + 1, ev.usedDim ? DEFAULT_QUBITS : 1, visSet ?? 1);
    if (next === M) break;
    M = next;
  }
  if (mode === 'execute') {
    if (traceError) M = maxSet ?? Math.max(DEFAULT_QUBITS, visSet ?? 0);
    ev = new Evaluator(program, opts, { ...dimsFor(M), strict: true }, settings);
    opts.backend.begin?.(M);
    ev.run();
  }
  const dims = dimsFor(M);
  let visibleQubits = dims.V;
  if (settings.AutoAdjustVisibleQubits) visibleQubits = Math.min(M, Math.max(visibleQubits, ev.hi + 1));
  const variables = {};
  for (const [name, v] of ev.globals) variables[name] = plain(v);
  const gateDefs = {};
  for (const [name, def] of ev.gateDefs) {
    const { sequence: _sequence, ...rest } = def;
    gateDefs[name] = rest;
  }
  return {
    numQubits: M,
    visibleQubits,
    ops: ev.ops,
    labels: ev.labels,
    annotations: ev.annotations,
    loops: ev.loops,
    sweeps: ev.sweeps.map(({ key, name, kind, values }) => ({ key, name, kind, values })),
    settings: { ...settings, MaxQubits: M, VisibleQubits: dims.V },
    gateDefs,
    variables,
    diagnostics: [...warnings, ...ev.diagnostics],
  };
}
