import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { renderVideo, probe, loadSceneModule, buildFromModule, renderFrameCanvas, findFFmpeg } from '../../cli/render.js';

const hasFFmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'qgfx-export-'));
const sceneFile = join(dir, 'scene.js');
const src = new URL('../../src/index.js', import.meta.url).href;
writeFileSync(sceneFile, `
import { Circle, Rect, create, fadeIn } from '${src}';
export const config = { width: 320, height: 180, fps: 12 };
export default async function (scene) {
  const c = new Circle({ radius: 1.5, fill: 'accent', stroke: null });
  await scene.play(fadeIn(c), { duration: 1 });
  await scene.play(create(new Rect({ width: 6, height: 3, stroke: 'ink' })), { duration: 1 });
  scene.caption('A circle, then a frame', 1);
  scene.tone({ from: 440, to: 880, duration: 0.4 });
  await scene.wait(1);
}
`);

function decodeFrame(file, n, w, h, pixFmt = 'rgba', codecArgs = []) {
  const r = spawnSync('ffmpeg', ['-v', 'error', ...codecArgs, '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', pixFmt, '-'], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(r.stdout.length, w * h * (pixFmt === 'rgba' ? 4 : 3));
  return r.stdout;
}

function meanAbsDiff(a, b, stride) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += stride) {
    for (let k = 0; k < 3; k++) s += Math.abs(a[i + k] - b[i + k]);
    n += 3;
  }
  return s / n;
}

test('MP4 export: frame count, duration, resolution, and sampled frames match the renderer', { skip: !hasFFmpeg && 'ffmpeg not installed' }, async () => {
  const out = join(dir, 'out.mp4');
  const r = await renderVideo(sceneFile, { output: out, format: 'mp4', jobs: 2, chunkFrames: 10, subtitles: true });
  assert.equal(r.frames, 36);
  const p = probe(out);
  assert.equal(p.width, 320);
  assert.equal(p.height, 180);
  assert.equal(p.frames, 36);
  assert.ok(Math.abs(p.duration - 3) < 0.1, `duration ${p.duration}`);
  assert.equal(p.codec, 'h264');
  assert.ok(existsSync(out.replace(/\.mp4$/, '.srt')));
  const mod = await loadSceneModule(sceneFile);
  const scene = await buildFromModule(mod);
  for (const n of [0, 6, 18, 35]) {
    const canvas = renderFrameCanvas(scene, n, { canvas: createCanvas(320, 180) });
    const ref = canvas.getContext('2d').getImageData(0, 0, 320, 180).data;
    const got = decodeFrame(out, n, 320, 180);
    const d = meanAbsDiff(got, ref, 4);
    assert.ok(d < 4, `frame ${n}: mean abs diff ${d.toFixed(2)}`);
  }
  const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  assert.equal(audio.stdout.trim(), 'aac');
});

test('resume reuses finished chunks', { skip: !hasFFmpeg && 'ffmpeg not installed' }, async () => {
  const out = join(dir, 'resume.mp4');
  await renderVideo(sceneFile, { output: out, format: 'mp4', jobs: 1, chunkFrames: 12 });
  const again = await renderVideo(sceneFile, { output: out, format: 'mp4', jobs: 1, chunkFrames: 12 });
  assert.equal(again.chunksReused, 3);
  assert.equal(probe(out).frames, 36);
});

test('WebM with alpha keeps transparent pixels', { skip: !hasFFmpeg && 'ffmpeg not installed' }, async () => {
  const out = join(dir, 'alpha.webm');
  await renderVideo(sceneFile, { output: out, format: 'webm', transparent: true, jobs: 1 });
  const px = decodeFrame(out, 18, 320, 180, 'rgba', ['-c:v', 'libvpx-vp9']);
  assert.ok(px[3] < 8, `corner alpha ${px[3]}`);
  const center = ((90 * 320) + 160) * 4;
  assert.ok(px[center + 3] > 240, `center alpha ${px[center + 3]}`);
});

test('ProRes 4444, GIF, APNG, and PNG sequence exports', { skip: !hasFFmpeg && 'ffmpeg not installed' }, async () => {
  for (const [format, name] of [['mov-prores4444', 'a.mov'], ['gif', 'a.gif'], ['apng', 'a.png'], ['webp', 'a.webp'], ['mp4-h265', 'h.mp4'], ['mkv', 'a.mkv']]) {
    const out = join(dir, name);
    await renderVideo(sceneFile, { output: out, format, transparent: format === 'mov-prores4444', jobs: 1 });
    assert.ok(readFileSync(out).length > 1000, `${format} output is empty`);
    if (format !== 'webp') assert.equal(probe(out).frames, 36, format);
  }
  const seq = join(dir, 'seq');
  await renderVideo(sceneFile, { output: seq, format: 'png-seq', jobs: 1 });
  assert.equal(readdirSync(seq).filter((f) => f.endsWith('.png')).length, 36);
  assert.ok(findFFmpeg());
});
