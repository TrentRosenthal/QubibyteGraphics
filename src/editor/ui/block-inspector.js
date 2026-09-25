/**
 * Block inspector: the property panel generated from a block definition's
 * fields, plus its entrance, exit, keyframes, and wiring.
 * @module editor/ui/block-inspector
 */

import { blockDefinition } from '../blocks.js';
import { ANIMATIONS } from '../document.js';
import { fieldWidget } from './fields.js';
import { icon } from '../../playground/icons.js';
import { esc } from '../../playground/ui.js';

const POS_KEYS = new Set(['x', 'y', 'rotation', 'scale', 'opacity']);
const ENTER = Object.keys(ANIMATIONS).filter((k) => !/Out|^un|shrink/.test(k));
const EXIT = Object.keys(ANIMATIONS).filter((k) => k === 'none' || /Out|^un|shrink/.test(k));

/**
 * Render the inspector for the current selection.
 * @param {HTMLElement} host
 * @param {import('./editor-app.js').VisualEditor} ed
 */
export function renderBlockInspector(host, ed) {
  const ids = [...ed.selection];
  if (!ids.length) {
    host.innerHTML = `<div class="bi"><p class="bi-note">Select a block on the canvas or in the timeline. Drag blocks in from the library on the left.</p>
      <section class="bi-section"><h3 class="section-title">Scene</h3><div class="bi-grid" data-scene></div></section></div>`;
    const grid = host.querySelector('[data-scene]');
    const m = ed.doc.meta;
    const f = [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'duration', label: 'Duration (s)', kind: 'number', min: 0.5, step: 0.5 },
      { key: 'fps', label: 'Frame rate', kind: 'number', min: 1, max: 120, step: 1 },
      { key: 'seed', label: 'Seed', kind: 'number', step: 1 },
    ];
    for (const field of f) grid.append(fieldWidget(field, m[field.key], ed.fieldContext((v, o) => ed.setMeta({ [field.key]: v }, o))));
    return;
  }
  if (ids.length > 1) {
    host.innerHTML = `<div class="bi"><div class="bi-head"><span class="bi-type">${ids.length} blocks</span></div>
      <div class="bi-actions">
        <button type="button" class="btn sm" data-act="group">${icon('group')}Group</button>
        <button type="button" class="btn sm" data-act="duplicate">${icon('duplicate')}Duplicate</button>
        <button type="button" class="btn sm danger" data-act="delete">${icon('trash')}Delete</button>
      </div>
      <p class="bi-note">Drag any selected block to move them together. Arrow keys nudge.</p></div>`;
    host.querySelector('[data-act=group]').onclick = () => ed.groupSelection();
    host.querySelector('[data-act=duplicate]').onclick = () => ed.duplicateSelection();
    host.querySelector('[data-act=delete]').onclick = () => ed.deleteSelection();
    return;
  }
  const block = ed.block(ids[0]);
  if (!block) {
    host.innerHTML = '';
    return;
  }
  const def = blockDefinition(block.type);
  const err = ed.blockErrors.get(block.id);
  host.innerHTML = `<div class="bi">
    <div class="bi-head">
      <span class="bi-type">${esc(def.label)}</span>
      <label class="bi-id"><span class="visually-hidden">Block id</span><input class="input mono" value="${esc(block.id)}" spellcheck="false" aria-label="Block id"></label>
    </div>
    ${err ? `<div class="bi-error" role="alert">${esc(err)}</div>` : ''}
    ${block.props.group ? `<div class="bi-note">In group <span class="mono">${esc(block.props.group)}</span>. <button type="button" class="linkish" data-act="ungroup">Ungroup</button></div>` : ''}
    <section class="bi-section"><h3 class="section-title">Properties</h3><div class="bi-fields" data-fields></div></section>
    ${def.fields.some((f) => POS_KEYS.has(f.key)) ? '<section class="bi-section"><h3 class="section-title">Layout</h3><div class="bi-grid" data-pos></div></section>' : ''}
    <section class="bi-section"><h3 class="section-title">Timing</h3><div data-timing></div></section>
    ${def.ports.in.length || def.ports.out.length ? '<section class="bi-section"><h3 class="section-title">Wiring</h3><div data-ports></div></section>' : ''}
  </div>`;
  const idInput = host.querySelector('.bi-id input');
  idInput.addEventListener('change', () => {
    if (!ed.renameBlock(block.id, idInput.value.trim())) idInput.value = block.id;
  });
  const ungroup = host.querySelector('[data-act=ungroup]');
  if (ungroup) ungroup.onclick = () => ed.ungroupSelection();
  const fields = host.querySelector('[data-fields]');
  const pos = host.querySelector('[data-pos]');
  for (const f of def.fields) {
    const w = fieldWidget(f, block.props[f.key], ed.fieldContext((v, o) => ed.updateProps(block.id, { [f.key]: v }, o)));
    (POS_KEYS.has(f.key) && pos ? pos : fields).append(w);
  }
  renderTiming(host.querySelector('[data-timing]'), block, ed);
  const ports = host.querySelector('[data-ports]');
  if (ports) renderPorts(ports, block, ed);
}

function animSelect(name, value, options) {
  return `<span class="select full"><select data-k="${name}" aria-label="${name === 'enter' ? 'Entrance' : 'Exit'} animation"><option value="">${name === 'enter' ? 'On from the start' : 'Stays to the end'}</option>${options.filter((o) => o !== 'none').map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select>${icon('chevronDown')}</span>`;
}

function renderTiming(host, block, ed) {
  const e = block.enter;
  const x = block.exit;
  const num = (k, v, label) => `<label class="bi-mini"><span>${label}</span><input class="input num" data-k="${k}" value="${v}" inputmode="decimal"></label>`;
  host.innerHTML = `
    <div class="bi-timing-row"><span class="bf-label">Enter</span>${animSelect('enter', e && e.anim, ENTER)}</div>
    ${e ? `<div class="bi-timing-nums">${num('enter.at', e.at ?? 0, 'At')}${num('enter.duration', e.duration ?? 1, 'For')}</div>` : ''}
    <div class="bi-timing-row"><span class="bf-label">Exit</span>${animSelect('exit', x && x.anim, EXIT)}</div>
    ${x ? `<div class="bi-timing-nums">${num('exit.at', x.at ?? 0, 'At')}${num('exit.duration', x.duration ?? 1, 'For')}</div>` : ''}
    <div class="bi-keys">
      <div class="bi-keys-head"><span class="bf-label">Keyframes</span><button type="button" class="btn sm ghost" data-act="key">${icon('diamond')}Add at playhead</button></div>
      ${(block.keyframes || []).map((k, i) => `<div class="bi-key"><span class="mono num">${k.t.toFixed(2)} s</span><span class="muted mono">${esc(Object.entries(k.props).map(([a, b]) => `${a} ${typeof b === 'number' ? +b.toFixed(2) : b}`).join(', '))}</span><button type="button" class="icon-btn sm" data-del="${i}" aria-label="Delete keyframe at ${k.t.toFixed(2)} seconds">${icon('trash')}</button></div>`).join('') || '<p class="bi-note">Move the block with the playhead past 0 to add one.</p>'}
    </div>`;
  host.querySelectorAll('select[data-k]').forEach((s) => s.addEventListener('change', () => {
    const k = s.dataset.k;
    if (!s.value) ed.setTiming(block.id, k, null);
    else ed.setTiming(block.id, k, { ...(block[k] || { at: k === 'enter' ? 0 : Math.max(0, ed.duration - 1), duration: 1 }), anim: s.value });
  }));
  host.querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const [k, field] = inp.dataset.k.split('.');
    const v = Number(inp.value);
    if (!Number.isFinite(v) || v < 0) return;
    ed.setTiming(block.id, k, { ...block[k], [field]: v });
  }));
  host.querySelector('[data-act=key]').onclick = () => ed.addKeyframeAtPlayhead(block.id);
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => ed.deleteKeyframe(block.id, Number(b.dataset.del))));
}

function renderPorts(host, block, ed) {
  const { inputs, outputs } = ed.portsOf(block);
  const wiredInto = (port) => ed.doc.wires.find((w) => w.to === `${block.id}.${port}`);
  const wiredFrom = (port) => ed.doc.wires.filter((w) => w.from === `${block.id}.${port}`);
  const row = (dir, p, text) => `<div class="bi-port"><span class="bi-port-dot ${dir}"></span><span class="mono">${esc(p.name)}</span><span class="muted">${esc(p.kind)}</span><span class="bi-port-link">${text}</span></div>`;
  host.innerHTML = `${inputs.map((p) => {
    const w = wiredInto(p.name);
    return row('in', p, w ? `from <button type="button" class="linkish mono" data-sel="${esc(w.from.split('.')[0])}">${esc(w.from)}</button> <button type="button" class="icon-btn sm" data-unwire="${esc(w.to)}" aria-label="Remove wire into ${esc(p.name)}">${icon('close')}</button>` : '<span class="muted">not wired</span>');
  }).join('')}${outputs.map((p) => {
    const ws = wiredFrom(p.name);
    return row('out', p, ws.length ? `to ${ws.map((w) => `<button type="button" class="linkish mono" data-sel="${esc(w.to.split('.')[0])}">${esc(w.to)}</button>`).join(', ')}` : '<span class="muted">not wired</span>');
  }).join('')}<p class="bi-note">Press W to show wires on the canvas and drag from an output to an input.</p>`;
  host.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => ed.select([b.dataset.sel])));
  host.querySelectorAll('[data-unwire]').forEach((b) => b.addEventListener('click', () => ed.removeWire(b.dataset.unwire)));
}
