/**
 * Audio synthesis for scene tone and click events, rendered offline to PCM
 * so the result is deterministic and frame-aligned. Audio files attached with
 * `scene.sound` are mixed by the exporter.
 * @module export/audio
 */

/**
 * Render synthesized events to a mono Float32Array.
 * @param {Array<Object>} events scene.audio entries of kind 'tone' or 'click'
 * @param {number} duration seconds
 * @param {number} [sampleRate=48000]
 * @returns {Float32Array}
 */
export function synthesize(events, duration, sampleRate = 48000) {
  const n = Math.max(1, Math.ceil(duration * sampleRate));
  const out = new Float32Array(n);
  for (const ev of events) {
    if (ev.kind === 'tone') renderTone(out, ev, sampleRate);
    else if (ev.kind === 'click') renderClick(out, ev, sampleRate);
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i]);
  return out;
}

function renderTone(out, ev, sr) {
  const start = Math.round(ev.time * sr);
  const len = Math.round(ev.duration * sr);
  const attack = Math.min(len / 4, 0.01 * sr);
  const release = Math.min(len / 2, 0.08 * sr);
  let phase = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    if (start + i < 0) continue;
    const u = i / len;
    const f = ev.from * Math.pow(ev.to / ev.from, u);
    phase += (2 * Math.PI * f) / sr;
    let s;
    if (ev.wave === 'square') s = Math.sign(Math.sin(phase)) * 0.6;
    else if (ev.wave === 'triangle') s = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else s = Math.sin(phase);
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > len - release) env = (len - i) / release;
    out[start + i] += s * env * ev.volume;
  }
}

function renderClick(out, ev, sr) {
  const start = Math.round(ev.time * sr);
  const len = Math.round(0.012 * sr);
  for (let i = 0; i < len && start + i < out.length; i++) {
    if (start + i < 0) continue;
    const env = Math.exp(-i / (0.0025 * sr));
    out[start + i] += Math.sin((2 * Math.PI * 2200 * i) / sr) * env * ev.volume;
  }
}

/**
 * Encode mono float samples as a 16-bit PCM WAV file.
 * @param {Float32Array} samples
 * @param {number} [sampleRate=48000]
 * @returns {Uint8Array}
 */
export function encodeWav(samples, sampleRate = 48000) {
  const bytes = 44 + samples.length * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * Whether a scene has any audio to export.
 * @param {import('../core/scene.js').Scene} scene
 * @returns {boolean}
 */
export function hasAudio(scene) {
  return scene.audio.length > 0;
}
