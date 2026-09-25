/**
 * App shell around the visual editor: top bar, doc permalinks, the export
 * panel, the shortcut sheet, and the interface theme. User code runs only in
 * the sandboxed runtime.
 * @module playground/app
 */

import { PROJECT } from '../config.js';
import { listThemes, registerTheme } from '../themes/index.js';
import { createCompletions } from './editor/completions.js';
import { decodePermalink } from './permalink.js';
import { ExportPanel } from './export/panel.js';
import { mountShortcuts } from './shortcuts.js';
import { icon } from './icons.js';
import { esc, toast, readJSON, writeJSON } from './ui.js';

const THEME_STORE = 'qgfx.themes.v1';
const UI_STORE = 'qgfx.ui.v1';
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const $ = (sel) => document.querySelector(sel);

/** The application. */
class App {
  constructor() {
    document.documentElement.style.setProperty('--brand', PROJECT.brandColor);
    this.state = { theme: null, board: 'default', size: [1920, 1080] };
    this.customThemes = readJSON(THEME_STORE, []);
    for (const t of this.customThemes) {
      try {
        registerTheme(t);
      } catch {
        this.customThemes = this.customThemes.filter((x) => x !== t);
      }
    }
    this.visual = null;
  }

  async start() {
    this.applyUiTheme(readJSON(UI_STORE, {}).theme ?? null);
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
    });
    $('#shortcuts-btn').innerHTML = icon('keyboard');
    this.fillThemeSelect();

    const index = await (await fetch(new URL('api-index.json', import.meta.url))).json();
    const comp = createCompletions(index);
    this.completions = (lang, before) => (lang === 'qubi' ? comp.qubi(before) : comp.js(before));

    // A document link opens that document; older code and Qubi links have no view any more.
    const link = await decodePermalink(location.hash).catch(() => null);
    if (link && link.kind !== 'doc') toast('This link holds a code scene. The editor opens documents only, so it shows your last document instead.');
    const { mountVisualEditor } = await import('../editor/ui/editor-app.js');
    this.visual = await mountVisualEditor($('#editor-root'), {
      app: this,
      docText: link && link.kind === 'doc' ? link.text : null,
      theme: this.state.theme,
      board: this.state.board,
      size: this.state.size,
    });
    this.visual.activate();

    // The export panel reads the editor's size and time as it renders, so it comes after the editor.
    this.exportPanel = new ExportPanel($('#export-panel'), $('#export-btn'), {
      runtime: () => this.visual.runtime,
      context: () => this.visual.exportContext(),
    });
    mountShortcuts($('#shortcuts-panel'), () => this.toggleShortcuts(false));
    this.bindChrome();
  }

  bindChrome() {
    $('#share-btn').addEventListener('click', () => this.share());
    $('#ui-theme-btn').addEventListener('click', () => {
      const dark = this.isDarkUi();
      this.applyUiTheme(dark ? 'light' : 'dark');
      writeJSON(UI_STORE, { theme: dark ? 'light' : 'dark' });
    });
    $('#shortcuts-btn').addEventListener('click', () => this.toggleShortcuts());
    $('#theme-select').addEventListener('change', (e) => this.setOptions({ theme: e.target.value }));
    $('#board-select').addEventListener('change', (e) => this.setOptions({ board: e.target.value }));
    $('#size-select').addEventListener('change', (e) => this.setOptions({ size: e.target.value.split('x').map(Number) }));
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerdown', (e) => {
      for (const [panel, btn, close] of [[$('#export-panel'), $('#export-btn'), () => this.exportPanel.close()], [$('#shortcuts-panel'), $('#shortcuts-btn'), () => this.toggleShortcuts(false)]]) {
        if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) close();
      }
    });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => this.applyUiTheme(document.documentElement.dataset.uiTheme ?? null));
  }

  isDarkUi() {
    const forced = document.documentElement.dataset.uiTheme;
    if (forced) return forced === 'dark';
    return !matchMedia('(prefers-color-scheme: light)').matches;
  }

  /** @param {'light'|'dark'|null} theme */
  applyUiTheme(theme) {
    if (theme) document.documentElement.dataset.uiTheme = theme;
    else delete document.documentElement.dataset.uiTheme;
    const dark = this.isDarkUi();
    const btn = $('#ui-theme-btn');
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
    btn.setAttribute('aria-label', dark ? 'Switch to the light interface' : 'Switch to the dark interface');
    btn.dataset.tip = dark ? 'Light interface' : 'Dark interface';
  }

  fillThemeSelect() {
    const sel = $('#theme-select');
    const themes = listThemes();
    const custom = new Set(this.customThemes.map((t) => t.id));
    const builtin = themes.filter((t) => !custom.has(t.id));
    const mine = themes.filter((t) => custom.has(t.id));
    sel.innerHTML = `<optgroup label="Built-in">${builtin.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>${mine.length ? `<optgroup label="Saved">${mine.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>` : ''}`;
    if (this.state.theme) sel.value = this.state.theme;
  }

  /**
   * Register a user theme so every runtime and the selects know it.
   * @param {any} theme
   */
  addCustomTheme(theme) {
    registerTheme(theme);
    this.customThemes = this.customThemes.filter((t) => t.id !== theme.id).concat([theme]);
    writeJSON(THEME_STORE, this.customThemes);
    this.fillThemeSelect();
  }

  setOptions(change) {
    if (change.theme !== undefined) this.state.theme = change.theme;
    if (change.board !== undefined) this.state.board = change.board;
    if (change.size) this.state.size = change.size;
    if (this.visual) this.visual.setSceneOptions({ theme: change.theme, board: change.board, size: change.size });
  }

  async share() {
    history.replaceState(null, '', await this.visual.permalink());
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied');
    } catch {
      toast('The address bar now holds the link; copy it from there.');
    }
  }

  toggleShortcuts(force) {
    const p = $('#shortcuts-panel');
    const open = force ?? p.hidden;
    p.hidden = !open;
    $('#shortcuts-btn').setAttribute('aria-expanded', String(open));
    if (open) p.querySelector('[data-close]').focus();
  }

  onKey(e) {
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type)) || t.tagName === 'SELECT' || t.isContentEditable);
    const mod = MAC ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape') {
      if (!$('#export-panel').hidden) {
        this.exportPanel.close();
        $('#export-btn').focus();
        return;
      }
      if (!$('#shortcuts-panel').hidden) {
        this.toggleShortcuts(false);
        $('#shortcuts-btn').focus();
        return;
      }
    }
    if (mod && (e.key === 's' || e.key === 'S') && !typing) {
      e.preventDefault();
      if (this.visual) this.visual.save();
      return;
    }
    if (typing) return;
    if (e.key === '?' && !mod) {
      e.preventDefault();
      this.toggleShortcuts();
      return;
    }
    if (this.visual && this.visual.handleKey(e)) e.preventDefault();
  }
}

const app = new App();
app.start().catch((e) => {
  console.error(e);
  toast(`The editor could not start: ${e.message}`);
});
