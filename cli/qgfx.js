#!/usr/bin/env node
/**
 * qgfx: headless rendering and export.
 *
 *   qgfx render scene.js -o out.mp4 [--res 1080p] [--fps 60] [--theme id] [--board chalkboard]
 *   qgfx still scene.js -o frame.png [--time 2.5]
 *   qgfx info scene.js
 *   qgfx formats | qgfx themes | qgfx presets
 */

import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROJECT } from '../src/config.js';
import { FORMATS, PRESETS, formatFromFilename, parseResolution, checkFps } from '../src/export/formats.js';
import { listThemes } from '../src/themes/index.js';
import { renderVideo, loadSceneModule, buildFromModule, renderStill, probe } from './render.js';
import { exportScene } from './export.js';

const HELP = `${PROJECT.cli} ${PROJECT.version}: render ${PROJECT.name} scenes

Commands
  render <scene.js> -o <out>     Render video, frame sequence, or animated vector output
  still <scene.js> -o <out>      Render one frame (png, jpg, webp, svg, pdf)
                                 Animated vector: -f svg-animated or -f lottie
  info <scene.js>                Print duration, frame count, labels, and captions
  probe <video>                  Print resolution, frame count, and codec of a file
  formats | themes | presets     List what is available

Options
  -o, --output <path>            Output file (or directory for sequences)
  -f, --format <id>              Output format (inferred from the extension otherwise)
  --res <name|WxH>               240p to 8k, or 1920x1080
  --aspect <w:h>                 Aspect ratio applied to --res, for example 9:16
  --preset <name>                youtube, shorts, twitter, linkedin, slides, ...
  --fps <n>                      1 to 240
  --theme <id>                   Theme id
  --board <style>                clean, chalkboard, whiteboard, paper, blueprint
  --seed <n>                     Scene seed
  --transparent                  Keep the background transparent (alpha formats)
  --time <seconds>               Scene time for 'still' (default: the last frame)
  --jobs <n>                     Parallel render workers
  --chunk <frames>               Frames per resumable chunk (default 240)
  --fresh                        Ignore cached chunks and render from scratch
  --subtitles                    Write captions as SRT and embed them when the container allows
  --gif-colors <n>               GIF palette size (default 256)
  --gif-dither <mode>            GIF dithering: sierra2_4a, floyd_steinberg, bayer, none
`;

function fail(msg) {
  console.error(`${PROJECT.cli}: ${msg}`);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      res: { type: 'string' },
      aspect: { type: 'string' },
      preset: { type: 'string' },
      fps: { type: 'string' },
      theme: { type: 'string' },
      board: { type: 'string' },
      seed: { type: 'string' },
      transparent: { type: 'boolean' },
      time: { type: 'string' },
      jobs: { type: 'string' },
      chunk: { type: 'string' },
      fresh: { type: 'boolean' },
      subtitles: { type: 'boolean' },
      'gif-colors': { type: 'string' },
      'gif-dither': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.version) return console.log(PROJECT.version);
  const [cmd, target] = positionals;
  if (!cmd || values.help) return console.log(HELP);

  if (cmd === 'formats') {
    for (const f of Object.values(FORMATS)) console.log(`${f.id.padEnd(16)} ${f.label}${f.alpha ? ' (alpha)' : ''}`);
    return;
  }
  if (cmd === 'themes') {
    for (const t of listThemes()) console.log(`${t.id.padEnd(20)} ${t.name}${t.board ? ` (board: ${t.board})` : ''}`);
    return;
  }
  if (cmd === 'presets') {
    for (const [k, p] of Object.entries(PRESETS)) console.log(`${k.padEnd(20)} ${p.width}x${p.height} @ ${p.fps} fps, ${p.format}: ${p.label}`);
    return;
  }
  if (cmd === 'probe') {
    if (!target) fail('probe needs a file');
    return console.log(JSON.stringify(probe(target), null, 2));
  }
  if (!target) fail(`${cmd} needs a scene file`);

  const overrides = {};
  let format = values.format;
  if (values.preset) {
    const p = PRESETS[values.preset];
    if (!p) fail(`Unknown preset "${values.preset}". Run \`${PROJECT.cli} presets\`.`);
    overrides.width = p.width;
    overrides.height = p.height;
    overrides.fps = p.fps;
    format = format ?? p.format;
  }
  if (values.res || values.aspect) {
    const [w, h] = parseResolution(values.res ?? '1080p', values.aspect);
    overrides.width = w;
    overrides.height = h;
  }
  if (values.fps) overrides.fps = checkFps(values.fps);
  if (values.theme) overrides.theme = values.theme;
  if (values.board) overrides.board = values.board;
  if (values.seed) overrides.seed = Number.isNaN(Number(values.seed)) ? values.seed : Number(values.seed);

  if (cmd === 'info') {
    const mod = await loadSceneModule(target);
    const scene = await buildFromModule(mod, overrides);
    console.log(JSON.stringify({
      width: scene.width,
      height: scene.height,
      fps: scene.fps,
      duration: +scene.duration.toFixed(4),
      frames: scene.frameCount,
      labels: Object.fromEntries(scene.labels),
      captions: scene.captions,
      pauses: scene.pauses,
      nodes: scene.root.family().length - 1,
    }, null, 2));
    return;
  }

  if (!values.output) fail('Missing -o <output>');
  format = format ?? formatFromFilename(values.output);
  const spec = FORMATS[format];
  if (!spec) fail(`Unknown format "${format}". Run \`${PROJECT.cli} formats\`.`);

  if (cmd === 'still' || spec.kind === 'image') {
    const mod = await loadSceneModule(target);
    const scene = await buildFromModule(mod, overrides);
    const t = values.time != null ? Number(values.time) : scene.frameTime(scene.frameCount - 1);
    mkdirSync(dirname(resolve(values.output)), { recursive: true });
    if (format === 'pdf' || format === 'svg-animated' || format === 'lottie') {
      console.log(await exportScene(scene, format, values.output, { time: values.time != null ? t : 0, transparent: values.transparent, fps: values.fps ? Number(values.fps) : undefined }));
      return;
    }
    if (cmd === 'still' && spec.kind !== 'image') fail(`'still' writes png, jpeg, webp, svg, or pdf; got ${format}`);
    const fmt = format === 'jpeg' ? 'jpeg' : format;
    writeFileSync(values.output, await renderStill(scene, t, fmt, { transparent: values.transparent }));
    console.log(`Wrote ${values.output}`);
    return;
  }

  if (cmd !== 'render') fail(`Unknown command "${cmd}"`);
  const started = Date.now();
  let lastPrint = 0;
  const result = await renderVideo(target, {
    output: values.output,
    format,
    transparent: !!values.transparent,
    jobs: values.jobs ? Number(values.jobs) : undefined,
    chunkFrames: values.chunk ? Number(values.chunk) : undefined,
    resume: !values.fresh,
    subtitles: !!values.subtitles,
    gif: { colors: values['gif-colors'] ? Number(values['gif-colors']) : undefined, dither: values['gif-dither'] },
    overrides,
    onProgress: (done, total) => {
      const now = Date.now();
      if (process.stderr.isTTY && (now - lastPrint > 200 || done === total)) {
        lastPrint = now;
        process.stderr.write(`\r${done}/${total} frames`);
      }
    },
  });
  if (process.stderr.isTTY) process.stderr.write('\n');
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Wrote ${result.output}: ${result.frames} frames, ${result.duration.toFixed(2)} s${result.chunksReused ? `, resumed ${result.chunksReused} cached chunks` : ''} (${secs} s)`);
}

main().catch((e) => fail(e.message));
