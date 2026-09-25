/**
 * Our TeX layout against real KaTeX HTML in headless Chromium.
 *
 * Recorded result (Chromium 1194 build, 28 formulas, 228 glyphs, KaTeX em):
 * largest glyph-origin error 0.0023 em (nested fractions inside \left\langle
 * and a tall radical), typical 0.0002 to 0.0010 em; formula widths within
 * 0.0024 em; fraction bars, overlines and underlines within 0.0022 em. The
 * residue is Chromium's 1/64 px layout rounding at a 48.4 px em.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadDefaultFonts } from '../../src/text/fonts.js';
import { texToPaths } from '../../src/text/tex.js';
import { FORMULAS, findChromium, measureInChromium, compare } from './fixtures/text/verify-katex.js';

const exe = findChromium();
let hasPlaywright = true;
try {
  await import('playwright-core');
} catch {
  hasPlaywright = false;
}
const skip = !exe ? 'no Chromium binary under /opt/pw-browsers' : !hasPlaywright ? 'playwright-core is not installed' : false;

before(() => loadDefaultFonts());

test('glyph origins match KaTeX in Chromium within 0.02 em', { skip, timeout: 120000 }, async () => {
  const ref = await measureInChromium(FORMULAS, exe);
  const rows = compare(texToPaths, FORMULAS, ref);
  for (const r of rows) {
    assert.ok(r.sequenceOk, `glyph sequence differs for ${r.formula}`);
    assert.ok(r.glyphs > 0);
    assert.ok(r.maxErr < 0.02, `${r.formula}: glyph error ${r.maxErr.toFixed(4)} em`);
    assert.ok(r.widthErr < 0.02, `${r.formula}: width error ${r.widthErr.toFixed(4)} em`);
    assert.ok(r.ruleErr < 0.02, `${r.formula}: rule error ${r.ruleErr.toFixed(4)} em`);
  }
  const worst = Math.max(...rows.map((r) => r.maxErr));
  assert.ok(worst < 0.005, `worst glyph error ${worst.toFixed(4)} em regressed past the recorded 0.0023 em`);
});
