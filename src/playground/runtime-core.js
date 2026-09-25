/**
 * Runtime core: builds scenes from user sources and renders them. It runs
 * inside the sandbox (a module Worker, or a sandboxed iframe when
 * OffscreenCanvas is missing) and never on the main page. The page talks to
 * it through messages; see `src/playground/runtime.js` for the client side.
 *
 * Sources come in three kinds:
 * - `module`: a scene module (`export default async function (scene) {}`),
 *   imported from a Blob URL after its engine imports are rewritten to
 *   absolute URLs;
 * - `document`: scene document JSON from the visual editor, built with
 *   `buildDocument`;
 * - `qubi`: a Qubi program, presented as an explainer or a circuit view.
 *
 * @module playground/runtime-core
 */

import {
  buildScene, sampleFrame, renderFrame, viewFor, renderSVG, getTheme, registerTheme, buildDocument,
  normalizeDocument, evaluateGraph, blockDefinition, explainQubi, evaluateQubi, quantumViews, Text, Tex,
  fadeIn, write, lagStart,
} from '../index.js';
import { tracePath, pathBounds } from '../core/path.js';
import { createCanvas } from '../core/platform.js';
import { StatevectorSimulator } from '../quantum/statevector.js';

/** Package specifiers a scene may import, mapped to engine modules. */
const PACKAGE_MAP = {
  'qubibyte-graphics': '../index.js',
  'qubibyte-graphics/qubi': '../qubi/index.js',
  'qubibyte-graphics/quantum': '../quantum/index.js',
  'qubibyte-graphics/math': '../math/index.js',
};

/** Board names in the playground and the themes that draw them. */
export const BOARD_THEMES = { whiteboard: 'whiteboard', chalkboard: 'chalkboard', paper: 'paper', blueprint: 'board-blueprint' };

const BUILD_KEYS = ['width', 'height', 'fps', 'seed'];

/**
 * Rewrite a scene module's imports so it can run from a Blob URL: package
 * specifiers and relative paths become absolute URLs of engine modules.
 * Only the specifier text changes, so line numbers stay the same.
 * @param {string} source module source
 * @param {string} baseURL URL the relative specifiers resolve against
 * @returns {string}
 */
export function rewriteImports(source, baseURL) {
  const engine = new URL('../index.js', import.meta.url).href;
  const map = (spec) => {
    if (PACKAGE_MAP[spec]) return new URL(PACKAGE_MAP[spec], import.meta.url).href;
    if (/^\.{0,2}\/?(?:.*\/)?src\/index\.js$/.test(spec) && !/^[a-z]+:/i.test(spec)) {
      const resolved = new URL(spec, baseURL).href;
      return resolved.endsWith('/src/index.js') ? resolved : engine;
    }
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) return new URL(spec, baseURL).href;
    return spec;
  };
  return source.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g, (_m, pre, q, spec) => `${pre}${q}${map(spec)}${q}`);
}

/**
 * Turn a module into a classic script that parses the same way, for
 * locating syntax errors: import and export keywords are blanked with spaces
 * so every other character keeps its line and column.
 * @param {string} source
 * @returns {{script: string, prefix: number}}
 */
function classicProbe(source) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let s = source.replace(/^\s*import\s[\s\S]*?(['"])[^'"\n]*\1\s*;?/gm, blank);
  s = s.replace(/^\s*import\s*(['"])[^'"\n]*\1\s*;?/gm, blank);
  s = s.replace(/\bexport\s+default\s/g, (m) => '0,' + ' '.repeat(m.length - 2));
  s = s.replace(/\bexport\s+(?=(?:async\s+)?function|const|let|var|class)/g, blank);
  s = s.replace(/\bexport\s*\{[^}]*\}\s*(?:from\s*(['"])[^'"\n]*\1)?\s*;?/g, blank);
  const prefix = 'async function __probe(){';
  return { script: prefix + s + '\n}', prefix: prefix.length };
}

/**
 * Locate a syntax error by parsing the source as a classic script in a
 * throwaway worker, whose error event carries a line and column.
 * @param {string} source
 * @returns {Promise<{line: number, col: number, message: string}|null>}
 */
function locateSyntaxError(source) {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  const { script, prefix } = classicProbe(source);
  const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  return new Promise((resolve) => {
    let w;
    const done = (v) => {
      clearTimeout(timer);
      if (w) w.terminate();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 3000);
    try {
      w = new Worker(url);
    } catch {
      done(null);
      return;
    }
    w.onerror = (ev) => {
      ev.preventDefault();
      if (!ev.lineno) return done(null);
      const col = ev.lineno === 1 ? Math.max(1, ev.colno - prefix) : ev.colno;
      done({ line: ev.lineno, col, message: String(ev.message || '').replace(/^Uncaught\s+/, '') });
    };
  });
}

/**
 * The Qubi circuit presentation: the diagram builds, then the final state
 * appears as bars and in Dirac notation.
 * @param {string} source
 * @returns {(scene: any) => Promise<void>}
 */
function circuitView(source) {
  return async (scene) => {
    const circuit = evaluateQubi(source);
    const n = circuit.numQubits;
    const sim = new StatevectorSimulator(n, { seed: 7 });
    for (const op of circuit.ops) if (op.kind === 'gate') sim.applyOp(op);
    const halfW = scene.frameWidth / 2;
    const halfH = scene.frameHeight / 2;
    const margin = Math.min(scene.frameWidth, scene.frameHeight) * 0.07;
    const title = new Text(`${n} qubit${n === 1 ? '' : 's'}, ${circuit.ops.length} operation${circuit.ops.length === 1 ? '' : 's'}`, { size: 'caption', color: 'muted' });
    title.moveTo([-halfW + margin, halfH - margin], 'top-left');
    const diagram = new quantumViews.CircuitDiagram(circuit, { groups: 'outline' });
    const areaW = scene.frameWidth - 2 * margin;
    diagram.fitTo(areaW, (scene.frameHeight - 2 * margin) * 0.46);
    if (diagram.width > 0 && diagram.width < areaW * 0.5) diagram.scale(Math.min(1.4, (areaW * 0.55) / diagram.width));
    diagram.moveTo([-halfW + margin, halfH - margin - 0.7], 'top-left');
    const bottom = -halfH + margin;
    const views = [];
    if (n <= 6) {
      const bars = new quantumViews.AmplitudeBars(n, sim, { mode: 'phase', width: Math.min(7, areaW * 0.48), height: 2.2 });
      bars.moveTo([-halfW + margin, bottom], 'bottom-left');
      views.push(bars);
    }
    const dirac = quantumViews.diracTex(sim, { size: 0.42, maxTerms: 8, perLine: 4 });
    const room = n <= 6 ? areaW * 0.46 : areaW;
    if (dirac.width > room || dirac.height > 2.4) dirac.fitTo(room, 2.4);
    dirac.moveTo([halfW - margin, bottom + 1.1], n <= 6 ? 'right' : 'center');
    views.push(dirac);
    await scene.play(fadeIn(title), { duration: 0.4 });
    await scene.play(diagram.build());
    await scene.play(lagStart(views.map((v) => (v instanceof Tex ? write(v) : fadeIn(v, { shift: 'up' }))), { lagRatio: 0.25 }), { duration: 1 });
    await scene.wait(1.2);
  };
}

/**
 * Encode a canvas (OffscreenCanvas or HTMLCanvasElement) as an image blob.
 * @param {any} canvas
 * @param {string} type
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function formatValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? +v.toPrecision(5) : String(v);
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(formatValue);
  if (typeof v === 'object' && 'r' in v && 'g' in v) return `rgba(${Math.round(v.r * 255)}, ${Math.round(v.g * 255)}, ${Math.round(v.b * 255)}, ${+v.a.toFixed(2)})`;
  if (typeof v === 'object' && v.constructor && v.constructor.name) return v.constructor.name;
  return String(v);
}

/**
 * Scene builder and renderer behind the sandbox boundary.
 */
export class RuntimeCore {
  /**
   * @param {{post: (msg: any, transfer?: any[]) => void, canvas?: any, bitmap?: boolean}} io
   *   post sends events to the page; canvas is the transferred preview canvas (worker mode);
   *   bitmap mode renders offscreen and posts ImageBitmaps (iframe fallback).
   */
  constructor(io) {
    this.post = io.post;
    this.canvas = io.canvas ?? null;
    this.bitmap = !!io.bitmap;
    this.scene = null;
    this.theme = null;
    this.source = null;
    this.options = {};
    this.controlOverrides = {};
    this.lastT = 0;
    this.viewport = null;
    this.pending = null;
    this.scheduled = false;
    this.blockHandles = new Map();
    this.cancelled = false;
  }

  /**
   * Handle a request message; returns the reply value.
   * @param {any} m
   * @returns {Promise<any>}
   */
  async handle(m) {
    switch (m.type) {
      case 'init':
        if (m.canvas) this.canvas = m.canvas;
        return true;
      case 'load':
        this.source = { kind: m.kind, source: m.source, doc: m.doc, baseURL: m.baseURL };
        this.options = m.options || {};
        this.controlOverrides = {};
        return this.rebuild();
      case 'options':
        this.options = { ...this.options, ...m.options };
        return this.rebuild();
      case 'viewport':
        this.viewport = { width: Math.max(1, Math.round(m.width)), height: Math.max(1, Math.round(m.height)) };
        this.refresh();
        return true;
      case 'pick':
        return this.pick(m.x, m.y);
      case 'inspect':
        return this.inspect(m.node);
      case 'control':
        return this.setControl(m.index, m.value);
      case 'texPreview':
        return this.texPreview(m.source, m.color);
      case 'still':
        return this.still(m);
      case 'export': {
        this.cancelled = false;
        const { exportScene } = await import('./export/encode.js');
        return exportScene(this, m.options, (p) => this.post({ type: 'progress', ...p }));
      }
      case 'cancelExport':
        this.cancelled = true;
        return true;
      default:
        throw new Error(`Unknown runtime request "${m.type}"`);
    }
  }

  /**
   * Build a scene for the current source with option overrides.
   * @param {Record<string, any>} [over] width, height, fps
   * @returns {Promise<any>}
   */
  async buildWith(over = {}) {
    const src = this.source;
    if (!src) throw new Error('Nothing is loaded');
    const o = { ...this.options, ...over };
    for (const t of o.themes || []) registerTheme(t);
    const opts = {};
    for (const k of BUILD_KEYS) if (o[k] != null) opts[k] = o[k];
    if (o.theme) opts.theme = typeof o.theme === 'object' ? registerTheme(o.theme).id : o.theme;
    if (src.kind === 'document') {
      const doc = normalizeDocument(src.doc);
      doc.meta = { ...doc.meta, ...opts };
      const overrides = {};
      for (const [blockId, value] of Object.entries(this.controlOverrides)) overrides[blockId] = { value };
      const scene = await buildDocument(doc, { overrides, tolerant: true });
      let layout = null;
      if (o.layout) {
        const still = { ...doc, blocks: doc.blocks.map(({ enter: _e, exit: _x, keyframes: _k, ...b }) => b) };
        layout = await buildDocument(still, { overrides, tolerant: true });
      }
      return { scene, doc, layout };
    }
    if (src.kind === 'qubi') {
      const fn = o.qubiView === 'circuit' ? circuitView(src.source) : explainQubi(src.source);
      return { scene: await buildScene(fn, { theme: 'qubibyte', ...opts }) };
    }
    if (!this.module || this.module.source !== src.source) {
      const code = rewriteImports(src.source, src.baseURL || new URL('../../examples/', import.meta.url).href);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        const mod = await import(url);
        if (typeof mod.default !== 'function') throw new Error('The scene module must export a default async function (scene) => { ... }');
        this.module = { source: src.source, build: mod.default, config: mod.config || {}, url };
      } catch (e) {
        if (e && e.name === 'SyntaxError') {
          const at = await locateSyntaxError(src.source);
          const err = new SyntaxError(at ? at.message.replace(/^SyntaxError:\s*/, '') : e.message);
          if (at) {
            err.line = at.line;
            err.col = at.col;
          }
          throw err;
        }
        e.moduleURL = url;
        throw e;
      }
    }
    const buildOpts = { ...this.module.config, ...opts };
    if (!o.theme && this.module.config.theme) buildOpts.theme = this.module.config.theme;
    try {
      return { scene: await buildScene(this.module.build, buildOpts) };
    } catch (e) {
      if (e && typeof e === 'object') e.moduleURL = this.module.url;
      throw e;
    }
  }

  /**
   * Resolve the render theme of a scene: a board override maps to its
   * board theme, `clean` keeps the scene theme.
   * @param {any} scene
   * @returns {any}
   */
  themeFor(scene) {
    const board = this.options.board;
    if (board && board !== 'clean' && BOARD_THEMES[board]) return getTheme(BOARD_THEMES[board]);
    const t = getTheme(scene.theme);
    if (!board && scene.board && scene.board !== 'clean' && BOARD_THEMES[scene.board]) return getTheme(BOARD_THEMES[scene.board]);
    return t;
  }

  async rebuild() {
    const built = await this.buildWith();
    this.scene = built.scene;
    this.doc = built.doc ?? null;
    this.layoutScene = built.layout ?? null;
    this.theme = this.themeFor(this.scene);
    for (const [i, v] of Object.entries(this.controlOverrides)) {
      if (this.source.kind !== 'document') this.applyTrackerOverride(Number(i), v);
    }
    this.computeHandles();
    this.lastT = Math.min(this.lastT, this.scene.duration);
    this.refresh();
    return this.info();
  }

  /** Serializable description of the loaded scene. @returns {any} */
  info() {
    const s = this.scene;
    const out = (t) => +s.sceneToOutputTime(t).toFixed(6);
    return {
      duration: s.duration,
      fps: s.fps,
      frameCount: s.frameCount,
      width: s.width,
      height: s.height,
      theme: typeof s.theme === 'string' ? s.theme : s.theme.id,
      sceneBoard: s.board ?? null,
      title: s.title,
      labels: [...s.labels].map(([name, t]) => ({ name, t: out(t) })).sort((a, b) => a.t - b.t),
      pauses: s.pauses.map((p) => ({ name: p.name, t: out(p.time) })),
      captions: s.captions.map((c) => ({ text: c.text, start: out(c.start), end: out(c.end) })),
      audio: s.audio.length,
      controls: s.controls.map((c, index) => ({
        index,
        kind: c.kind ?? 'slider',
        label: c.label ?? c.name ?? `control ${index + 1}`,
        min: c.min ?? 0,
        max: c.max ?? 1,
        step: c.step ?? 0.01,
        value: this.controlValue(c, index),
        blockId: c.tracker && c.tracker.meta ? c.tracker.meta.blockId ?? null : null,
      })),
      blockErrors: s.blockErrors ?? [],
      keyframes: this.doc ? this.doc.blocks.flatMap((b) => (b.keyframes || []).map((k) => ({ block: b.id, t: out(k.t) }))) : [],
      themeColors: this.theme ? { ...this.theme.colors } : null,
    };
  }

  controlValue(c, index) {
    if (this.controlOverrides[index] != null) return this.controlOverrides[index];
    if (c.tracker) return c.tracker.valueAt('value', 0);
    return c.value ?? 0;
  }

  applyTrackerOverride(index, value) {
    const c = this.scene.controls[index];
    if (!c || !c.tracker) return;
    c.tracker._tracks.delete('value');
    c.tracker._init.value = value;
    c.tracker._cur.value = value;
  }

  async setControl(index, value) {
    const c = this.scene && this.scene.controls[index];
    if (!c) throw new Error(`No control ${index}`);
    if (this.source.kind === 'document') {
      const blockId = c.tracker && c.tracker.meta.blockId;
      this.controlOverrides[blockId] = value;
      await this.rebuild();
      return true;
    }
    this.controlOverrides[index] = value;
    this.applyTrackerOverride(index, value);
    this.refresh();
    return true;
  }

  /** Interactive handles exposed by block definitions (world positions). */
  computeHandles() {
    this.blockHandles = new Map();
    if (!this.doc) return;
    const withHandles = this.doc.blocks.filter((b) => typeof blockDefinition(b.type).handles === 'function');
    if (!withHandles.length) return;
    let outputs;
    try {
      outputs = evaluateGraph(this.doc);
    } catch {
      return;
    }
    for (const b of withHandles) {
      try {
        const hs = blockDefinition(b.type).handles(b.props, outputs.get(b.id) || {}) || [];
        this.blockHandles.set(b.id, hs);
      } catch {
        this.blockHandles.set(b.id, []);
      }
    }
  }

  /** Scene time for an output time. @param {number} T @returns {number} */
  sceneTime(T) {
    return this.scene.outputToSceneTime(Math.max(0, Math.min(T, this.scene.duration)));
  }

  /** Render the current frame again, keeping a queued time if there is one. */
  refresh() {
    this.requestFrame(this.pending ? { ...this.pending } : { t: this.lastT, layout: this.lastLayout });
  }

  /**
   * Queue a preview frame; only the latest request renders.
   * @param {{t: number}} req
   */
  requestFrame(req) {
    this.pending = req;
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      const r = this.pending;
      this.pending = null;
      if (r) this.renderPreview(r);
    }, 0);
  }

  renderPreview(req) {
    const s = req.layout && this.layoutScene ? this.layoutScene : this.scene;
    if (!s) return;
    this.lastT = req.t;
    this.lastLayout = !!req.layout;
    const vp = this.viewport ?? { width: s.width, height: s.height };
    const st = s === this.scene ? this.sceneTime(req.t) : 0;
    const frame = sampleFrame(s, st, this.theme);
    const pr = vp.width / s.width;
    let canvas = this.canvas;
    if (this.bitmap || !canvas) {
      if (!this.scratch || this.scratch.width !== vp.width || this.scratch.height !== vp.height) this.scratch = createCanvas(vp.width, vp.height);
      canvas = this.scratch;
    } else if (canvas.width !== vp.width || canvas.height !== vp.height) {
      canvas.width = vp.width;
      canvas.height = vp.height;
    }
    const ctx = canvas.getContext('2d');
    renderFrame(ctx, frame, { pixelRatio: pr, assets: s.assets });
    const msg = {
      type: 'frame',
      t: req.t,
      n: Math.round(req.t * s.fps),
      captions: frame.captions.map((c) => c.text),
      layout: s !== this.scene,
      blocks: this.doc ? this.blockInfo(s, st) : null,
    };
    if (this.bitmap || !this.canvas) {
      const send = (bitmap) => {
        msg.bitmap = bitmap;
        this.post(msg, [bitmap]);
      };
      if (typeof canvas.transferToImageBitmap === 'function') send(canvas.transferToImageBitmap());
      else createImageBitmap(canvas).then(send);
    } else this.post(msg);
  }

  /**
   * World bounds, visibility, and handles of every document block at a time.
   * @param {any} s the scene (the layout scene shows every block at rest)
   * @param {number} st scene time
   * @returns {any[]}
   */
  blockInfo(s, st) {
    const out = [];
    s.evaluateAt(st, () => {
      for (const node of s.root.children) {
        const id = node.meta && node.meta.blockId;
        if (!id) continue;
        const b = node.bounds();
        const m = node.worldMatrix();
        const hs = (this.blockHandles.get(id) || []).map((h) => ({ id: h.id, label: h.label ?? '', at: h.at, world: applyMatrix(m, h.at[0], h.at[1]) }));
        out.push({ id, bounds: b, visible: !!node.get('visible') && node.get('opacity') > 0.01, matrix: m, handles: hs });
      }
    });
    return out;
  }

  /**
   * Find the node under a point of the preview canvas (device pixels).
   * @param {number} px
   * @param {number} py
   * @returns {{chain: Array<{id: string, type: string, blockId: string|null}>}|null}
   */
  pick(px, py) {
    const s = this.scene;
    if (!s) return null;
    const vp = this.viewport ?? { width: s.width, height: s.height };
    const pr = vp.width / s.width;
    const frame = sampleFrame(s, this.sceneTime(this.lastT), this.theme);
    const view = viewFor(frame, pr);
    if (!this.pickCtx) this.pickCtx = createCanvas(4, 4).getContext('2d');
    const ctx = this.pickCtx;
    const [a, b, c, d, e, f] = view.matrix;
    const det = a * d - b * c;
    const wx = (d * (px - e) - c * (py - f)) / det;
    const wy = (-b * (px - e) + a * (py - f)) / det;
    let hit = null;
    for (let i = frame.items.length - 1; i >= 0 && !hit; i--) {
      const it = frame.items[i];
      if (it.kind === 'image') {
        const m = it.matrix;
        const det2 = m[0] * m[3] - m[1] * m[2];
        const lx = (m[3] * (wx - m[4]) - m[2] * (wy - m[5])) / det2;
        const ly = (-m[1] * (wx - m[4]) + m[0] * (wy - m[5])) / det2;
        if (Math.abs(lx) <= it.width / 2 && Math.abs(ly) <= it.height / 2) hit = it;
        continue;
      }
      ctx.setTransform(a, b, c, d, e, f);
      ctx.beginPath();
      tracePath(ctx, it.path);
      if (it.fill && ctx.isPointInPath(px, py, it.fillRule)) hit = it;
      else if (it.stroke) {
        ctx.lineWidth = Math.max((it.strokeWidth * view.strokeScale) / view.scale, (8 * pr) / view.scale);
        if (ctx.isPointInStroke(px, py)) hit = it;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!hit) {
      // Thin glyphs and hairlines are hard to hit exactly: take the smallest
      // item whose bounds, padded by a few pixels, contain the point.
      const pad = (6 * pr) / view.scale;
      let best = Infinity;
      for (const it of frame.items) {
        if (it.kind !== 'path') continue;
        const b = pathBounds(it.path);
        if (!b || wx < b.x - pad || wx > b.x + b.w + pad || wy < b.y - pad || wy > b.y + b.h + pad) continue;
        const area = (b.w + pad) * (b.h + pad);
        if (area < best) {
          best = area;
          hit = it;
        }
      }
    }
    if (!hit) return null;
    const node = s.find(hit.id);
    if (!node) return null;
    const chain = [];
    for (let n = node; n && n !== s.root; n = n.parent) chain.unshift({ id: n.id, type: n.type, blockId: n.meta?.blockId ?? null });
    return { chain, world: [wx, wy] };
  }

  /**
   * Tracked properties of a node at the current time, and its bounds in canvas pixels.
   * @param {string} id
   * @returns {any}
   */
  inspect(id) {
    const s = this.scene;
    const node = s && s.find(id);
    if (!node) return null;
    const st = this.sceneTime(this.lastT);
    const props = [];
    let bounds = null;
    s.evaluateAt(st, () => {
      for (const key of Object.keys(node._cur)) {
        if (key === 'shape') continue;
        props.push({ key, value: formatValue(node.get(key)), animated: node._tracks.has(key) });
      }
      bounds = node.bounds();
    });
    let rect = null;
    if (bounds) {
      const vp = this.viewport ?? { width: s.width, height: s.height };
      const frame = sampleFrame(s, st, this.theme);
      const view = viewFor(frame, vp.width / s.width);
      const corners = [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h]].map(([x, y]) => applyMatrix(view.matrix, x, y));
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    return {
      id: node.id,
      type: node.type,
      name: node.name ?? null,
      children: node.children.length,
      blockId: node.meta?.blockId ?? null,
      source: typeof node.source === 'string' ? node.source : typeof node.content === 'string' ? node.content : null,
      props,
      rect,
      world: bounds,
    };
  }

  /**
   * Typeset TeX to an SVG string for the inspector preview.
   * @param {string} source
   * @param {string} [color]
   * @returns {Promise<{svg: string, width: number, height: number}>}
   */
  async texPreview(source, color) {
    let tex;
    const scene = await buildScene((sc) => {
      tex = new Tex(source, { size: 0.6, color: color ?? 'ink' });
      sc.add(tex);
    }, { width: 640, height: 360 });
    const b = tex.bounds() || { x: 0, y: 0, w: 1, h: 1 };
    const pad = 0.15;
    const w = b.w + 2 * pad;
    const h = b.h + 2 * pad;
    scene.width = Math.max(16, Math.round((w / scene.unit)));
    scene.height = Math.max(16, Math.round((h / scene.unit)));
    scene.camera.set({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const theme = this.theme ?? getTheme('qubibyte');
    const frame = sampleFrame(scene, 0, theme);
    return { svg: renderSVG(frame, { transparent: true }), width: scene.width, height: scene.height };
  }

  /**
   * Render one frame at a size to an image blob (gallery thumbnails, stills).
   * @param {{t?: number, width?: number, format?: string}} m
   * @returns {Promise<Blob>}
   */
  async still(m) {
    const s = this.scene;
    const w = Math.round(m.width ?? s.width);
    const h = Math.round((w * s.height) / s.width);
    const c = createCanvas(w, h);
    const t = m.t ?? s.duration;
    renderFrame(c.getContext('2d'), sampleFrame(s, this.sceneTime(t), this.theme), { pixelRatio: w / s.width, assets: s.assets });
    return canvasToBlob(c, m.format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.9);
  }

  /**
   * Describe an error for the page, with a line and column in the user's
   * source when one can be found.
   * @param {any} err
   * @returns {{message: string, line: number|null, col: number|null, name: string}}
   */
  describeError(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    let line = e.line ?? (e.pos && e.pos.line) ?? null;
    let col = e.col ?? (e.pos && e.pos.col) ?? null;
    const message = e.reason ?? e.message;
    if (line == null && e.stack && e.moduleURL) {
      const esc = e.moduleURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`${esc}:(\\d+):(\\d+)`).exec(e.stack);
      if (m) {
        line = Number(m[1]);
        col = Number(m[2]);
      }
    }
    return { message, line, col, name: e.name };
  }
}
