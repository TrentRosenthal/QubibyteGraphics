#!/usr/bin/env node
/**
 * Build the playground's completion index, `src/playground/api-index.json`:
 * every name exported from src/index.js with its kind, signature, and the
 * first sentence of its JSDoc, and the Qubi standard library calls with
 * their signatures from docs/qubi-stdlib.md.
 *
 * Usage: node tools/build-api-index.js [--check]
 * With --check it fails when the committed file is out of date.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * First sentence of a JSDoc comment body.
 * @param {string} doc comment text without the delimiters
 * @returns {string}
 */
function firstSentence(doc) {
  const text = doc
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .filter((l) => !l.trim().startsWith('@'))
    .join(' ')
    .replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*([^}]+))?\}/g, (_, a, b) => b || a)
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = /^(.+?(?<!\.)[.!?](?!\.))(\s|$)/.exec(text);
  return (m ? m[1] : text).trim();
}

function jsdocBefore(src, index) {
  const before = src.slice(0, index);
  const end = before.lastIndexOf('*/');
  if (end < 0) return '';
  const between = before.slice(end + 2);
  if (between.trim() !== '') return '';
  const start = before.lastIndexOf('/**', end);
  if (start < 0) return '';
  return before.slice(start + 3, end);
}

function moduleDoc(src) {
  const m = /^\s*(?:#![^\n]*\n)?\s*\/\*\*([\s\S]*?)\*\//.exec(src);
  return m ? firstSentence(m[1]) : '';
}

function signatureAt(src, index, kind) {
  if (kind === 'function') {
    const open = src.indexOf('(', index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1).replace(/\s+/g, ' ').replace(/,\s*\)/, ')');
    }
    return '()';
  }
  if (kind === 'class') {
    const body = src.indexOf('{', index);
    const ctor = src.indexOf('constructor(', body);
    const nextClass = src.indexOf('\nexport ', body);
    if (ctor > 0 && (nextClass < 0 || ctor < nextClass)) return signatureAt(src, ctor, 'function');
    return '';
  }
  return '';
}

const cache = new Map();

/**
 * Exported declarations of a module, following re-exports.
 * @param {string} file absolute path
 * @returns {Map<string, {kind: string, signature: string, summary: string, module: string}>}
 */
function declarations(file) {
  if (cache.has(file)) return cache.get(file);
  const out = new Map();
  cache.set(file, out);
  if (!existsSync(file)) return out;
  const src = readFileSync(file, 'utf8');
  const mod = relative(ROOT, file).replace(/\\/g, '/');
  const re = /export\s+(?:async\s+)?(function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[1].startsWith('function') ? 'function' : m[1] === 'class' ? 'class' : 'const';
    out.set(m[2], { kind, signature: signatureAt(src, m.index, kind), summary: firstSentence(jsdocBefore(src, m.index)), module: mod });
  }
  const reexp = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = reexp.exec(src))) {
    const target = declarations(resolve(dirname(file), m[2]));
    for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const [orig, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
      const d = target.get(orig);
      out.set(alias ?? orig, d ? { ...d } : { kind: 'const', signature: '', summary: '', module: relative(ROOT, resolve(dirname(file), m[2])) });
    }
  }
  const star = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = star.exec(src))) for (const [k, v] of declarations(resolve(dirname(file), m[1]))) if (!out.has(k)) out.set(k, v);
  const ns = /export\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  while ((m = ns.exec(src))) {
    const target = resolve(dirname(file), m[2]);
    out.set(m[1], { kind: 'namespace', signature: '', summary: existsSync(target) ? moduleDoc(readFileSync(target, 'utf8')) : '', module: relative(ROOT, target) });
  }
  return out;
}

function stdlibIndex() {
  const md = readFileSync(join(ROOT, 'docs/qubi-stdlib.md'), 'utf8');
  const out = [];
  for (const line of md.split('\n')) {
    const m = /^\|\s*`([A-Za-z]+)\(([^`]*)\)`\s*\|\s*([^|]*)\|\s*(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const summary = firstSentence(m[4].replace(/&#124;/g, '|'));
    const sig = `(${m[2]})`;
    const existing = out.find((e) => e.name === m[1]);
    if (existing) existing.signatures.push(sig);
    else out.push({ name: m[1], signatures: [sig], defaults: m[3].trim(), summary });
  }
  return out;
}

/**
 * Public methods of the Scene class, for completions after `scene.`.
 * @returns {Array<{name: string, signature: string, summary: string}>}
 */
function sceneMembers() {
  const src = readFileSync(join(ROOT, 'src/core/scene.js'), 'utf8');
  const start = src.indexOf('export class Scene');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  const out = [];
  const re = /\n {2}(?:async\s+)?(?:get\s+)?([a-zA-Z]\w*)\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] === 'constructor') continue;
    const summary = firstSentence(jsdocBefore(body, m.index + 1));
    if (/@internal|@private/.test(jsdocBefore(body, m.index + 1))) continue;
    out.push({ name: m[1], signature: /\bget\s/.test(body.slice(m.index, m.index + 8)) ? '' : `(${m[2]})`, summary });
  }
  return out;
}

/**
 * Build both indexes.
 * @returns {{api: any}}
 */
export function buildIndexes() {
  const decl = declarations(join(ROOT, 'src/index.js'));
  const exports = [...decl].map(([name, d]) => {
    if (!d.summary && d.kind === 'function') {
      const cls = decl.get(name[0].toUpperCase() + name.slice(1));
      if (cls && cls.summary) return { name, ...d, summary: cls.summary };
    }
    return { name, ...d };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { api: { exports, scene: sceneMembers(), qubi: { stdlib: stdlibIndex() } } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { api } = buildIndexes();
  const files = [
    ['src/playground/api-index.json', JSON.stringify(api, null, 1) + '\n'],
  ];
  if (process.argv.includes('--check')) {
    const stale = files.filter(([f, text]) => !existsSync(join(ROOT, f)) || readFileSync(join(ROOT, f), 'utf8') !== text).map(([f]) => f);
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')}. Run npm run build:api.`);
      process.exit(1);
    }
    console.log('API index is up to date.');
  } else {
    for (const [f, text] of files) writeFileSync(join(ROOT, f), text);
    console.log(`Wrote ${api.exports.length} exports, ${api.qubi.stdlib.length} Qubi calls.`);
  }
}
