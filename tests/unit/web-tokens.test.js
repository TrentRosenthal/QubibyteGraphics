import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { contrast, parseColor, rgbToOklab, oklabToRgb, toHex } from '../../src/core/color.js';
import { PROJECT } from '../../src/config.js';

const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');

/** Custom properties declared in the first rule whose selector matches. */
function block(selectorStart) {
  const i = css.indexOf(selectorStart);
  assert.ok(i >= 0, `tokens.css has ${selectorStart}`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const out = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const dark = block(':root,\n:host {');
const light = { ...dark, ...block(":root[data-ui-theme='light'] {") };

/** Resolve a token to a hex color, evaluating var() and color-mix(in oklab, ...). */
function resolve(vars, value, depth = 0) {
  assert.ok(depth < 20, `cycle resolving ${value}`);
  const v = value.trim();
  if (v === 'var(--brand)') return PROJECT.brandColor;
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return resolve(vars, vars[ref[1]], depth + 1);
  const mixm = /^color-mix\(in oklab,\s*(.+?)(?:\s+(\d+)%)?,\s*(.+?)(?:\s+(\d+)%)?\)$/.exec(v);
  if (mixm) {
    const [, a, pa, b, pb] = mixm;
    let wa = pa != null ? Number(pa) / 100 : pb != null ? 1 - Number(pb) / 100 : 0.5;
    if (b === 'transparent') return null;
    const A = rgbToOklab(parseColor(resolve(vars, a, depth + 1)));
    const B = rgbToOklab(parseColor(resolve(vars, b, depth + 1)));
    wa = Math.max(0, Math.min(1, wa));
    return toHex(oklabToRgb(A.L * wa + B.L * (1 - wa), A.a * wa + B.a * (1 - wa), A.b * wa + B.b * (1 - wa)));
  }
  if (/^(white|black)$/.test(v)) return v === 'white' ? '#ffffff' : '#000000';
  return v;
}

const TEXT = 4.5;
const PAIRS = [
  ['--text', '--bg', 7],
  ['--text', '--surface', 7],
  ['--text', '--surface-raised', 7],
  ['--text', '--stage', 7],
  ['--text-muted', '--bg', TEXT],
  ['--text-muted', '--surface', TEXT],
  ['--text-muted', '--surface-raised', TEXT],
  ['--text-muted', '--surface-hover', TEXT],
  ['--text-faint', '--bg', TEXT],
  ['--text-faint', '--surface', TEXT],
  ['--accent-text', '--bg', TEXT],
  ['--accent-text', '--surface', TEXT],
  ['--on-accent', '--accent-solid', TEXT],
  ['--on-accent', '--accent-solid-hover', TEXT],
  ['--danger', '--surface-raised', TEXT],
  ['--warning', '--surface', TEXT],
  ['--syn-keyword', '--surface', TEXT],
  ['--syn-string', '--surface', TEXT],
  ['--syn-comment', '--surface', TEXT],
  ['--syn-fn', '--surface', TEXT],
  ['--syn-punct', '--surface', TEXT],
  ['--accent', '--bg', 3],
  ['--success', '--surface-raised', 3],
];

for (const [name, vars] of [['dark', dark], ['light', light]]) {
  test(`${name} interface tokens meet WCAG AA contrast`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const a = resolve(vars, vars[fg]);
      const b = resolve(vars, vars[bg]);
      const r = contrast(a, b);
      assert.ok(r >= min, `${name}: ${fg} ${a} on ${bg} ${b} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}

test('the brand color is a config token and the only accent source', () => {
  assert.equal(dark['--brand'], PROJECT.brandColor);
  assert.equal(dark['--accent'], 'var(--brand)');
});

test('stylesheets other than tokens.css use tokens, not raw colors', () => {
  const dir = new URL('../../styles/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.css') && x !== 'tokens.css')) {
    const text = readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const raw = text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g);
    assert.equal(raw, null, `${f} has raw colors: ${raw}`);
  }
});
