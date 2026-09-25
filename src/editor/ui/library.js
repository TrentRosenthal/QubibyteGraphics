/**
 * Block library: every registered block, grouped by category, searchable.
 * Tiles drag onto the canvas (the block is created at the drop point) or,
 * clicked or activated with Enter, are added at the center of the frame.
 * @module editor/ui/library
 */

import { blockLibrary } from '../blocks.js';
import { icon } from '../../playground/icons.js';
import { esc } from '../../playground/ui.js';

// Quantum first: the editor is built around Qubi programs and their views.
const CATEGORIES = [
  ['quantum', 'Quantum'],
  ['3d', '3D'],
  ['text', 'Text and math'],
  ['shapes', 'Shapes'],
  ['plots', 'Plots'],
  ['data', 'Data'],
  ['board', 'Board'],
  ['media', 'Media'],
];

const G = {
  circle: '<circle cx="8" cy="8" r="5"/>',
  rect: '<rect x="3" y="4.5" width="10" height="7" rx="1"/>',
  polygon: '<path d="M8 2.8 12.5 5.4v5.2L8 13.2 3.5 10.6V5.4z"/>',
  star: '<path d="m8 2.5 1.7 3.6 3.8.4-2.9 2.6.8 3.8L8 11l-3.4 1.9.8-3.8-2.9-2.6 3.8-.4z"/>',
  dot: '<circle cx="8" cy="8" r="2.2" class="fill-part"/>',
  line: '<path d="M3 12.5 13 3.5"/>',
  arrow: '<path d="M3 13 12.5 3.5M7.5 3.5h5v5"/>',
  brace: '<path d="M3 5.5c0 1.5 1 2.5 2.5 2.5H7c.6 0 1 .4 1 1 0-.6.4-1 1-1h1.5C12 8 13 7 13 5.5"/>',
  path: '<path d="M2.5 11c2-6 4-6 5.5-3s3.5 3 5.5-3"/>',
  text: '<path d="M3.5 4h9M8 4v9"/>',
  tex: '<path d="M3 11.5 5 12l3-8.5M8 4h4.5M9.5 9l3 3.5M12.5 9l-3 3.5"/>',
  number: '<path d="M4.5 5.5 6 4v8M9 5a1.8 1.8 0 0 1 3.5.5c0 1.5-3.5 3-3.5 6.5h3.5"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  axes: '<path d="M3 2.5v11h11"/><path d="M4.5 10.5c2-5 4.5-5 6-2s2 1 3-3"/>',
  numberLine: '<path d="M2 8h12M4 6.5v3M8 6.5v3M12 6.5v3"/>',
  complexPlane: '<path d="M2 8h12M8 2v12"/><circle cx="11" cy="5" r="1" class="fill-part"/>',
  polarPlane: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/><path d="M2.5 8h11M8 2.5v11"/>',
  bloch: '<circle cx="8" cy="8" r="5.5"/><ellipse cx="8" cy="8" rx="5.5" ry="1.8"/><path d="M8 8l2.5-3.5"/>',
  dimension: '<path d="M3 5v6M13 5v6M3 8h10M5 6.5 3 8l2 1.5M11 6.5 13 8l-2 1.5"/>',
  qubi: '<path d="M2 5h12M2 11h12"/><rect x="4" y="3" width="3.5" height="4" rx=".6" class="solid"/><circle cx="11" cy="5" r="1" class="fill-part"/><path d="M11 5v6"/><circle cx="11" cy="11" r="1.6"/>',
  amplitudes: '<path d="M3 13V8M6 13V4M9 13V9M12 13V6"/>',
  probabilities: '<path d="M3 13v-3M6 13V5M9 13v-5M12 13v-7M2 13.5h12"/>',
  phaseDisks: '<circle cx="5" cy="8" r="2.5"/><circle cx="11" cy="8" r="2.5"/><path d="M5 8V5.5M11 8l1.8 1.8"/>',
  dirac: '<path d="M4 3v10M11 3l2 5-2 5"/><path d="M6.5 8h2.5"/>',
  matrix: '<path d="M4.5 3H3v10h1.5M11.5 3H13v10h-1.5M6 6h.01M10 6h.01M6 10h.01M10 10h.01"/>',
  density: '<rect x="3" y="3" width="4" height="4" class="solid"/><rect x="9" y="9" width="4" height="4" class="solid"/><rect x="9.5" y="4" width="2" height="2"/><rect x="4" y="9.5" width="2" height="2"/>',
  sweepPlot: '<path d="M2.5 13.5h11M2.5 13.5v-11"/><path d="M3.5 11c3-8 6-8 9 0"/>',
  slider: '<path d="M2.5 8h11"/><circle cx="6" cy="8" r="2" class="fill-part"/>',
  expression: '<path d="M4 12c1 0 1.5-1 2-4s1-4 2-4M4.5 7.5h4M9.5 8.5l3 3.5M12.5 8.5l-3 3.5"/>',
  image: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.25"/><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5 3 3"/>',
  background: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 10.5l4-3 3 2.5 2-1.5 3 2.5"/>',
  video: '<rect x="2" y="4" width="8.5" height="8" rx="1.5"/><path d="m10.5 7 3.5-2v6l-3.5-2"/>',
  audio: '<path d="M6 11.5V4l7-1.5V10"/><circle cx="4.5" cy="11.5" r="1.5"/><circle cx="11.5" cy="10" r="1.5"/>',
};

/**
 * SVG glyph for a block type.
 * @param {string} type
 * @returns {string}
 */
export function blockGlyph(type) {
  return `<svg class="icon lib-glyph" viewBox="0 0 16 16" aria-hidden="true">${G[type] ?? G.rect}</svg>`;
}

/**
 * Mount the library.
 * @param {HTMLElement} host
 * @param {{add: (type: string) => void}} o
 */
export function mountLibrary(host, o) {
  const lib = blockLibrary();
  host.innerHTML = `
    <div class="lib-search"><span class="lib-search-icon">${icon('search')}</span><input class="input" type="search" placeholder="Search blocks" aria-label="Search blocks"></div>
    <div class="lib-body">${CATEGORIES.filter(([k]) => lib[k] && lib[k].length).map(([k, title]) => `
      <section class="lib-group" data-cat="${k}">
        <h3 class="section-title">${title}</h3>
        <div class="lib-tiles">${lib[k].map((d) => `<button type="button" class="lib-tile" draggable="true" data-type="${esc(d.type)}" data-search="${esc(`${d.label} ${d.type} ${title}`.toLowerCase())}" aria-label="Add ${esc(d.label)}">${blockGlyph(d.type)}<span>${esc(d.label)}</span></button>`).join('')}</div>
      </section>`).join('')}
      <p class="lib-empty" hidden>No blocks match.</p>
    </div>`;
  const search = host.querySelector('input');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    host.querySelectorAll('.lib-group').forEach((g) => {
      let n = 0;
      g.querySelectorAll('.lib-tile').forEach((t) => {
        const hit = !q || t.dataset.search.includes(q);
        t.hidden = !hit;
        if (hit) n++;
      });
      g.hidden = n === 0;
      if (n) any = true;
    });
    host.querySelector('.lib-empty').hidden = any;
  });
  host.addEventListener('click', (e) => {
    const t = e.target.closest('.lib-tile');
    if (t) o.add(t.dataset.type);
  });
  host.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.lib-tile');
    if (!t) return;
    e.dataTransfer.setData('application/x-qgfx-block', t.dataset.type);
    e.dataTransfer.setData('text/plain', t.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
}
