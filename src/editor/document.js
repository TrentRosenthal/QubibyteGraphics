/**
 * Scene documents. A document is plain JSON: metadata, assets, blocks,
 * wires, and an optional script. The code view and the visual editor are
 * two views of one document; `buildDocument` turns it into a Scene.
 *
 *   {
 *     version: 1,
 *     meta: { title, width, height, fps, seed, theme, board, duration },
 *     assets: { id: { kind: 'image' | 'video' | 'audio' | 'font' | 'svg', name, mime, data } },
 *     blocks: [ { id, type, props, enter?, exit?, keyframes? } ],
 *     wires: [ { from: 'blockId.port', to: 'blockId.port' } ],
 *   }
 *
 * Block `enter` and `exit` are { anim, at, duration, ease }. Keyframes are
 * { t, props, ease, duration } and tween props into place ending at t.
 * @module editor/document
 */

import { buildScene } from '../core/scene.js';
import { BLOCKS, blockDefinition } from './blocks.js';
import { resolveEasing } from '../core/easing.js';
import * as A from '../core/animations.js';
import { loadImage } from '../core/platform.js';

/** Current document schema version. */
export const DOCUMENT_VERSION = 1;

/**
 * A new empty document.
 * @param {Record<string, any>} [meta]
 * @returns {Record<string, any>}
 */
export function newDocument(meta = {}) {
  return {
    version: DOCUMENT_VERSION,
    meta: { title: 'Untitled scene', width: 1920, height: 1080, fps: 60, seed: 1, theme: 'qubibyte', board: null, duration: 6, ...meta },
    assets: {},
    blocks: [],
    wires: [],
  };
}

/**
 * Validate a document and fill defaults. Throws with a message that names
 * the offending block or wire.
 * @param {any} doc
 * @returns {Record<string, any>}
 */
export function normalizeDocument(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('A scene document must be an object');
  const out = newDocument(doc.meta || {});
  out.assets = { ...(doc.assets || {}) };
  const ids = new Set();
  out.blocks = (doc.blocks || []).map((b, i) => {
    if (!b || typeof b.type !== 'string') throw new Error(`Block ${i} needs a type`);
    const def = blockDefinition(b.type);
    const id = b.id ?? `${b.type}${i + 1}`;
    if (ids.has(id)) throw new Error(`Duplicate block id "${id}"`);
    ids.add(id);
    const block = { id, type: b.type, props: { ...def.defaults, ...(b.props || {}) } };
    if (b.enter) block.enter = { ...b.enter };
    if (b.exit) block.exit = { ...b.exit };
    if (b.keyframes && b.keyframes.length) block.keyframes = b.keyframes.map((k) => ({ ...k, props: { ...k.props } })).sort((a, c) => a.t - c.t);
    if (b.name) block.name = b.name;
    return block;
  });
  out.wires = (doc.wires || []).map((w, i) => {
    const [fromId] = String(w.from || '').split('.');
    const [toId] = String(w.to || '').split('.');
    if (!ids.has(fromId)) throw new Error(`Wire ${i}: unknown source block "${fromId}"`);
    if (!ids.has(toId)) throw new Error(`Wire ${i}: unknown target block "${toId}"`);
    return { from: w.from, to: w.to };
  });
  if (doc.script) out.script = String(doc.script);
  return out;
}

/**
 * Evaluate the data-flow graph: each block's outputs from its props and
 * wired inputs, in dependency order. Returns outputs keyed by block id.
 * @param {Record<string, any>} doc normalized document
 * @param {Record<string, any>} [overrides] live values by block id (sliders being dragged)
 * @returns {Map<string, Record<string, any>>}
 */
export function evaluateGraph(doc, overrides = {}) {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const incoming = new Map();
  for (const w of doc.wires) {
    const [toId, ...toPort] = w.to.split('.');
    if (!incoming.has(toId)) incoming.set(toId, []);
    incoming.get(toId).push({ from: w.from, port: toPort.join('.') });
  }
  const outputs = new Map();
  const visiting = new Set();
  const visit = (id) => {
    if (outputs.has(id)) return outputs.get(id);
    if (visiting.has(id)) throw new Error(`Wires form a loop through "${id}"`);
    visiting.add(id);
    const block = byId.get(id);
    const inputs = {};
    for (const { from, port } of incoming.get(id) || []) {
      const [fromId, ...fromPort] = from.split('.');
      const src = visit(fromId);
      const key = fromPort.join('.') || 'value';
      inputs[port || key] = src[key];
    }
    const def = blockDefinition(block.type);
    const props = overrides[id] ? { ...block.props, ...overrides[id] } : block.props;
    const out = def.outputs ? def.outputs(props, inputs, doc) : {};
    out.__inputs = inputs;
    outputs.set(id, out);
    visiting.delete(id);
    return out;
  };
  for (const b of doc.blocks) visit(b.id);
  return outputs;
}

/**
 * Decode document assets into drawable resources on the scene.
 * @param {import('../core/scene.js').Scene} scene
 * @param {Record<string, any>} assets
 * @returns {Promise<void>}
 */
export async function loadAssets(scene, assets) {
  for (const [id, a] of Object.entries(assets || {})) {
    if (a.kind === 'image' || a.kind === 'svg') {
      const img = await loadImage(a.data);
      scene.assets.set(id, { ...a, decoded: img, width: img.width, height: img.height });
    } else {
      scene.assets.set(id, { ...a });
    }
  }
}

/**
 * Build a Scene from a document.
 * @param {Record<string, any>} doc
 * @param {{overrides?: Record<string, any>, tolerant?: boolean, script?: (scene: import('../core/scene.js').Scene, nodes: Map<string, any>) => any}} [opts]
 *   tolerant: a block that fails to build is skipped and reported in `scene.blockErrors` instead of failing the scene (the editor uses this).
 * @returns {Promise<import('../core/scene.js').Scene>}
 */
export async function buildDocument(doc, opts = {}) {
  const d = normalizeDocument(doc);
  const m = d.meta;
  return buildScene(async (scene) => {
    await loadAssets(scene, d.assets);
    const outputs = evaluateGraph(d, opts.overrides);
    /** @type {Map<string, any>} */
    const nodes = new Map();
    scene.blockErrors = [];
    for (const b of d.blocks) {
      const def = blockDefinition(b.type);
      if (!def.create) continue;
      const out = outputs.get(b.id);
      let node;
      try {
        node = def.create(b.props, out.__inputs, { scene, doc: d, outputs: out, assets: scene.assets });
      } catch (e) {
        if (!opts.tolerant) throw e;
        scene.blockErrors.push({ block: b.id, message: e.message });
        continue;
      }
      if (!node) continue;
      node.meta.blockId = b.id;
      nodes.set(b.id, node);
    }
    scheduleBlocks(scene, d, nodes);
    if (opts.script) await opts.script(scene, nodes);
    const end = Math.max(m.duration ?? 0, scene.sceneDuration);
    if (end > scene.clock) await scene.wait(end - scene.clock);
  }, { width: m.width, height: m.height, fps: m.fps, seed: m.seed, theme: m.theme, board: m.board ?? undefined, title: m.title });
}

/**
 * Record entrances, keyframes, and exits of every block. Blocks without an
 * entrance are present from time 0.
 * @param {import('../core/scene.js').Scene} scene
 * @param {Record<string, any>} doc
 * @param {Map<string, any>} nodes
 */
export function scheduleBlocks(scene, doc, nodes) {
  const events = [];
  for (const b of doc.blocks) {
    const node = nodes.get(b.id);
    if (!node) continue;
    if (!b.enter) scene.add(node);
    else events.push({ t: b.enter.at ?? 0, run: () => playNamed(scene, node, b.enter, 'enter') });
    for (const k of b.keyframes || []) {
      const dur = k.duration ?? 0.8;
      events.push({ t: Math.max(0, k.t - dur), run: () => playKeyframe(scene, node, k, dur) });
    }
    if (b.exit) events.push({ t: b.exit.at ?? 0, run: () => playNamed(scene, node, b.exit, 'exit') });
  }
  events.sort((a, c) => a.t - c.t);
  for (const e of events) {
    const saved = scene.clock;
    scene.clock = e.t;
    e.run();
    scene.clock = Math.max(saved, scene.clock);
    scene._noteTime(scene.clock);
    scene.clock = saved;
  }
}

function playNamed(scene, node, spec, phase) {
  const factory = ANIMATIONS[spec.anim ?? (phase === 'enter' ? 'fadeIn' : 'fadeOut')];
  if (spec.anim === 'none' && phase === 'enter') {
    scene.add(node);
    return;
  }
  if (!factory) throw new Error(`Unknown ${phase} animation "${spec.anim}". Use one of: ${Object.keys(ANIMATIONS).join(', ')}`);
  const anim = factory(node, spec);
  scene.play(anim, { duration: spec.duration ?? 1, ease: spec.ease ?? undefined });
}

function playKeyframe(scene, node, k, dur) {
  const b = node.animate;
  for (const [key, v] of Object.entries(k.props)) b.set(key, v);
  scene.play(b.with({ ease: resolveEasing(k.ease) }), { duration: dur });
}

/**
 * Named entrance and exit animations available to documents and the editor.
 * @type {Record<string, (node: any, spec: any) => any>}
 */
export const ANIMATIONS = {
  none: () => new A.Wait(0),
  fadeIn: (node, spec) => A.fadeIn(node, { shift: spec.shift }),
  fadeInUp: (node) => A.fadeIn(node, { shift: 'up' }),
  create: (node) => A.create(node),
  write: (node) => A.write(node),
  grow: (node) => A.growFromCenter(node),
  spinIn: (node) => A.spinIn(node),
  typewriter: (node) => A.typewriter(node),
  fadeOut: (node, spec) => A.fadeOut(node, { shift: spec.shift }),
  fadeOutDown: (node) => A.fadeOut(node, { shift: 'down' }),
  uncreate: (node) => A.uncreate(node),
  unwrite: (node) => A.unwrite(node),
  shrink: (node) => A.shrinkToCenter(node),
};

/**
 * Serialize a document to JSON with stable key order and formatting, so
 * edits in the visual editor produce minimal diffs.
 * @param {Record<string, any>} doc
 * @returns {string}
 */
export function stringifyDocument(doc) {
  const d = normalizeDocument(doc);
  const order = ['version', 'meta', 'assets', 'blocks', 'wires', 'script'];
  const blockOrder = ['id', 'name', 'type', 'props', 'enter', 'keyframes', 'exit'];
  const clean = {};
  for (const k of order) if (d[k] !== undefined) clean[k] = d[k];
  clean.blocks = d.blocks.map((b) => {
    const o = {};
    const def = blockDefinition(b.type);
    for (const k of blockOrder) {
      if (b[k] === undefined) continue;
      if (k === 'props') {
        // Keep only props that differ from the block defaults, in definition order.
        const props = {};
        const keys = Object.keys(def.defaults).concat(Object.keys(b.props).filter((x) => !(x in def.defaults)));
        for (const p of keys) if (b.props[p] !== undefined && JSON.stringify(b.props[p]) !== JSON.stringify(def.defaults[p])) props[p] = b.props[p];
        o.props = props;
      } else o[k] = b[k];
    }
    return o;
  });
  return JSON.stringify(clean, null, 2);
}

/**
 * The JavaScript view of a document: a module that exports it. The visual
 * editor writes this; the code view edits it; both parse back to the same
 * document.
 * @param {Record<string, any>} doc
 * @returns {string}
 */
export function documentToModule(doc) {
  return `// Scene document. The visual editor and this file are two views of the same data.\nexport default ${stringifyDocument(doc)};\n`;
}

/**
 * Parse the JavaScript view back into a document without executing code:
 * the module body after `export default` must be a JSON object.
 * @param {string} src
 * @returns {Record<string, any>}
 */
export function moduleToDocument(src) {
  const i = src.indexOf('export default');
  if (i < 0) throw new Error('Expected `export default { ... }`');
  let body = src.slice(i + 'export default'.length).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  try {
    return normalizeDocument(JSON.parse(body));
  } catch (e) {
    throw new Error(`The document is not valid JSON: ${e.message}`, { cause: e });
  }
}

/** @returns {string[]} registered block types */
export function blockTypes() {
  return Object.keys(BLOCKS);
}

