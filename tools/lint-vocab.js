#!/usr/bin/env node
/**
 * Vocabulary lint. The public surface (src outside importers, docs, examples,
 * README, index.html) may only use Qubi's gate names. Names from other quantum
 * frameworks are allowed inside src/quantum/import/ and src/quantum/export/
 * where they are mapped to Qubi forms.
 *
 * Usage: node tools/lint-vocab.js
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// Foreign gate identifiers that must never appear on public surfaces as gate names.
const FOREIGN = [
  'CNOT', 'CCNOT', 'CCX', 'Toffoli', 'TOFFOLI', 'Fredkin', 'FREDKIN', 'Hadamard gate name h',
  'MCX', 'MCZ', 'MCT', 'CRX', 'CRY', 'CRZ', 'CU1', 'CU3', 'U1', 'U2', 'U3', 'RXX', 'RYY', 'RZZ', 'RZX',
  'CSX', 'SXdg', 'sxdg', 'Sdg', 'Tdg', 'SX', 'C3X', 'C4X', 'RCCX', 'ECR', 'XX_YY', 'XXPlusYY', 'XXMinusYY',
  'CPhase', 'CPHASE', 'ISwapPowGate', 'CZPowGate', 'XPowGate', 'FSim', 'FSIM', 'PhasedXPow',
];

const ALLOWED_PREFIX = ['src/quantum/import/', 'src/quantum/export/', 'tests/unit/quantum-import', 'tests/unit/quantum-export', 'vendor/', 'tools/lint-vocab.js', 'docs/DECISIONS.md', 'docs/THIRD_PARTY.md', 'CHANGELOG.md', 'docs/site/'];
const PUBLIC_PREFIX = ['src/', 'docs/', 'examples/', 'README.md', 'index.html', 'styles/', 'cli/', 'src/embed/'];
const TEXT_EXT = new Set(['.js', '.md', '.html', '.json', '.qubi', '.css']);

const patterns = FOREIGN.map((w) => ({ w, re: new RegExp(`(^|[^A-Za-z0-9_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`) }));

function trackedFiles() {
  const out = execSync('git ls-files -z --cached --others --exclude-standard', { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

const problems = [];
for (const file of trackedFiles()) {
  if (!PUBLIC_PREFIX.some((p) => file.startsWith(p))) continue;
  if (ALLOWED_PREFIX.some((p) => file.startsWith(p))) continue;
  if (!TEXT_EXT.has(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const { w, re } of patterns) {
      if (re.test(line)) problems.push(`${file}:${i + 1}: foreign gate name "${w}"`);
    }
  });
}

if (problems.length) {
  console.error('Vocabulary lint failed (use Qubi gate names on public surfaces):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('Vocabulary lint passed.');
