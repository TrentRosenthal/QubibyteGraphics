/**
 * Chromium reference measurements for the TeX layout engine.
 *
 * Renders each formula with real KaTeX HTML and `katex.css` (fonts pointed at
 * the vendored TTFs) in headless Chromium, then reads every glyph origin by
 * inserting a zero-size inline-block marker before each character: the
 * marker's box sits exactly at the character's pen position on its baseline.
 * Coordinates are returned in KaTeX em, relative to the start of the first
 * `.base` on its baseline, with y up, the same frame `texToPaths` uses.
 *
 * Run directly to print a comparison table:
 *   node tests/unit/fixtures/text/verify-katex.js
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import katex from '../../../../vendor/katex/katex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');

export const FORMULAS = [
  '\\frac{a}{b}',
  '\\frac{1}{1+\\frac{1}{x}}',
  '\\sqrt[3]{x^2+y^2}',
  '\\sum_{k=0}^{n} k^2',
  '\\int_0^\\infty e^{-x^2}\\,dx',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  '\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}',
  'f(x)=\\begin{cases} 1 & x>0 \\\\ 0 & \\text{otherwise} \\end{cases}',
  '\\begin{aligned} a &= b+c \\\\ d &= e \\end{aligned}',
  '\\left(\\frac{a}{b}\\right)',
  '\\hat{x}\\;\\vec{v}\\;\\bar{z}',
  '\\overbrace{a+b}^{n}\\;\\underbrace{c+d}_{m}',
  '\\mathbb{R}^n',
  '\\alpha\\beta\\gamma\\Delta\\Omega',
  '|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle',
  '\\frac{1}{\\sqrt{2}}',
  'e^{i\\pi/4}',
  '\\sum_{k=0}^{n} \\binom{n}{k}',
  'x_1^2 + P_2 + \\sum x',
  '\\overrightarrow{AB} \\xrightarrow{f} \\widehat{xyz}',
  '\\left[\\int_0^1 \\left(\\frac{x^2}{2}\\right) dx\\right]',
  '\\overline{AB} + \\underline{cd} + \\boxed{E=mc^2}',
  '\\cancel{x} \\xleftarrow[below]{above} \\tilde{n}\\dot{y}\\ddot{q}',
  '\\text{if } x \\in A \\operatorname{rank}(M) \\lim_{n\\to\\infty} a_n',
  '\\left\\langle \\frac{\\frac{a}{b}}{\\frac{c}{d}} \\right| \\sqrt{\\frac{\\frac{a}{b}}{\\frac{c}{d}}}',
  '\\left( \\begin{array}{c} a \\\\ b \\\\ c \\\\ d \\\\ e \\end{array} \\right)',
  '\\mathcal{L} = \\mathbf{F} \\cdot \\mathrm{d}\\mathbf{s} \\quad \\mathfrak{g} \\; \\mathsf{T} \\; \\mathtt{m}',
  '\\left\\{\\begin{array}{c|c} \\frac{\\partial f}{\\partial x} & \\sqrt{\\frac{a}{b}} \\end{array}\\right\\}',
];

/**
 * Locate the Chromium binary shipped under /opt/pw-browsers, or null.
 * @returns {string|null}
 */
export function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).sort().reverse()) {
    if (!d.startsWith('chromium-')) continue;
    for (const p of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const f = join(root, d, p);
      if (existsSync(f)) return f;
    }
  }
  return null;
}

function pageHtml(formulas) {
  const fontDir = pathToFileURL(join(repo, 'vendor/fonts/katex')).href;
  const css = readFileSync(join(here, 'katex.css'), 'utf8').replace(
    /src: url\(fonts\/(KaTeX_[A-Za-z0-9-]+)\.woff2\)[^;]*;/g,
    (_, name) => `src: url(${fontDir}/${name}.ttf) format("truetype");`
  );
  const blocks = formulas
    .map((f, i) => `<div class="f" id="f${i}">${katex.renderToString(f, { displayMode: true, output: 'html', throwOnError: true })}</div>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}
body { margin: 0; font-size: 40px; }
.f { padding: 20px 40px; }
.katex-display { text-align: left; margin: 0; }
.katex-display > .katex { text-align: left; }
</style></head><body>${blocks}</body></html>`;
}

function probeInPage() {
  const fams = new Set();
  for (const r of document.styleSheets[0].cssRules) if (r.type === 5) fams.add(r.style.getPropertyValue('font-family').replace(/"/g, ''));
  return Promise.all([...fams].map((f) => document.fonts.load(`40px ${f}`, 'a'))).then(() => document.fonts.ready).then(() => {
    const mk = () => {
      const m = document.createElement('q-m');
      m.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0';
      return m;
    };
    const out = [];
    for (const div of document.querySelectorAll('.f')) {
      const html = div.querySelector('.katex-html');
      const base = html.querySelector('.base');
      const origin = mk();
      base.insertBefore(origin, base.firstChild);
      const walker = document.createTreeWalker(html, 4);
      const texts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
      const markers = [];
      for (const t of texts) {
        const chars = Array.from(t.data);
        const parent = t.parentNode;
        for (const ch of chars) {
          if (ch === '​' || /\s/.test(ch)) {
            parent.insertBefore(document.createTextNode(ch), t);
            continue;
          }
          const m = mk();
          parent.insertBefore(m, t);
          parent.insertBefore(document.createTextNode(ch), t);
          markers.push([ch, m]);
        }
        parent.removeChild(t);
      }
      const emPx = parseFloat(getComputedStyle(html.closest('.katex')).fontSize);
      const o = origin.getBoundingClientRect();
      let right = o.left;
      for (const b of html.querySelectorAll(':scope > .base')) right = Math.max(right, b.getBoundingClientRect().right);
      const width = (right - o.left) / emPx;
      const lines = [...html.querySelectorAll('.frac-line, .overline-line, .underline-line')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x0: (r.left - o.left) / emPx, x1: (r.right - o.left) / emPx, y: -(r.bottom - o.top) / emPx };
      });
      out.push({
        width,
        lines,
        glyphs: markers.map(([ch, m]) => {
          const r = m.getBoundingClientRect();
          return { ch, x: (r.left - o.left) / emPx, y: -(r.top - o.top) / emPx };
        }),
      });
    }
    return out;
  });
}

/**
 * Measure glyph origins of formulas in headless Chromium.
 * @param {string[]} formulas
 * @param {string} executablePath Chromium binary.
 * @returns {Promise<{width: number, lines: {x0: number, x1: number, y: number}[], glyphs: {ch: string, x: number, y: number}[]}[]>}
 */
export async function measureInChromium(formulas, executablePath) {
  const { chromium } = await import('playwright-core');
  const dir = mkdtempSync(join(tmpdir(), 'qgfx-katex-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, pageHtml(formulas));
  const browser = await chromium.launch({ executablePath, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href);
    return await page.evaluate(probeInPage);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Compare `texToPaths` glyph origins with Chromium's.
 * @param {typeof import('../../../../src/text/tex.js').texToPaths} texToPaths
 * @param {string[]} formulas
 * @param {Awaited<ReturnType<typeof measureInChromium>>} ref
 * @returns {{formula: string, glyphs: number, maxErr: number, widthErr: number, ruleErr: number, sequenceOk: boolean}[]}
 */
export function compare(texToPaths, formulas, ref) {
  return formulas.map((f, i) => {
    const ours = texToPaths(f, { size: 1, display: true }).paths.filter((p) => p.kind === 'glyph');
    const theirs = ref[i].glyphs;
    const sequenceOk = ours.length === theirs.length && ours.every((g, k) => g.text === theirs[k].ch);
    let maxErr = Infinity;
    if (sequenceOk) {
      maxErr = 0;
      ours.forEach((g, k) => {
        maxErr = Math.max(maxErr, Math.abs(g.x - theirs[k].x), Math.abs(g.y - theirs[k].y));
      });
    }
    const res = texToPaths(f, { size: 1, display: true });
    const rules = res.paths.filter((p) => p.kind === 'rule');
    let ruleErr = 0;
    for (const l of ref[i].lines) {
      let best = Infinity;
      for (const r of rules) {
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        for (const s of r.path.subpaths) {
          for (let k = 0; k < s.points.length; k += 2) {
            x0 = Math.min(x0, s.points[k]);
            x1 = Math.max(x1, s.points[k]);
            y0 = Math.min(y0, s.points[k + 1]);
          }
        }
        best = Math.min(best, Math.max(Math.abs(x0 - l.x0), Math.abs(x1 - l.x1), Math.abs(y0 - l.y)));
      }
      ruleErr = Math.max(ruleErr, best);
    }
    return { formula: f, glyphs: theirs.length, maxErr, widthErr: Math.abs(res.width - ref[i].width), ruleErr, sequenceOk };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const exe = findChromium();
  if (!exe) {
    console.error('No Chromium binary under /opt/pw-browsers');
    process.exit(1);
  }
  const { loadDefaultFonts } = await import('../../../../src/text/fonts.js');
  const { texToPaths } = await import('../../../../src/text/tex.js');
  await loadDefaultFonts();
  const ref = await measureInChromium(FORMULAS, exe);
  const rows = compare(texToPaths, FORMULAS, ref);
  for (const r of rows) console.log(`${r.maxErr.toFixed(4)}  w${r.widthErr.toFixed(4)}  rule${r.ruleErr.toFixed(4)}  n=${r.glyphs}  ${r.sequenceOk ? '' : 'SEQUENCE MISMATCH '}${r.formula}`);
  if (process.argv.includes('--detail')) {
    FORMULAS.forEach((f, i) => {
      const ours = texToPaths(f, { size: 1, display: true }).paths.filter((p) => p.kind === 'glyph');
      console.log(f);
      ref[i].glyphs.forEach((g, k) => {
        const o = ours[k];
        console.log(`  ${g.ch} chrome(${g.x.toFixed(4)}, ${g.y.toFixed(4)}) ours(${o ? o.x.toFixed(4) : '-'}, ${o ? o.y.toFixed(4) : '-'}) ${o ? o.text : ''}`);
      });
    });
  }
}
