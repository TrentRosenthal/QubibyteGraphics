import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteFrom, parseDescription, themeFrom } from '../../src/themes/palette.js';
import { getTheme, registerTheme, listThemes, exportTheme, importTheme, themeWithBoard } from '../../src/themes/index.js';
import { COLOR_KEYS } from '../../src/themes/tokens.js';
import { contrast, rgbToOklch, parseColor } from '../../src/core/color.js';

test('every built-in theme defines every token and passes text contrast', () => {
  const themes = listThemes();
  assert.ok(themes.length >= 17, `${themes.length} themes`);
  for (const t of themes) {
    const th = getTheme(t.id);
    for (const k of COLOR_KEYS) assert.ok(th.colors[k], `${t.id}.${k}`);
    assert.ok(contrast(th.colors.ink, th.colors.background) >= 7, `${t.id} ink contrast`);
    assert.ok(contrast(th.colors.muted, th.colors.background) >= 3, `${t.id} muted contrast`);
  }
});

test('a description becomes a coherent palette with contrast checks', () => {
  const p = paletteFrom('pastel green');
  assert.equal(p.dark, false);
  assert.deepEqual(p.warnings, []);
  const h = rgbToOklch(parseColor(p.colors.accent)).H;
  assert.ok(h > 120 && h < 175, `accent hue ${h}`);
  assert.ok(p.contrasts.ink >= 7 && p.contrasts.accent >= 3);
  const d = paletteFrom('dark vivid blue');
  assert.equal(d.dark, true);
  assert.ok(rgbToOklch(parseColor(d.colors.background)).L < 0.3);
  assert.equal(parseDescription('#ff8800 dark').seed, '#ff8800');
});

test('themes from descriptions register, export, and import', () => {
  const t = registerTheme(themeFrom('test-mint', 'soft mint'));
  assert.equal(getTheme('test-mint').colors.accent, t.colors.accent);
  const json = exportTheme(t);
  const back = importTheme(json.replace('"test-mint"', '"test-mint-2"'));
  assert.equal(back.id, 'test-mint-2');
  assert.throws(() => getTheme('nope'), /Unknown theme/);
});

test('everyday color nouns set the hue of a described theme', async () => {
  const { themeFrom, rgbToOklch, parseColor } = await import('../../src/index.js');
  const hueOf = (d) => rgbToOklch(parseColor(themeFrom('t', d).colors.accent)).H;
  const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 25;
  assert.ok(near(hueOf('warm terracotta paper'), 40), `terracotta ${hueOf('warm terracotta paper')}`);
  assert.ok(near(hueOf('forest, dark'), 150));
  assert.ok(near(hueOf('lavender pastel'), 300));
});

test('a board swaps only the surface and keeps the theme colors readable', () => {
  const t = getTheme('qubibyte');
  assert.equal(themeWithBoard(t, 'default'), t);
  assert.equal(themeWithBoard(t, undefined), t);
  const chalk = getTheme('chalkboard');
  const on = themeWithBoard(t, 'chalkboard');
  assert.equal(on.id, t.id);
  assert.equal(on.board, 'chalkboard');
  assert.equal(on.colors.background, chalk.colors.background);
  assert.equal(on.colors.ink, chalk.colors.ink);
  assert.notEqual(on.colors.accent, chalk.colors.accent);
  // Light accents drawn on a whiteboard are pulled toward its ink until they read.
  const white = themeWithBoard(chalk, 'whiteboard');
  assert.equal(white.board, 'whiteboard');
  for (const k of ['accent', 'accent2', 'ket0', 'ket1', 'gateHadamard']) {
    assert.ok(contrast(white.colors[k], white.colors.background) >= 3, `${k} ${white.colors[k]}`);
  }
  assert.equal(themeWithBoard(chalk, 'chalkboard'), chalk);
  assert.equal(themeWithBoard(chalk, 'clean').board, null);
});
