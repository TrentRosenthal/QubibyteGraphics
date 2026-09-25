#!/usr/bin/env node
/**
 * Slop lint. Fails when any tracked text file contains an em dash, an en dash,
 * a filler phrase, an emoji, a TODO marker, or a stub throw.
 *
 * Usage: node tools/lint-slop.js [--staged]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt', '.svg', '.qubi', '.qgfx']);
const SKIP_PREFIX = ['vendor/', 'docs/site/', 'dist/', 'tests/golden/expected/'];
const SELF = 'tools/lint-slop.js';

const DASHES = [
  { re: /—/g, name: 'em dash' },
  { re: /–/g, name: 'en dash' },
];

const PHRASES = [
  'welcome to',
  'unleash',
  'seamlessly',
  'seamless',
  'elevate',
  'powerful and intuitive',
  "whether you're a",
  'whether you are a',
  "in today's fast-paced",
  'in today’s fast-paced',
  'coming soon',
  'not implemented',
  'placeholder image',
  'placeholder text',
  'lorem ipsum',
  'game-changing',
  'cutting-edge',
  'state-of-the-art',
  'revolutionize',
  'supercharge',
  'effortlessly',
  'delve',
  'dive into',
  'robust and scalable',
  'next-level',
  'look no further',
  'unlock the',
  'tapestry',
  'a testament to',
];

const MARKERS = [
  { re: /\/\/\s*TODO\b/, name: 'TODO comment' },
  { re: /\/\/\s*FIXME\b/, name: 'FIXME comment' },
  { re: /\/\/\s*XXX\b/, name: 'XXX comment' },
  { re: /\/\*\s*TODO\b/, name: 'TODO comment' },
  { re: /<!--\s*TODO\b/, name: 'TODO comment' },
  { re: /throw new Error\((['"`])not implemented/i, name: 'stub throw' },
  { re: /assert\.ok\(true\)/, name: 'trivial assertion' },
  { re: /assert\.equal\(true,\s*true\)/, name: 'trivial assertion' },
  { re: /console\.log\(/, name: 'console.log', only: ['src/'] },
];

// Emoji ranges: pictographs, transport, symbols, flags, dingbats, and variation selectors.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/u;

function trackedFiles() {
  const out = execSync('git ls-files -z --cached --others --exclude-standard', { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

const problems = [];
for (const file of trackedFiles()) {
  if (file === SELF) continue;
  if (SKIP_PREFIX.some((p) => file.startsWith(p))) continue;
  if (!TEXT_EXT.has(extname(file))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    for (const d of DASHES) {
      if (d.re.test(line)) problems.push(`${where}: ${d.name}`);
      d.re.lastIndex = 0;
    }
    const lower = line.toLowerCase();
    for (const p of PHRASES) {
      if (lower.includes(p)) problems.push(`${where}: filler phrase "${p}"`);
    }
    for (const m of MARKERS) {
      if (m.only && !m.only.some((p) => file.startsWith(p))) continue;
      if (m.re.test(line)) problems.push(`${where}: ${m.name}`);
    }
    if (EMOJI.test(line)) problems.push(`${where}: emoji`);
  });
}

if (problems.length) {
  console.error('Slop lint failed:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('Slop lint passed.');
