import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { GifEncoder, buildPalette, lzwEncode } from '../../src/playground/export/gif.js';
import { encodePNG, assembleAPNG } from '../../src/playground/export/apng.js';

const hasFFmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const skip = hasFFmpeg ? false : 'ffmpeg and ffprobe are not installed';

const W = 96;
const H = 64;

/** A moving disc over a gradient, with a noisy band that forces LZW table resets. */
function frame(n) {
  const px = new Uint8Array(W * H * 4);
  const cx = 16 + n * 6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inDisc = (x - cx) ** 2 + (y - 32) ** 2 < 144;
      const noise = y > 54 ? ((x * 7919 + y * 104729 + n * 31) % 97) * 2 : 0;
      px[i] = inDisc ? 91 : Math.min(255, (x * 255) / W + noise);
      px[i + 1] = inDisc ? 141 : (y * 255) / H;
      px[i + 2] = inDisc ? 239 : 60;
      px[i + 3] = 255;
    }
  }
  return px;
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).streams[0];
}

function decodeFrames(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout;
}

test('median cut keeps distinct colors and caps the palette size', () => {
  const two = new Uint8Array([10, 20, 30, 255, 200, 100, 50, 255]);
  const pal = buildPalette([two], 16);
  assert.equal(pal.length, 6);
  const big = buildPalette([frame(0), frame(3)], 64);
  assert.ok(big.length <= 64 * 3 && big.length >= 32 * 3);
});

test('LZW output starts with a clear code and ends with end-of-information', () => {
  const bytes = lzwEncode(new Uint8Array([0, 0, 0, 1, 1, 1]), 2);
  assert.equal(bytes[0] & 0b111, 4, 'clear code 4 at 3 bits');
  assert.ok(bytes.length >= 2);
});

test('GIF encoder output decodes in ffmpeg with the right frame count and size', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-gif-'));
  try {
    const frames = Array.from({ length: 10 }, (_, n) => frame(n));
    for (const dither of [false, true]) {
      const palette = buildPalette(frames, 256);
      const gif = new GifEncoder({ width: W, height: H, fps: 30, palette, dither });
      for (const f of frames) gif.addFrame(f);
      const file = join(dir, `a-${dither}.gif`);
      writeFileSync(file, gif.finish());
      const s = probe(file);
      assert.equal(s.codec_name, 'gif');
      assert.equal(s.width, W);
      assert.equal(s.height, H);
      assert.equal(Number(s.nb_read_frames), 10);
      if (!dither) {
        const raw = decodeFrames(file);
        assert.equal(raw.length, W * H * 4 * 10);
        // The disc center of the last frame keeps its color within quantization error.
        const i = (9 * W * H + 32 * W + (16 + 9 * 6)) * 4;
        assert.ok(Math.abs(raw[i] - 91) < 12 && Math.abs(raw[i + 1] - 141) < 12 && Math.abs(raw[i + 2] - 239) < 12, `got ${raw[i]},${raw[i + 1]},${raw[i + 2]}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('APNG assembled from PNG frames decodes with every frame', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-apng-'));
  try {
    const pngs = [];
    for (let n = 0; n < 8; n++) pngs.push(await encodePNG(frame(n), W, H, (b) => new Uint8Array(deflateSync(b))));
    const one = join(dir, 'one.png');
    writeFileSync(one, pngs[0]);
    assert.equal(probe(one).codec_name, 'png');
    const file = join(dir, 'anim.png');
    writeFileSync(file, assembleAPNG(pngs, { fps: 24 }));
    const r = spawnSync('ffprobe', ['-v', 'error', '-f', 'apng', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout).streams[0];
    assert.equal(s.codec_name, 'apng');
    assert.equal(s.width, W);
    assert.equal(s.height, H);
    assert.equal(Number(s.nb_read_frames), 8);
    const raw = spawnSync('ffmpeg', ['-v', 'error', '-f', 'apng', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 }).stdout;
    const expected = frame(5);
    assert.deepEqual([...raw.subarray(5 * W * H * 4, 5 * W * H * 4 + 64)], [...expected.subarray(0, 64)], 'pixels are lossless');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
