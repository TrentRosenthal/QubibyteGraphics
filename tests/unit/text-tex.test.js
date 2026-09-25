import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadDefaultFonts } from '../../src/text/fonts.js';
import { texToPaths, texPart, colorByToken, matchTokens, tokenize } from '../../src/text/tex.js';
import { pathBounds } from '../../src/core/path.js';

before(() => loadDefaultFonts());

const glyph = (r, ch, n = 0) => r.paths.filter((p) => p.kind === 'glyph' && p.text === ch)[n];

test('fraction: numerator above the bar, bar above the denominator, both centered', () => {
  const r = texToPaths('\\frac{a}{b}', { size: 2 });
  const a = glyph(r, 'a');
  const b = glyph(r, 'b');
  const bar = r.paths.find((p) => p.kind === 'rule');
  const bb = pathBounds(bar.path);
  assert.ok(a.y > bb.y + bb.h, 'numerator baseline above the bar');
  const bBox = pathBounds(b.path);
  assert.ok(bBox.y + bBox.h < bb.y, 'denominator ink below the bar');
  assert.ok(Math.abs(bb.y + bb.h / 2 - 2 * 0.25) < 1e-6, 'bar centered on the math axis (0.25 em)');
  const mid = bb.x + bb.w / 2;
  for (const g of [a, b]) {
    const gb = pathBounds(g.path);
    assert.ok(Math.abs(gb.x + gb.w / 2 - mid) < 0.15, 'glyph roughly centered over the bar');
  }
});

test('superscripts are raised and smaller; subscripts are lowered', () => {
  const r = texToPaths('x^2 y_1', { size: 1 });
  const x = glyph(r, 'x');
  const two = glyph(r, '2');
  const one = glyph(r, '1');
  assert.equal(x.y, 0);
  assert.ok(two.y > 0.3, `superscript baseline ${two.y}`);
  assert.ok(one.y < -0.1, `subscript baseline ${one.y}`);
  assert.ok(two.x > x.x);
  assert.ok(pathBounds(two.path).h < 0.7 * pathBounds(texToPaths('2').paths[0].path).h + 0.01);
});

test('KaTeX classes select fonts: italic math letters, upright digits, blackboard R', () => {
  const r = texToPaths('x2\\mathbb{R}\\sum', { size: 1, display: true });
  assert.deepEqual(r.paths.map((p) => p.text), ['x', '2', 'R', '∑']);
  const sum = pathBounds(r.paths[3].path);
  assert.ok(sum.h > 1.2, 'display sum comes from the large Size2 face');
  assert.ok(r.height > 0.9 && r.depth > 0.5);
});

test('sqrt, braces and arrows emit SVG shapes clipped to their boxes', () => {
  const r = texToPaths('\\sqrt{x+y}', { size: 1 });
  const svg = r.paths.find((p) => p.kind === 'svg');
  const sb = pathBounds(svg.path);
  assert.ok(Math.abs(sb.x + sb.w - r.width) < 1e-6, 'radical vinculum ends at the right edge');
  const brace = texToPaths('\\overbrace{a+b+c}', { size: 1 });
  const shapes = brace.paths.filter((p) => p.kind === 'svg');
  assert.equal(shapes.length, 3);
  const right = Math.max(...shapes.map((s) => {
    const b = pathBounds(s.path);
    return b.x + b.w;
  }));
  assert.ok(right <= brace.width + 1e-6);
});

test('tokenize keeps commands, delimiters and environments as units', () => {
  const t = tokenize('\\left( x^{2} \\right) \\begin{pmatrix}a\\end{pmatrix}').filter((k) => k.kind !== 'space');
  assert.deepEqual(t.map((k) => k.text), ['\\left(', 'x', '^', '{', '2', '}', '\\right)', '\\begin{pmatrix}', 'a', '\\end{pmatrix}']);
  assert.equal(t[1].start, 7);
});

test('every item maps to the token that produced it', () => {
  const r = texToPaths("\\frac{x^2}{x^3} + f'(y) + \\sqrt[3]{z}");
  assert.equal(r.mapping, 'exact');
  const owner = (i) => r.tokens[r.paths[i].tokenIndex];
  r.paths.forEach((p, i) => {
    assert.ok(p.tokenIndex >= 0, `item ${i} (${p.text}) is mapped`);
    if (p.kind === 'glyph' && owner(i).kind === 'char') assert.equal(owner(i).text.replace("'", '′'), p.text);
  });
  const xs = r.paths.map((p, i) => [p, i]).filter(([p]) => p.text === 'x');
  const starts = xs.map(([, i]) => owner(i).start).sort((a, b) => a - b);
  assert.deepEqual(starts, [6, 11], 'numerator and denominator x resolve to their own tokens');
  assert.equal(owner(r.paths.findIndex((p) => p.kind === 'rule')).text, '\\frac');
  assert.equal(owner(r.paths.findIndex((p) => p.kind === 'svg')).text, '\\sqrt');
  assert.equal(owner(r.paths.findIndex((p) => p.text === '′')).text, "'");
});

test('part() finds sub-expressions verbatim or by tokens', () => {
  const r = texToPaths('x^2 + 2x');
  assert.deepEqual(r.part('x^2'), [0, 1]);
  assert.deepEqual(r.part('2x'), [3, 4]);
  assert.deepEqual(r.part('x', 1), [4]);
  assert.deepEqual(texToPaths('x^{2}+1').part('x^2'), [0, 1]);
  assert.deepEqual(r.part('q'), []);
  const d = texToPaths('\\left(\\frac{a}{b}\\right)');
  assert.equal(texPart(d, '\\left(').length, 1);
  assert.equal(texPart(d, '\\frac{a}{b}').length, 3);
});

test('matchTokens pairs x^2 + 2x with x^2 + 2x + 1 and fades in the rest', () => {
  const a = texToPaths('x^2 + 2x');
  const b = texToPaths('x^2 + 2x + 1');
  const m = matchTokens(a, b);
  assert.deepEqual(m.pairs, [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  assert.deepEqual(m.unmatchedA, []);
  assert.deepEqual(m.unmatchedB, [5, 6]);
  assert.deepEqual(b.paths.slice(5).map((p) => p.text), ['+', '1']);
  const swap = matchTokens(texToPaths('a+b'), texToPaths('b+a'));
  assert.equal(swap.pairs.length, 3, 'reordered terms still pair up');
});

test('colors: \\textcolor flows through and colorByToken recolors by token', () => {
  const r = texToPaths('\\textcolor{red}{a} + b');
  assert.equal(glyph(r, 'a').color, 'red');
  assert.equal(glyph(r, 'b').color, null);
  const c = colorByToken(texToPaths('x^2 + y^2'), { x: '#f00', 'y^2': '#00f' });
  assert.equal(glyph(c, 'x').color, '#f00');
  assert.equal(glyph(c, 'y').color, '#00f');
  assert.equal(glyph(c, '2', 1).color, '#00f');
  assert.equal(glyph(c, '2', 0).color, null);
  assert.equal(c.part('y^2').length, 2);
});

test('display environments and delimiters produce mapped output', () => {
  const r = texToPaths('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', { display: true });
  assert.equal(r.mapping, 'exact');
  const own = r.paths.map((p) => r.tokens[p.tokenIndex].text);
  assert.equal(own[0], '\\begin{pmatrix}');
  assert.equal(own[own.length - 1], '\\end{pmatrix}');
  const a = glyph(r, 'a');
  const c = glyph(r, 'c');
  const d = glyph(r, 'd');
  assert.ok(a.y > c.y && Math.abs(a.x - c.x) < 0.05 && d.x > c.x);
});

test('size scales linearly and invalid TeX throws a KaTeX parse error', () => {
  const one = texToPaths('\\alpha^2', { size: 1 });
  const three = texToPaths('\\alpha^2', { size: 3 });
  assert.ok(Math.abs(three.width - 3 * one.width) < 1e-9);
  assert.ok(Math.abs(three.paths[1].y - 3 * one.paths[1].y) < 1e-9);
  assert.throws(() => texToPaths('\\frac{a}'), /KaTeX parse error/);
});
