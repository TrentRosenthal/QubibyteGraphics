/**
 * SubRip subtitles from scene captions (and optionally timeline labels).
 * Times are converted from scene time to output time so speed changes and
 * holds are respected.
 * @module export/srt
 */

/**
 * Format seconds as an SRT timestamp HH:MM:SS,mmm.
 * @param {number} s
 * @returns {string}
 */
export function srtTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(sec, 2)},${p(r, 3)}`;
}

/**
 * Build an SRT document for a scene.
 * @param {import('../core/scene.js').Scene} scene
 * @param {{labels?: boolean, labelDuration?: number}} [opts] include timeline labels as cues
 * @returns {string}
 */
export function toSRT(scene, opts = {}) {
  const cues = scene.captions.map((c) => ({ start: scene.sceneToOutputTime(c.start), end: scene.sceneToOutputTime(c.end), text: c.text }));
  if (opts.labels) {
    for (const [name, t] of scene.labels) {
      const start = scene.sceneToOutputTime(t);
      cues.push({ start, end: start + (opts.labelDuration ?? 2), text: name });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}
