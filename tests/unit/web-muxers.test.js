import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebMMuxer } from '../../src/playground/export/webm.js';

const hasFFmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const skip = hasFFmpeg ? false : 'ffmpeg and ffprobe are not installed';

const W = 320;
const H = 180;
const FPS = 30;
const FRAMES = 45;

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames,sample_rate', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).streams;
}

/** VP9 frames and keyframe flags from an IVF file. */
function ivfFrames(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = v.getUint16(6, true);
  const out = [];
  for (let o = headerLen; o + 12 <= bytes.length;) {
    const size = v.getUint32(o, true);
    const data = bytes.slice(o + 12, o + 12 + size);
    const b = data[0];
    out.push({ data, key: ((b >> 3) & 1) === 0 && ((b >> 2) & 1) === 0 });
    o += 12 + size;
  }
  return out;
}

test('WebM muxer writes VP9 SimpleBlocks with cues that ffprobe reads frame for frame', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-webm-'));
  try {
    ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}`, '-frames:v', String(FRAMES), '-c:v', 'libvpx-vp9', '-g', '20', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-f', 'ivf', join(dir, 'v.ivf')]);
    const frames = ivfFrames(new Uint8Array(readFileSync(join(dir, 'v.ivf'))));
    assert.equal(frames.length, FRAMES);
    assert.ok(frames[0].key && frames.filter((f) => f.key).length >= 2);
    const mux = new WebMMuxer({ width: W, height: H, fps: FPS, codec: 'vp9' });
    frames.forEach((f, i) => mux.addVideoChunk(f.data, { timestamp: (i * 1e6) / FPS, key: f.key }));
    const bytes = mux.finalize();
    assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
    const file = join(dir, 'out.webm');
    writeFileSync(file, bytes);
    const [v] = probe(file);
    assert.equal(v.codec_name, 'vp9');
    assert.equal(v.width, W);
    assert.equal(v.height, H);
    assert.equal(Number(v.nb_read_frames), FRAMES);
    const fmt = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    assert.ok(Math.abs(Number(fmt.stdout) - FRAMES / FPS) < 0.05, `duration ${fmt.stdout}`);
    const seek = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(seek.status, 0, seek.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a transparent WebM carries a second VP9 stream of alpha in BlockAdditions that libvpx decodes', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-webm-alpha-'));
  try {
    const vp9 = ['-c:v', 'libvpx-vp9', '-g', '20', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', '-f', 'ivf'];
    ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}`, '-frames:v', String(FRAMES), ...vp9, join(dir, 'c.ivf')]);
    // The alpha stream: its luma plane is the alpha, transparent on the left half, opaque on the right.
    ffmpeg(['-f', 'lavfi', '-i', `nullsrc=size=${W}x${H}:rate=${FPS},format=yuv420p,geq=lum='if(lt(X,${W / 2}),0,255)':cb=128:cr=128`, '-frames:v', String(FRAMES), ...vp9, join(dir, 'a.ivf')]);
    const color = ivfFrames(new Uint8Array(readFileSync(join(dir, 'c.ivf'))));
    const alpha = ivfFrames(new Uint8Array(readFileSync(join(dir, 'a.ivf'))));
    assert.equal(color.length, FRAMES);
    assert.equal(alpha.length, FRAMES);
    const mux = new WebMMuxer({ width: W, height: H, fps: FPS, codec: 'vp9', alpha: true });
    color.forEach((f, i) => mux.addVideoChunk(f.data, { timestamp: (i * 1e6) / FPS, key: f.key, alpha: alpha[i].data }));
    const file = join(dir, 'alpha.webm');
    writeFileSync(file, mux.finalize());
    const [v] = probe(file);
    assert.equal(Number(v.nb_read_frames), FRAMES);
    const tags = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=alpha_mode', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    assert.equal(tags.stdout.trim(), '1');
    for (const at of ['0', '1']) {
      const px = spawnSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-ss', at, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 });
      assert.equal(px.status, 0, String(px.stderr));
      const rgba = px.stdout;
      assert.ok(rgba[(H / 2 * W + 10) * 4 + 3] < 8, `left half is transparent at ${at}s`);
      assert.ok(rgba[(H / 2 * W + W - 10) * 4 + 3] > 247, `right half is opaque at ${at}s`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('browser video codecs are tried best first: H.264 then AV1 then VP9 for MP4, VP9 then VP8 for WebM', async () => {
  const { videoCandidates } = await import('../../src/playground/export/encode.js');
  const mp4 = videoCandidates('mp4', 1920, 1080).map((c) => c.mux);
  assert.deepEqual([...new Set(mp4)], ['avc', 'av1', 'vp9']);
  assert.equal(videoCandidates('mp4', 1920, 1080)[0].codec, 'avc1.640028');
  assert.deepEqual([...new Set(videoCandidates('webm', 640, 360).map((c) => c.mux))], ['vp9', 'vp8', 'av1']);
  // Alpha needs a codec libvpx can carry as a second stream, so AV1 is not offered.
  assert.deepEqual([...new Set(videoCandidates('webm-alpha', 640, 360).map((c) => c.mux))], ['vp9', 'vp8']);
});
