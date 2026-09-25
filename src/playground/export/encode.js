/**
 * Browser export, run inside the scene sandbox. The scene is rebuilt at the
 * export size and frame rate, and frame n is sampled at `scene.frameTime(n)`,
 * the same time the preview shows for that frame. Video goes through
 * WebCodecs and our own muxers when the browser has the encoder, and
 * through ffmpeg.wasm otherwise.
 * @module playground/export/encode
 */

/* global AudioEncoder, AudioData */

import { sampleFrame, renderFrame, renderSVG, synthesize, encodeWav } from '../../index.js';
import { createCanvas } from '../../core/platform.js';
import { canvasToBlob } from '../runtime-core.js';
import { MP4Muxer } from './mp4.js';
import { WebMMuxer } from './webm.js';
import { GifEncoder, buildPalette } from './gif.js';
import { encodePNG, assembleAPNG } from './apng.js';

const SAMPLE_RATE = 48000;

const MIME = {
  png: 'image/png', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', 'webm-alpha': 'video/webm', gif: 'image/gif', apng: 'image/apng',
};

const EXT = { png: 'png', svg: 'svg', mp4: 'mp4', webm: 'webm', 'webm-alpha': 'webm', gif: 'gif', apng: 'png' };

function aborted() {
  return Object.assign(new Error('Export cancelled'), { name: 'AbortError' });
}

async function deflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function evenUp(v) {
  const r = Math.max(2, Math.round(v));
  return r % 2 ? r + 1 : r;
}

function avcCodecs(w, h) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const level = mbs <= 3600 ? '1f' : mbs <= 8192 ? '28' : mbs <= 22080 ? '32' : '33';
  return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`];
}

function vp9Codec(w, h) {
  const px = w * h;
  const level = px <= 921600 ? '31' : px <= 2228224 ? '41' : '51';
  return `vp09.00.${level}.08`;
}

function copyChunk(chunk) {
  const b = new Uint8Array(chunk.byteLength);
  chunk.copyTo(b);
  return b;
}

/**
 * Audio for the export: the scene's tone and click events synthesized to
 * mono PCM, with event times mapped to output time.
 * @param {any} scene
 * @param {string[]} notes
 * @returns {Float32Array|null}
 */
function sceneAudio(scene, notes) {
  if (scene.audio.some((e) => e.kind === 'file')) notes.push('Audio files attached with scene.sound() are mixed by the CLI; browser exports include synthesized tones and clicks only.');
  const events = scene.audio.filter((e) => e.kind === 'tone' || e.kind === 'click').map((e) => ({ ...e, time: scene.sceneToOutputTime(e.time) }));
  if (!events.length) return null;
  return synthesize(events, scene.duration, SAMPLE_RATE);
}

async function encodeAudio(samples, codec, muxer, notes) {
  if (typeof AudioEncoder === 'undefined') return false;
  const config = { codec, sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 128000 };
  let ok;
  try {
    ok = (await AudioEncoder.isConfigSupported(config)).supported;
  } catch {
    ok = false;
  }
  if (!ok) return false;
  let failure = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(copyChunk(chunk), { timestamp: chunk.timestamp, duration: chunk.duration ?? 0 }, meta && meta.decoderConfig),
    error: (e) => {
      failure = e;
    },
  });
  enc.configure(config);
  const step = 4800;
  for (let i = 0; i < samples.length; i += step) {
    const n = Math.min(step, samples.length - i);
    const data = new AudioData({ format: 'f32', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data: samples.slice(i, i + n) });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failure) {
    notes.push(`Audio encoding failed (${failure.message}); the video is silent.`);
    return false;
  }
  return true;
}

/**
 * Encode video frames with WebCodecs into our muxers. Returns null when the
 * browser has no encoder for the configuration, so the caller can fall back.
 */
async function webCodecsVideo(ctx) {
  const { format, W, H, fps, N, draw, canvas, core, progress, samples, notes } = ctx;
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const alpha = format === 'webm-alpha';
  const codecs = format === 'mp4' ? avcCodecs(W, H) : [vp9Codec(W, H), 'vp09.00.10.08'];
  let config = null;
  for (const codec of codecs) {
    const c = { codec, width: W, height: H, bitrate: Math.round(Math.min(40e6, W * H * fps * 0.09)), framerate: fps, alpha: alpha ? 'keep' : 'discard', latencyMode: 'quality' };
    if (format === 'mp4') c.avc = { format: 'avc' };
    try {
      if ((await VideoEncoder.isConfigSupported(c)).supported) {
        config = c;
        break;
      }
    } catch {
      config = null;
    }
  }
  if (!config) return null;
  let audioCodec = null;
  if (samples && typeof AudioEncoder !== 'undefined') {
    const codec = format === 'mp4' ? 'mp4a.40.2' : 'opus';
    try {
      if ((await AudioEncoder.isConfigSupported({ codec, sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 128000 })).supported) audioCodec = codec;
    } catch {
      audioCodec = null;
    }
  }
  if (samples && !audioCodec) notes.push(format === 'mp4' ? 'This browser has no AAC encoder, so the MP4 is silent. WebM carries the audio as Opus.' : 'This browser has no Opus encoder, so the video is silent.');
  const audio = audioCodec ? { sampleRate: SAMPLE_RATE, channels: 1 } : null;
  const muxer = format === 'mp4' ? new MP4Muxer({ width: W, height: H, fps, audio }) : new WebMMuxer({ width: W, height: H, fps, codec: 'vp9', alpha, audio });
  let failure = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const info = { timestamp: chunk.timestamp, duration: chunk.duration ?? undefined, key: chunk.type === 'key', alpha: meta && meta.alphaSideData ? new Uint8Array(meta.alphaSideData) : null };
      muxer.addVideoChunk(copyChunk(chunk), info, meta && meta.decoderConfig);
    },
    error: (e) => {
      failure = e;
    },
  });
  enc.configure(config);
  const frameUs = 1e6 / fps;
  for (let n = 0; n < N; n++) {
    if (core.cancelled) {
      enc.close();
      throw aborted();
    }
    if (failure) throw failure;
    draw(n);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(n * frameUs), duration: Math.round(frameUs), alpha: alpha ? 'keep' : 'discard' });
    enc.encode(vf, { keyFrame: n % Math.max(1, Math.round(fps * 2)) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 1));
    progress({ stage: 'Encoding', done: n + 1, total: N });
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  if (audioCodec) await encodeAudio(samples, audioCodec, muxer, notes);
  notes.push(`Encoded with WebCodecs (${config.codec}).`);
  return muxer.finalize();
}

/**
 * Export the loaded scene.
 * @param {import('../runtime-core.js').RuntimeCore} core
 * @param {{format: string, width: number, height: number, fps: number, transparent?: boolean, t?: number, gif?: {colors?: number, dither?: boolean}}} o
 * @param {(p: {stage: string, done: number, total: number}) => void} progress
 * @returns {Promise<{blob: Blob, ext: string, notes: string[], frames: number, width: number, height: number, encoder: string}>}
 */
export async function exportScene(core, o, progress) {
  const format = o.format;
  if (!MIME[format]) throw new Error(`Unknown export format "${format}"`);
  const video = format === 'mp4' || format === 'webm' || format === 'webm-alpha';
  const W = video ? evenUp(o.width) : Math.max(1, Math.round(o.width));
  const H = video ? evenUp(o.height) : Math.max(1, Math.round(o.height));
  const fps = o.fps;
  progress({ stage: 'Building the scene', done: 0, total: 1 });
  const { scene } = await core.buildWith({ width: W, height: H, fps });
  if (core.source.kind !== 'document') {
    for (const [i, v] of Object.entries(core.controlOverrides)) {
      const c = scene.controls[Number(i)];
      if (c && c.tracker) {
        c.tracker._tracks.delete('value');
        c.tracker._init.value = v;
      }
    }
  }
  const theme = core.themeFor(scene);
  const transparent = format === 'webm-alpha' || (!!o.transparent && (format === 'png' || format === 'svg' || format === 'apng'));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: format === 'gif' || format === 'apng' });
  const draw = (n) => renderFrame(ctx, sampleFrame(scene, scene.frameTime(n), theme), { transparent, assets: scene.assets });
  const notes = [];
  const N = scene.frameCount;
  const result = (bytes, frames, encoder) => ({ blob: bytes instanceof Blob ? bytes : new Blob([bytes], { type: MIME[format] }), ext: EXT[format], notes, frames, width: W, height: H, encoder });

  if (format === 'png' || format === 'svg') {
    const n = Math.max(0, Math.min(N - 1, Math.round((o.t ?? 0) * fps)));
    if (format === 'svg') {
      const svg = renderSVG(sampleFrame(scene, scene.frameTime(n), theme), { transparent, assets: scene.assets });
      return result(new Blob([svg], { type: MIME.svg }), 1, 'renderSVG');
    }
    draw(n);
    return result(await canvasToBlob(canvas, 'image/png'), 1, 'canvas');
  }

  if (format === 'gif') {
    const colors = Math.max(2, Math.min(256, o.gif?.colors ?? 256));
    const picks = Math.min(N, 24);
    const samples = [];
    for (let k = 0; k < picks; k++) {
      const n = Math.round((k * (N - 1)) / Math.max(1, picks - 1));
      draw(n);
      samples.push(ctx.getImageData(0, 0, W, H).data);
      progress({ stage: 'Building the palette', done: k + 1, total: picks });
    }
    const gif = new GifEncoder({ width: W, height: H, fps, palette: buildPalette(samples, colors), dither: o.gif?.dither ?? true });
    samples.length = 0;
    for (let n = 0; n < N; n++) {
      if (core.cancelled) throw aborted();
      draw(n);
      gif.addFrame(ctx.getImageData(0, 0, W, H).data);
      progress({ stage: 'Encoding', done: n + 1, total: N });
      if (n % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    return result(gif.finish(), N, 'GIF encoder');
  }

  if (format === 'apng') {
    const pngs = [];
    for (let n = 0; n < N; n++) {
      if (core.cancelled) throw aborted();
      draw(n);
      pngs.push(await encodePNG(ctx.getImageData(0, 0, W, H).data, W, H, deflateZlib));
      progress({ stage: 'Encoding', done: n + 1, total: N });
    }
    return result(assembleAPNG(pngs, { fps }), N, 'APNG assembler');
  }

  const samples = sceneAudio(scene, notes);
  const bytes = await webCodecsVideo({ format, W, H, fps, N, draw, canvas, core, progress, samples, notes });
  if (bytes) return result(bytes, N, 'WebCodecs');

  const why = format === 'mp4' ? 'This browser has no WebCodecs H.264 encoder, so ffmpeg.wasm encoded the file with x264.' : format === 'webm-alpha' ? 'This browser cannot encode VP9 with alpha in WebCodecs, so ffmpeg.wasm encoded VP8 with alpha.' : 'This browser has no WebCodecs VP9 encoder, so ffmpeg.wasm encoded VP8.';
  notes.push(why);
  const { encodeWithFFmpeg } = await import('./ffmpeg.js');
  const out = await encodeWithFFmpeg({
    format,
    fps,
    frameCount: N,
    wav: samples ? encodeWav(samples, SAMPLE_RATE) : null,
    frame: async (n) => {
      draw(n);
      return new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    },
    onProgress: progress,
    cancelled: () => core.cancelled,
  });
  return result(out, N, 'ffmpeg.wasm');
}
