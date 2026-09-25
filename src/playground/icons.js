/**
 * Interface icons: 16 px line drawings on a 16 unit grid, stroked with the
 * current text color. Returned as SVG markup for templates.
 * @module playground/icons
 */

const PATHS = {
  play: '<path class="fill" d="M5 3.5v9l7.5-4.5z"/>',
  pause: '<path class="fill" d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z"/>',
  stepBack: '<path d="M11 4 6.5 8 11 12M4.5 4v8"/>',
  stepForward: '<path d="M5 4 9.5 8 5 12M11.5 4v8"/>',
  skipStart: '<path d="M12 4 7.5 8 12 12M8 4 3.5 8 8 12"/>',
  skipEnd: '<path d="M4 4 8.5 8 4 12M8 4l4.5 4L8 12"/>',
  loop: '<path d="M3 7.5V7a3 3 0 0 1 3-3h6.5M10.5 2l2 2-2 2M13 8.5V9a3 3 0 0 1-3 3H3.5M5.5 14l-2-2 2-2"/>',
  link: '<path d="M6.8 9.2a2.5 2.5 0 0 0 3.5 0l2.3-2.3a2.5 2.5 0 0 0-3.5-3.5l-.8.8M9.2 6.8a2.5 2.5 0 0 0-3.5 0L3.4 9.1a2.5 2.5 0 0 0 3.5 3.5l.8-.8"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  sun: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
  moon: '<path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z"/>',
  keyboard: '<rect x="1.75" y="4" width="12.5" height="8" rx="1.5"/><path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M5 9.5h6"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>',
  chevronDown: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  chevronRight: '<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>',
  run: '<path class="fill" d="M5 3.5v9l7.5-4.5z"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  wires: '<circle cx="3.5" cy="4.5" r="1.5"/><circle cx="12.5" cy="11.5" r="1.5"/><path d="M5 4.5h2.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 1.5 1.5H11"/>',
  grid: '<path d="M2.5 5.5h11M2.5 10.5h11M5.5 2.5v11M10.5 2.5v11"/>',
  magnet: '<path d="M4 2.5v5a4 4 0 0 0 8 0v-5M4 5h2.5M9.5 5H12M6.5 2.5v5a1.5 1.5 0 0 0 3 0v-5"/>',
  undo: '<path d="M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7"/>',
  redo: '<path d="M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  duplicate: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  group: '<rect x="2" y="2" width="12" height="12" rx="2" stroke-dasharray="2 2"/><rect x="4.5" y="4.5" width="4" height="4" rx="1"/><rect x="8.5" y="8.5" width="3" height="3" rx="1"/>',
  image: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.25"/><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5 3 3"/>',
  upload: '<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/>',
  palette: '<path d="M8 2a6 6 0 1 0 0 12c1 0 1.5-.6 1.5-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.4-1.2H12a2 2 0 0 0 2-2C14 4.6 11.3 2 8 2z"/><circle cx="5" cy="7" r=".75"/><circle cx="7.5" cy="4.75" r=".75"/><circle cx="10.5" cy="5" r=".75"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  fit: '<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>',
  diamond: '<path class="fill" d="M8 3 13 8 8 13 3 8z"/>',
  file: '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>',
  audio: '<path d="M6 11.5V4l7-1.5V10"/><circle cx="4.5" cy="11.5" r="1.5"/><circle cx="11.5" cy="10" r="1.5"/>',
  video: '<rect x="2" y="4" width="8.5" height="8" rx="1.5"/><path d="m10.5 7 3.5-2v6l-3.5-2"/>',
  font: '<path d="M3 13 7 3h2l4 10M4.5 9.5h7"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  alignLeft: '<path d="M2.5 2.5v11M5 5h8M5 10.5h5"/>',
  layers: '<path d="m8 2.5 6 3-6 3-6-3z"/><path d="m2 8.5 6 3 6-3"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
};

/**
 * SVG markup for an icon.
 * @param {keyof typeof PATHS} name
 * @param {string} [cls] extra classes
 * @returns {string}
 */
export function icon(name, cls = '') {
  const body = PATHS[name];
  if (!body) throw new Error(`Unknown icon "${name}"`);
  return `<svg class="icon ${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body.replace(/class="fill"/g, 'class="fill-part"')}</svg>`;
}
