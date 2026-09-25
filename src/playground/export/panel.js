/**
 * Export panel: an inline panel under the Export button. Pick a format,
 * size, and frame rate; the sandbox renders and encodes; progress shows in
 * place with a cancel control, and the file downloads when done.
 * @module playground/export/panel
 */

import { icon } from '../icons.js';
import { esc, download } from '../ui.js';

const FORMATS = [
  { id: 'png', name: 'PNG', desc: 'Current frame', still: true, alpha: true },
  { id: 'svg', name: 'SVG', desc: 'Current frame as vectors', still: true, alpha: true },
  { id: 'mp4', name: 'MP4', desc: 'H.264 video' },
  { id: 'webm', name: 'WebM', desc: 'VP9 video' },
  { id: 'webm-alpha', name: 'WebM with alpha', desc: 'VP9, transparent background', alphaOnly: true },
  { id: 'gif', name: 'GIF', desc: 'Global palette, dithered', gif: true },
  { id: 'apng', name: 'APNG', desc: 'Lossless animated PNG', alpha: true },
];

const SHORT_SIDES = [360, 540, 720, 1080, 1440, 2160];

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The export panel.
 */
export class ExportPanel {
  /**
   * @param {HTMLElement} panel
   * @param {HTMLElement} button the toggle button in the top bar
   * @param {{runtime: () => import('../runtime.js').Runtime, context: () => {name: string, width: number, height: number, fps: number, time: number, duration: number}}} o
   */
  constructor(panel, button, o) {
    this.panel = panel;
    this.button = button;
    this.o = o;
    this.format = 'mp4';
    this.busy = false;
    this.render();
    button.addEventListener('click', () => this.toggle());
  }

  get isOpen() {
    return !this.panel.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.render();
    const first = this.panel.querySelector('input[name=xp-format]:checked');
    if (first) first.focus();
  }

  close() {
    if (this.busy) return;
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  sizes(ctx) {
    const ar = ctx.width / ctx.height;
    const list = SHORT_SIDES.map((s) => (ar >= 1 ? [Math.round(s * ar), s] : [s, Math.round(s / ar)]));
    if (!list.some(([w, h]) => w === ctx.width && h === ctx.height)) list.push([ctx.width, ctx.height]);
    return list.sort((a, b) => a[0] * a[1] - b[0] * b[1]);
  }

  render(state = {}) {
    const ctx = this.o.context();
    const f = FORMATS.find((x) => x.id === this.format);
    const sizes = this.sizes(ctx);
    const defSize = f.gif ? sizes.find(([w, h]) => Math.min(w, h) === 540) ?? sizes[0] : [ctx.width, ctx.height];
    const cur = this.options ?? {};
    const size = cur.format === this.format && cur.size ? cur.size : defSize;
    const fps = cur.format === this.format && cur.fps ? cur.fps : f.gif ? Math.min(30, ctx.fps) : ctx.fps;
    const frames = Math.max(1, Math.round(ctx.duration * fps));
    this.options = { format: this.format, size, fps, transparent: cur.transparent ?? false, colors: cur.colors ?? 256, dither: cur.dither ?? true };
    const o = this.options;
    const summary = f.still ? `${size[0]} × ${size[1]} · frame ${Math.round(ctx.time * ctx.fps)} at ${ctx.time.toFixed(2)} s` : `${size[0]} × ${size[1]} · ${fps} fps · ${frames} frames · ${ctx.duration.toFixed(2)} s`;
    this.panel.innerHTML = `
      <div class="xp-head">
        <h2 class="xp-title" id="xp-title">Export</h2>
        <button type="button" class="icon-btn sm" data-close aria-label="Close export panel">${icon('close')}</button>
      </div>
      <fieldset class="xp-formats" ${this.busy ? 'disabled' : ''}>
        <legend class="visually-hidden">Format</legend>
        ${FORMATS.map((x) => `<label class="xp-format"><input type="radio" name="xp-format" value="${x.id}" ${x.id === this.format ? 'checked' : ''}><span class="xp-name">${x.name}</span><span class="xp-desc">${x.desc}</span></label>`).join('')}
      </fieldset>
      <div class="xp-options" ${this.busy ? 'inert' : ''}>
        <label class="xp-field"><span class="label">Size</span>
          <span class="select full"><select data-opt="size">${sizes.map(([w, h]) => `<option value="${w}x${h}" ${w === size[0] && h === size[1] ? 'selected' : ''}>${w} × ${h}</option>`).join('')}</select><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg></span>
        </label>
        ${f.still ? '' : `<label class="xp-field"><span class="label">Frame rate</span>
          <span class="select full"><select data-opt="fps">${[24, 25, 30, 50, 60].map((r) => `<option value="${r}" ${r === fps ? 'selected' : ''}>${r} fps</option>`).join('')}</select><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg></span>
        </label>`}
        ${f.gif ? `<label class="xp-field"><span class="label">Colors</span>
          <span class="select full"><select data-opt="colors">${[256, 128, 64, 32].map((c) => `<option value="${c}" ${c === o.colors ? 'selected' : ''}>${c}</option>`).join('')}</select><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg></span>
        </label>
        <label class="xp-check"><input type="checkbox" class="check" data-opt="dither" ${o.dither ? 'checked' : ''}><span>Floyd-Steinberg dithering</span></label>` : ''}
        ${f.alpha ? `<label class="xp-check"><input type="checkbox" class="check" data-opt="transparent" ${o.transparent ? 'checked' : ''}><span>Transparent background</span></label>` : ''}
      </div>
      <div class="xp-summary num">${summary}</div>
      <div class="xp-foot">
        ${state.progress ? `<div class="xp-progress" role="progressbar" aria-label="Export progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(state.progress.u * 100)}">
            <div class="xp-bar"><div class="xp-bar-fill" style="width:${(state.progress.u * 100).toFixed(1)}%"></div></div>
            <div class="xp-progress-text"><span>${esc(state.progress.text)}</span><button type="button" class="btn sm ghost" data-cancel>Cancel</button></div>
          </div>` : `<button type="button" class="btn primary xp-go" data-go>${icon('download')}Export ${f.name}</button>`}
      </div>
      ${state.result ? `<div class="xp-result" role="status">
          <div class="xp-result-line">${icon('check')}<span class="xp-file">${esc(state.result.file)}</span><span class="muted num">${esc(state.result.meta)}</span></div>
          ${state.result.notes.map((n) => `<p class="xp-note">${esc(n)}</p>`).join('')}
        </div>` : ''}
      ${state.error ? `<div class="xp-error" role="alert">${esc(state.error)}</div>` : ''}`;
    this.panel.setAttribute('aria-labelledby', 'xp-title');
    this.bind();
  }

  bind() {
    const p = this.panel;
    p.querySelector('[data-close]').onclick = () => this.close();
    p.querySelectorAll('input[name=xp-format]').forEach((r) => {
      r.onchange = () => {
        this.format = r.value;
        this.render();
        p.querySelector(`input[value="${r.value}"]`).focus();
      };
    });
    p.querySelectorAll('[data-opt]').forEach((el) => {
      el.onchange = () => {
        const k = el.dataset.opt;
        if (k === 'size') this.options.size = el.value.split('x').map(Number);
        else if (k === 'fps') this.options.fps = Number(el.value);
        else if (k === 'colors') this.options.colors = Number(el.value);
        else this.options[k] = el.checked;
        this.render();
        const again = p.querySelector(`[data-opt="${k}"]`);
        if (again) again.focus();
      };
    });
    const go = p.querySelector('[data-go]');
    if (go) go.onclick = () => this.run();
    const cancel = p.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = () => this.o.runtime().cancelExport();
  }

  async run() {
    const ctx = this.o.context();
    const o = this.options;
    const f = FORMATS.find((x) => x.id === o.format);
    const rt = this.o.runtime();
    this.busy = true;
    this.render({ progress: { u: 0, text: 'Starting' } });
    const onProgress = (e) => {
      const d = e.detail;
      const u = d.total ? d.done / d.total : 0;
      const text = d.stage === 'Encoding' || d.stage === 'Rendering' ? `${d.stage} frame ${d.done} of ${d.total}` : d.stage;
      const bar = this.panel.querySelector('.xp-bar-fill');
      const label = this.panel.querySelector('.xp-progress-text span');
      const pb = this.panel.querySelector('.xp-progress');
      if (bar) bar.style.width = `${(u * 100).toFixed(1)}%`;
      if (label) label.textContent = text;
      if (pb) pb.setAttribute('aria-valuenow', String(Math.round(u * 100)));
    };
    rt.addEventListener('progress', onProgress);
    try {
      const res = await rt.exportScene({ format: o.format, width: o.size[0], height: o.size[1], fps: f.still ? ctx.fps : o.fps, transparent: o.transparent, t: ctx.time, gif: { colors: o.colors, dither: o.dither } });
      const suffix = f.still ? `-${String(Math.round(ctx.time * ctx.fps)).padStart(4, '0')}` : '';
      const file = `${ctx.name}${suffix}.${res.ext}`;
      download(res.blob, file);
      this.busy = false;
      const meta = f.still ? `${fmtBytes(res.blob.size)} · ${res.width} × ${res.height}` : `${fmtBytes(res.blob.size)} · ${res.frames} frames · ${res.width} × ${res.height}`;
      this.render({ result: { file, meta, notes: res.notes } });
    } catch (e) {
      this.busy = false;
      this.render(e.name === 'AbortError' ? { result: null, error: 'Export cancelled.' } : { error: e.message });
    } finally {
      rt.removeEventListener('progress', onProgress);
      this.busy = false;
    }
  }
}
