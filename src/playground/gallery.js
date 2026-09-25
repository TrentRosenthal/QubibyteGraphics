/**
 * Gallery: the example scenes from `gallery.json`. Thumbnails come from
 * docs/renders when the gallery renders exist; otherwise a headless runtime
 * renders each example's poster frame in the background, one at a time,
 * once the item scrolls into view.
 * @module playground/gallery
 */

import { esc } from './ui.js';
import { Runtime } from './runtime.js';

const ROOT = new URL('../../', import.meta.url);

/**
 * Render the gallery list.
 * @param {HTMLElement} host
 * @param {{onOpen: (example: any, source: string) => void}} o
 * @returns {Promise<{setCurrent: (file: string|null) => void}>}
 */
export async function mountGallery(host, o) {
  const res = await fetch(new URL('gallery.json', import.meta.url));
  const { examples } = await res.json();
  host.innerHTML = `<div class="gallery" role="list">${examples.map((ex, i) => `
    <button type="button" class="gallery-item" role="listitem" data-i="${i}">
      <span class="gallery-thumb${ex.thumbnail ? '' : ' is-loading'}">${ex.thumbnail ? `<img alt="" loading="lazy" src="${new URL(ex.thumbnail, ROOT).href}">` : ''}</span>
      <span class="gallery-text"><span class="gallery-title">${esc(ex.title)}</span><span class="gallery-summary">${esc(ex.summary)}</span></span>
    </button>`).join('')}</div>`;
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('.gallery-item');
    if (!b) return;
    const ex = examples[Number(b.dataset.i)];
    const src = await (await fetch(new URL(ex.file, ROOT))).text();
    o.onOpen(ex, src);
  });

  const queue = [];
  let thumbs = null;
  let busy = false;
  const next = async () => {
    if (busy || !queue.length) return;
    busy = true;
    const { ex, el } = queue.shift();
    try {
      if (!thumbs) thumbs = new Runtime(null);
      const source = await (await fetch(new URL(ex.file, ROOT))).text();
      const info = await thumbs.load('module', { source, baseURL: new URL(ex.file, ROOT).href }, { width: 640, height: 360, fps: 30 });
      const blob = await thumbs.still({ t: Math.min(info.duration, ex.posterTime ?? info.duration * 0.85), width: 320 });
      el.innerHTML = `<img alt="" src="${URL.createObjectURL(blob)}">`;
    } catch {
      el.textContent = ex.title.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    } finally {
      el.classList.remove('is-loading');
      busy = false;
      next();
    }
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const ex = examples[Number(en.target.closest('.gallery-item').dataset.i)];
      queue.push({ ex, el: en.target });
      next();
    }
  }, { root: host });
  host.querySelectorAll('.gallery-thumb.is-loading').forEach((el) => io.observe(el));

  return {
    setCurrent(file) {
      host.querySelectorAll('.gallery-item').forEach((b) => {
        const ex = examples[Number(b.dataset.i)];
        b.setAttribute('aria-current', String(ex.file === file));
      });
    },
  };
}
