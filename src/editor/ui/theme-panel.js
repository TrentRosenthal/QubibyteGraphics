/**
 * Theme panel: switch the scene theme, generate a palette from words with
 * `paletteFrom` ("pastel green", "dark vivid blue", "#4a90e2 warm"), edit
 * any color token live, read contrast against the background, save the
 * result as a named theme in this browser, and export or import theme JSON.
 * @module editor/ui/theme-panel
 */

import { getTheme, listThemes, exportTheme } from '../../themes/index.js';
import { paletteFrom } from '../../themes/palette.js';
import { COLOR_KEYS } from '../../themes/tokens.js';
import { contrast, toHex, parseColor } from '../../core/color.js';
import { icon } from '../../playground/icons.js';
import { esc, download, toast } from '../../playground/ui.js';

const GROUPS = [
  ['Surfaces and ink', ['background', 'surface', 'ink', 'muted', 'faint', 'grid']],
  ['Accents', ['accent', 'accent2', 'positive', 'negative', 'ket0', 'ket1']],
  ['Gates', COLOR_KEYS.filter((k) => k.startsWith('gate'))],
];

const PAIRS = [
  ['ink', 'Ink', 4.5, 7],
  ['muted', 'Muted', 4.5, 7],
  ['accent', 'Accent', 3, 4.5],
  ['accent2', 'Accent 2', 3, 4.5],
];

function hexOf(c) {
  try {
    return toHex(parseColor(c));
  } catch {
    return '#000000';
  }
}

/** The theme panel. */
export class ThemePanel {
  /**
   * @param {HTMLElement} host
   * @param {import('./editor-app.js').VisualEditor} ed
   */
  constructor(host, ed) {
    this.host = host;
    this.ed = ed;
    this.words = 'pastel green';
  }

  /** The theme the scene uses now (the draft while one is being edited). */
  current() {
    return this.ed.themeDraft ?? getTheme(this.ed.doc.meta.theme);
  }

  render() {
    const t = this.current();
    const themes = listThemes();
    const bg = t.colors.background;
    this.host.innerHTML = `<div class="tp">
      <section class="tp-section">
        <h3 class="section-title">Theme</h3>
        <span class="select full"><select data-theme aria-label="Scene theme">${this.ed.themeDraft ? `<option value="__draft" selected>${esc(t.name)} (unsaved)</option>` : ''}${themes.map((x) => `<option value="${esc(x.id)}" ${!this.ed.themeDraft && x.id === this.ed.doc.meta.theme ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${icon('chevronDown')}</span>
      </section>
      <section class="tp-section">
        <h3 class="section-title">Palette from words</h3>
        <form class="tp-gen" data-gen><input class="input" data-words value="${esc(this.words)}" aria-label="Describe a palette" placeholder="pastel green"><button type="submit" class="btn sm">Generate</button></form>
        <p class="tp-hint">A color and a mood, or a hex seed: dark vivid blue, warm amber, #4a90e2.</p>
      </section>
      <section class="tp-section">
        <h3 class="section-title">Colors</h3>
        ${GROUPS.map(([label, keys]) => `<div class="tp-group"><span class="bf-label">${label}</span><div class="tp-colors">${keys.map((k) => `<div class="tp-color"><input type="color" value="${hexOf(t.colors[k])}" data-color="${k}" aria-label="${k} color"><span class="tp-name">${k}</span><input class="input mono tp-hex" data-hex="${k}" value="${esc(hexOf(t.colors[k]))}" aria-label="${k} hex"></div>`).join('')}</div></div>`).join('')}
      </section>
      <section class="tp-section">
        <h3 class="section-title">Contrast on background</h3>
        <div class="tp-contrast">${PAIRS.map(([k, label, aa, aaa]) => {
          const r = contrast(t.colors[k], bg);
          const grade = r >= aaa ? 'AAA' : r >= aa ? 'AA' : 'Low';
          return `<div class="tp-ratio"><span class="tp-chip" style="background:${esc(bg)};color:${esc(t.colors[k])}">Aa</span><span>${label}</span><span class="num">${r.toFixed(2)}:1</span><span class="tp-grade ${grade === 'Low' ? 'is-low' : ''}">${grade}</span></div>`;
        }).join('')}</div>
      </section>
      <section class="tp-section">
        <h3 class="section-title">Save and share</h3>
        <form class="tp-gen" data-save><input class="input" data-name value="${esc(this.ed.themeDraft ? this.ed.themeDraft.name : '')}" placeholder="Theme name" aria-label="Theme name"><button type="submit" class="btn sm" ${this.ed.themeDraft ? '' : 'disabled'}>Save</button></form>
        <div class="tp-actions">
          <button type="button" class="btn sm ghost" data-export>${icon('download')}Export JSON</button>
          <label class="btn sm ghost tp-import">${icon('upload')}Import JSON<input type="file" accept="application/json,.json" data-import hidden></label>
        </div>
      </section>
    </div>`;
    this.bind();
  }

  bind() {
    const h = this.host;
    const ed = this.ed;
    h.querySelector('[data-theme]').addEventListener('change', (e) => {
      if (e.target.value === '__draft') return;
      ed.setDraftTheme(null);
      ed.setMeta({ theme: e.target.value }, { commit: true });
    });
    h.querySelector('[data-gen]').addEventListener('submit', (e) => {
      e.preventDefault();
      this.words = h.querySelector('[data-words]').value.trim() || 'pastel green';
      const p = paletteFrom(this.words);
      const base = getTheme(ed.doc.meta.theme);
      ed.setDraftTheme({ id: 'draft', name: this.words.replace(/^./, (c) => c.toUpperCase()), extends: base.board ? 'qubibyte' : base.id, dark: p.dark, colors: p.colors });
      if (p.warnings.length) toast(p.warnings[0]);
    });
    const edit = (k, v, commit) => {
      const t = this.current();
      const draft = ed.themeDraft ?? { id: 'draft', name: `${t.name} edited`, extends: t.id, dark: t.dark, colors: { ...t.colors } };
      ed.setDraftTheme({ ...draft, colors: { ...draft.colors, [k]: v } }, { rerender: commit });
    };
    h.querySelectorAll('[data-color]').forEach((inp) => {
      inp.addEventListener('input', () => {
        h.querySelector(`[data-hex="${inp.dataset.color}"]`).value = inp.value;
        edit(inp.dataset.color, inp.value, false);
      });
      inp.addEventListener('change', () => edit(inp.dataset.color, inp.value, true));
    });
    h.querySelectorAll('[data-hex]').forEach((inp) => inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(v)) edit(inp.dataset.hex, v.startsWith('#') ? v : `#${v}`, true);
      else inp.value = hexOf(this.current().colors[inp.dataset.hex]);
    }));
    h.querySelector('[data-save]').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = h.querySelector('[data-name]').value.trim();
      if (!name || !ed.themeDraft) return;
      ed.saveDraftTheme(name);
    });
    h.querySelector('[data-export]').addEventListener('click', () => {
      const t = this.current();
      download(new Blob([exportTheme(t)], { type: 'application/json' }), `${t.id}.theme.json`);
    });
    h.querySelector('[data-import]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        ed.importThemeText(await file.text());
      } catch (err) {
        toast(`That file is not a theme: ${err.message}`);
      }
    });
  }
}
