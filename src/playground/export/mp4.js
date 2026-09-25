/**
 * Progressive MP4 muxer for WebCodecs output: H.264 video (the sample
 * entry carries the encoder's AVCDecoderConfigurationRecord as `avcC`) and
 * optional AAC audio (`esds` from the AudioSpecificConfig). The movie box is
 * written before the media data (fast start), samples are grouped into
 * chunks of about half a second, and audio and video chunks interleave.
 * @module playground/export/mp4
 */

import { ByteWriter, concatBytes } from './bytes.js';

const VIDEO_TIMESCALE = 90000;
const MOVIE_TIMESCALE = 1000;
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function box(type, ...parts) {
  const body = concatBytes(parts.filter(Boolean));
  const w = new ByteWriter(8 + body.length);
  w.u32(8 + body.length).ascii(type).bytes(body);
  return w.done();
}

function fullBox(type, version, flags, ...parts) {
  const w = new ByteWriter(4);
  w.u8(version).u24(flags);
  return box(type, w.done(), ...parts);
}

function writer(fn) {
  const w = new ByteWriter(64);
  fn(w);
  return w.done();
}

/**
 * @typedef {Object} Sample
 * @property {Uint8Array} data
 * @property {number} dts decode time in track timescale units
 * @property {number} cts composition time in track timescale units
 * @property {number} duration
 * @property {boolean} key
 */

/** MP4 muxer. Add encoded chunks in decode order, then call finalize(). */
export class MP4Muxer {
  /**
   * @param {{width: number, height: number, fps: number, audio?: {sampleRate: number, channels: number}}} opts
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.fps = opts.fps;
    this.audio = opts.audio ?? null;
    /** @type {Sample[]} */
    this.video = [];
    /** @type {Sample[]} */
    this.audioSamples = [];
    this.avcC = null;
    this.asc = null;
  }

  /**
   * Add an encoded video chunk.
   * @param {Uint8Array} data AVC (length-prefixed) access unit
   * @param {{timestamp: number, duration?: number, key: boolean}} info microseconds
   * @param {{description?: ArrayBuffer|ArrayBufferView}} [decoderConfig] present on the first chunk
   */
  addVideoChunk(data, info, decoderConfig) {
    if (decoderConfig && decoderConfig.description && !this.avcC) this.avcC = toBytes(decoderConfig.description);
    const i = this.video.length;
    const dts = Math.round((i * VIDEO_TIMESCALE) / this.fps);
    const cts = Math.round((info.timestamp * VIDEO_TIMESCALE) / 1e6);
    this.video.push({ data, dts, cts, duration: 0, key: !!info.key });
  }

  /**
   * Add an encoded AAC frame.
   * @param {Uint8Array} data raw AAC frame
   * @param {{timestamp: number, duration: number}} info microseconds
   * @param {{description?: ArrayBuffer|ArrayBufferView}} [decoderConfig]
   */
  addAudioChunk(data, info, decoderConfig) {
    if (!this.audio) return;
    if (decoderConfig && decoderConfig.description && !this.asc) this.asc = toBytes(decoderConfig.description);
    const sr = this.audio.sampleRate;
    const t = Math.round((info.timestamp * sr) / 1e6);
    this.audioSamples.push({ data, dts: t, cts: t, duration: Math.round((info.duration * sr) / 1e6), key: true });
  }

  /**
   * Write the file.
   * @returns {Uint8Array}
   */
  finalize() {
    if (!this.video.length) throw new Error('No video frames were encoded');
    if (!this.avcC) throw new Error('The encoder did not provide an AVC decoder configuration');
    const v = this.video;
    for (let i = 0; i < v.length; i++) v[i].duration = i + 1 < v.length ? v[i + 1].dts - v[i].dts : Math.round(VIDEO_TIMESCALE / this.fps);
    const a = this.audio && this.audioSamples.length && this.asc ? this.audioSamples : null;
    if (a) for (let i = 0; i < a.length; i++) if (!a[i].duration) a[i].duration = i + 1 < a.length ? a[i + 1].dts - a[i].dts : 1024;

    const tracks = [{ id: 1, kind: 'video', samples: v, timescale: VIDEO_TIMESCALE }];
    if (a) tracks.push({ id: 2, kind: 'audio', samples: a, timescale: this.audio.sampleRate });
    for (const t of tracks) t.chunks = chunkSamples(t.samples, Math.round(t.timescale / 2));
    const order = tracks.flatMap((t) => t.chunks.map((c) => ({ t, c }))).sort((x, y) => x.c.start / x.t.timescale - y.c.start / y.t.timescale || x.t.id - y.t.id);

    this.largeOffsets = tracks.reduce((n, t) => n + t.samples.reduce((m, s) => m + s.data.length, 0), 0) > 0xfff00000;
    const ftyp = box('ftyp', writer((w) => w.ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii('avc1').ascii('mp41')));
    const layout = (base) => {
      let off = base;
      for (const { c } of order) {
        c.offset = off;
        off += c.size;
      }
      return this.moov(tracks);
    };
    const probe = layout(0);
    const mdatBody = order.reduce((n, { c }) => n + c.size, 0);
    const largeMdat = mdatBody + 8 > 0xffffffff;
    const mdatHeader = largeMdat ? 16 : 8;
    const moov = layout(ftyp.length + probe.length + mdatHeader);
    const out = new Uint8Array(ftyp.length + moov.length + mdatHeader + mdatBody);
    out.set(ftyp, 0);
    out.set(moov, ftyp.length);
    let p = ftyp.length + moov.length;
    const hv = new DataView(out.buffer, p, mdatHeader);
    if (largeMdat) {
      hv.setUint32(0, 1);
      out.set([0x6d, 0x64, 0x61, 0x74], p + 4);
      hv.setUint32(8, Math.floor((mdatBody + 16) / 2 ** 32));
      hv.setUint32(12, (mdatBody + 16) >>> 0);
    } else {
      hv.setUint32(0, mdatBody + 8);
      out.set([0x6d, 0x64, 0x61, 0x74], p + 4);
    }
    p += mdatHeader;
    for (const { c } of order) {
      for (const s of c.samples) {
        out.set(s.data, p);
        p += s.data.length;
      }
    }
    return out;
  }

  moov(tracks) {
    const durMs = Math.max(...tracks.map((t) => (trackDuration(t) * MOVIE_TIMESCALE) / t.timescale));
    const mvhd = fullBox('mvhd', 0, 0, writer((w) => {
      w.u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(Math.round(durMs)).u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0);
      for (const m of MATRIX) w.u32(m);
      for (let i = 0; i < 6; i++) w.u32(0);
      w.u32(tracks.length + 1);
    }));
    return box('moov', mvhd, ...tracks.map((t) => this.trak(t)));
  }

  trak(t) {
    const video = t.kind === 'video';
    const dur = trackDuration(t);
    const tkhd = fullBox('tkhd', 0, 3, writer((w) => {
      w.u32(0).u32(0).u32(t.id).u32(0).u32(Math.round((dur * MOVIE_TIMESCALE) / t.timescale)).u32(0).u32(0);
      w.i16(0).i16(video ? 0 : 1).u16(video ? 0 : 0x0100).u16(0);
      for (const m of MATRIX) w.u32(m);
      w.u32(video ? this.width * 65536 : 0).u32(video ? this.height * 65536 : 0);
    }));
    const mdhd = fullBox('mdhd', 0, 0, writer((w) => w.u32(0).u32(0).u32(t.timescale).u32(dur).u16(0x55c4).u16(0)));
    const hdlr = fullBox('hdlr', 0, 0, writer((w) => w.u32(0).ascii(video ? 'vide' : 'soun').u32(0).u32(0).u32(0).ascii(video ? 'VideoHandler' : 'SoundHandler').u8(0)));
    const mediaHeader = video ? fullBox('vmhd', 0, 1, writer((w) => w.u16(0).u16(0).u16(0).u16(0))) : fullBox('smhd', 0, 0, writer((w) => w.i16(0).u16(0)));
    const dinf = box('dinf', fullBox('dref', 0, 0, writer((w) => w.u32(1)), fullBox('url ', 0, 1)));
    const stbl = box('stbl', this.stsd(t), stts(t.samples), video ? ctts(t.samples) : null, video ? stss(t.samples) : null, stsc(t.chunks), stsz(t.samples), stco(t.chunks, this.largeOffsets));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', mediaHeader, dinf, stbl)));
  }

  stsd(t) {
    if (t.kind === 'video') {
      const entry = box('avc1', writer((w) => {
        for (let i = 0; i < 6; i++) w.u8(0);
        w.u16(1).u16(0).u16(0).u32(0).u32(0).u32(0);
        w.u16(this.width).u16(this.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
        const name = 'Qubibyte Graphics';
        w.u8(name.length).ascii(name);
        for (let i = name.length + 1; i < 32; i++) w.u8(0);
        w.u16(0x0018).i16(-1);
      }), box('avcC', this.avcC), box('pasp', writer((w) => w.u32(1).u32(1))));
      return fullBox('stsd', 0, 0, writer((w) => w.u32(1)), entry);
    }
    const ch = this.audio.channels;
    const sr = this.audio.sampleRate;
    const entry = box('mp4a', writer((w) => {
      for (let i = 0; i < 6; i++) w.u8(0);
      w.u16(1).u32(0).u32(0).u16(ch).u16(16).u16(0).u16(0).u32(sr * 65536);
    }), esds(this.asc, t.id));
    return fullBox('stsd', 0, 0, writer((w) => w.u32(1)), entry);
  }
}

function toBytes(d) {
  if (d instanceof Uint8Array) return d.slice();
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  return new Uint8Array(d.slice(0));
}

function trackDuration(t) {
  return t.samples.reduce((n, s) => n + s.duration, 0);
}

function chunkSamples(samples, span) {
  const chunks = [];
  let cur = null;
  for (const s of samples) {
    if (!cur || s.dts - cur.start >= span) {
      cur = { start: s.dts, samples: [], size: 0, offset: 0 };
      chunks.push(cur);
    }
    cur.samples.push(s);
    cur.size += s.data.length;
  }
  return chunks;
}

function stts(samples) {
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last[1] === s.duration) last[0]++;
    else runs.push([1, s.duration]);
  }
  return fullBox('stts', 0, 0, writer((w) => {
    w.u32(runs.length);
    for (const [n, d] of runs) w.u32(n).u32(d);
  }));
}

function ctts(samples) {
  if (samples.every((s) => s.cts === s.dts)) return null;
  const runs = [];
  for (const s of samples) {
    const off = s.cts - s.dts;
    const last = runs[runs.length - 1];
    if (last && last[1] === off) last[0]++;
    else runs.push([1, off]);
  }
  return fullBox('ctts', 1, 0, writer((w) => {
    w.u32(runs.length);
    for (const [n, off] of runs) w.u32(n).i32(off);
  }));
}

function stss(samples) {
  const keys = [];
  samples.forEach((s, i) => {
    if (s.key) keys.push(i + 1);
  });
  if (keys.length === samples.length) return null;
  return fullBox('stss', 0, 0, writer((w) => {
    w.u32(keys.length);
    for (const k of keys) w.u32(k);
  }));
}

function stsc(chunks) {
  const runs = [];
  chunks.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (!last || last[1] !== c.samples.length) runs.push([i + 1, c.samples.length]);
  });
  return fullBox('stsc', 0, 0, writer((w) => {
    w.u32(runs.length);
    for (const [first, n] of runs) w.u32(first).u32(n).u32(1);
  }));
}

function stsz(samples) {
  return fullBox('stsz', 0, 0, writer((w) => {
    w.u32(0).u32(samples.length);
    for (const s of samples) w.u32(s.data.length);
  }));
}

function stco(chunks, large) {
  return fullBox(large ? 'co64' : 'stco', 0, 0, writer((w) => {
    w.u32(chunks.length);
    for (const c of chunks) {
      if (large) w.u64(c.offset);
      else w.u32(c.offset);
    }
  }));
}

function descriptor(tag, body) {
  const w = new ByteWriter(body.length + 5);
  w.u8(tag);
  let n = body.length;
  const lens = [];
  do {
    lens.unshift(n & 0x7f);
    n >>= 7;
  } while (n > 0);
  lens.forEach((b, i) => w.u8(i < lens.length - 1 ? b | 0x80 : b));
  return w.bytes(body).done();
}

function esds(asc, trackId) {
  const dsi = descriptor(0x05, asc);
  const dcd = descriptor(0x04, concatBytes([writer((w) => w.u8(0x40).u8(0x15).u24(0).u32(0).u32(0)), dsi]));
  const sl = descriptor(0x06, new Uint8Array([0x02]));
  const es = descriptor(0x03, concatBytes([writer((w) => w.u16(trackId).u8(0)), dcd, sl]));
  return fullBox('esds', 0, 0, es);
}
