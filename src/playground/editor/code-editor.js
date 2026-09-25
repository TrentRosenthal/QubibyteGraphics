/**
 * Code editor: a transparent textarea over a highlighted `<pre>`. The
 * textarea is the real control (native selection, IME, undo, screen
 * readers); the `<pre>` underneath draws syntax colors, diagnostics, and the
 * active line, and follows the textarea's scroll position. Adds bracket
 * pairs, Tab indentation, line comments, completions, and hover messages.
 * @module playground/editor/code-editor
 */

/* global EventTarget */

import { tokenizeJS, tokenizeQubi } from './tokenize.js';

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);
const INDENT = '  ';
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape a code span. The code face draws ' and ` as curly quotes, so they
 * are set from the UI face in a box exactly one code cell wide (the code
 * face advances 0.525 em per character), which keeps every column aligned
 * with the textarea above.
 */
function codeHtml(s) {
  return escapeHtml(s).replace(/['`]/g, (c) => `<span class="qm">${c}</span>`);
}

/**
 * @typedef {Object} Diagnostic
 * @property {number} line 1-based
 * @property {number} [col] 1-based
 * @property {number} [endCol] 1-based, exclusive
 * @property {'error'|'warning'} severity
 * @property {string} message
 */

/**
 * The editor. Events: `input` (the value changed), `run`, `save`.
 */
export class CodeEditor extends EventTarget {
  /**
   * @param {HTMLElement} host
   * @param {{language?: 'js'|'qubi', value?: string, label?: string, completions?: (lang: string, before: string) => {from: number, items: any[]}, known?: Set<string>}} [opts]
   */
  constructor(host, opts = {}) {
    super();
    this.language = opts.language ?? 'js';
    this.completions = opts.completions ?? null;
    this.known = opts.known ?? null;
    this.diagnostics = [];
    this.root = document.createElement('div');
    this.root.className = 'ce';
    this.root.innerHTML = `
      <div class="ce-gutter" aria-hidden="true"><div class="ce-gutter-inner"></div></div>
      <div class="ce-main">
        <div class="ce-layer">
          <div class="ce-active"></div>
          <pre class="ce-hl" aria-hidden="true"></pre>
        </div>
        <textarea class="ce-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea>
      </div>
      <div class="ce-pop popover" role="listbox" hidden></div>
      <div class="ce-tip" role="tooltip" hidden></div>`;
    host.append(this.root);
    this.ta = this.root.querySelector('.ce-ta');
    this.ta.setAttribute('aria-label', opts.label ?? 'Code');
    this.hl = this.root.querySelector('.ce-hl');
    this.layer = this.root.querySelector('.ce-layer');
    this.active = this.root.querySelector('.ce-active');
    this.gutter = this.root.querySelector('.ce-gutter-inner');
    this.pop = this.root.querySelector('.ce-pop');
    this.pop.id = `ce-pop-${Math.random().toString(36).slice(2, 8)}`;
    this.tip = this.root.querySelector('.ce-tip');
    this.ta.setAttribute('aria-autocomplete', 'list');
    this.ta.setAttribute('aria-controls', this.pop.id);
    this.popState = null;
    this.tabMovesFocus = false;
    this.ta.value = opts.value ?? '';
    this.ta.addEventListener('input', () => {
      this.render();
      this.dispatchEvent(new Event('input'));
      this.maybeComplete(false);
    });
    this.ta.addEventListener('scroll', () => this.sync());
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('keyup', () => this.updateActive());
    this.ta.addEventListener('click', () => {
      this.updateActive();
      this.closeCompletions();
    });
    this.ta.addEventListener('blur', () => setTimeout(() => this.closeCompletions(), 120));
    this.ta.addEventListener('mousemove', (e) => this.onHover(e));
    this.ta.addEventListener('mouseleave', () => {
      this.tip.hidden = true;
    });
    this.pop.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]');
      if (!li) return;
      e.preventDefault();
      this.accept(Number(li.dataset.i));
    });
    this.render();
  }

  /** @returns {string} */
  get value() {
    return this.ta.value;
  }

  /** @param {string} v */
  set value(v) {
    if (v === this.ta.value) return;
    const { scrollTop, scrollLeft, selectionStart } = this.ta;
    this.ta.value = v;
    this.ta.scrollTop = scrollTop;
    this.ta.scrollLeft = scrollLeft;
    const p = Math.min(selectionStart, v.length);
    if (document.activeElement === this.ta) this.ta.setSelectionRange(p, p);
    this.render();
  }

  /** @param {'js'|'qubi'} lang */
  setLanguage(lang) {
    this.language = lang;
    this.render();
  }

  /** @param {string} label accessible name */
  setLabel(label) {
    this.ta.setAttribute('aria-label', label);
  }

  /** @param {Diagnostic[]} list */
  setDiagnostics(list) {
    this.diagnostics = list.filter((d) => d.line != null);
    this.render();
  }

  /** Focus the textarea. */
  focus() {
    this.ta.focus();
  }

  /**
   * Put the caret at a position and scroll it into view.
   * @param {number} line 1-based
   * @param {number} [col=1] 1-based
   */
  reveal(line, col = 1) {
    const lines = this.ta.value.split('\n');
    let off = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) off += lines[i].length + 1;
    off += Math.max(0, Math.min((col || 1) - 1, (lines[line - 1] ?? '').length));
    this.ta.focus();
    this.ta.setSelectionRange(off, off);
    const m = this.metrics();
    const y = (line - 1) * m.lh;
    if (y < this.ta.scrollTop || y > this.ta.scrollTop + this.ta.clientHeight - 3 * m.lh) this.ta.scrollTop = Math.max(0, y - this.ta.clientHeight / 3);
    this.updateActive();
  }

  metrics() {
    if (!this._metrics || !this._metrics.cw) {
      const cs = getComputedStyle(this.ta);
      const probe = document.createElement('span');
      probe.textContent = 'M'.repeat(80);
      probe.style.cssText = `font:${cs.font};position:absolute;visibility:hidden;white-space:pre`;
      document.body.append(probe);
      const cw = probe.getBoundingClientRect().width / 80;
      probe.remove();
      this._metrics = { cw, lh: parseFloat(cs.lineHeight) || 20, padT: parseFloat(cs.paddingTop), padL: parseFloat(cs.paddingLeft) };
    }
    return this._metrics;
  }

  sync() {
    const x = this.ta.scrollLeft;
    const y = this.ta.scrollTop;
    this.layer.style.transform = `translate(${-x}px, ${-y}px)`;
    this.gutter.style.transform = `translateY(${-y}px)`;
    if (this.popState) this.positionPopover();
  }

  render() {
    const src = this.ta.value;
    const lines = this.language === 'qubi' ? tokenizeQubi(src) : tokenizeJS(src, { known: this.known });
    const byLine = new Map();
    for (const d of this.diagnostics) {
      if (!byLine.has(d.line)) byLine.set(d.line, []);
      byLine.get(d.line).push(d);
    }
    const textLines = src.split('\n');
    let html = '';
    lines.forEach((spans, i) => {
      const diags = byLine.get(i + 1);
      html += diags ? this.renderWithDiagnostics(spans, textLines[i] ?? '', diags) : spans.map((s) => `<span class="t-${s.kind}">${codeHtml(s.text)}</span>`).join('');
      html += '\n';
    });
    this.hl.innerHTML = html;
    let g = '';
    const n = textLines.length;
    for (let i = 1; i <= n; i++) {
      const d = byLine.get(i);
      const sev = d ? (d.some((x) => x.severity === 'error') ? 'error' : 'warning') : '';
      g += `<div class="ce-ln${sev ? ` has-${sev}` : ''}">${i}</div>`;
    }
    this.gutter.innerHTML = g;
    this.updateActive();
    this.sync();
  }

  renderWithDiagnostics(spans, text, diags) {
    const marks = new Array(Math.max(text.length, 1)).fill('');
    for (const d of diags) {
      let s = Math.max(0, (d.col ?? 1) - 1);
      let e = d.endCol != null ? d.endCol - 1 : -1;
      if (s >= text.length) s = Math.max(0, text.length - 1);
      if (e < 0) {
        const w = /^[\w#.]+|^\S/.exec(text.slice(s));
        e = s + (w ? w[0].length : 1);
        if (d.col == null) {
          s = text.search(/\S/);
          if (s < 0) s = 0;
          e = Math.max(s + 1, text.length);
        }
      }
      for (let k = s; k < Math.min(e, marks.length); k++) marks[k] = marks[k] === 'error' ? 'error' : d.severity;
    }
    let out = '';
    let pos = 0;
    for (const sp of spans) {
      let run = '';
      let runMark = null;
      for (let k = 0; k < sp.text.length; k++) {
        const m = marks[pos + k] ?? '';
        if (runMark !== null && m !== runMark) {
          out += this.wrap(sp.kind, run, runMark);
          run = '';
        }
        runMark = m;
        run += sp.text[k];
      }
      if (run) out += this.wrap(sp.kind, run, runMark);
      pos += sp.text.length;
    }
    if (!text.length && marks[0]) out += `<span class="ce-diag ce-${marks[0]}"> </span>`;
    return out;
  }

  wrap(kind, text, mark) {
    const inner = `<span class="t-${kind}">${codeHtml(text)}</span>`;
    return mark ? `<span class="ce-diag ce-${mark}">${inner}</span>` : inner;
  }

  caret() {
    const p = this.ta.selectionStart;
    const before = this.ta.value.slice(0, p);
    const line = before.split('\n').length;
    const col = p - before.lastIndexOf('\n');
    return { line, col, before: before.slice(before.lastIndexOf('\n') + 1) };
  }

  updateActive() {
    const m = this.metrics();
    const { line } = this.caret();
    this.active.style.transform = `translateY(${m.padT + (line - 1) * m.lh}px)`;
    this.active.style.height = `${m.lh}px`;
    const prev = this.gutter.querySelector('.is-active');
    if (prev) prev.classList.remove('is-active');
    const cur = this.gutter.children[line - 1];
    if (cur) cur.classList.add('is-active');
  }

  /**
   * Replace a range with text through the browser's editing commands, so
   * native undo and redo keep working.
   */
  replace(start, end, text, caretStart = null, caretEnd = null) {
    this.ta.focus();
    this.ta.setSelectionRange(start, end);
    if (text === '') document.execCommand('delete');
    else if (!document.execCommand('insertText', false, text)) {
      this.ta.setRangeText(text, start, end, 'end');
      this.ta.dispatchEvent(new Event('input'));
    }
    if (caretStart != null) this.ta.setSelectionRange(caretStart, caretEnd ?? caretStart);
  }

  lineRange() {
    const v = this.ta.value;
    const s = this.ta.selectionStart;
    let e = this.ta.selectionEnd;
    if (e > s && v[e - 1] === '\n') e--;
    const start = v.lastIndexOf('\n', s - 1) + 1;
    let end = v.indexOf('\n', e);
    if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, end) };
  }

  indent(dir) {
    const { selectionStart: s, selectionEnd: e } = this.ta;
    const r = this.lineRange();
    if (dir > 0 && s === e) {
      this.replace(s, e, INDENT);
      return;
    }
    const lines = r.text.split('\n');
    let firstDelta = 0;
    let total = 0;
    const out = lines.map((l, i) => {
      if (dir > 0) {
        if (i === 0) firstDelta = INDENT.length;
        total += INDENT.length;
        return INDENT + l;
      }
      const m = /^( {1,2}|\t)/.exec(l);
      const cut = m ? m[0].length : 0;
      if (i === 0) firstDelta = -cut;
      total -= cut;
      return l.slice(cut);
    });
    const text = out.join('\n');
    if (text === r.text) return;
    const ns = Math.max(r.start, s + firstDelta);
    this.replace(r.start, r.end, text, s === e ? ns : ns, s === e ? ns : e + total);
  }

  toggleComment() {
    const r = this.lineRange();
    const lines = r.text.split('\n');
    const nonEmpty = lines.filter((l) => l.trim());
    const all = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\/\//.test(l));
    const minIndent = Math.min(...nonEmpty.map((l) => /^\s*/.exec(l)[0].length), Infinity);
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      if (all) return l.replace(/^(\s*)\/\/ ?/, '$1');
      return l.slice(0, minIndent) + '// ' + l.slice(minIndent);
    });
    const text = out.join('\n');
    this.replace(r.start, r.end, text, r.start, r.start + text.length);
  }

  onKey(e) {
    const mod = MAC ? e.metaKey : e.ctrlKey;
    if (this.popState) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.popState.items.length;
        this.popState.index = (this.popState.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.drawCompletions();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.accept(this.popState.index);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeCompletions();
        return;
      }
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      this.dispatchEvent(new Event('run'));
      return;
    }
    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this.dispatchEvent(new Event('save'));
      return;
    }
    if (mod && e.key === '/') {
      e.preventDefault();
      this.toggleComment();
      return;
    }
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      this.maybeComplete(true);
      return;
    }
    if (e.key === 'Escape') {
      this.tabMovesFocus = true;
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (this.tabMovesFocus) {
        this.tabMovesFocus = false;
        return;
      }
      e.preventDefault();
      this.indent(e.shiftKey ? -1 : 1);
      return;
    }
    this.tabMovesFocus = false;
    if (mod || e.altKey) return;
    const { selectionStart: s, selectionEnd: en, value: v } = this.ta;
    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const indent = /^\s*/.exec(v.slice(lineStart, s))[0];
      const prev = v[s - 1];
      const next = v[s];
      if ('([{'.includes(prev) && PAIRS[prev] === next) {
        this.replace(s, en, `\n${indent}${INDENT}\n${indent}`, s + 1 + indent.length + INDENT.length);
      } else {
        const extra = prev && '([{'.includes(prev) ? INDENT : '';
        this.replace(s, en, `\n${indent}${extra}`);
      }
      return;
    }
    if (e.key === 'Backspace' && s === en && s > 0 && PAIRS[v[s - 1]] && PAIRS[v[s - 1]] === v[s]) {
      e.preventDefault();
      this.replace(s - 1, s + 1, '');
      return;
    }
    if (CLOSERS.has(e.key) && s === en && v[s] === e.key && (e.key !== '"' && e.key !== "'" && e.key !== '`' ? true : v[s - 1] !== '\\')) {
      e.preventDefault();
      this.ta.setSelectionRange(s + 1, s + 1);
      this.updateActive();
      return;
    }
    if (PAIRS[e.key]) {
      const quote = e.key === '"' || e.key === "'" || e.key === '`';
      if (s !== en) {
        e.preventDefault();
        const sel = v.slice(s, en);
        this.replace(s, en, e.key + sel + PAIRS[e.key], s + 1, en + 1);
        return;
      }
      const next = v[s] ?? '';
      const prev = v[s - 1] ?? '';
      if (next && !/[\s)\]},;:]/.test(next)) return;
      if (quote && /[\w$]/.test(prev)) return;
      if (quote && this.language === 'qubi' && e.key !== '"') return;
      e.preventDefault();
      this.replace(s, en, e.key + PAIRS[e.key], s + 1);
    }
  }

  maybeComplete(force) {
    if (!this.completions || document.activeElement !== this.ta) return;
    const { selectionStart: s, selectionEnd: en } = this.ta;
    if (s !== en) {
      this.closeCompletions();
      return;
    }
    const { before } = this.caret();
    const res = this.completions(this.language, before);
    const typed = before.length - res.from;
    const contextual = /\.$/.test(before) || /^\s*#(settings\s+(\w+\s+)?)?$/.test(before);
    if (!res.items.length || !(force || typed > 0 || contextual)) {
      this.closeCompletions();
      return;
    }
    this.popState = { items: res.items, index: 0, from: s - typed, to: s };
    this.drawCompletions();
  }

  drawCompletions() {
    const st = this.popState;
    this.pop.innerHTML = st.items.map((it, i) => `<div class="ce-item${i === st.index ? ' is-selected' : ''}" role="option" id="${this.pop.id}-${i}" aria-selected="${i === st.index}" data-i="${i}"><span class="ce-item-kind k-${it.kind}">${kindLetter(it.kind)}</span><span class="ce-item-label">${escapeHtml(it.label)}</span><span class="ce-item-detail">${escapeHtml(it.detail || '')}</span>${i === st.index && it.doc ? `<span class="ce-item-doc">${escapeHtml(it.doc)}</span>` : ''}</div>`).join('');
    this.pop.hidden = false;
    this.ta.setAttribute('aria-expanded', 'true');
    this.ta.setAttribute('aria-activedescendant', `${this.pop.id}-${st.index}`);
    const sel = this.pop.querySelector('.is-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    this.positionPopover();
  }

  positionPopover() {
    const m = this.metrics();
    const { line, before } = this.caret();
    const col = before.length - (this.popState.to - this.popState.from);
    const main = this.root.querySelector('.ce-main');
    const gutterW = main.offsetLeft;
    let x = gutterW + m.padL + col * m.cw - this.ta.scrollLeft - 8;
    const y = m.padT + line * m.lh - this.ta.scrollTop + 4;
    const maxX = this.root.clientWidth - this.pop.offsetWidth - 8;
    x = Math.max(4, Math.min(x, maxX));
    const below = y + this.pop.offsetHeight < this.root.clientHeight;
    this.pop.style.left = `${x}px`;
    this.pop.style.top = below ? `${y}px` : `${Math.max(4, y - m.lh - 8 - this.pop.offsetHeight)}px`;
  }

  closeCompletions() {
    if (!this.popState) return;
    this.popState = null;
    this.pop.hidden = true;
    this.ta.setAttribute('aria-expanded', 'false');
    this.ta.removeAttribute('aria-activedescendant');
  }

  accept(i) {
    const st = this.popState;
    if (!st) return;
    const it = st.items[i];
    this.closeCompletions();
    if (!it || !it.insert) return;
    this.replace(st.from, st.to, it.insert);
    this.closeCompletions();
  }

  onHover(e) {
    if (!this.diagnostics.length) {
      this.tip.hidden = true;
      return;
    }
    const m = this.metrics();
    const r = this.ta.getBoundingClientRect();
    const line = Math.floor((e.clientY - r.top + this.ta.scrollTop - m.padT) / m.lh) + 1;
    const col = Math.floor((e.clientX - r.left + this.ta.scrollLeft - m.padL) / m.cw) + 1;
    const text = this.ta.value.split('\n')[line - 1] ?? '';
    const hit = this.diagnostics.find((d) => {
      if (d.line !== line) return false;
      const s = d.col ?? 1;
      const w = /^[\w#.]+|^\S/.exec(text.slice(s - 1));
      const end = d.endCol ?? (d.col == null ? text.length + 1 : s + (w ? w[0].length : 1));
      return col >= s && col < Math.max(end, s + 1);
    });
    if (!hit) {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = hit.message;
    this.tip.className = `ce-tip ce-tip-${hit.severity}`;
    this.tip.hidden = false;
    const root = this.root.getBoundingClientRect();
    const main = this.root.querySelector('.ce-main');
    const x = main.offsetLeft + m.padL + ((hit.col ?? 1) - 1) * m.cw - this.ta.scrollLeft;
    const y = m.padT + line * m.lh - this.ta.scrollTop + 4;
    this.tip.style.left = `${Math.max(4, Math.min(x, root.width - this.tip.offsetWidth - 8))}px`;
    this.tip.style.top = `${y}px`;
  }
}

function kindLetter(kind) {
  return { function: 'f', class: 'C', const: 'k', namespace: 'N', method: 'm', gate: 'G', stdlib: 'f', keyword: 'K', wire: 'w', setting: 's', value: 'v' }[kind] ?? '';
}
