/**
 * Node render pipeline: build a scene module, render frames with Canvas2D,
 * and encode them with native FFmpeg. Rendering is split into chunks encoded
 * to lossless FFV1 intermediates; finished chunks are kept in a cache
 * directory so an interrupted render resumes from the last finished chunk.
 * Chunks can render in parallel worker threads.
 */

import '../src/text/setup.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

import { setPlatform } from '../src/core/platform.js';
import { buildScene } from '../src/core/scene.js';
import { sampleFrame } from '../src/core/sampler.js';
import { renderFrame } from '../src/render/canvas.js';
import { renderSVG } from '../src/render/svg.js';
import { getTheme } from '../src/themes/index.js';
import { FORMATS, ffmpegArgs } from '../src/export/formats.js';
import { synthesize, encodeWav } from '../src/export/audio.js';
import { toSRT } from '../src/export/srt.js';
import { PROJECT } from '../src/config.js';

setPlatform({ createCanvas, loadImage: (src) => loadImage(typeof src === 'string' && !/^(https?:|data:)/.test(src) ? readFileSync(src) : src) });

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate an FFmpeg binary: $QGFX_FFMPEG, then `ffmpeg` on PATH.
 * @returns {string}
 */
export function findFFmpeg() {
  const candidates = [process.env.QGFX_FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  throw new Error('FFmpeg not found. Install it (for example `apt install ffmpeg` or `brew install ffmpeg`) or set QGFX_FFMPEG to its path.');
}

/**
 * Import a scene module. It must default-export an async build function and
 * may export `config` ({width, height, fps, theme, seed, board}).
 * @param {string} file
 * @returns {Promise<{build: Function, config: Object, file: string}>}
 */
export async function loadSceneModule(file) {
  const abs = resolve(file);
  const mod = await import(pathToFileURL(abs).href);
  if (typeof mod.default !== 'function') throw new Error(`${file} must export a default async function (scene) => {...}`);
  return { build: mod.default, config: mod.config ?? {}, file: abs };
}

/**
 * Build a scene from a module with option overrides.
 * @param {{build: Function, config: Object}} mod
 * @param {Object} [overrides]
 * @returns {Promise<import('../src/core/scene.js').Scene>}
 */
export async function buildFromModule(mod, overrides = {}) {
  const opts = { ...mod.config, ...stripUndefined(overrides) };
  return buildScene(mod.build, opts);
}

function stripUndefined(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Resolve the theme for a scene, applying a board override.
 * @param {import('../src/core/scene.js').Scene} scene
 * @returns {import('../src/themes/tokens.js').Theme}
 */
export function sceneTheme(scene) {
  const t = getTheme(scene.theme);
  if (!scene.board) return t;
  if (scene.board === 'clean') return { ...t, board: null };
  const boardTheme = getTheme(boardThemeId(scene.board));
  return boardTheme;
}

function boardThemeId(board) {
  return { chalkboard: 'chalkboard', whiteboard: 'whiteboard', paper: 'paper', blueprint: 'board-blueprint' }[board] ?? board;
}

/**
 * Render one frame to a canvas.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {number} n output frame index
 * @param {{transparent?: boolean, theme?: Object, canvas?: any}} [opts]
 * @returns {any} canvas
 */
export function renderFrameCanvas(scene, n, opts = {}) {
  const theme = opts.theme ?? sceneTheme(scene);
  const canvas = opts.canvas ?? createCanvas(scene.width, scene.height);
  const frame = sampleFrame(scene, scene.frameTime(n), theme);
  renderFrame(canvas.getContext('2d'), frame, { transparent: opts.transparent, assets: scene.assets });
  return canvas;
}

/**
 * Render a still at a scene time to PNG, JPEG, WebP, or SVG bytes.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {number} t scene time
 * @param {'png'|'jpeg'|'webp'|'svg'} format
 * @param {{transparent?: boolean}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function renderStill(scene, t, format, opts = {}) {
  const theme = sceneTheme(scene);
  const frame = sampleFrame(scene, t, theme);
  if (format === 'svg') return Buffer.from(renderSVG(frame, { transparent: opts.transparent }));
  const canvas = createCanvas(scene.width, scene.height);
  renderFrame(canvas.getContext('2d'), frame, { transparent: opts.transparent, assets: scene.assets });
  if (format === 'jpeg') return canvas.encode('jpeg', 92);
  if (format === 'webp') return canvas.encode('webp', 92);
  return canvas.encode('png');
}

/**
 * Hash that identifies a render: scene source, options, engine version.
 * @param {string} sceneFile
 * @param {Object} opts
 * @returns {string}
 */
export function renderKey(sceneFile, opts) {
  const h = createHash('sha256');
  h.update(readFileSync(sceneFile));
  h.update(JSON.stringify(opts));
  h.update(PROJECT.version);
  return h.digest('hex').slice(0, 16);
}

/**
 * Encode a range of frames to an FFV1 chunk file.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {number} start
 * @param {number} end exclusive
 * @param {string} out
 * @param {{ffmpeg: string, transparent: boolean, onFrame?: (n: number) => void}} o
 * @returns {Promise<void>}
 */
export async function encodeChunk(scene, start, end, out, o) {
  const W = scene.width;
  const H = scene.height;
  const tmp = out + '.partial.mkv';
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(scene.fps), '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', o.transparent ? 'bgra' : 'bgr0', tmp];
  const proc = spawn(o.ffmpeg, args, { stdio: ['pipe', 'inherit', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => {
    proc.on('error', rej);
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`FFmpeg failed (${code}): ${err.trim()}`))));
  });
  const theme = sceneTheme(scene);
  const canvas = createCanvas(W, H);
  for (let n = start; n < end; n++) {
    renderFrameCanvas(scene, n, { transparent: o.transparent, theme, canvas });
    const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const ok = proc.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    if (!ok) await new Promise((r) => proc.stdin.once('drain', r));
    if (o.onFrame) o.onFrame(n);
  }
  proc.stdin.end();
  await done;
  const { renameSync } = await import('node:fs');
  renameSync(tmp, out);
}

/**
 * @typedef {Object} VideoOptions
 * @property {string} output
 * @property {string} format
 * @property {boolean} [transparent]
 * @property {number} [chunkFrames=240]
 * @property {number} [jobs] parallel workers (default: CPU count, at most 8)
 * @property {string} [cacheDir]
 * @property {boolean} [resume=true]
 * @property {boolean} [subtitles] embed captions as a subtitle track and write a .srt next to the output
 * @property {{colors?: number, dither?: string}} [gif]
 * @property {Object} [overrides] scene option overrides (width, height, fps, theme, board, seed)
 * @property {(done: number, total: number) => void} [onProgress]
 */

/**
 * Render a scene module to a video file.
 * @param {string} sceneFile
 * @param {VideoOptions} o
 * @returns {Promise<{output: string, frames: number, duration: number, chunksReused: number}>}
 */
export async function renderVideo(sceneFile, o) {
  const ffmpeg = findFFmpeg();
  const spec = FORMATS[o.format];
  if (!spec) throw new Error(`Unknown format "${o.format}"`);
  if (o.transparent && !spec.alpha) throw new Error(`${spec.label} cannot carry transparency. Use webm, mov-prores4444, apng, webp, or png-seq.`);
  const mod = await loadSceneModule(sceneFile);
  const scene = await buildFromModule(mod, o.overrides);
  const total = scene.frameCount;
  const key = renderKey(mod.file, { overrides: o.overrides ?? {}, transparent: !!o.transparent });
  const cache = o.cacheDir ?? join(dirname(mod.file), '.qgfx-cache', basename(mod.file, extname(mod.file)) + '-' + key);
  if (o.resume === false) rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });

  if (spec.kind === 'sequence') {
    await renderSequence(scene, o, spec);
    return { output: o.output, frames: total, duration: scene.duration, chunksReused: 0 };
  }

  const chunkFrames = Math.max(1, o.chunkFrames ?? 240);
  const chunks = [];
  for (let s = 0, i = 0; s < total; s += chunkFrames, i++) chunks.push({ i, start: s, end: Math.min(total, s + chunkFrames), file: join(cache, `chunk_${String(s).padStart(7, '0')}_${String(Math.min(total, s + chunkFrames)).padStart(7, '0')}.mkv`) });
  const pending = chunks.filter((c) => !existsSync(c.file) || statSync(c.file).size === 0);
  const reused = chunks.length - pending.length;
  let doneFrames = reused ? chunks.filter((c) => !pending.includes(c)).reduce((a, c) => a + c.end - c.start, 0) : 0;
  if (o.onProgress) o.onProgress(doneFrames, total);

  const jobs = Math.max(1, Math.min(o.jobs ?? Math.min(8, cpus().length), pending.length || 1));
  if (jobs <= 1) {
    for (const c of pending) {
      await encodeChunk(scene, c.start, c.end, c.file, { ffmpeg, transparent: !!o.transparent, onFrame: () => o.onProgress && o.onProgress(++doneFrames, total) });
    }
  } else {
    const queue = pending.slice();
    const runWorker = () =>
      new Promise((res, rej) => {
        const next = () => {
          const c = queue.shift();
          if (!c) {
            w.terminate().then(res, res);
            return;
          }
          w.postMessage({ chunk: c });
        };
        const w = new Worker(join(HERE, 'render-worker.js'), { workerData: { sceneFile: mod.file, overrides: o.overrides ?? {}, transparent: !!o.transparent, ffmpeg } });
        w.on('message', (m) => {
          if (m.type === 'frame') {
            doneFrames++;
            if (o.onProgress) o.onProgress(doneFrames, total);
          } else if (m.type === 'chunk-done') next();
          else if (m.type === 'ready') next();
          else if (m.type === 'error') rej(new Error(m.message));
        });
        w.on('error', rej);
      });
    await Promise.all(Array.from({ length: jobs }, runWorker));
  }

  const list = join(cache, 'chunks.txt');
  writeFileSync(list, chunks.map((c) => `file '${c.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  let audio = null;
  if (scene.audio.length) audio = await mixAudio(scene, cache, ffmpeg);
  let subtitles = null;
  if (o.subtitles && scene.captions.length) {
    subtitles = join(cache, 'captions.srt');
    const srt = toSRT(scene);
    writeFileSync(subtitles, srt);
    writeFileSync(o.output.replace(/\.[^.]+$/, '') + '.srt', srt);
  }
  mkdirSync(dirname(resolve(o.output)), { recursive: true });
  const args = ffmpegArgs({
    format: o.format,
    inputArgs: ['-f', 'concat', '-safe', '0', '-i', list],
    output: o.output,
    fps: scene.fps,
    audio,
    subtitles,
    transparent: !!o.transparent,
    gif: o.gif,
  });
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`FFmpeg final encode failed: ${r.stderr}`);
  return { output: o.output, frames: total, duration: scene.duration, chunksReused: reused };
}

/**
 * Render a frame sequence (png, jpeg, webp, svg) into a directory.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {VideoOptions} o
 * @param {import('../src/export/formats.js').FormatSpec} spec
 */
async function renderSequence(scene, o, spec) {
  const dir = o.output;
  mkdirSync(dir, { recursive: true });
  const total = scene.frameCount;
  const theme = sceneTheme(scene);
  const canvas = createCanvas(scene.width, scene.height);
  const digits = String(total).length;
  for (let n = 0; n < total; n++) {
    const name = join(dir, `frame_${String(n).padStart(Math.max(5, digits), '0')}.${spec.ext}`);
    if (o.resume !== false && existsSync(name)) continue;
    if (spec.ext === 'svg') {
      writeFileSync(name, renderSVG(sampleFrame(scene, scene.frameTime(n), theme), { transparent: o.transparent }));
    } else {
      renderFrameCanvas(scene, n, { transparent: o.transparent && spec.alpha, theme, canvas });
      const fmt = spec.ext === 'jpg' ? 'jpeg' : spec.ext;
      writeFileSync(name, await canvas.encode(fmt, fmt === 'png' ? undefined : 92));
    }
    if (o.onProgress) o.onProgress(n + 1, total);
  }
}

/**
 * Mix synthesized events and attached audio files into one WAV.
 * @param {import('../src/core/scene.js').Scene} scene
 * @param {string} dir
 * @param {string} ffmpeg
 * @returns {Promise<string>} path to the mixed audio
 */
export async function mixAudio(scene, dir, ffmpeg) {
  const synthPath = join(dir, 'synth.wav');
  const synthEvents = scene.audio.filter((a) => a.kind !== 'file').map((a) => ({ ...a, time: scene.sceneToOutputTime(a.time) }));
  writeFileSync(synthPath, encodeWav(synthesize(synthEvents, scene.duration)));
  const files = scene.audio.filter((a) => a.kind === 'file');
  if (!files.length) return synthPath;
  const out = join(dir, 'mix.wav');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', synthPath];
  const filters = ['[0:a]aresample=48000[a0]'];
  files.forEach((f, i) => {
    const src = scene.assets.get(f.source)?.path ?? f.source;
    args.push('-i', src);
    const delay = Math.round(scene.sceneToOutputTime(f.time) * 1000);
    filters.push(`[${i + 1}:a]atrim=start=${f.offset},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${f.volume},aresample=48000[a${i + 1}]`);
  });
  filters.push(`${files.map((_, i) => `[a${i}]`).join('')}[a${files.length}]amix=inputs=${files.length + 1}:normalize=0,atrim=0:${scene.duration}[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', out);
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Audio mix failed: ${r.stderr}`);
  return out;
}

/**
 * Probe a media file with ffprobe (for tests and the `info` command).
 * @param {string} file
 * @returns {{width: number, height: number, frames: number, duration: number, codec: string, pixFmt: string}}
 */
export function probe(file) {
  const ffprobe = findFFmpeg().replace(/ffmpeg$/, 'ffprobe');
  const r = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,codec_name,pix_fmt:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams[0];
  return { width: s.width, height: s.height, frames: Number(s.nb_read_frames), duration: Number(j.format.duration), codec: s.codec_name, pixFmt: s.pix_fmt };
}
