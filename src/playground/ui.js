/**
 * Small DOM helpers shared by the playground and the visual editor.
 * @module playground/ui
 */

/**
 * Escape text for HTML templates.
 * @param {any} s
 * @returns {string}
 */
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * Show a short message at the bottom of the window.
 * @param {string} text
 */
export function toast(text) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

/**
 * Read JSON from localStorage, tolerating blocked storage.
 * @param {string} key
 * @param {any} fallback
 * @returns {any}
 */
export function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write JSON to localStorage; returns false when storage is blocked.
 * @param {string} key
 * @param {any} value
 * @returns {boolean}
 */
export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger a file download.
 * @param {Blob} blob
 * @param {string} name
 */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

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
