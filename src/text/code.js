/**
 * Code blocks: monospace text with syntax colors, one Text node per line so
 * lines can be highlighted or revealed one at a time.
 * @module text/code
 */

import { Group, PathNode } from '../core/node.js';
import { rectPath } from '../core/path.js';
import { Text } from './nodes.js';

const QUBI_KEYWORDS = new Set(['LOOP', 'REPEAT', 'if', 'elseif', 'elif', 'else', 'gate', 'function', 'fn', 'LABEL', 'ANNOTATE', 'ANN', 'ENDANNOTATE', 'ENDANN', 'and', 'or', 'xor', 'not', 'blackbox', 'encapsulate', 'arg', 'argmax']);
const QUBI_GATES = new Set(['I', 'H', 'X', 'Y', 'Z', 'S', 'T', 'SDG', 'TDG', 'RX', 'RY', 'RZ', 'P', 'U', 'CX', 'CY', 'CZ', 'CP', 'SWAP', 'CSWAP', 'ISWAP', 'SQRTSWAP', 'SWAPSEQ', 'MEASURE']);
const QUBI_STDLIB = new Set(['Bell', 'GHZ', 'W', 'Superdense', 'Teleport', 'Deutsch', 'BV', 'Grover', 'QFT', 'IQFT', 'Shor', 'PhaseKickback', 'PhaseOracle', 'SwapTest', 'StatePreparation', 'QubitPreparation', 'BitFlip', 'QPE', 'Stego']);
const QUBI_WIRES = new Set(['all', 'visible', 'max', 'visiblemax']);

/**
 * Split one line of Qubi into highlighted spans.
 * @param {string} line
 * @returns {Array<{text: string, kind: 'comment'|'string'|'number'|'gate'|'stdlib'|'keyword'|'wire'|'setting'|'plain'}>}
 */
export function highlightQubi(line) {
  const out = [];
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*")|(#\w+)|(0b[01]+|0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:deg|rad|pirad)?)|([A-Za-z_][\w]*)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(line))) {
    const [t, com, str, set, num, word, ws] = m;
    if (com) out.push({ text: t, kind: 'comment' });
    else if (str) out.push({ text: t, kind: 'string' });
    else if (set) out.push({ text: t, kind: 'setting' });
    else if (num) out.push({ text: t, kind: 'number' });
    else if (word) {
      let kind = 'plain';
      if (QUBI_GATES.has(word)) kind = 'gate';
      else if (QUBI_STDLIB.has(word)) kind = 'stdlib';
      else if (QUBI_KEYWORDS.has(word)) kind = 'keyword';
      else if (QUBI_WIRES.has(word)) kind = 'wire';
      out.push({ text: t, kind });
    } else if (ws) out.push({ text: t, kind: 'plain' });
    else out.push({ text: t, kind: 'plain' });
  }
  return out;
}

const KIND_COLOR = {
  comment: 'faint',
  string: 'accent2',
  setting: 'muted',
  number: 'accent2',
  gate: 'accent',
  stdlib: 'accent',
  keyword: 'muted',
  wire: 'accent2',
  plain: 'ink',
};

/**
 * A block of code with syntax colors.
 */
export class CodeBlock extends Group {
  /**
   * @param {string} source
   * @param {Record<string, any>} [props] language ('qubi' | 'plain'), size (0.26), lineHeight (1.45), panel (draw a surface panel, default true), pad (0.3)
   */
  constructor(source, props = {}) {
    super([], { type: 'code' });
    this.source = source;
    const size = props.size ?? 0.26;
    const lh = size * (props.lineHeight ?? 1.45);
    const pad = props.pad ?? 0.3;
    const lang = props.language ?? 'qubi';
    const lines = source.replace(/\t/g, '  ').split('\n');
    /** @type {Text[]} */
    this.lines = [];
    const charW = size * 0.525;
    let maxLen = 0;
    lines.forEach((line, i) => {
      maxLen = Math.max(maxLen, line.length);
      if (!line.trim()) {
        this.lines.push(null);
        return;
      }
      const t = new Text(line, { size, font: 'KaTeX_Typewriter' });
      const spans = lang === 'qubi' ? highlightQubi(line) : [{ text: line, kind: 'plain' }];
      const colorAt = [];
      for (const sp of spans) for (let k = 0; k < sp.text.length; k++) colorAt.push(KIND_COLOR[sp.kind]);
      for (const g of t.glyphs) g.set('fill', colorAt[g.meta.cluster] ?? 'ink');
      // Place the layout origin on the monospace grid and the baseline on the line.
      const first = t.layout.paths[0];
      t.shift(-t.offset[0], -i * lh - (first.y + t.offset[1]));
      this.lines.push(t);
    });
    const width = maxLen * charW + 2 * pad;
    const height = lines.length * lh + 2 * pad - (lh - size);
    if (props.panel ?? true) {
      const panel = new PathNode(rectPath(width / 2 - pad, -height / 2 + pad + size * 0.5, width, height, 0.1), { type: 'codePanel', fill: 'surface', stroke: 'grid', strokeWidth: 1.5, meta: { solidFill: true, noBoard: true } });
      this.add(panel);
      this.panel = panel;
    }
    for (const t of this.lines) if (t) this.add(t);
    this.moveTo([0, 0]);
  }

  /**
   * Line node by index (null for blank lines).
   * @param {number} i
   * @returns {Text|null}
   */
  line(i) {
    return this.lines[i] ?? null;
  }
}
