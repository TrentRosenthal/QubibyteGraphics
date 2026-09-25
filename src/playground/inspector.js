/**
 * Inspector: what is under the pointer in the preview. A click hit-tests
 * the sampled frame in the sandbox; the panel shows the node's ancestry,
 * id, type, and every tracked property at the current time, with animated
 * properties marked. The picked node is outlined on the preview.
 * @module playground/inspector
 */

import { esc } from './ui.js';

const EMPTY = '<div class="inspector"><p class="inspector-note">Click an object in the preview to see its id, type, and tracked properties at the current time.</p></div>';

/**
 * Inspector panel controller.
 */
export class Inspector {
  /**
   * @param {HTMLElement} host panel body
   * @param {HTMLElement} outline outline element inside the preview frame
   * @param {import('./runtime.js').Runtime} runtime
   */
  constructor(host, outline, runtime) {
    this.host = host;
    this.outline = outline;
    this.runtime = runtime;
    this.chain = null;
    this.current = null;
    this.host.innerHTML = EMPTY;
    this.host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-node]');
      if (b) this.show(b.dataset.node);
    });
  }

  /** Forget the selection (after a rebuild). */
  clear() {
    this.chain = null;
    this.current = null;
    this.outline.hidden = true;
    this.host.innerHTML = EMPTY;
  }

  /**
   * Pick at device-pixel coordinates of the preview canvas.
   * @param {number} x
   * @param {number} y
   * @returns {Promise<boolean>} whether something was hit
   */
  async pick(x, y) {
    const res = await this.runtime.pick(x, y);
    if (!res) {
      this.clear();
      return false;
    }
    this.chain = res.chain;
    await this.show(res.chain[0].id);
    return true;
  }

  /** Refresh the selected node at the current time. */
  async refresh() {
    if (this.current) await this.show(this.current, true);
  }

  async show(id, quiet = false) {
    const d = await this.runtime.inspect(id);
    if (!d) {
      if (!quiet) this.clear();
      return;
    }
    this.current = id;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (d.rect) {
      Object.assign(this.outline.style, { left: `${d.rect.x / dpr}px`, top: `${d.rect.y / dpr}px`, width: `${d.rect.w / dpr}px`, height: `${d.rect.h / dpr}px` });
      this.outline.hidden = false;
    } else this.outline.hidden = true;
    const crumbs = (this.chain || [{ id: d.id, type: d.type }]).map((c) => `<button type="button" data-node="${esc(c.id)}" aria-current="${c.id === id}">${esc(c.type)}</button>`).join('<span aria-hidden="true">/</span>');
    const rows = d.props.map((p) => {
      const colorish = typeof p.value === 'string' && /^(#|rgba?\()/.test(p.value);
      const val = p.value == null ? 'null' : Array.isArray(p.value) ? `[${p.value.join(', ')}]` : String(p.value);
      return `<dt>${p.animated ? '<span class="anim-dot" title="Animated"></span>' : ''}${esc(p.key)}</dt><dd title="${esc(val)}">${colorish ? `<span class="swatch-inline" style="background:${esc(val)}"></span>` : ''}${esc(val)}</dd>`;
    }).join('');
    this.host.innerHTML = `<div class="inspector">
      <nav class="crumbs" aria-label="Ancestors">${crumbs}</nav>
      <div class="inspector-head">
        <div class="inspector-type">${esc(d.type)}</div>
        <div class="inspector-id">${esc(d.id)}${d.blockId ? ` · block ${esc(d.blockId)}` : ''}${d.children ? ` · ${d.children} children` : ''}</div>
      </div>
      ${d.source ? `<div class="inspector-source">${esc(d.source)}</div>` : ''}
      <div>
        <h3 class="section-title">Tracked properties</h3>
        <dl class="props">${rows}</dl>
      </div>
      <p class="inspector-note legend"><span class="anim-dot"></span>Animated: the property changes over the timeline.</p>
    </div>`;
  }
}
