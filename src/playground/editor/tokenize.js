/**
 * Tokenizers for the code editor. Each returns one array of spans per line,
 * so the highlighter can render lines independently and diagnostics can be
 * placed by line and column. JavaScript state (block comments, template
 * strings) carries across lines; Qubi reuses the engine's own highlighter.
 * @module playground/editor/tokenize
 */

import { highlightQubi } from '../../text/code.js';

/** @typedef {{text: string, kind: string}} Span */

const JS_KEYWORDS = new Set([
  'await', 'async', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
  'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return',
  'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'as', 'get', 'set',
]);
const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

/**
 * Tokenize JavaScript source.
 * @param {string} source
 * @param {{known?: Set<string>}} [opts] known engine names, highlighted as API
 * @returns {Span[][]}
 */
export function tokenizeJS(source, opts = {}) {
  const known = opts.known ?? null;
  const lines = [];
  let line = [];
  const push = (text, kind) => {
    const parts = text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) {
        lines.push(line);
        line = [];
      }
      if (p) {
        const last = line[line.length - 1];
        if (last && last.kind === kind) last.text += p;
        else line.push({ text: p, kind });
      }
    });
  };
  const src = source;
  let i = 0;
  let prevSignificant = '';
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i, i + 2);
    if (rest === '//') {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      push(src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (rest === '/*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      push(src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n' && c !== '`') break;
        j++;
      }
      j = Math.min(src.length, j + 1);
      push(src.slice(i, j), 'string');
      prevSignificant = 'x';
      i = j;
      continue;
    }
    if (c === '/' && /^$|[=(,:[!&|?{};]$/.test(prevSignificant)) {
      const m = /^\/(?![*/])(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+\/[gimsuyd]*/.exec(src.slice(i));
      if (m) {
        push(m[0], 'string');
        i += m[0].length;
        prevSignificant = 'x';
        continue;
      }
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      push(src.slice(i, j), 'plain');
      i = j;
      continue;
    }
    const num = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i));
    if (num && /\d/.test(num[0])) {
      push(num[0], 'number');
      i += num[0].length;
      prevSignificant = 'x';
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (id) {
      const w = id[0];
      let kind = 'plain';
      const after = src.slice(i + w.length).match(/^\s*(.)/);
      if (JS_KEYWORDS.has(w)) kind = 'keyword';
      else if (JS_LITERALS.has(w)) kind = 'number';
      else if (known && known.has(w)) kind = 'api';
      else if (after && after[1] === '(') kind = 'fn';
      else if (/^[A-Z]/.test(w)) kind = 'type';
      push(w, kind);
      i += w.length;
      prevSignificant = JS_KEYWORDS.has(w) && w !== 'this' && w !== 'super' ? '(' : 'x';
      continue;
    }
    push(c, 'punct');
    prevSignificant = c;
    i++;
  }
  lines.push(line);
  return lines;
}

const QUBI_KIND = { comment: 'comment', string: 'string', number: 'number', gate: 'gate', stdlib: 'fn', keyword: 'keyword', wire: 'number', setting: 'setting', plain: 'plain' };

/**
 * Tokenize Qubi source with the engine's highlighter, mapped to editor kinds.
 * @param {string} source
 * @returns {Span[][]}
 */
export function tokenizeQubi(source) {
  return source.split('\n').map((line) => highlightQubi(line).map((s) => ({ text: s.text, kind: /^[()[\]{},;=+\-*/<>.]+$/.test(s.text) ? 'punct' : QUBI_KIND[s.kind] ?? 'plain' })));
}
