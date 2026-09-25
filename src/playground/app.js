/**
 * Playground app shell: top bar, the Editor and Code modes (code editor,
 * preview, inspector), permalinks, saving, the export panel, and the
 * shortcut sheet. User code runs only in the sandboxed runtime.
 * @module playground/app
 */

import { PROJECT } from '../config.js';
import { listThemes, registerTheme } from '../themes/index.js';
import { diagnose } from '../qubi/index.js';
import { Runtime } from './runtime.js';
import { Preview } from './preview.js';
import { CodeEditor } from './editor/code-editor.js';
import { createCompletions } from './editor/completions.js';
import { encodePermalink, decodePermalink } from './permalink.js';
import { Inspector } from './inspector.js';
import { ExportPanel } from './export/panel.js';
import { mountShortcuts } from './shortcuts.js';
import { icon } from './icons.js';
import { esc, toast, readJSON, writeJSON } from './ui.js';

const STORE = 'qgfx.playground.v1';
const THEME_STORE = 'qgfx.themes.v1';
const UI_STORE = 'qgfx.ui.v1';
const ROOT = new URL('../../', import.meta.url);
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const DEFAULT_EXAMPLE = 'examples/00-first-scene.js';
/** Local storage key for the last mode (code or editor). */
const MODE_STORE = 'qgfx.mode';
const DEFAULT_QUBI = '// A Bell pair: two qubits that always agree.\nH 0\nCX [0,1]\n';

const $ = (sel) => document.querySelector(sel);

/** The application. */
class App {
  constructor() {
    document.documentElement.style.setProperty('--brand', PROJECT.brandColor);
    this.state = {
      mode: 'code',
      src: 'js',
      js: '',
      qubi: DEFAULT_QUBI,
      qubiView: 'explain',
      example: DEFAULT_EXAMPLE,
      name: 'first-scene',
      theme: null,
      board: 'default',
      size: [1920, 1080],
    };
    this.customThemes = readJSON(THEME_STORE, []);
    for (const t of this.customThemes) {
      try {
        registerTheme(t);
      } catch {
        this.customThemes = this.customThemes.filter((x) => x !== t);
      }
    }
    this.info = null;
    this.runSeq = 0;
    this.lastError = null;
  }

  async start() {
    this.applyUiTheme(readJSON(UI_STORE, {}).theme ?? null);
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
    });
    $('#shortcuts-btn').innerHTML = icon('keyboard');
    $('#run-kbd').textContent = MAC ? '⌘ ↵' : 'Ctrl ↵';
    this.fillThemeSelect();

    const index = await (await fetch(new URL('api-index.json', import.meta.url))).json();
    const comp = createCompletions(index);
    this.completions = (lang, before) => (lang === 'qubi' ? comp.qubi(before) : comp.js(before));
    this.editor = new CodeEditor($('#code-host'), {
      language: 'js',
      label: 'Scene code, JavaScript',
      known: comp.known,
      completions: this.completions,
    });
    this.editor.addEventListener('input', () => this.onEdit());
    this.editor.addEventListener('run', () => this.run());
    this.editor.addEventListener('save', () => this.save());

    this.runtime = new Runtime($('#code-frame'));
    this.preview = new Preview({ runtime: this.runtime, stage: $('#code-stage'), frame: $('#code-frame'), caption: $('#code-caption'), transport: $('#code-transport'), controls: $('#code-controls'), status: $('#code-status') });
    this.inspector = new Inspector($('#inspector-panel'), $('#pick-outline'), this.runtime);
    this.preview.addEventListener('pick', async (e) => {
      await this.inspector.pick(e.detail.x, e.detail.y);
    });
    this.preview.addEventListener('time', () => {
      if (!this.preview.playing && this.inspector.current) {
        clearTimeout(this.inspectTimer);
        this.inspectTimer = setTimeout(() => this.inspector.refresh(), 120);
      }
    });

    this.exportPanel = new ExportPanel($('#export-panel'), $('#export-btn'), {
      runtime: () => (this.state.mode === 'editor' && this.visual ? this.visual.runtime : this.runtime),
      context: () => this.exportContext(),
    });
    mountShortcuts($('#shortcuts-panel'), () => this.toggleShortcuts(false));
    this.bindChrome();

    const restored = await this.restore();
    if (restored === 'doc') return;
    await this.run();
    // Open in the visual editor unless a code or Qubi link was opened, the
    // page asks for a mode (?mode=code), or the last session ended in Code.
    const asked = new URLSearchParams(location.search).get('mode');
    const last = readJSON(MODE_STORE, null);
    const mode = asked === 'code' || asked === 'editor' ? asked : restored === 'code' || restored === 'qubi' ? 'code' : last ?? 'editor';
    if (mode === 'editor') await this.setMode('editor');
  }

  /** Restore from the permalink, then local storage, then the default example. */
  async restore() {
    const link = await decodePermalink(location.hash).catch(() => null);
    const saved = readJSON(STORE, null);
    if (link && link.kind === 'doc') {
      await this.setMode('editor', { docText: link.text });
      return 'doc';
    }
    if (saved) {
      this.state.js = saved.js ?? '';
      this.state.qubi = saved.qubi ?? DEFAULT_QUBI;
      this.state.qubiView = saved.qubiView ?? 'explain';
      if (saved.example) this.state.example = saved.example;
      if (saved.name) this.state.name = saved.name;
    }
    if (link) {
      this.fromLink = true;
      this.state.name = 'scene';
      if (link.kind === 'code') this.state.js = link.text;
      else this.state.qubi = link.text;
      this.setSource(link.kind === 'code' ? 'js' : 'qubi');
    } else if (saved && saved.src) this.setSource(saved.src);
    if (!this.state.js) this.state.js = await (await fetch(new URL(DEFAULT_EXAMPLE, ROOT))).text();
    this.editor.value = this.state.src === 'js' ? this.state.js : this.state.qubi;
    this.setQubiView(this.state.qubiView, false);
    if (this.state.src === 'qubi') this.diagnoseQubi();
    return link ? link.kind : 'default';
  }

  bindChrome() {
    document.querySelectorAll('.mode-switch [data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    document.querySelectorAll('.code-tabs [data-src]').forEach((b) => b.addEventListener('click', () => {
      this.setSource(b.dataset.src);
      this.run();
    }));
    document.querySelectorAll('#qubi-view [data-view]').forEach((b) => b.addEventListener('click', () => this.setQubiView(b.dataset.view, true)));
    $('#run-btn').addEventListener('click', () => this.run());
    $('#share-btn').addEventListener('click', () => this.share());
    $('#ui-theme-btn').addEventListener('click', () => {
      const dark = this.isDarkUi();
      this.applyUiTheme(dark ? 'light' : 'dark');
      writeJSON(UI_STORE, { theme: dark ? 'light' : 'dark' });
    });
    $('#shortcuts-btn').addEventListener('click', () => this.toggleShortcuts());
    $('#problems-toggle').addEventListener('click', () => {
      const p = $('#problems');
      const collapsed = p.dataset.collapsed === 'true';
      p.dataset.collapsed = String(!collapsed);
      $('#problems-toggle').setAttribute('aria-expanded', String(collapsed));
    });
    $('#problems-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-line]');
      if (b) this.editor.reveal(Number(b.dataset.line), Number(b.dataset.col) || 1);
    });
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
    else if (this.info) sel.value = this.info.theme;
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

  /** @param {'js'|'qubi'} src */
  setSource(src) {
    if (this.editor && this.state.src !== src) {
      this.state[this.state.src] = this.editor.value;
      this.editor.value = this.state[src];
    }
    this.state.src = src;
    for (const b of document.querySelectorAll('.code-tabs [data-src]')) b.setAttribute('aria-selected', String(b.dataset.src === src));
    $('#qubi-view').hidden = src !== 'qubi';
    if (this.editor) {
      this.editor.setLanguage(src === 'qubi' ? 'qubi' : 'js');
      this.editor.setLabel(src === 'qubi' ? 'Qubi program' : 'Scene code, JavaScript');
      this.editor.setDiagnostics([]);
      this.setProblems([]);
      if (src === 'qubi') this.diagnoseQubi();
    }
  }

  setQubiView(view, rerun) {
    this.state.qubiView = view;
    for (const b of document.querySelectorAll('#qubi-view [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    if (rerun && this.state.src === 'qubi') this.run();
  }

  onEdit() {
    this.state[this.state.src] = this.editor.value;
    if (this.state.src === 'qubi') {
      clearTimeout(this.diagTimer);
      this.diagTimer = setTimeout(() => {
        const ok = this.diagnoseQubi();
        if (ok) {
          clearTimeout(this.autoRun);
          this.autoRun = setTimeout(() => this.run(), 500);
        }
      }, 220);
    }
  }

  /** Run diagnose() on the Qubi source; returns true when there are no errors. */
  diagnoseQubi() {
    let list;
    try {
      list = diagnose(this.editor.value);
    } catch (e) {
      list = [{ severity: 'error', message: e.message }];
    }
    this.editor.setDiagnostics(list);
    this.setProblems(list);
    return !list.some((d) => d.severity === 'error');
  }

  setProblems(list) {
    const box = $('#problems');
    const ul = $('#problems-list');
    const errors = list.filter((d) => d.severity === 'error').length;
    box.classList.toggle('has-errors', errors > 0);
    $('#problems-count').textContent = String(list.length);
    ul.innerHTML = list.length
      ? list.map((d) => `<li><button type="button" class="problem ${d.severity === 'warning' ? 'is-warning' : ''}" data-line="${d.line ?? ''}" data-col="${d.col ?? ''}"><span class="problem-dot" aria-hidden="true"></span><span class="problem-pos">${d.line != null ? `${d.line}:${d.col ?? 1}` : ''}</span><span class="problem-msg">${esc(d.message)}</span></button></li>`).join('')
      : '<li class="problems-empty">No problems</li>';
  }

  buildOptions() {
    const o = { width: this.state.size[0], height: this.state.size[1], board: this.state.board, themes: this.customThemes };
    if (this.state.theme) o.theme = this.state.theme;
    return o;
  }

  async setOptions(change) {
    if (change.theme !== undefined) this.state.theme = change.theme;
    if (change.board !== undefined) this.state.board = change.board;
    if (change.size) this.state.size = change.size;
    if (this.state.mode === 'editor' && this.visual) {
      this.visual.setSceneOptions({ theme: change.theme, board: change.board, size: change.size });
      return;
    }
    if (!this.info) return;
    const seq = ++this.runSeq;
    this.preview.setStatus('Building', 0, true);
    try {
      const info = await this.runtime.setOptions(this.buildOptions());
      if (seq !== this.runSeq) return;
      this.onLoaded(info, true);
    } catch (e) {
      if (seq === this.runSeq) this.onError(e);
    }
  }

  /** Build and show the current source. */
  async run() {
    const src = this.state.src;
    const text = this.editor.value;
    this.state[src] = text;
    if (src === 'qubi' && !this.diagnoseQubi()) {
      this.preview.setStatus('Fix the problems below to run', 2400);
      return;
    }
    const seq = ++this.runSeq;
    this.clearError();
    this.preview.setStatus('Building', 0, true);
    try {
      const info = src === 'qubi'
        ? await this.runtime.load('qubi', { source: text }, { ...this.buildOptions(), qubiView: this.state.qubiView })
        : await this.runtime.load('module', { source: text, baseURL: new URL(this.state.example || DEFAULT_EXAMPLE, ROOT).href }, this.buildOptions());
      if (seq !== this.runSeq) return;
      if (src === 'js') {
        this.editor.setDiagnostics([]);
        this.setProblems([]);
      }
      this.inspector.clear();
      this.onLoaded(info, false);
      this.preview.play(1);
    } catch (e) {
      if (seq === this.runSeq) this.onError(e);
    }
  }

  onLoaded(info, keepTime) {
    this.info = info;
    this.preview.setStatus('');
    this.preview.setInfo(info, { keepTime });
    if (!this.state.theme) $('#theme-select').value = info.theme;
    $('#board-select').value = this.state.board;
    this.clearError();
  }

  clearError() {
    const old = $('#code-stage .stage-error');
    if (old) old.remove();
  }

  onError(e) {
    this.preview.setStatus('');
    this.clearError();
    const where = e.line != null ? `Line ${e.line}${e.col != null ? `:${e.col}` : ''}` : e.name === 'SyntaxError' ? 'Syntax' : 'Build';
    const div = document.createElement('div');
    div.className = 'stage-error';
    div.setAttribute('role', 'alert');
    div.innerHTML = `<span class="where">${esc(where)}</span><span class="msg">${esc(e.message)}</span>${e.line != null ? '<button type="button" class="btn sm ghost">Show</button>' : ''}`;
    const btn = div.querySelector('button');
    if (btn) btn.addEventListener('click', () => this.editor.reveal(e.line, e.col ?? 1));
    $('#code-stage').append(div);
    if (this.state.src === 'js') {
      const d = { severity: 'error', message: e.message, line: e.line ?? undefined, col: e.col ?? undefined };
      this.editor.setDiagnostics(e.line != null ? [d] : []);
      this.setProblems([d]);
    }
  }

  exportContext() {
    if (this.state.mode === 'editor' && this.visual) return this.visual.exportContext();
    const i = this.info ?? { width: this.state.size[0], height: this.state.size[1], fps: 60, duration: 0 };
    const name = this.state.src === 'qubi' ? 'qubi-program' : this.state.name || 'scene';
    return { name, width: i.width, height: i.height, fps: i.fps, time: this.preview.t, duration: i.duration };
  }

  async currentPermalink() {
    if (this.state.mode === 'editor' && this.visual) return encodePermalink('doc', this.visual.documentText());
    return encodePermalink(this.state.src === 'qubi' ? 'qubi' : 'code', this.editor.value);
  }

  async save() {
    this.state[this.state.src] = this.editor.value;
    const ok = writeJSON(STORE, { js: this.state.js, qubi: this.state.qubi, src: this.state.src, qubiView: this.state.qubiView, example: this.state.example, name: this.state.name });
    history.replaceState(null, '', await this.currentPermalink());
    toast(ok ? 'Saved in this browser. The address bar link now opens this scene.' : 'The link is updated, but this browser blocks local storage.');
  }

  async share() {
    history.replaceState(null, '', await this.currentPermalink());
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

  /**
   * Switch between Code and Editor mode.
   * @param {'code'|'editor'} mode
   * @param {{docText?: string}} [opts]
   */
  async setMode(mode, opts = {}) {
    this.state.mode = mode;
    writeJSON(MODE_STORE, mode);
    $('#app').dataset.mode = mode;
    for (const b of document.querySelectorAll('.mode-switch [data-mode]')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    $('#mode-code').hidden = mode !== 'code';
    $('#mode-editor').hidden = mode !== 'editor';
    if (mode === 'editor') {
      this.preview.pause();
      if (!this.visual) {
        const { mountVisualEditor } = await import('../editor/ui/editor-app.js');
        this.visual = await mountVisualEditor($('#mode-editor'), {
          app: this,
          docText: opts.docText ?? null,
          theme: this.state.theme,
          board: this.state.board,
          size: this.state.size,
        });
      } else if (opts.docText) this.visual.loadText(opts.docText);
      this.visual.activate();
    } else if (this.visual) {
      this.visual.deactivate();
      this.preview.layout(true);
    }
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
      if (this.state.mode === 'editor' && this.visual) this.visual.save();
      else this.save();
      return;
    }
    if (typing) return;
    if (e.key === '?' && !mod) {
      e.preventDefault();
      this.toggleShortcuts();
      return;
    }
    if (this.state.mode === 'editor' && this.visual) {
      if (this.visual.handleKey(e)) e.preventDefault();
      return;
    }
    if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if (!mod && !e.altKey && this.preview.handleKey(e)) e.preventDefault();
  }
}

const app = new App();
app.start().catch((e) => {
  console.error(e);
  toast(`The playground could not start: ${e.message}`);
});
