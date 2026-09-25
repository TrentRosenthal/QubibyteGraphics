/**
 * Keyboard shortcut sheet, an inline panel opened with `?`.
 * @module playground/shortcuts
 */

import { icon } from './icons.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = MAC ? '⌘' : 'Ctrl';

const GROUPS = [
  ['Playback', [
    ['Play or pause', ['Space']],
    ['Previous or next frame', ['←', '→']],
    ['Back or forward one second', ['Shift', '←/→']],
    ['Start or end', ['Home', 'End']],
    ['Shuttle back, stop, forward', ['J', 'K', 'L']],
  ]],
  ['Code', [
    ['Run', [MOD, 'Enter']],
    ['Save and update the link', [MOD, 'S']],
    ['Toggle line comment', [MOD, '/']],
    ['Indent or outdent', ['Tab', 'Shift Tab']],
    ['Completions', ['Ctrl', 'Space']],
    ['Move focus out of the editor', ['Esc', 'Tab']],
  ]],
  ['Visual editor', [
    ['Undo or redo', [MOD, 'Z'], [MOD, 'Shift', 'Z']],
    ['Duplicate', [MOD, 'D']],
    ['Group', [MOD, 'G']],
    ['Send backward or forward', [MOD, '[', ']']],
    ['Delete', ['Delete']],
    ['Nudge, or 10x with Shift', ['Arrows']],
    ['Show wires', ['W']],
  ]],
  ['Anywhere', [
    ['This sheet', ['?']],
    ['Close panels', ['Esc']],
  ]],
];

/**
 * Fill the shortcut panel.
 * @param {HTMLElement} panel
 * @param {() => void} onClose
 */
export function mountShortcuts(panel, onClose) {
  const keys = (list) => `<span class="keys">${list.map((k) => `<span class="kbd">${k}</span>`).join('')}</span>`;
  panel.innerHTML = `
    <div class="sheet-head"><h2 id="shortcuts-title">Keyboard shortcuts</h2><button type="button" class="icon-btn sm" data-close aria-label="Close shortcuts">${icon('close')}</button></div>
    <div class="shortcut-groups">${GROUPS.map(([title, rows]) => `
      <section class="shortcut-group"><h3 class="section-title">${title}</h3>
        ${rows.map(([label, ...combos]) => `<div class="shortcut"><span>${label}</span><span class="keys">${combos.map(keys).join('<span class="muted">or</span>')}</span></div>`).join('')}
      </section>`).join('')}</div>`;
  panel.setAttribute('aria-labelledby', 'shortcuts-title');
  panel.querySelector('[data-close]').addEventListener('click', onClose);
}
