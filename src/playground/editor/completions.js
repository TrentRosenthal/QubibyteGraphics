/**
 * Completion providers for the code editor. JavaScript completions come
 * from the generated API index (every public export with the first sentence
 * of its JSDoc, and Scene methods after `scene.`); Qubi completions list
 * gates with their arity, wire forms, `#settings` keys and values, keywords,
 * and standard library calls with their signatures.
 * @module playground/editor/completions
 */

import { SETTINGS_KEYS, STDLIB_NAMES } from '../../qubi/index.js';

/**
 * @typedef {Object} Completion
 * @property {string} label text shown and matched
 * @property {string} insert text inserted in place of the typed prefix
 * @property {string} kind function, class, const, namespace, method, gate, wire, setting, value, keyword, stdlib
 * @property {string} detail short signature or arity
 * @property {string} doc one sentence
 */

/** Qubi gates with their arity notes. */
const QUBI_GATES = [
  ['I', 'I q', 'Identity on one qubit.'],
  ['H', 'H q', 'Hadamard: a basis state becomes an equal superposition.'],
  ['X', 'X q', 'Bit flip.'],
  ['Y', 'Y q', 'Bit flip with a phase of i.'],
  ['Z', 'Z q', 'Phase flip of the 1 component.'],
  ['S', 'S q', 'Quarter-turn phase on the 1 component.'],
  ['T', 'T q', 'Eighth-turn phase on the 1 component.'],
  ['SDG', 'SDG q', 'Inverse of S.'],
  ['TDG', 'TDG q', 'Inverse of T.'],
  ['RX', 'RX(angle) q', 'Rotation about x; one qubit, one angle in CodeAngleUnit.'],
  ['RY', 'RY(angle) q', 'Rotation about y; one qubit, one angle in CodeAngleUnit.'],
  ['RZ', 'RZ(angle) q', 'Rotation about z; one qubit, one angle in CodeAngleUnit.'],
  ['P', 'P(angle) q', 'Phase on the 1 component; one qubit, one angle.'],
  ['U', 'U(theta, phi, lambda) q', 'General one-qubit unitary from three angles.'],
  ['CX', 'CX [control, target]', 'Controlled X; bracket register, the last wire is the target.'],
  ['CY', 'CY [control, target]', 'Controlled Y; bracket register, the last wire is the target.'],
  ['CZ', 'CZ [control, target]', 'Controlled Z; bracket register, any number of controls.'],
  ['CP', 'CP(angle) [control, target]', 'Controlled phase; bracket register and one angle.'],
  ['SWAP', 'SWAP [a, b]', 'Exchange two qubits.'],
  ['CSWAP', 'CSWAP [control, a, b]', 'Controlled swap of the last two wires.'],
  ['ISWAP', 'ISWAP [a, b]', 'Swap with a phase of i on the exchanged terms.'],
  ['SQRTSWAP', 'SQRTSWAP [a, b]', 'Square root of SWAP.'],
  ['SWAPSEQ', 'SWAPSEQ wires', 'Reverse the order of the listed wires with SWAPs.'],
  ['MEASURE', 'MEASURE (a, b)', 'Measure wires; `m = MEASURE (a, b)` keeps the bits.'],
];

const WIRE_FORMS = [
  ['all', 'all', 'Every qubit: (0..MaxQubits-1).'],
  ['visible', 'visible', 'The visible qubits: (0..VisibleQubits-1).'],
  ['max', 'max', 'The last qubit, MaxQubits-1.'],
  ['visiblemax', 'visiblemax', 'The last visible qubit, VisibleQubits-1.'],
  ['A..B', '0..2', 'Range, both ends included; counts down when B < A.'],
  ['A.S.E', '0.2.6', 'Stepped range: start, step, end.'],
  ['(a,b)', '(0,1)', 'Parallel list: the gate acts on each wire.'],
  ['[c,t]', '[0,1]', 'Register: controls first, the target last.'],
];

const KEYWORDS = [
  ['LOOP', 'LOOP n { }', 'Repeat a block n times.'],
  ['REPEAT', 'REPEAT n { }', 'Repeat a block n times.'],
  ['if', 'if cond { }', 'Branch on a classical condition.'],
  ['elseif', 'elseif cond { }', 'Another branch.'],
  ['else', 'else { }', 'The fallback branch.'],
  ['fn', 'fn Name(q) { }', 'Define a function.'],
  ['gate', 'gate NAME { matrix: ... }', 'Define a gate from a matrix or a sequence.'],
  ['LABEL', 'LABEL wires "text"', 'Label the circuit at this point.'],
  ['ANNOTATE', 'ANNOTATE', 'Open an annotated region.'],
  ['ENDANNOTATE', 'ENDANNOTATE "id"', 'Close and name the annotated region.'],
];

const DIRECTIVES = [
  ['#settings', '#settings ', 'Set a program setting: #settings KEY VALUE.'],
  ['#import', '#import "file.qubi"', 'Include another Qubi file.'],
  ['#include', '#include "file.qubi"', 'Alias of #import.'],
];

const BOOL = ['true', 'false'];
const UNITS = ['piradians', 'degrees', 'radians'];

/** Values each setting accepts. */
const SETTING_VALUES = {
  Scheduling: ['same_line', 'never', 'same_gate_continuous', 'same_gate', 'always', 'compressed'],
  MaxQubits: ['1 to 1024'],
  VisibleQubits: ['1 to 1024'],
  Zoom: ['1', '0.75', '1.5'],
  AutoAdjustVisibleQubits: BOOL,
  DecimalPlaces: ['3', '0 to 15'],
  AutoRun: BOOL,
  UseOptimizedGates: BOOL,
  UseOptimizedSweep: BOOL,
  StepByStep: BOOL,
  ShowGateParams: BOOL,
  ShowConditionalBranches: BOOL,
  ShowEvaluatedLabels: BOOL,
  GateParamAngleUnit: UNITS,
  CodeAngleUnit: UNITS,
  SymbolicNotation: BOOL,
  HideNegligibles: BOOL,
  SortBy: ['state', 'probability', 'amplitude', 'phase'],
  SortOrder: ['ascending', 'descending'],
};

function match(items, prefix) {
  const p = prefix.toLowerCase();
  return items
    .filter((it) => it.label.toLowerCase().startsWith(p) && it.label !== prefix)
    .sort((a, b) => Number(!a.label.startsWith(prefix)) - Number(!b.label.startsWith(prefix)) || a.label.length - b.label.length || a.label.localeCompare(b.label));
}

/**
 * Build completion providers from the generated API index.
 * @param {{exports: any[], scene: any[], qubi: {stdlib: any[]}}} index contents of api-index.json
 * @returns {{js: (before: string) => {from: number, items: Completion[]}, qubi: (before: string) => {from: number, items: Completion[]}, known: Set<string>}}
 */
export function createCompletions(index) {
  const jsItems = index.exports.map((e) => ({
    label: e.name,
    insert: e.name,
    kind: e.kind,
    detail: e.kind === 'class' ? `new ${e.name}${e.signature || '()'}` : e.kind === 'function' ? `${e.name}${e.signature}` : e.kind,
    doc: e.summary,
  }));
  const sceneItems = index.scene.map((m) => ({ label: m.name, insert: m.name, kind: 'method', detail: m.signature ? `scene.${m.name}${m.signature.length > 48 ? '(...)' : m.signature}` : `scene.${m.name}`, doc: m.summary }));
  const stdlib = new Map(index.qubi.stdlib.map((s) => [s.name, s]));
  const qubiItems = [
    ...QUBI_GATES.map(([label, detail, doc]) => ({ label, insert: label, kind: 'gate', detail, doc })),
    ...STDLIB_NAMES.map((name) => {
      const s = stdlib.get(name);
      return { label: name, insert: name, kind: 'stdlib', detail: s ? s.signatures.map((sig) => name + sig).join('  ') : `${name}(...)`, doc: s ? s.summary : '' };
    }),
    ...KEYWORDS.map(([label, detail, doc]) => ({ label, insert: label, kind: 'keyword', detail, doc })),
    ...WIRE_FORMS.filter(([l]) => /^[a-z]/.test(l)).map(([label, detail, doc]) => ({ label, insert: label, kind: 'wire', detail, doc })),
  ];
  const wireHints = WIRE_FORMS.map(([label, insert, doc]) => ({ label, insert, kind: 'wire', detail: 'wires', doc }));

  const js = (before) => {
    const m = /([A-Za-z_$][\w$]*)$/.exec(before);
    const prefix = m ? m[1] : '';
    const from = before.length - prefix.length;
    const beforeWord = before.slice(0, from);
    if (/\bscene\.\s*$/.test(beforeWord)) return { from, items: match(sceneItems, prefix).concat(prefix ? [] : sceneItems).slice(0, 40) };
    if (/\.\s*$/.test(beforeWord)) return { from, items: [] };
    if (!prefix) return { from, items: [] };
    return { from, items: match(jsItems, prefix).slice(0, 40) };
  };

  const qubi = (before) => {
    let m = /^\s*#settings\s+(\w+)\s+(\w*)$/.exec(before);
    if (m) {
      const key = SETTINGS_KEYS.find((k) => k.toLowerCase() === m[1].toLowerCase());
      const values = (key && SETTING_VALUES[key]) || [];
      const items = values.map((v) => ({ label: v, insert: /^\d+ to \d+$/.test(v) ? '' : v, kind: 'value', detail: key, doc: /^\d+ to \d+$/.test(v) ? `Whole number from ${v}.` : '' }));
      return { from: before.length - m[2].length, items: m[2] ? match(items, m[2]) : items };
    }
    m = /^\s*#settings\s+(\w*)$/.exec(before);
    if (m) {
      const items = SETTINGS_KEYS.map((k) => ({ label: k, insert: `${k} `, kind: 'setting', detail: (SETTING_VALUES[k] || []).slice(0, 3).join(' | '), doc: '' }));
      return { from: before.length - m[1].length, items: m[1] ? match(items, m[1]) : items };
    }
    m = /^\s*(#\w*)$/.exec(before);
    if (m) {
      const items = DIRECTIVES.map(([label, insert, doc]) => ({ label, insert, kind: 'keyword', detail: insert.trim(), doc }));
      return { from: before.length - m[1].length, items: match(items, m[1]) };
    }
    m = /([A-Za-z_]\w*)$/.exec(before);
    const prefix = m ? m[1] : '';
    const from = before.length - prefix.length;
    const gateBefore = /(?:^|\s)([A-Z]+)(?:\([^)]*\))?\s+$/.exec(before.slice(0, from));
    if (!prefix && gateBefore && QUBI_GATES.some(([g]) => g === gateBefore[1])) return { from, items: wireHints };
    if (!prefix) return { from, items: [] };
    return { from, items: match(qubiItems, prefix).slice(0, 40) };
  };

  return { js, qubi, known: new Set(index.exports.map((e) => e.name)) };
}
