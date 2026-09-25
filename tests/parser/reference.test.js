import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, evaluate, STDLIB_NAMES } from '../../src/qubi/index.js';
import { NATIVE_GATES } from '../../src/qubi/ir.js';

const doc = readFileSync(new URL('../../docs/qubi-reference.md', import.meta.url), 'utf8');
const fences = [...doc.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
const spans = [...doc.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);

const NAMES = [...NATIVE_GATES, ...STDLIB_NAMES].join('|');
const STATEMENT = new RegExp(`^(#settings|#import|#include|LOOP|REPEAT|if|LABEL|ANNOTATE|ANN|function|fn)\\s+\\S|^endif$|^<|^[A-Za-z_]\\w*\\s*=[^=]|^(${NAMES})(\\(|\\s+[^A-Z\\s])`);
const statements = [...new Set(spans.filter((s) => STATEMENT.test(s)))];

/** Examples the reference itself marks as wrong. */
const NEGATIVE = {
  'CX (0,1)': /Controlled gates take a bracket register/,
  'CX (c,t)': /Controlled gates take a bracket register/,
  'MEASURE []': /MEASURE takes parentheses, not brackets/,
  endif: /Qubi has no endif/,
};

/** Templates with placeholders (KEY, NAME(...), alternatives) and the concrete forms that stand for them. */
const SCHEMATIC = {
  'if cond { } elseif { } else { }': ['cond = 1 > 0\nif cond { } elseif 2 > 1 { } else { }'],
  '#settings KEY VALUE': ['#settings MaxQubits 4\nH 0'],
  'function NAME(...) { }': ['function NAME(a, b) { }\nNAME(0, 1)'],
  'fn NAME(...) { }': ['fn NAME(a) { }\nNAME 0'],
  'StatePreparation("bell"|"ghz"|"superposition")': ['StatePreparation("bell")', 'StatePreparation("ghz")', 'StatePreparation("superposition")'],
  'ANN ... ENDANNOTATE': ['ANN\nH 0\nENDANNOTATE "id"'],
  'MEASURE ()': ['MEASURE (0)'],
};

/** Placeholder names used by the reference examples. */
const PRELUDE = 'q = 0\nc = 0\nt = 2\nc1 = 0\nc2 = 1\nn = 2\nv = 0\nexpr = 1\nwires = 0\n';
const resolveImport = () => 'H 0';

test('the reference yields a stable set of statement examples', () => {
  assert.ok(statements.length >= 40, `found ${statements.length}`);
  for (const s of ['Grover(0b110)', 'CX [c,t]', 'LOOP v<3 { v++ }', '<H,X> 0', 'RY 0 0.295', 'H (0, visiblemax, sqrt(4))']) {
    assert.ok(statements.includes(s), s);
  }
});

test('every negative example in the reference is rejected', () => {
  for (const [src, re] of Object.entries(NEGATIVE)) {
    assert.ok(statements.includes(src), `the reference still shows ${src}`);
    assert.throws(() => parse(src), re, src);
  }
});

test('every schematic example has concrete forms that evaluate', () => {
  for (const [src, forms] of Object.entries(SCHEMATIC)) {
    assert.ok(statements.includes(src), `the reference still shows ${src}`);
    for (const f of forms) assert.ok(evaluate(f, { resolveImport }), f);
  }
  assert.doesNotThrow(() => parse('MEASURE ()'), 'MEASURE () is a valid parse even though it measures nothing');
});

test('every other statement example parses and evaluates', () => {
  const plain = statements.filter((s) => !(s in NEGATIVE) && !(s in SCHEMATIC));
  assert.ok(plain.length >= 35);
  for (const src of plain) {
    assert.doesNotThrow(() => parse(src, { resolveImport }), src);
    assert.doesNotThrow(() => evaluate(PRELUDE + src, { resolveImport }), src);
  }
});

test('the fenced gate definition parses and runs', () => {
  assert.equal(fences.length, 1);
  const c = evaluate(fences[0] + '\nNAME 0');
  assert.equal(c.ops[0].name, 'NAME');
  assert.equal(c.gateDefs.NAME.displayName, 'Display Name');
});
