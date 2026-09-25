#!/usr/bin/env node
/**
 * Report exports under src/ that nothing uses: not imported by another
 * module, not re-exported from a public entry point (src/index.js and the
 * package subpath entries), and not referenced by tests, tools, examples,
 * or the CLI. Exits nonzero when it finds any, so dead code does not pile up.
 *
 *   node tools/check-exports.js
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const entries = new Set(['src/index.js', ...Object.values(pkg.exports ?? {}).map((p) => p.replace(/^\.\//, ''))]);
const srcFiles = walk('src');
const others = ['tests', 'tools', 'examples', 'cli'].flatMap((d) => walk(d)).concat(srcFiles);
const text = new Map(others.map((f) => [f, readFileSync(f, 'utf8')]));

const unused = [];
for (const file of srcFiles) {
  if (entries.has(relative('.', file))) continue;
  const src = text.get(file);
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
    const used = [...text].some(([f, t]) => f !== file && re.test(t)) || new RegExp(`\\b${name}\\b`, 'g').test(src.replace(new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|class|const|let)\\s+${name}\\b`, 'm'), ''));
    if (!used) unused.push(`${relative('.', file)}: ${name}`);
  }
}
if (unused.length) {
  console.error(`Exports nothing uses (${unused.length}):`);
  for (const u of unused) console.error(`  ${u}`);
  process.exit(1);
}
console.log('Every export is used.');
