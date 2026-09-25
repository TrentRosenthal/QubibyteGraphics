import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MP4Muxer } from '../../src/playground/export/mp4.js';
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

/** Split an Annex B stream into NAL units. */
function nalUnits(bytes) {
  const starts = [];
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) {
      const len = bytes[i + 2] === 1 ? 3 : 4;
      starts.push([i, i + len]);
      i += len - 1;
    }
  }
  return starts.map(([, s], k) => bytes.subarray(s, k + 1 < starts.length ? starts[k + 1][0] : bytes.length));
}

/** Access units (AVC length-prefixed) and the avcC record from an Annex B H.264 stream with AUD NALs. */
function annexBToAvc(bytes) {
  let sps = null;
  let pps = null;
  const frames = [];
  let cur = null;
  for (const nal of nalUnits(bytes)) {
    const type = nal[0] & 0x1f;
    if (type === 9) {
      cur = { nals: [], key: false };
      frames.push(cur);
    } else if (type === 7) sps = nal;
    else if (type === 8) pps = nal;
    else if (cur) {
      cur.nals.push(nal);
      if (type === 5) cur.key = true;
    }
  }
  const avcC = new Uint8Array([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff, ...sps, 1, pps.length >> 8, pps.length & 0xff, ...pps]);
  return {
    avcC,
    frames: frames.filter((f) => f.nals.length).map((f) => {
      const size = f.nals.reduce((n, x) => n + 4 + x.length, 0);
      const out = new Uint8Array(size);
      const v = new DataView(out.buffer);
      let o = 0;
      for (const n of f.nals) {
        v.setUint32(o, n.length);
        out.set(n, o + 4);
        o += 4 + n.length;
      }
      return { data: out, key: f.key };
    }),
  };
}

/** Raw AAC frames and the AudioSpecificConfig from an ADTS stream. */
function adtsFrames(bytes) {
  const frames = [];
  let asc = null;
  for (let i = 0; i + 7 <= bytes.length;) {
    const profile = bytes[i + 2] >> 6;
    const sf = (bytes[i + 2] >> 2) & 0xf;
    const ch = ((bytes[i + 2] & 1) << 2) | (bytes[i + 3] >> 6);
    const len = ((bytes[i + 3] & 3) << 11) | (bytes[i + 4] << 3) | (bytes[i + 5] >> 5);
    const header = bytes[i + 1] & 1 ? 7 : 9;
    if (!asc) {
      const v = ((profile + 1) << 11) | (sf << 7) | (ch << 3);
      asc = new Uint8Array([v >> 8, v & 0xff]);
    }
    frames.push(bytes.slice(i + header, i + len));
    i += len;
  }
  return { asc, frames };
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

test('MP4 muxer writes H.264 and AAC that ffprobe reads frame for frame', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qg-mp4-'));
  try {
    ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}`, '-frames:v', String(FRAMES), '-c:v', 'libx264', '-profile:v', 'baseline', '-g', '15', '-bf', '0', '-x264-params', 'aud=1', '-pix_fmt', 'yuv420p', '-f', 'h264', join(dir, 'v.h264')]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(FRAMES / FPS), '-c:a', 'aac', '-ac', '1', '-f', 'adts', join(dir, 'a.aac')]);
    const { avcC, frames } = annexBToAvc(new Uint8Array(readFileSync(join(dir, 'v.h264'))));
    assert.equal(frames.length, FRAMES);
    const { asc, frames: aac } = adtsFrames(new Uint8Array(readFileSync(join(dir, 'a.aac'))));
    const mux = new MP4Muxer({ width: W, height: H, fps: FPS, audio: { sampleRate: 48000, channels: 1 } });
    frames.forEach((f, i) => mux.addVideoChunk(f.data, { timestamp: (i * 1e6) / FPS, key: f.key }, i === 0 ? { description: avcC } : undefined));
    aac.forEach((f, i) => mux.addAudioChunk(f, { timestamp: (i * 1024 * 1e6) / 48000, duration: (1024 * 1e6) / 48000 }, i === 0 ? { description: asc } : undefined));
    const bytes = mux.finalize();
    assert.equal(String.fromCharCode(...bytes.subarray(4, 8)), 'ftyp');
    assert.equal(String.fromCharCode(...bytes.subarray(36, 40)), 'moov', 'moov comes before mdat (fast start)');
    const file = join(dir, 'out.mp4');
    writeFileSync(file, bytes);
    const streams = probe(file);
    const v = streams.find((s) => s.codec_type === 'video');
    const a = streams.find((s) => s.codec_type === 'audio');
    assert.equal(v.codec_name, 'h264');
    assert.equal(v.width, W);
    assert.equal(v.height, H);
    assert.equal(Number(v.nb_read_frames), FRAMES);
    assert.equal(a.codec_name, 'aac');
    assert.equal(Number(a.sample_rate), 48000);
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(decode.status, 0);
    assert.equal(decode.stderr.trim(), '', 'decodes without errors');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
