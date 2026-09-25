/**
 * Assets panel: images (PNG, JPEG, WebP, SVG, GIF), audio, video, and fonts
 * dropped here or on the canvas become document assets stored as data URLs.
 * Images can be placed as image blocks or used as the background, with a
 * theme treatment (none, tint, duotone, desaturate).
 * @module editor/ui/assets-panel
 */

import { icon } from '../../playground/icons.js';
import { esc } from '../../playground/ui.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif,audio/*,video/*,.ttf,.otf,.woff,.woff2,font/*';
const TREATMENTS = ['none', 'tint', 'duotone', 'desaturate'];

/**
 * Asset kind for a file.
 * @param {{type: string, name: string}} file
 * @returns {'image'|'svg'|'audio'|'video'|'font'|null}
 */
export function assetKind(file) {
  const t = file.type || '';
  if (t === 'image/svg+xml' || /\.svg$/i.test(file.name)) return 'svg';
  if (/^image\/(png|jpeg|webp|gif)$/.test(t) || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('font/') || /\.(ttf|otf|woff2?)$/i.test(file.name)) return 'font';
  return null;
}

function fmtBytes(n) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The assets panel. */
export class AssetsPanel {
  /**
   * @param {HTMLElement} host
   * @param {import('./editor-app.js').VisualEditor} ed
   */
  constructor(host, ed) {
    this.host = host;
    this.ed = ed;
    this.treatment = 'none';
  }

  render() {
    const assets = Object.entries(this.ed.doc.assets || {});
    this.host.innerHTML = `<div class="ap">
      <label class="ap-drop" data-drop>
        ${icon('upload')}
        <span class="ap-drop-title">Drop files or browse</span>
        <span class="ap-drop-sub">PNG, JPEG, WebP, SVG, GIF, audio, video, fonts</span>
        <input type="file" multiple accept="${ACCEPT}" hidden data-file>
      </label>
      <div class="ap-treat"><span class="bf-label">Image treatment</span><div class="seg sm" role="group" aria-label="Image treatment">${TREATMENTS.map((t) => `<button type="button" data-treat="${t}" aria-pressed="${t === this.treatment}">${t}</button>`).join('')}</div></div>
      <ul class="ap-list">${assets.map(([id, a]) => `
        <li class="ap-item">
          <span class="ap-thumb">${a.kind === 'image' || a.kind === 'svg' ? `<img alt="" src="${esc(a.data)}">` : icon(a.kind === 'audio' ? 'audio' : a.kind === 'video' ? 'video' : a.kind === 'font' ? 'font' : 'file')}</span>
          <span class="ap-meta"><span class="ap-name">${esc(a.name || id)}</span><span class="ap-sub">${esc(a.kind)} · ${fmtBytes(Math.round((a.data || '').length * 0.75))}</span></span>
          <span class="ap-actions">
            ${a.kind === 'image' || a.kind === 'svg' ? `<button type="button" class="btn sm ghost" data-place="${esc(id)}">Place</button><button type="button" class="btn sm ghost" data-bg="${esc(id)}">Use as background</button>` : ''}
            ${a.kind === 'audio' || a.kind === 'video' ? `<button type="button" class="btn sm ghost" data-place="${esc(id)}">Place</button>` : ''}
            <button type="button" class="icon-btn sm" data-remove="${esc(id)}" aria-label="Remove ${esc(a.name || id)}">${icon('trash')}</button>
          </span>
        </li>`).join('')}</ul>
      ${assets.length ? '' : '<p class="ap-note">Files live inside the scene document, so a shared link or an exported document carries them.</p>'}
    </div>`;
    const h = this.host;
    const input = h.querySelector('[data-file]');
    input.addEventListener('change', () => {
      if (input.files.length) this.ed.importFiles([...input.files], null);
    });
    const drop = h.querySelector('[data-drop]');
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      if (e.dataTransfer.files.length) this.ed.importFiles([...e.dataTransfer.files], null, { place: false });
    });
    h.querySelectorAll('[data-treat]').forEach((b) => b.addEventListener('click', () => {
      this.treatment = b.dataset.treat;
      this.render();
    }));
    h.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => this.ed.placeAsset(b.dataset.place, null, this.treatment)));
    h.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => this.ed.useAsBackground(b.dataset.bg, this.treatment === 'none' ? 'duotone' : this.treatment)));
    h.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => this.ed.removeAsset(b.dataset.remove)));
  }
}
