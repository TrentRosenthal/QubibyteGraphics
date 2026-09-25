/**
 * Visual editor: a drag-and-drop canvas over a scene document. It owns the
 * document, the selection, the history, and the playhead, and coordinates
 * the block library, the canvas and wire layer, the inspector, the
 * timeline, the theme and assets panels, and the two-way code view.
 * @module editor/ui/editor-app
 */

import { normalizeDocument, newDocument, stringifyDocument, documentToModule, moduleToDocument } from '../document.js';
import { blockDefinition, qubiVariables } from '../blocks.js';
import { registerTheme, getTheme, importTheme } from '../../themes/index.js';
import { Runtime } from '../../playground/runtime.js';
import { CodeEditor } from '../../playground/editor/code-editor.js';
import { icon } from '../../playground/icons.js';
import { esc, toast, readJSON, writeJSON } from '../../playground/ui.js';
import { encodePermalink } from '../../playground/permalink.js';
import { History } from './history.js';
import { Stage } from './stage.js';
import { mountLibrary } from './library.js';
import { renderBlockInspector } from './block-inspector.js';
import { Timeline } from './timeline.js';
import { ThemePanel } from './theme-panel.js';
import { AssetsPanel, assetKind } from './assets-panel.js';

/** Input kinds the editor wires automatically when a block is added. */
const AUTO_WIRED = new Set(['state', 'matrix', 'series']);

const STORE = 'qgfx.editor.v1';
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/**
 * The document the editor opens with: one qubit shown three ways, wired
 * from a Qubi program into a Bloch sphere into its density matrix.
 * @returns {any}
 */
function starterDocument() {
  const doc = newDocument({ title: 'One qubit, three views', duration: 6 });
  doc.blocks.push(
    { id: 'title', type: 'text', props: { content: 'One qubit, three views', size: 'heading', weight: 'semibold', x: -4.35, y: 3.55 }, enter: { anim: 'write', at: 0, duration: 0.9 } },
    { id: 'prog', type: 'qubi', props: { source: 'RY(0.3) 0\nRZ(0.6) 0', width: 3.8, height: 1.2, x: -4.7, y: 0.25 }, enter: { anim: 'create', at: 0.5, duration: 1 } },
    { id: 'bloch', type: 'bloch', props: { x: 0.1, y: 0.25 }, enter: { anim: 'fadeIn', at: 1.3, duration: 0.8 } },
    { id: 'rho', type: 'matrix', props: { label: '\\rho =', size: 0.32, x: 5.1, y: 0.35 }, enter: { anim: 'write', at: 2.1, duration: 1 } },
  );
  doc.wires.push({ from: 'prog.state', to: 'bloch.state' }, { from: 'bloch.rho', to: 'rho.unitary' });
  return normalizeDocument(doc);
}

function round(v, d = 3) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function uiColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#e9e7e2';
}

/** The visual editor controller. */
export class VisualEditor {
  /**
   * @param {HTMLElement} root the editor section
   * @param {{app: any, docText?: string|null, board?: string}} o
   */
  constructor(root, o) {
    this.root = root;
    this.app = o.app;
    this.board = o.board ?? 'default';
    this.selection = new Set();
    this.selectedWire = null;
    this.blockErrors = new Map();
    this.infos = new Map();
    this.history = new History();
    this.t = 0;
    this.playing = false;
    this.snap = true;
    this.grid = false;
    this.gridStep = 0.25;
    this.showWires = false;
    this.codeOpen = false;
    this.themeDraft = null;
    this.sceneInfo = null;
    this.building = false;
    this.dirty = false;
    this.lastInfo = null;
    const saved = readJSON(STORE, null);
    let doc = null;
    for (const text of [o.docText, saved && saved.doc]) {
      if (!text) continue;
      try {
        doc = normalizeDocument(JSON.parse(text));
        break;
      } catch (e) {
        toast(`The saved document could not be opened: ${e.message}`);
      }
    }
    this.doc = doc ?? starterDocument();
    this.history.reset(this.doc);
    this.mount();
  }

  mount() {
    this.root.innerHTML = `<div class="ve">
      <aside class="ve-library panel" aria-label="Block library"></aside>
      <div class="ve-center">
        <div class="ve-toolbar" role="toolbar" aria-label="Canvas tools">
          <button type="button" class="icon-btn" data-act="undo" aria-label="Undo" data-tip="Undo">${icon('undo')}</button>
          <button type="button" class="icon-btn" data-act="redo" aria-label="Redo" data-tip="Redo">${icon('redo')}</button>
          <span class="divider-v"></span>
          <button type="button" class="icon-btn" data-act="duplicate" aria-label="Duplicate selection" data-tip="Duplicate">${icon('duplicate')}</button>
          <button type="button" class="icon-btn" data-act="group" aria-label="Group selection" data-tip="Group">${icon('group')}</button>
          <button type="button" class="icon-btn" data-act="delete" aria-label="Delete selection" data-tip="Delete">${icon('trash')}</button>
          <span class="divider-v"></span>
          <button type="button" class="icon-btn" data-act="snap" aria-pressed="true" aria-label="Snap to blocks" data-tip="Snap to blocks">${icon('magnet')}</button>
          <button type="button" class="icon-btn" data-act="grid" aria-pressed="false" aria-label="Snap to grid" data-tip="Snap to grid">${icon('grid')}</button>
          <button type="button" class="icon-btn" data-act="wires" aria-pressed="false" aria-label="Show wires" data-tip="Wires  W">${icon('wires')}</button>
          <span class="ve-toolbar-title" data-title></span>
          <span class="spacer"></span>
          <span class="ve-mode-hint" data-hint></span>
          <button type="button" class="btn sm ghost" data-act="code" aria-pressed="false">${icon('code')}Code</button>
        </div>
        <div class="ve-main">
          <div class="stage ve-stage" data-stage>
            <div class="stage-frame ve-frame" data-frame></div>
            <div class="stage-status" data-status role="status"></div>
          </div>
          <div class="ve-code" data-code hidden>
            <div class="ve-code-head"><span class="section-title">Scene document</span><span class="ve-code-state" data-code-state></span></div>
            <div class="ve-code-host" data-code-host></div>
          </div>
        </div>
        <div class="controls ve-controls" data-controls></div>
        <div class="ve-timeline" data-timeline></div>
      </div>
      <aside class="ve-side panel">
        <div class="tabs" role="tablist" aria-label="Editor panels">
          <button type="button" role="tab" aria-selected="true" data-tab="inspector" id="ve-tab-inspector" aria-controls="ve-inspector">Inspector</button>
          <button type="button" role="tab" aria-selected="false" data-tab="theme" id="ve-tab-theme" aria-controls="ve-theme">Theme</button>
          <button type="button" role="tab" aria-selected="false" data-tab="assets" id="ve-tab-assets" aria-controls="ve-assets">Assets</button>
        </div>
        <div class="panel-body" id="ve-inspector" role="tabpanel" aria-labelledby="ve-tab-inspector" data-panel="inspector"></div>
        <div class="panel-body" id="ve-theme" role="tabpanel" aria-labelledby="ve-tab-theme" data-panel="theme" hidden></div>
        <div class="panel-body" id="ve-assets" role="tabpanel" aria-labelledby="ve-tab-assets" data-panel="assets" hidden></div>
      </aside>
    </div>`;
    const q = (s) => this.root.querySelector(s);
    this.q = q;
    mountLibrary(q('.ve-library'), { add: (type) => this.addBlock(type, null) });
    this.runtime = new Runtime(q('[data-frame]'));
    this.stage = new Stage(this, q('[data-stage]'), q('[data-frame]'));
    this.timeline = new Timeline(q('[data-timeline]'), this);
    this.themePanel = new ThemePanel(q('[data-panel=theme]'), this);
    this.assetsPanel = new AssetsPanel(q('[data-panel=assets]'), this);
    this.runtime.addEventListener('frame', (e) => this.onFrame(e.detail));
    q('.ve-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) this.action(b.dataset.act);
    });
    q('.ve-side .tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    });
    // Dragging a slider sends a live override (evaluateGraph overrides in
    // the sandbox); releasing it writes the value into the document.
    let pending = null;
    let sending = false;
    const send = async () => {
      if (sending || !pending) return;
      sending = true;
      const { index, value } = pending;
      pending = null;
      try {
        await this.runtime.setControl(index, value);
        this.seek(this.t);
      } catch (err) {
        this.setStatus(err.message);
      } finally {
        sending = false;
        if (pending) send();
      }
    };
    q('[data-controls]').addEventListener('input', (e) => {
      const inp = e.target.closest('input[data-block]');
      if (!inp) return;
      const v = Number(inp.value);
      inp.parentElement.querySelector('.value').textContent = String(round(v, 3));
      const c = this.sceneInfo && this.sceneInfo.controls.find((x) => x.blockId === inp.dataset.block);
      if (!c) return;
      pending = { index: c.index, value: v };
      send();
    });
    q('[data-controls]').addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-block]');
      if (inp) this.updateProps(inp.dataset.block, { value: Number(inp.value) }, { commit: true });
    });
    this.refreshPanels();
    this.scheduleBuild();
  }

  // Lookup helpers.

  block(id) {
    return this.doc.blocks.find((b) => b.id === id) ?? null;
  }

  info(id) {
    return this.infos.get(id) ?? null;
  }

  /** Block infos in draw order (z index, then document order). */
  orderedInfos() {
    return this.doc.blocks
      .map((b, i) => ({ b, i }))
      .sort((x, y) => (x.b.props.zIndex ?? 0) - (y.b.props.zIndex ?? 0) || x.i - y.i)
      .map(({ b }) => this.infos.get(b.id))
      .filter(Boolean);
  }

  get duration() {
    return Math.max(this.doc.meta.duration ?? 0, this.sceneInfo ? this.sceneInfo.duration : 0);
  }

  get fps() {
    return this.doc.meta.fps ?? 60;
  }

  /**
   * Input and output ports of a block. A Qubi block gets a `var:NAME` input
   * for each variable its program reads.
   */
  portsOf(block) {
    const def = blockDefinition(block.type);
    const inputs = [];
    for (const p of def.ports.in) {
      if (p.name === 'var:*') for (const v of qubiVariables(block.props.source ?? '')) inputs.push({ name: `var:${v}`, kind: p.kind });
      else inputs.push(p);
    }
    return { inputs, outputs: def.ports.out };
  }

  // Build and render.

  buildOptions() {
    const themes = [...(this.app.customThemes || [])];
    if (this.themeDraft) themes.push(this.themeDraft);
    return { board: this.board, themes, layout: true };
  }

  /** Rebuild the scene; while a build runs, only the latest document is built next. */
  async scheduleBuild() {
    if (this.building) {
      this.dirty = true;
      return;
    }
    this.building = true;
    this.dirty = false;
    const doc = JSON.parse(JSON.stringify(this.doc));
    if (this.themeDraft) doc.meta.theme = this.themeDraft.id;
    try {
      const info = await this.runtime.load('document', { doc }, this.buildOptions());
      this.sceneInfo = info;
      this.blockErrors = new Map((info.blockErrors || []).map((e) => [e.block, e.message]));
      this.setStatus('');
      this.renderControls(info);
      this.seek(Math.min(this.t, info.duration));
      if (this.selection.size === 1) {
        const id = [...this.selection][0];
        if (this.blockErrors.has(id) !== !!this.q('.bi-error')) this.renderInspector();
      }
      this.timeline.render();
    } catch (e) {
      this.setStatus(e.message);
    } finally {
      this.building = false;
      if (this.dirty) this.scheduleBuild();
    }
  }

  setStatus(text) {
    const el = this.q('[data-status]');
    el.innerHTML = text ? `<span class="stage-error-inline">${esc(text)}</span>` : '';
  }

  onFrame(m) {
    this.infos = new Map((m.blocks || []).map((b) => [b.id, b]));
    this.stage.setCaptions(m.captions);
    if (!this.stage.drag) this.stage.render();
  }

  renderControls(info) {
    const host = this.q('[data-controls]');
    const sliders = this.doc.blocks.filter((b) => b.type === 'slider');
    host.innerHTML = sliders.map((b) => {
      const p = b.props;
      return `<div class="control"><label class="label" for="vs-${esc(b.id)}">${esc(p.label)}</label><input id="vs-${esc(b.id)}" type="range" class="range" data-block="${esc(b.id)}" min="${p.min}" max="${p.max}" step="${p.step || 0.01}" value="${p.value}"><span class="value num">${round(Number(p.value), 3)}</span></div>`;
    }).join('');
    return info;
  }

  refreshPanels() {
    this.renderInspector();
    this.timeline.render();
    if (!this.q('[data-panel=theme]').hidden) this.themePanel.render();
    if (!this.q('[data-panel=assets]').hidden) this.assetsPanel.render();
    this.q('[data-title]').textContent = this.doc.meta.title || '';
    this.q('[data-act=undo]').disabled = !this.history.canUndo;
    this.q('[data-act=redo]').disabled = !this.history.canRedo;
    const none = this.selection.size === 0;
    for (const a of ['duplicate', 'group', 'delete']) this.q(`[data-act=${a}]`).disabled = none;
    this.q('[data-hint]').textContent = this.keyMode ? `Moves at ${this.t.toFixed(2)} s add keyframes` : 'Layout: every block at rest';
    this.syncCode();
  }

  renderInspector() {
    renderBlockInspector(this.q('[data-panel=inspector]'), this);
  }

  setTab(tab) {
    for (const b of this.root.querySelectorAll('.ve-side [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of this.root.querySelectorAll('.ve-side [data-panel]')) p.hidden = p.dataset.panel !== tab;
    if (tab === 'theme') this.themePanel.render();
    if (tab === 'assets') this.assetsPanel.render();
  }

  // History.

  /**
   * Record the current document as an undo step and rebuild.
   * @param {string} [_label]
   */
  commit(_label) {
    this.history.push(this.doc);
    this.persist();
    this.refreshPanels();
    this.scheduleBuild();
  }

  /** Apply a live change without an undo step. */
  preview() {
    this.scheduleBuild();
    this.syncCode(true);
  }

  undo() {
    const d = this.history.undo();
    if (!d) return;
    this.doc = d;
    this.pruneSelection();
    this.persist();
    this.refreshPanels();
    this.scheduleBuild();
  }

  redo() {
    const d = this.history.redo();
    if (!d) return;
    this.doc = d;
    this.pruneSelection();
    this.persist();
    this.refreshPanels();
    this.scheduleBuild();
  }

  pruneSelection() {
    for (const id of [...this.selection]) if (!this.block(id)) this.selection.delete(id);
  }

  persist() {
    writeJSON(STORE, { doc: stringifyDocument(this.doc) });
  }

  // Selection.

  groupMembers(id) {
    const g = this.block(id)?.props.group;
    return g ? this.doc.blocks.filter((b) => b.props.group === g).map((b) => b.id) : [id];
  }

  /** @param {string[]} ids */
  select(ids) {
    this.selection = new Set(ids.flatMap((id) => this.groupMembers(id)));
    this.selectedWire = null;
    this.refreshPanels();
    this.stage.render();
  }

  toggleSelect(id) {
    const members = this.groupMembers(id);
    const on = !this.selection.has(id);
    for (const m of members) {
      if (on) this.selection.add(m);
      else this.selection.delete(m);
    }
    this.refreshPanels();
    this.stage.render();
  }

  selectWire(key) {
    this.selectedWire = key;
    this.stage.render();
  }

  focusInspector() {
    this.setTab('inspector');
    const first = this.q('[data-panel=inspector] input, [data-panel=inspector] textarea');
    if (first) first.focus();
  }

  focusTiming(kind) {
    this.setTab('inspector');
    const s = this.q(`[data-panel=inspector] select[data-k="${kind}"]`);
    if (s) s.focus();
  }

  // Editing.

  uniqueId(base) {
    const stem = base.replace(/\d+$/, '') || 'block';
    let n = 1;
    while (this.block(`${stem}${n}`)) n++;
    return `${stem}${n}`;
  }

  /**
   * Create a block of a type at a world point (the frame center when null).
   * @param {string} type
   * @param {number[]|null} at
   * @param {Record<string, any>} [props]
   * @returns {string} the new id
   */
  addBlock(type, at, props = {}) {
    const def = blockDefinition(type);
    const id = this.uniqueId(type);
    const p = { ...def.defaults, ...props };
    if ('x' in def.defaults) {
      p.x = round(at ? at[0] : 0, 2);
      p.y = round(at ? at[1] : 0, 2);
    } else if (at) {
      // Blocks with nothing to draw keep their drop point for their wire-mode card.
      p.cardX = round(at[0], 2);
      p.cardY = round(at[1], 2);
    }
    this.doc.blocks.push({ id, type, props: p });
    const wired = this.autoWire(id);
    this.selection = new Set([id]);
    this.setTab('inspector');
    this.commit('Add block');
    if (wired.length) toast(`${wired.join(' ')} Press W to see or change wires.`);
    return id;
  }

  /**
   * Connect a new block's quantum inputs (state, matrix, sweep series) when
   * the choice is unambiguous: exactly one circuit (Qubi program block) on
   * the canvas produces that kind of value. With none, or several, the input is left for the user to
   * wire; nothing is ever added.
   * @param {string} id
   * @returns {string[]} one sentence per wire made
   */
  autoWire(id) {
    const block = this.doc.blocks.find((b) => b.id === id);
    const notes = [];
    for (const port of this.portsOf(block).inputs) {
      if (!AUTO_WIRED.has(port.kind)) continue;
      const to = `${id}.${port.name}`;
      if (this.doc.wires.some((w) => w.to === to)) continue;
      const sources = this.sourcesOf(port.kind, id);
      if (sources.length !== 1) continue;
      this.doc.wires.push({ from: sources[0], to });
      notes.push(`Wired its ${port.name} to ${sources[0]}.`);
    }
    return notes;
  }

  /**
   * Output ports of circuits (Qubi program blocks) that produce a value of this kind.
   * @param {string} kind
   * @param {string} exclude
   * @returns {string[]}
   */
  sourcesOf(kind, exclude) {
    const out = [];
    for (const b of this.doc.blocks) {
      if (b.id === exclude || b.type !== 'qubi') continue;
      for (const o of this.portsOf(b).outputs) {
        if (o.kind !== kind) continue;
        out.push(`${b.id}.${o.name}`);
      }
    }
    return out;
  }

  deleteSelection() {
    if (this.selectedWire) {
      this.removeWire(this.selectedWire);
      return;
    }
    if (!this.selection.size) return;
    const ids = this.selection;
    this.doc.blocks = this.doc.blocks.filter((b) => !ids.has(b.id));
    this.doc.wires = this.doc.wires.filter((w) => !ids.has(w.from.split('.')[0]) && !ids.has(w.to.split('.')[0]));
    this.selection = new Set();
    this.commit('Delete');
  }

  duplicateSelection() {
    if (!this.selection.size) return;
    const fresh = [];
    const groupMap = new Map();
    for (const id of this.selection) {
      const b = this.block(id);
      const copy = JSON.parse(JSON.stringify(b));
      copy.id = this.uniqueId(b.id);
      if ('x' in copy.props) copy.props.x = round(copy.props.x + 0.4, 2);
      if ('y' in copy.props) copy.props.y = round(copy.props.y - 0.4, 2);
      if (copy.props.group) {
        if (!groupMap.has(copy.props.group)) groupMap.set(copy.props.group, this.uniqueGroup());
        copy.props.group = groupMap.get(copy.props.group);
      }
      this.doc.blocks.push(copy);
      fresh.push(copy.id);
    }
    this.selection = new Set(fresh);
    this.commit('Duplicate');
  }

  uniqueGroup() {
    const used = new Set(this.doc.blocks.map((b) => b.props.group).filter(Boolean));
    let n = 1;
    while (used.has(`group${n}`)) n++;
    return `group${n}`;
  }

  groupSelection() {
    if (this.selection.size < 2) {
      toast('Select two or more blocks to group them.');
      return;
    }
    const g = this.uniqueGroup();
    for (const id of this.selection) this.block(id).props.group = g;
    this.commit('Group');
  }

  ungroupSelection() {
    for (const id of this.selection) delete this.block(id).props.group;
    this.commit('Ungroup');
  }

  /** @param {1|-1} dir */
  zOrder(dir) {
    if (!this.selection.size) return;
    const order = this.doc.blocks.map((b, i) => ({ b, i })).sort((x, y) => (x.b.props.zIndex ?? 0) - (y.b.props.zIndex ?? 0) || x.i - y.i).map((x) => x.b);
    const sel = order.filter((b) => this.selection.has(b.id));
    const rest = order.filter((b) => !this.selection.has(b.id));
    const first = order.indexOf(sel[0]);
    const pos = Math.max(0, Math.min(rest.length, first + dir));
    const next = [...rest.slice(0, pos), ...sel, ...rest.slice(pos)];
    next.forEach((b, i) => {
      if (b.type !== 'background') b.props.zIndex = i + 1;
    });
    this.doc.blocks = next;
    this.commit('Reorder');
  }

  renameBlock(from, to) {
    if (!to || to === from || !/^[A-Za-z_][\w-]*$/.test(to) || this.block(to)) {
      if (to !== from) toast('Ids start with a letter and must be unique.');
      return false;
    }
    this.block(from).id = to;
    for (const w of this.doc.wires) {
      if (w.from.split('.')[0] === from) w.from = `${to}.${w.from.split('.').slice(1).join('.')}`;
      if (w.to.split('.')[0] === from) w.to = `${to}.${w.to.split('.').slice(1).join('.')}`;
    }
    this.selection = new Set([to]);
    this.commit('Rename');
    return true;
  }

  /**
   * Merge props into a block.
   * @param {string} id
   * @param {Record<string, any>} patch
   * @param {{commit?: boolean}} [o]
   */
  updateProps(id, patch, o = {}) {
    const b = this.block(id);
    if (!b) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null && k !== 'fill' && k !== 'stroke') delete b.props[k];
      else b.props[k] = v;
    }
    if (o.commit) this.commit('Edit');
    else this.preview();
  }

  setMeta(patch, o = {}) {
    Object.assign(this.doc.meta, patch);
    if (patch.width || patch.height) this.stage.layout();
    if (o.commit) this.commit('Scene');
    else this.preview();
  }

  setTiming(id, kind, spec) {
    const b = this.block(id);
    if (spec) b[kind] = { anim: spec.anim, at: round(spec.at ?? 0, 2), duration: round(spec.duration ?? 1, 2) };
    else delete b[kind];
    this.commit('Timing');
  }

  previewTiming(id, kind, spec) {
    this.block(id)[kind] = { ...spec, at: round(spec.at, 2), duration: round(spec.duration, 2) };
    this.timeline.render();
    this.preview();
  }

  previewKeyframeTime(id, i, t) {
    const b = this.block(id);
    b.keyframes[i].t = round(t, 2);
    b.keyframes[i].duration = Math.min(b.keyframes[i].duration ?? 0.8, b.keyframes[i].t);
    this.timeline.render();
    this.preview();
  }

  /** Is the playhead past the first frame (moves become keyframes)? */
  get keyMode() {
    return this.t > 0.5 / this.fps;
  }

  upsertKeyframe(b, props) {
    const t = round(this.t, 3);
    b.keyframes = b.keyframes ? b.keyframes.map((k) => ({ ...k, props: { ...k.props } })) : [];
    const k = b.keyframes.find((x) => Math.abs(x.t - t) < 0.5 / this.fps);
    if (k) Object.assign(k.props, props);
    else b.keyframes.push({ t, props, duration: round(Math.min(0.8, t), 3) });
    b.keyframes.sort((a, c) => a.t - c.t);
  }

  addKeyframeAtPlayhead(id) {
    const b = this.block(id);
    const info = this.info(id);
    if (!this.keyMode) {
      toast('Move the playhead past 0 to add a keyframe.');
      return;
    }
    const c = info && info.bounds ? [info.bounds.x + info.bounds.w / 2, info.bounds.y + info.bounds.h / 2] : [b.props.x ?? 0, b.props.y ?? 0];
    this.upsertKeyframe(b, { x: round(c[0]), y: round(c[1]) });
    this.commit('Keyframe');
  }

  deleteKeyframe(id, i) {
    const b = this.block(id);
    b.keyframes.splice(i, 1);
    if (!b.keyframes.length) delete b.keyframes;
    this.commit('Delete keyframe');
  }

  /**
   * Where a block's wire-mode card sits when the block draws nothing: its own
   * position when it has one, else its stored card position, else a slot
   * down the left edge so cards never pile on top of each other.
   * @param {any} block
   * @returns {[number, number]}
   */
  cardPosition(block) {
    const p = block.props;
    if (typeof p.x === 'number' && typeof p.y === 'number') return [p.x, p.y];
    if (typeof p.cardX === 'number' && typeof p.cardY === 'number') return [p.cardX, p.cardY];
    const i = this.doc.blocks.indexOf(block);
    return [-6.2, 3.2 - 1.4 * Math.max(0, i)];
  }

  previewMove(ids, starts, dx, dy) {
    for (const id of ids) {
      const b = this.block(id);
      const s = starts.get(id);
      if (!b) continue;
      if (!('x' in s.props)) {
        // A data block (slider, expression) moves its wire-mode card.
        const [cx, cy] = s.card ?? (s.card = this.cardPosition({ ...b, props: s.props }));
        b.props.cardX = round(cx + dx);
        b.props.cardY = round(cy + dy);
        continue;
      }
      if (this.keyMode && s.bounds) {
        if (!s.keyframes) s.keyframes = b.keyframes ? JSON.parse(JSON.stringify(b.keyframes)) : null;
        b.keyframes = s.keyframes ? JSON.parse(JSON.stringify(s.keyframes)) : undefined;
        if (!b.keyframes) delete b.keyframes;
        this.upsertKeyframe(b, { x: round(s.bounds.x + s.bounds.w / 2 + dx), y: round(s.bounds.y + s.bounds.h / 2 + dy) });
      } else {
        b.props.x = round(s.props.x + dx);
        b.props.y = round(s.props.y + dy);
      }
    }
    this.preview();
  }

  previewResize(id, p0, b0, kx, ky, center) {
    const b = this.block(id);
    const p = { ...p0 };
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const k = kx;
    if (num(p.width) && num(p.height)) {
      p.width = round(p0.width * kx);
      p.height = round(p0.height * ky);
    } else if (num(p.outerRadius)) {
      p.outerRadius = round(p0.outerRadius * k);
      p.innerRadius = round(p0.innerRadius * k);
    } else if (num(p.radius) && b.type !== 'polarPlane' && b.type !== 'bloch') p.radius = round(p0.radius * k);
    else if (num(p.width)) p.width = round(p0.width * k);
    else if (num(p.length)) p.length = round(p0.length * k);
    else if (num(p.size) && b.type !== 'bloch') p.size = round(p0.size * k);
    else if (b.type === 'bloch' || b.type === 'polarPlane') p.radius = round(p0.radius * k);
    else p.scale = round((p0.scale ?? 1) * k);
    if ('x' in p0) {
      p.x = round(p0.x + center[0] - (b0.x + b0.w / 2));
      p.y = round(p0.y + center[1] - (b0.y + b0.h / 2));
    }
    b.props = p;
    this.preview();
  }

  previewRotate(id, r) {
    const b = this.block(id);
    if (this.keyMode) this.upsertKeyframe(b, { rotation: r });
    else b.props.rotation = r;
    this.preview();
  }

  /**
   * Drag an interactive handle: the block definition turns the point into
   * new props for itself and, through the context, for connected blocks.
   */
  dragHandle(id, hid, local) {
    const b = this.block(id);
    const def = blockDefinition(b.type);
    if (!def.onDrag) return;
    const ctx = {
      source: (port) => {
        const w = this.doc.wires.find((x) => x.to === `${id}.${port}`);
        if (!w) return null;
        const [bid, ...rest] = w.from.split('.');
        const blk = this.block(bid);
        return blk ? { block: blk, port: rest.join('.') } : null;
      },
      update: (bid, patch) => {
        const target = this.block(bid);
        if (target) Object.assign(target.props, patch);
      },
    };
    const next = def.onDrag(b.props, { id: hid, at: local }, ctx);
    if (next) Object.assign(b.props, next);
    this.preview();
    if (this.selection.size === 1) {
      const sel = this.block([...this.selection][0]);
      if (sel && sel.type === 'qubi') this.renderInspectorSoon();
    }
  }

  renderInspectorSoon() {
    clearTimeout(this.inspectorTimer);
    this.inspectorTimer = setTimeout(() => this.renderInspector(), 150);
  }

  addWire(from, to) {
    const [a] = from.split('.');
    const [b] = to.split('.');
    if (a === b) return;
    this.doc.wires = this.doc.wires.filter((w) => w.to !== to);
    this.doc.wires.push({ from, to });
    this.commit('Wire');
  }

  /** @param {string} key a wire's `from>to`, or just its target port */
  removeWire(key) {
    this.doc.wires = this.doc.wires.filter((w) => `${w.from}>${w.to}` !== key && w.to !== key);
    this.selectedWire = null;
    this.commit('Unwire');
  }

  // Assets.

  async importFiles(files, at, o = {}) {
    let placed = false;
    for (const file of files) {
      const kind = assetKind(file);
      if (!kind) {
        toast(`${file.name} is not an image, audio, video, or font file.`);
        continue;
      }
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'asset';
      let id = base;
      for (let n = 2; this.doc.assets[id]; n++) id = `${base}${n}`;
      this.doc.assets[id] = { kind, name: file.name, mime: file.type, data };
      if (o.place !== false && at && (kind === 'image' || kind === 'svg') && !placed) {
        this.addBlock('image', at, { asset: id });
        placed = true;
      }
    }
    if (!placed) this.commit('Assets');
    this.setTab(placed ? 'inspector' : 'assets');
  }

  placeAsset(id, at, treatment) {
    const a = this.doc.assets[id];
    if (!a) return;
    if (a.kind === 'image' || a.kind === 'svg') this.addBlock('image', at, { asset: id, treatment });
    else if (a.kind === 'video') this.addBlock('video', at, { asset: id });
    else if (a.kind === 'audio') this.addBlock('audio', null, { asset: id, at: round(this.t, 2) });
  }

  useAsBackground(id, treatment) {
    const existing = this.doc.blocks.find((b) => b.type === 'background');
    if (existing) {
      existing.props.asset = id;
      existing.props.treatment = treatment;
      this.selection = new Set([existing.id]);
      this.commit('Background');
      return;
    }
    const bid = this.uniqueId('background');
    this.doc.blocks.unshift({ id: bid, type: 'background', props: { ...blockDefinition('background').defaults, asset: id, treatment } });
    this.selection = new Set([bid]);
    this.commit('Background');
  }

  removeAsset(id) {
    delete this.doc.assets[id];
    this.doc.blocks = this.doc.blocks.filter((b) => b.props.asset !== id);
    this.pruneSelection();
    this.commit('Remove asset');
  }

  // Themes.

  /**
   * Preview an edited theme on the canvas.
   * @param {any} draft theme object, or null to drop the draft
   * @param {{rerender?: boolean}} [o]
   */
  setDraftTheme(draft, o = {}) {
    this.themeDraft = draft ? { ...draft, id: 'draft' } : null;
    if (this.themeDraft) registerTheme(this.themeDraft);
    if (o.rerender !== false) this.themePanel.render();
    this.scheduleBuild();
  }

  saveDraftTheme(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
    let id = `my-${slug}`;
    for (let n = 2; getThemeSafe(id) && !(this.app.customThemes || []).some((t) => t.id === id); n++) id = `my-${slug}-${n}`;
    const theme = { ...this.themeDraft, id, name };
    this.app.addCustomTheme(theme);
    this.themeDraft = null;
    this.doc.meta.theme = id;
    this.commit('Theme');
    this.themePanel.render();
    toast(`Saved ${name} in this browser.`);
  }

  importThemeText(text) {
    const t = importTheme(text);
    this.app.addCustomTheme(JSON.parse(text));
    this.themeDraft = null;
    this.doc.meta.theme = t.id;
    this.commit('Theme');
    this.themePanel.render();
  }

  /** Field widget context for the inspector. */
  fieldContext(change) {
    const theme = this.themeDraft ?? getThemeSafe(this.doc.meta.theme) ?? getTheme('qubibyte');
    return {
      change,
      colors: theme.colors,
      assets: this.doc.assets,
      texPreview: (src) => this.runtime.texPreview(src, uiColor('--text')),
      completions: this.app.completions ?? null,
    };
  }

  // Playback.

  /**
   * @param {number} t
   * @param {boolean} [snap]
   */
  seek(t, snap = false) {
    let v = Math.max(0, Math.min(this.duration, t));
    if (snap) v = Math.round(v * this.fps) / this.fps;
    this.t = v;
    this.runtime.seek(v, this.layoutView);
    this.timeline.update();
    this.q('[data-hint]').textContent = this.keyMode ? `Moves at ${this.t.toFixed(2)} s add keyframes` : 'Layout: every block at rest';
  }

  /** At rest on frame 0 the canvas shows every block without its entrance. */
  get layoutView() {
    return !this.playing && !this.keyMode;
  }

  togglePlay() {
    if (this.playing) {
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.seek(this.t, true);
      return;
    }
    this.playing = true;
    if (this.t >= this.duration - 1e-6) this.t = 0;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      this.t += (now - last) / 1000;
      last = now;
      if (this.t >= this.duration) this.t = 0;
      this.seek(this.t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.timeline.update();
  }

  // Toolbar and keys.

  action(act) {
    switch (act) {
      case 'undo': return this.undo();
      case 'redo': return this.redo();
      case 'duplicate': return this.duplicateSelection();
      case 'group': return this.groupSelection();
      case 'delete': return this.deleteSelection();
      case 'snap':
        this.snap = !this.snap;
        this.q('[data-act=snap]').setAttribute('aria-pressed', String(this.snap));
        return undefined;
      case 'grid':
        this.grid = !this.grid;
        this.q('[data-act=grid]').setAttribute('aria-pressed', String(this.grid));
        this.q('[data-frame]').classList.toggle('show-grid', this.grid);
        return undefined;
      case 'wires':
        return this.toggleWires();
      case 'code':
        return this.toggleCode();
      default:
        return undefined;
    }
  }

  toggleWires(force) {
    this.showWires = force ?? !this.showWires;
    this.q('[data-act=wires]').setAttribute('aria-pressed', String(this.showWires));
    this.stage.render();
  }

  /**
   * Editor keys. Returns true when handled.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  handleKey(e) {
    const mod = MAC ? e.metaKey : e.ctrlKey;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      this.redo();
      return true;
    }
    if (mod && (k === 'd' || k === 'D')) {
      this.duplicateSelection();
      return true;
    }
    if (mod && (k === 'g' || k === 'G')) {
      if (e.shiftKey) this.ungroupSelection();
      else this.groupSelection();
      return true;
    }
    if (mod && (k === '[' || k === ']')) {
      this.zOrder(k === ']' ? 1 : -1);
      return true;
    }
    if (mod && (k === 'a' || k === 'A')) {
      this.select(this.doc.blocks.map((b) => b.id));
      return true;
    }
    if (mod) return false;
    if (e.target && e.target.tagName === 'BUTTON' && (k === ' ' || k === 'Enter')) return false;
    if (k === 'Delete' || k === 'Backspace') {
      this.deleteSelection();
      return true;
    }
    if (k === 'w' || k === 'W') {
      this.toggleWires();
      return true;
    }
    if (k === 'Escape') {
      this.select([]);
      return true;
    }
    if (k === ' ') {
      this.togglePlay();
      return true;
    }
    if (k === 'Home' || k === 'End') {
      this.seek(k === 'Home' ? 0 : this.duration, true);
      return true;
    }
    if (k.startsWith('Arrow')) {
      if (this.selection.size && !this.keyMode) {
        const step = e.shiftKey ? 0.5 : 0.05;
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
        for (const id of this.selection) {
          const b = this.block(id);
          if ('x' in b.props) {
            b.props.x = round(b.props.x + dx);
            b.props.y = round(b.props.y + dy);
          }
        }
        clearTimeout(this.nudgeTimer);
        this.preview();
        this.nudgeTimer = setTimeout(() => this.commit('Nudge'), 300);
        return true;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const n = Math.round(this.t * this.fps) + (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? this.fps : 1);
        this.seek(n / this.fps, true);
        return true;
      }
    }
    return false;
  }

  // Code view.

  toggleCode(force) {
    this.codeOpen = force ?? !this.codeOpen;
    this.q('[data-act=code]').setAttribute('aria-pressed', String(this.codeOpen));
    this.q('[data-code]').hidden = !this.codeOpen;
    this.q('.ve-main').classList.toggle('has-code', this.codeOpen);
    if (this.codeOpen && !this.code) {
      this.code = new CodeEditor(this.q('[data-code-host]'), { language: 'js', label: 'Scene document code', value: documentToModule(this.doc) });
      this.code.addEventListener('input', () => {
        clearTimeout(this.codeTimer);
        this.codeTimer = setTimeout(() => this.applyCode(), 400);
      });
      this.code.addEventListener('run', () => this.applyCode());
      this.code.addEventListener('save', () => this.save());
    }
    this.syncCode();
    requestAnimationFrame(() => this.stage.layout());
  }

  syncCode(throttled = false) {
    if (!this.code || !this.codeOpen) return;
    if (this.code.ta === document.activeElement) return;
    const write = () => {
      this.code.value = documentToModule(this.doc);
      this.code.setDiagnostics([]);
      this.q('[data-code-state]').textContent = 'In sync';
    };
    if (!throttled) write();
    else {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(write, 120);
    }
  }

  applyCode() {
    const text = this.code.value;
    const state = this.q('[data-code-state]');
    try {
      const doc = moduleToDocument(text);
      this.doc = doc;
      this.pruneSelection();
      this.code.setDiagnostics([]);
      state.textContent = 'In sync';
      this.history.push(this.doc);
      this.persist();
      const code = this.code;
      this.code = null;
      this.refreshPanels();
      this.code = code;
      this.scheduleBuild();
    } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      let line = null;
      let col = null;
      if (m) {
        const start = text.indexOf('export default') + 'export default'.length;
        const body = text.slice(start);
        const lead = body.length - body.trimStart().length;
        const before = text.slice(0, start + lead + Number(m[1]));
        line = before.split('\n').length;
        col = before.length - before.lastIndexOf('\n');
      }
      this.code.setDiagnostics([{ severity: 'error', message: e.message, line: line ?? 1, col: col ?? 1 }]);
      state.textContent = 'Not applied: fix the error';
    }
  }

  // Integration with the app shell.

  /** @returns {string} the document as stable JSON */
  documentText() {
    return stringifyDocument(this.doc);
  }

  /** @param {string} text */
  loadText(text) {
    try {
      this.doc = normalizeDocument(JSON.parse(text));
      this.selection = new Set();
      this.history.reset(this.doc);
      this.refreshPanels();
      this.stage.layout();
      this.scheduleBuild();
    } catch (e) {
      toast(`That link does not hold a valid scene document: ${e.message}`);
    }
  }

  async save() {
    this.persist();
    history.replaceState(null, '', await encodePermalink('doc', this.documentText()));
    toast('Saved in this browser. The address bar link now opens this document.');
  }

  exportContext() {
    const m = this.doc.meta;
    const name = (m.title || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
    return { name, width: m.width, height: m.height, fps: m.fps, time: this.t, duration: this.duration };
  }

  /**
   * Top bar changes while the editor is active.
   * @param {{theme?: string, board?: string, size?: number[]}} o
   */
  setSceneOptions(o) {
    if (o.theme) {
      this.themeDraft = null;
      this.doc.meta.theme = o.theme;
    }
    if (o.board) this.board = o.board;
    if (o.size) {
      this.doc.meta.width = o.size[0];
      this.doc.meta.height = o.size[1];
      this.stage.layout();
    }
    this.commit('Scene options');
  }

  activate() {
    this.active = true;
    const sel = document.querySelector('#theme-select');
    if (sel) sel.value = this.doc.meta.theme;
    const size = document.querySelector('#size-select');
    if (size) size.value = `${this.doc.meta.width}x${this.doc.meta.height}`;
    requestAnimationFrame(() => this.stage.layout());
  }

  deactivate() {
    this.active = false;
    if (this.playing) this.togglePlay();
  }
}

function getThemeSafe(id) {
  try {
    return getTheme(id);
  } catch {
    return null;
  }
}

/**
 * Mount the visual editor into its section.
 * @param {HTMLElement} root
 * @param {{app: any, docText?: string|null, board?: string}} o
 * @returns {Promise<VisualEditor>}
 */
export async function mountVisualEditor(root, o) {
  return new VisualEditor(root, o);
}
