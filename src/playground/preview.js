/**
 * Preview: keeps the canvas at the scene's aspect ratio inside the stage,
 * drives time with requestAnimationFrame, and owns the transport (play,
 * frame step, J/K/L shuttle, loop), the scrubber with its markers, the
 * caption overlay, and the sliders for scene controls.
 * @module playground/preview
 */

/* global EventTarget */

import { icon } from './icons.js';

/**
 * Format seconds as m:ss.cc.
 * @param {number} t
 * @returns {string}
 */
export function formatTime(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * The preview controller. Events: `pick` (detail: {x, y} in device pixels), `time`.
 */
export class Preview extends EventTarget {
  /**
   * @param {{runtime: import('./runtime.js').Runtime, stage: HTMLElement, frame: HTMLElement, caption: HTMLElement,
   *   transport: HTMLElement, controls?: HTMLElement|null, status?: HTMLElement|null}} o
   */
  constructor(o) {
    super();
    this.runtime = o.runtime;
    this.stage = o.stage;
    this.frameEl = o.frame;
    this.captionEl = o.caption;
    this.transportEl = o.transport;
    this.controlsEl = o.controls ?? null;
    this.statusEl = o.status ?? null;
    this.info = null;
    this.t = 0;
    this.rate = 0;
    this.loop = true;
    this.raf = 0;
    this.lastNow = 0;
    this.stopAtPauses = true;
    this.buildTransport();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.stage);
    this.runtime.addEventListener('frame', (e) => this.onFrame(e.detail));
    this.runtime.addEventListener('restart', () => this.layout(true));
    this.bindPointer();
  }

  buildTransport() {
    this.transportEl.innerHTML = `
      <div class="transport-row">
        <div class="transport-buttons">
          <button type="button" class="icon-btn" data-act="start" aria-label="Jump to start" data-tip="Start  Home" data-tip-pos="up">${icon('skipStart')}</button>
          <button type="button" class="icon-btn" data-act="back" aria-label="Previous frame" data-tip="Previous frame" data-tip-pos="up">${icon('stepBack')}</button>
          <button type="button" class="icon-btn play-btn" data-act="play" aria-label="Play" data-tip="Play  Space" data-tip-pos="up">${icon('play')}</button>
          <button type="button" class="icon-btn" data-act="forward" aria-label="Next frame" data-tip="Next frame" data-tip-pos="up">${icon('stepForward')}</button>
          <button type="button" class="icon-btn" data-act="end" aria-label="Jump to end" data-tip="End  End" data-tip-pos="up">${icon('skipEnd')}</button>
        </div>
        <div class="time-readout"><span class="cur">0:00.00</span><span class="sep">/</span><span class="total">0:00.00</span></div>
        <div class="frame-readout">Frame <span class="fcur">0</span> of <span class="ftotal">0</span></div>
        <span class="spacer"></span>
        <span class="rate-badge" hidden></span>
        <button type="button" class="icon-btn" data-act="loop" aria-label="Loop playback" aria-pressed="true" data-tip="Loop" data-tip-pos="up">${icon('loop')}</button>
      </div>
      <div class="scrubber" role="slider" tabindex="0" aria-label="Timeline position" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
        <div class="scrub-track"><div class="scrub-fill"></div></div>
        <div class="scrub-captions"></div>
        <div class="scrub-markers"></div>
        <div class="scrub-head"></div>
      </div>`;
    const q = (s) => this.transportEl.querySelector(s);
    this.playBtn = q('[data-act=play]');
    this.loopBtn = q('[data-act=loop]');
    this.curEl = q('.cur');
    this.totalEl = q('.total');
    this.fcurEl = q('.fcur');
    this.ftotalEl = q('.ftotal');
    this.rateEl = q('.rate-badge');
    this.scrub = q('.scrubber');
    this.fill = q('.scrub-fill');
    this.head = q('.scrub-head');
    this.markers = q('.scrub-markers');
    this.captionsBar = q('.scrub-captions');
    this.transportEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'play') this.toggle();
      else if (act === 'start') this.jump('start');
      else if (act === 'end') this.jump('end');
      else if (act === 'back') this.step(-1);
      else if (act === 'forward') this.step(1);
      else if (act === 'loop') {
        this.loop = !this.loop;
        this.loopBtn.setAttribute('aria-pressed', String(this.loop));
      }
    });
    let dragging = false;
    const seekTo = (e) => {
      const r = this.scrub.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.pause();
      this.seek(u * this.duration, true);
    };
    this.scrub.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.scrub.setPointerCapture(e.pointerId);
      seekTo(e);
    });
    this.scrub.addEventListener('pointermove', (e) => {
      if (dragging) seekTo(e);
      this.showHover(e);
    });
    this.scrub.addEventListener('pointerup', () => {
      dragging = false;
    });
    this.scrub.addEventListener('pointerleave', () => {
      const h = this.scrub.querySelector('.scrub-hover');
      if (h) h.remove();
    });
  }

  showHover(e) {
    if (!this.info) return;
    const r = this.scrub.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    let h = this.scrub.querySelector('.scrub-hover');
    if (!h) {
      h = document.createElement('div');
      h.className = 'scrub-hover';
      this.scrub.append(h);
    }
    const t = u * this.duration;
    const near = [...this.markerData].find((m) => Math.abs(m.t - t) < this.duration * 0.012);
    h.textContent = near ? `${near.name}  ${formatTime(near.t)}` : formatTime(t);
    h.style.left = `${u * 100}%`;
  }

  bindPointer() {
    let down = null;
    this.frameEl.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    this.frameEl.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = this.frameEl.getBoundingClientRect();
      const dpr = this.dpr();
      this.dispatchEvent(new CustomEvent('pick', { detail: { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr } }));
    });
  }

  dpr() {
    return Math.min(3, window.devicePixelRatio || 1);
  }

  /** @returns {number} */
  get duration() {
    return this.info ? this.info.duration : 0;
  }

  /** @returns {number} */
  get fps() {
    return this.info ? this.info.fps : 60;
  }

  /**
   * Show a loaded scene's info: duration, markers, controls.
   * @param {any} info
   * @param {{keepTime?: boolean}} [opts]
   */
  setInfo(info, opts = {}) {
    this.info = info;
    if (!opts.keepTime) this.t = 0;
    this.t = Math.min(this.t, info.duration);
    this.scrub.setAttribute('aria-valuemax', info.duration.toFixed(2));
    this.totalEl.textContent = formatTime(info.duration);
    this.ftotalEl.textContent = String(info.frameCount);
    this.markerData = [
      ...info.labels.map((l) => ({ ...l, kind: 'label' })),
      ...info.pauses.map((p) => ({ ...p, kind: 'pause' })),
      ...(info.keyframes || []).map((k) => ({ name: `keyframe ${k.block}`, t: k.t, kind: 'key' })),
    ];
    const pct = (t) => `${(100 * t) / Math.max(1e-9, info.duration)}%`;
    this.markers.innerHTML = this.markerData.map((m) => `<span class="scrub-marker ${m.kind}" style="left:${pct(m.t)}" title="${esc(m.name)} at ${formatTime(m.t)}"></span>`).join('');
    this.captionsBar.innerHTML = info.captions.map((c) => `<span class="scrub-caption" style="left:${pct(c.start)};width:${pct(c.end - c.start)}" title="${esc(c.text)}"></span>`).join('');
    this.renderControls(info.controls);
    this.layout(true);
    this.seek(this.t, true);
  }

  renderControls(controls) {
    if (!this.controlsEl) return;
    this.controlsEl.innerHTML = controls.map((c) => {
      const id = `ctl-${c.index}-${Math.random().toString(36).slice(2, 6)}`;
      if (c.kind === 'toggle') return `<label class="control"><span class="label">${esc(c.label)}</span><input type="checkbox" class="check" data-index="${c.index}" ${c.value ? 'checked' : ''}><span></span></label>`;
      return `<div class="control"><label class="label" for="${id}">${esc(c.label)}</label><input id="${id}" type="range" class="range" data-index="${c.index}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"><span class="value num">${fmtNum(c.value)}</span></div>`;
    }).join('');
    let pending = null;
    let busy = false;
    const send = async () => {
      if (busy || !pending) return;
      busy = true;
      const { index, value } = pending;
      pending = null;
      try {
        await this.runtime.setControl(index, value);
        this.runtime.seek(this.t);
      } finally {
        busy = false;
        if (pending) send();
      }
    };
    this.controlsEl.oninput = (e) => {
      const inp = e.target.closest('input[data-index]');
      if (!inp) return;
      const value = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : Number(inp.value);
      const v = inp.parentElement.querySelector('.value');
      if (v) v.textContent = fmtNum(value);
      pending = { index: Number(inp.dataset.index), value };
      send();
    };
  }

  /**
   * Fit the canvas to the stage at the scene's aspect ratio.
   * @param {boolean} [force]
   */
  layout(force = false) {
    const info = this.info;
    const cs = getComputedStyle(this.stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const aw = Math.max(1, this.stage.clientWidth - padX);
    const ah = Math.max(1, this.stage.clientHeight - padY);
    const ar = info ? info.width / info.height : 16 / 9;
    let w = aw;
    let h = w / ar;
    if (h > ah) {
      h = ah;
      w = h * ar;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    if (!force && this.size && this.size.w === w && this.size.h === h) return;
    this.size = { w, h };
    this.frameEl.style.width = `${w}px`;
    this.frameEl.style.height = `${h}px`;
    const dpr = this.dpr();
    this.runtime.resize(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    this.dispatchEvent(new Event('layout'));
  }

  onFrame(m) {
    this.captionEl.textContent = m.captions && m.captions.length ? m.captions.join(' ') : '';
    this.lastFrame = m;
    this.dispatchEvent(new CustomEvent('frame', { detail: m }));
  }

  updateReadout() {
    const d = this.duration;
    this.curEl.textContent = formatTime(this.t);
    const n = Math.min(this.info ? this.info.frameCount - 1 : 0, Math.round(this.t * this.fps));
    this.fcurEl.textContent = String(Math.max(0, n));
    const u = d > 0 ? this.t / d : 0;
    this.fill.style.width = `${u * 100}%`;
    this.head.style.left = `${u * 100}%`;
    this.scrub.setAttribute('aria-valuenow', this.t.toFixed(2));
    this.scrub.setAttribute('aria-valuetext', `${formatTime(this.t)}, frame ${n}`);
  }

  /**
   * Show a time.
   * @param {number} t output seconds
   * @param {boolean} [snap] snap to the nearest frame
   */
  seek(t, snap = false) {
    const d = this.duration;
    let v = Math.max(0, Math.min(d, t));
    if (snap) v = Math.min(d, Math.round(v * this.fps) / this.fps);
    this.t = v;
    this.runtime.seek(v);
    this.updateReadout();
    this.dispatchEvent(new Event('time'));
  }

  /** @param {number} frames */
  step(frames) {
    this.pause();
    const n = Math.round(this.t * this.fps) + frames;
    this.seek(n / this.fps, true);
  }

  /** @param {'start'|'end'} where */
  jump(where) {
    this.pause();
    this.seek(where === 'start' ? 0 : this.duration, true);
  }

  /** @returns {boolean} */
  get playing() {
    return this.rate !== 0;
  }

  /** @param {number} [rate=1] */
  play(rate = 1) {
    if (!this.info) return;
    if (rate > 0 && this.t >= this.duration - 1e-6) this.t = 0;
    if (rate < 0 && this.t <= 1e-6) this.t = this.duration;
    this.rate = rate;
    this.lastNow = performance.now();
    this.playBtn.innerHTML = icon('pause');
    this.playBtn.setAttribute('aria-label', 'Pause');
    this.rateEl.hidden = rate === 1;
    this.rateEl.textContent = `${rate > 0 ? '' : '-'}${Math.abs(rate)}x`;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  pause() {
    if (!this.rate) return;
    this.rate = 0;
    cancelAnimationFrame(this.raf);
    this.playBtn.innerHTML = icon('play');
    this.playBtn.setAttribute('aria-label', 'Play');
    this.rateEl.hidden = true;
    this.seek(this.t, true);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play(1);
  }

  /** J/K/L shuttle. @param {'j'|'k'|'l'} key */
  shuttle(key) {
    if (key === 'k') return this.pause();
    const dir = key === 'l' ? 1 : -1;
    if (this.rate && Math.sign(this.rate) === dir) this.play(Math.max(-8, Math.min(8, this.rate * 2)));
    else this.play(dir);
  }

  tick(now) {
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const prev = this.t;
    let t = prev + dt * this.rate;
    const d = this.duration;
    if (this.stopAtPauses && this.rate > 0 && this.info) {
      const p = this.info.pauses.find((x) => x.t > prev + 1e-6 && x.t <= t);
      if (p) {
        this.seek(p.t, true);
        this.pause();
        this.setStatus(`Paused at ${p.name}`, 1800);
        return;
      }
    }
    if (t >= d || t <= 0) {
      if (this.loop) t = this.rate > 0 ? 0 : d;
      else {
        this.seek(Math.max(0, Math.min(d, t)), true);
        this.pause();
        this.dispatchEvent(new Event('ended'));
        return;
      }
    }
    this.seek(t);
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  /**
   * Show a short status line on the stage.
   * @param {string} text
   * @param {number} [ms] clear after this long
   * @param {boolean} [busy] show a pulse
   */
  setStatus(text, ms = 0, busy = false) {
    if (!this.statusEl) return;
    clearTimeout(this.statusTimer);
    this.statusEl.innerHTML = text ? `${busy ? '<span class="pulse"></span>' : ''}<span>${esc(text)}</span>` : '';
    if (ms) this.statusTimer = setTimeout(() => (this.statusEl.innerHTML = ''), ms);
  }

  /**
   * Playback keys. Returns true when the key was handled.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  handleKey(e) {
    if (!this.info) return false;
    const big = e.shiftKey ? Math.round(this.fps) : 1;
    switch (e.key) {
      case ' ':
        this.toggle();
        return true;
      case 'ArrowLeft':
        this.step(-big);
        return true;
      case 'ArrowRight':
        this.step(big);
        return true;
      case 'Home':
        this.jump('start');
        return true;
      case 'End':
        this.jump('end');
        return true;
      case 'j':
      case 'k':
      case 'l':
        this.shuttle(e.key);
        return true;
      default:
        return false;
    }
  }
}

function fmtNum(v) {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1);
}
