/**
 * Lazy ffmpeg.wasm for formats WebCodecs cannot produce in this browser
 * (H.264 without a platform encoder, VP9 with alpha). The vendored
 * `@ffmpeg/ffmpeg` and `@ffmpeg/core` (GPL-2.0-or-later) load only when an
 * export needs them, never with the playground.
 * @module playground/export/ffmpeg
 */

const VENDOR = new URL('../../../vendor/ffmpeg/', import.meta.url);

let loading = null;

/**
 * Load ffmpeg.wasm once.
 * @returns {Promise<any>} an FFmpeg instance
 */
function loadFFmpeg() {
  if (!loading) {
    loading = (async () => {
      const { FFmpeg } = await import(new URL('ffmpeg/index.js', VENDOR).href);
      const ff = new FFmpeg();
      await ff.load({ coreURL: new URL('core/ffmpeg-core.js', VENDOR).href, wasmURL: new URL('core/ffmpeg-core.wasm', VENDOR).href });
      return ff;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

const ARGS = {
  mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-movflags', '+faststart'],
  // The VP9 encoder in @ffmpeg/core 0.12.10 faults (memory access out of
  // bounds) from 640x360 up, so the wasm fallback writes VP8, which WebM
  // players decode with and without alpha.
  webm: ['-c:v', 'libvpx', '-b:v', '8M', '-crf', '10', '-quality', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'],
  'webm-alpha': ['-c:v', 'libvpx', '-b:v', '8M', '-crf', '10', '-quality', 'good', '-cpu-used', '4', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0'],
};

const AUDIO_ARGS = {
  mp4: ['-c:a', 'aac', '-b:a', '160k'],
  webm: ['-c:a', 'libopus', '-b:a', '128k'],
  'webm-alpha': ['-c:a', 'libopus', '-b:a', '128k'],
};

/**
 * Encode a PNG frame sequence (and optional WAV audio) with ffmpeg.wasm.
 * @param {{format: 'mp4'|'webm'|'webm-alpha', fps: number, frameCount: number,
 *   frame: (n: number) => Promise<Uint8Array>, wav?: Uint8Array|null,
 *   onProgress: (p: {stage: string, done: number, total: number}) => void, cancelled: () => boolean}} o
 * @returns {Promise<Uint8Array>}
 */
export async function encodeWithFFmpeg(o) {
  o.onProgress({ stage: 'Loading ffmpeg.wasm', done: 0, total: o.frameCount });
  const ff = await loadFFmpeg();
  const names = [];
  const cleanup = async () => {
    for (const n of names) await ff.deleteFile(n).catch(() => {});
  };
  try {
    for (let n = 0; n < o.frameCount; n++) {
      if (o.cancelled()) throw Object.assign(new Error('Export cancelled'), { name: 'AbortError' });
      const name = `f${String(n).padStart(6, '0')}.png`;
      await ff.writeFile(name, await o.frame(n));
      names.push(name);
      o.onProgress({ stage: 'Rendering', done: n + 1, total: o.frameCount });
    }
    const ext = o.format === 'mp4' ? 'mp4' : 'webm';
    const out = `out.${ext}`;
    const args = ['-framerate', String(o.fps), '-i', 'f%06d.png'];
    if (o.wav) {
      await ff.writeFile('audio.wav', o.wav);
      names.push('audio.wav');
      args.push('-i', 'audio.wav');
    }
    args.push(...ARGS[o.format]);
    if (o.wav) args.push(...AUDIO_ARGS[o.format], '-shortest');
    args.push('-r', String(o.fps), out);
    const onProgress = ({ progress }) => o.onProgress({ stage: 'Encoding', done: Math.round(Math.max(0, Math.min(1, progress)) * o.frameCount), total: o.frameCount });
    const log = [];
    const onLog = ({ message }) => {
      log.push(message);
      if (log.length > 40) log.shift();
    };
    ff.on('progress', onProgress);
    ff.on('log', onLog);
    let code;
    try {
      code = await ff.exec(args);
    } finally {
      ff.off('progress', onProgress);
      ff.off('log', onLog);
    }
    if (code !== 0) {
      const why = log.filter((l) => /error|invalid|failed|not found/i.test(l)).slice(-2).join(' ');
      throw new Error(`ffmpeg.wasm exited with code ${code}${why ? `: ${why}` : ''}`);
    }
    names.push(out);
    return await ff.readFile(out);
  } finally {
    await cleanup();
  }
}
