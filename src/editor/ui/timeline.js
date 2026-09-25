/**
 * Editor timeline: a track per block with its entrance and exit bars (drag
 * the body to move, the edges to change start and duration) and keyframe
 * diamonds (drag to retime, click to jump), a ruler to scrub, and the
 * playhead. The transport lives in the header.
 * @module editor/ui/timeline
 */

import { blockDefinition } from '../blocks.js';
import { blockGlyph } from './library.js';
import { icon } from '../../playground/icons.js';
import { formatTime } from '../../playground/preview.js';
import { esc } from '../../playground/ui.js';

const SNAP = 0.05;

/** The timeline panel. */
export class Timeline {
  /**
   * @param {HTMLElement} host
   * @param {import('./editor-app.js').VisualEditor} ed
   */
  constructor(host, ed) {
    this.host = host;
    this.ed = ed;
    host.innerHTML = `
      <div class="tl-head">
        <div class="transport-buttons">
          <button type="button" class="icon-btn" data-act="start" aria-label="Jump to start">${icon('skipStart')}</button>
          <button type="button" class="icon-btn tl-play" data-act="play" aria-label="Play">${icon('play')}</button>
          <button type="button" class="icon-btn" data-act="end" aria-label="Jump to end">${icon('skipEnd')}</button>
        </div>
        <div class="time-readout"><span class="cur">0:00.00</span><span class="sep">/</span><span class="total">0:00.00</span></div>
        <span class="spacer"></span>
        <label class="tl-duration"><span class="label">Duration</span><input class="input num" data-duration inputmode="decimal" aria-label="Scene duration in seconds"><span class="label">s</span></label>
      </div>
      <div class="tl-body">
        <div class="tl-grid">
          <div class="tl-corner"></div>
          <div class="tl-ruler" role="slider" tabindex="0" aria-label="Playhead" aria-valuemin="0"></div>
          <div class="tl-rows"></div>
          <div class="tl-playhead" aria-hidden="true"><span class="tl-playhead-knob"></span></div>
        </div>
      </div>`;
    this.q = (s) => host.querySelector(s);
    this.rows = this.q('.tl-rows');
    this.ruler = this.q('.tl-ruler');
    this.playhead = this.q('.tl-playhead');
    host.querySelector('.tl-head').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'play') ed.togglePlay();
      else if (b.dataset.act === 'start') ed.seek(0);
      else ed.seek(ed.duration);
    });
    const dur = this.q('[data-duration]');
    dur.addEventListener('change', () => {
      const v = Number(dur.value);
      if (Number.isFinite(v) && v >= 0.5) ed.setMeta({ duration: v }, { commit: true });
      else dur.value = String(ed.doc.meta.duration);
    });
    // The ruler, the playhead, and its knob all start a scrub.
    this.ruler.addEventListener('pointerdown', (e) => this.scrub(e));
    this.playhead.addEventListener('pointerdown', (e) => this.scrub(e));
    this.rows.addEventListener('pointerdown', (e) => this.onDown(e));
    new ResizeObserver(() => this.render()).observe(this.rows);
  }

  /** Track width in pixels and the time span shown. */
  span() {
    const w = this.ruler.clientWidth || 1;
    return { w, d: Math.max(0.5, this.ed.duration) };
  }

  timeAt(clientX) {
    const r = this.ruler.getBoundingClientRect();
    const { d } = this.span();
    return Math.max(0, Math.min(d, ((clientX - r.left) / r.width) * d));
  }

  x(t) {
    const { w, d } = this.span();
    return (t / d) * w;
  }

  render() {
    const ed = this.ed;
    const { d } = this.span();
    this.q('.total').textContent = formatTime(d);
    const dur = this.q('[data-duration]');
    if (document.activeElement !== dur) dur.value = String(ed.doc.meta.duration);
    const step = d > 20 ? 5 : d > 8 ? 1 : 0.5;
    let ticks = '';
    for (let t = 0; t <= d + 1e-9; t += step) ticks += `<span class="tl-tick${Math.abs(t - Math.round(t)) < 1e-9 ? ' major' : ''}" style="left:${this.x(t)}px">${Math.abs(t - Math.round(t)) < 1e-9 ? `${Math.round(t)}s` : ''}</span>`;
    this.ruler.innerHTML = ticks;
    this.ruler.setAttribute('aria-valuemax', d.toFixed(2));
    this.rows.innerHTML = ed.doc.blocks.map((b) => {
      const def = blockDefinition(b.type);
      const sel = ed.selection.has(b.id);
      const start = b.enter ? b.enter.at ?? 0 : 0;
      const end = b.exit ? (b.exit.at ?? d) + (b.exit.duration ?? 1) : d;
      const life = `<span class="tl-life" style="left:${this.x(start)}px;width:${Math.max(0, this.x(end) - this.x(start))}px"></span>`;
      const bar = (kind, spec) => spec ? `<span class="tl-bar ${kind}" data-bar="${kind}" style="left:${this.x(spec.at ?? 0)}px;width:${Math.max(6, this.x(spec.duration ?? 1))}px" title="${kind === 'enter' ? 'Entrance' : 'Exit'}: ${esc(spec.anim)} at ${(spec.at ?? 0).toFixed(2)} s for ${(spec.duration ?? 1).toFixed(2)} s"><span class="tl-edge l" data-edge="l"></span><span class="tl-bar-label">${esc(spec.anim)}</span><span class="tl-edge r" data-edge="r"></span></span>` : '';
      const keys = (b.keyframes || []).map((k, i) => `<span class="tl-key" data-key="${i}" style="left:${this.x(k.t)}px" title="Keyframe at ${k.t.toFixed(2)} s"></span>`).join('');
      return `<div class="tl-row${sel ? ' is-selected' : ''}${ed.blockErrors.has(b.id) ? ' is-error' : ''}" data-id="${esc(b.id)}">
        <button type="button" class="tl-label" data-select="${esc(b.id)}" aria-pressed="${sel}">${blockGlyph(b.type)}<span class="tl-name">${esc(b.id)}</span><span class="tl-type">${esc(def.label)}</span></button>
        <div class="tl-track">${life}${bar('enter', b.enter)}${bar('exit', b.exit)}${keys}</div>
      </div>`;
    }).join('') || '<p class="tl-empty">Blocks you add appear here with their entrance, exit, and keyframes.</p>';
    this.update();
  }

  /** Move the playhead and refresh the readout. */
  update() {
    const ed = this.ed;
    this.q('.cur').textContent = formatTime(ed.t);
    const play = this.q('.tl-play');
    play.innerHTML = icon(ed.playing ? 'pause' : 'play');
    play.setAttribute('aria-label', ed.playing ? 'Pause' : 'Play');
    const r = this.ruler;
    this.playhead.style.left = `${r.offsetLeft + this.x(ed.t)}px`;
    r.setAttribute('aria-valuenow', ed.t.toFixed(2));
  }

  /**
   * Drag the playhead from a pointerdown anywhere on the ruler, the playhead,
   * or an empty track. The pointer is captured so the drag follows the mouse
   * off the timeline, text never gets selected, seeks are coalesced to one
   * per frame, and the drag always ends (release, cancel, or lost capture).
   * @param {PointerEvent} e
   */
  scrub(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const ed = this.ed;
    const el = e.currentTarget && e.currentTarget.setPointerCapture ? e.currentTarget : this.ruler;
    el.setPointerCapture(e.pointerId);
    if (ed.playing) ed.togglePlay();
    this.host.classList.add('is-scrubbing');
    let pending = null;
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (pending != null) ed.seek(pending, true);
      pending = null;
    };
    const seek = (ev) => {
      pending = this.timeAt(ev.clientX);
      // Move the line at once; the scene render follows on the next frame.
      this.playhead.style.left = `${this.ruler.offsetLeft + this.x(pending)}px`;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    seek(e);
    const end = () => {
      el.removeEventListener('pointermove', seek);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      if (frame) cancelAnimationFrame(frame);
      flush();
      this.host.classList.remove('is-scrubbing');
    };
    el.addEventListener('pointermove', seek);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  onDown(e) {
    const ed = this.ed;
    const row = e.target.closest('.tl-row');
    if (!row) return;
    const id = row.dataset.id;
    const selBtn = e.target.closest('[data-select]');
    if (selBtn) {
      if (e.shiftKey) ed.toggleSelect(id);
      else ed.select([id]);
      return;
    }
    const block = ed.block(id);
    const bar = e.target.closest('[data-bar]');
    const key = e.target.closest('[data-key]');
    if (!bar && !key) {
      // Empty track: select the block and scrub from here, like the ruler.
      ed.select([id]);
      this.scrub(e);
      return;
    }
    e.preventDefault();
    const t0 = this.timeAt(e.clientX);
    const target = e.target;
    target.setPointerCapture(e.pointerId);
    ed.select([id]);
    let moved = false;
    if (key) {
      const i = Number(key.dataset.key);
      const k0 = block.keyframes[i].t;
      const move = (ev) => {
        moved = true;
        const t = Math.max(0.05, snap(k0 + this.timeAt(ev.clientX) - t0));
        ed.previewKeyframeTime(id, i, t);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        if (moved) ed.commit('Retime keyframe');
        else ed.seek(block.keyframes[i].t, true);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      return;
    }
    const kind = bar.dataset.bar;
    const edge = e.target.dataset.edge ?? null;
    const spec0 = { ...block[kind] };
    const move = (ev) => {
      moved = true;
      const dt = this.timeAt(ev.clientX) - t0;
      const s = { ...spec0 };
      if (edge === 'l') {
        const end = spec0.at + spec0.duration;
        s.at = Math.max(0, Math.min(end - 0.1, snap(spec0.at + dt)));
        s.duration = snap(end - s.at);
      } else if (edge === 'r') s.duration = Math.max(0.1, snap(spec0.duration + dt));
      else s.at = Math.max(0, snap(spec0.at + dt));
      ed.previewTiming(id, kind, s);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (moved) ed.commit('Retime');
      else ed.focusTiming(kind);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
}

function snap(t) {
  return Math.round(t / SNAP) * SNAP;
}
