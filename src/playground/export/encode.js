/**
 * Browser export, run inside the scene sandbox. The scene is rebuilt at the
 * export size and frame rate, and frame n is sampled at `scene.frameTime(n)`,
 * the same time the preview shows for that frame. Video is encoded with
 * WebCodecs and muxed with mp4-muxer and webm-muxer; a transparent WebM
 * carries its alpha as a second VP9 or VP8 stream in BlockAdditions, which
 * our own WebM muxer writes.
 * @module playground/export/encode
 */

import { sampleFrame, renderFrame, renderSVG } from '../../index.js';
import { createCanvas } from '../../core/platform.js';
import { canvasToBlob } from '../runtime-core.js';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from '../../../vendor/mp4-muxer/mp4-muxer.mjs';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from '../../../vendor/webm-muxer/webm-muxer.mjs';
import { WebMMuxer as AlphaWebMMuxer } from './webm.js';
import { GifEncoder, buildPalette } from './gif.js';
import { encodePNG, assembleAPNG } from './apng.js';

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

function av1Codec(w, h) {
  const px = w * h;
  const level = px <= 2359296 ? '08' : px <= 8912896 ? '12' : '16';
  return `av01.0.${level}M.08`;
}

/**
 * Video codecs to try for a format, best first. `mux` is the codec name the
 * container writer uses.
 * @param {string} format
 * @param {number} W
 * @param {number} H
 * @returns {Array<{codec: string, mux: string, name: string}>}
 */
export function videoCandidates(format, W, H) {
  if (format === 'mp4') {
    return [
      ...avcCodecs(W, H).map((codec) => ({ codec, mux: 'avc', name: 'H.264' })),
      { codec: av1Codec(W, H), mux: 'av1', name: 'AV1' },
      { codec: vp9Codec(W, H), mux: 'vp9', name: 'VP9' },
    ];
  }
  const vp = [{ codec: vp9Codec(W, H), mux: 'vp9', name: 'VP9' }, { codec: 'vp09.00.10.08', mux: 'vp9', name: 'VP9' }, { codec: 'vp8', mux: 'vp8', name: 'VP8' }];
  return format === 'webm-alpha' ? vp : [...vp, { codec: av1Codec(W, H), mux: 'av1', name: 'AV1' }];
}

function copyChunk(chunk) {
  const b = new Uint8Array(chunk.byteLength);
  chunk.copyTo(b);
  return b;
}

async function supported(Encoder, config) {
  try {
    return (await Encoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

/**
 * Browser exports are silent: audio blocks play files, which the CLI mixes.
 * @param {any} scene
 * @param {string[]} notes
 */
function noteAudio(scene, notes) {
  if (scene.audio.length) notes.push('Audio is mixed by the qgfx CLI; browser exports are silent.');
}

function videoConfig(c, W, H, fps, alpha) {
  const config = { codec: c.codec, width: W, height: H, bitrate: Math.round(Math.min(40e6, W * H * fps * 0.09)), framerate: fps, alpha: alpha ? 'keep' : 'discard', latencyMode: 'quality' };
  if (c.mux === 'avc') config.avc = { format: 'avc' };
  return config;
}

/** The first candidate the browser's VideoEncoder accepts, with its config. */
async function pickVideo(format, W, H, fps, alpha) {
  for (const c of videoCandidates(format, W, H)) {
    const config = videoConfig(c, W, H, fps, alpha);
    if (await supported(VideoEncoder, config)) return { ...c, config };
  }
  return null;
}

/**
 * Run a VideoEncoder over every frame. `frame(n, timestamp)` returns the
 * VideoFrame for frame n (or an array of frames, one per encoder).
 */
async function encodeFrames({ encoders, N, fps, frame, core, progress }) {
  const frameUs = 1e6 / fps;
  const keyEvery = Math.max(1, Math.round(fps * 2));
  for (let n = 0; n < N; n++) {
    if (core.cancelled) {
      for (const e of encoders) e.enc.close();
      throw aborted();
    }
    for (const e of encoders) if (e.failure) throw e.failure;
    const frames = [].concat(frame(n, Math.round(n * frameUs), Math.round(frameUs)));
    frames.forEach((vf, i) => {
      encoders[i].enc.encode(vf, { keyFrame: n % keyEvery === 0 });
      vf.close();
    });
    while (encoders.some((e) => e.enc.encodeQueueSize > 3)) await new Promise((r) => setTimeout(r, 1));
    progress({ stage: 'Encoding', done: n + 1, total: N });
  }
  for (const e of encoders) {
    await e.enc.flush();
    e.enc.close();
    if (e.failure) throw e.failure;
  }
}

function makeEncoder(config, output) {
  const e = { enc: null, failure: null };
  e.enc = new VideoEncoder({ output, error: (err) => { e.failure = err; } });
  e.enc.configure(config);
  return e;
}

/** MP4 or opaque WebM through mp4-muxer or webm-muxer. */
async function muxedVideo(ctx) {
  const { format, W, H, fps, N, draw, canvas, core, progress, notes } = ctx;
  const video = await pickVideo(format, W, H, fps, false);
  if (!video) throw new Error(`This browser cannot encode ${format === 'mp4' ? 'MP4 (H.264, AV1, or VP9)' : 'WebM (VP9, VP8, or AV1)'} video with WebCodecs. Try PNG, GIF, or APNG, or render with the qgfx CLI.`);
  if (format === 'mp4' && video.mux !== 'avc') notes.push(`This browser has no H.264 encoder, so the MP4 uses ${video.name}. It plays in current browsers and VLC; older players may need H.264 from the qgfx CLI.`);
  const muxer = format === 'mp4'
    ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: video.mux, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' })
    : new WebmMuxer({ target: new WebmTarget(), video: { codec: `V_${video.mux.toUpperCase()}`, width: W, height: H, frameRate: fps } });
  const enc = makeEncoder(video.config, (chunk, meta) => muxer.addVideoChunk(chunk, meta));
  await encodeFrames({
    encoders: [enc], N, fps, core, progress,
    frame: (n, timestamp, duration) => {
      draw(n);
      return new VideoFrame(canvas, { timestamp, duration, alpha: 'discard' });
    },
  });
  muxer.finalize();
  notes.push(`Encoded with WebCodecs (${video.config.codec}).`);
  return new Uint8Array(muxer.target.buffer);
}

/**
 * Transparent WebM. When the encoder keeps alpha itself its side data is
 * used; otherwise the alpha channel is encoded as a second stream whose
 * luma plane is the alpha, the layout libvpx and browsers decode.
 */
async function alphaVideo(ctx) {
  const { W, H, fps, N, draw, ctx2d, core, progress, notes } = ctx;
  let video = await pickVideo('webm-alpha', W, H, fps, true);
  const native = !!video;
  if (!video) video = await pickVideo('webm-alpha', W, H, fps, false);
  if (!video) throw new Error('This browser cannot encode VP9 or VP8 with WebCodecs, so it cannot export a transparent WebM. Try PNG or APNG, or render with the qgfx CLI.');
  const muxer = new AlphaWebMMuxer({ width: W, height: H, fps, codec: video.mux, alpha: true });
  const color = [];
  const alphaByTime = new Map();
  const encoders = [makeEncoder(video.config, (chunk, meta) => color.push({ chunk: copyChunk(chunk), timestamp: chunk.timestamp, key: chunk.type === 'key', side: meta && meta.alphaSideData ? new Uint8Array(meta.alphaSideData) : null, config: meta && meta.decoderConfig }))];
  if (!native) encoders.push(makeEncoder({ ...video.config, alpha: 'discard' }, (chunk) => alphaByTime.set(chunk.timestamp, copyChunk(chunk))));
  const ySize = W * H;
  const cSize = (W / 2) * (H / 2);
  await encodeFrames({
    encoders, N, fps, core, progress,
    frame: (n, timestamp, duration) => {
      draw(n);
      const rgba = ctx2d.getImageData(0, 0, W, H).data;
      if (native) return new VideoFrame(rgba, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp, duration });
      const planes = new Uint8Array(ySize + 2 * cSize);
      for (let i = 0; i < ySize; i++) planes[i] = rgba[i * 4 + 3];
      planes.fill(128, ySize);
      return [
        new VideoFrame(rgba, { format: 'RGBX', codedWidth: W, codedHeight: H, timestamp, duration }),
        new VideoFrame(planes, { format: 'I420', codedWidth: W, codedHeight: H, timestamp, duration, colorSpace: { fullRange: true, matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' } }),
      ];
    },
  });
  for (const c of color) muxer.addVideoChunk(c.chunk, { timestamp: c.timestamp, key: c.key, alpha: native ? c.side : alphaByTime.get(c.timestamp) ?? null }, c.config);
  notes.push(`Encoded with WebCodecs (${video.config.codec}), alpha ${native ? 'from the encoder' : 'as a second stream'}.`);
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
  const ctx = canvas.getContext('2d', { willReadFrequently: format === 'gif' || format === 'apng' || format === 'webm-alpha' });
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

  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('This browser has no WebCodecs video encoder. Export PNG, GIF, or APNG here, or render video with the qgfx CLI.');
  }
  noteAudio(scene, notes);
  const job = { format, W, H, fps, N, draw, canvas, ctx2d: ctx, core, progress, notes };
  const bytes = format === 'webm-alpha' ? await alphaVideo(job) : await muxedVideo(job);
  return result(bytes, N, 'WebCodecs');
}
