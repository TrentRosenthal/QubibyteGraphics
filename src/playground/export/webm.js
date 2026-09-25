/**
 * WebM (Matroska) muxer for WebCodecs output: VP9 or VP8 video in
 * SimpleBlocks (BlockGroups with BlockAdditions when the encoder emits alpha
 * side data) and optional Opus audio. Clusters start at video keyframes, a
 * SeekHead and Cues make the file seekable, and the whole file is written at
 * the end, so every size is known.
 * @module playground/export/webm
 */

import { ByteWriter, concatBytes } from './bytes.js';

const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, MuxingApp: 0x4d80, WritingApp: 0x5741, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
  CodecID: 0x86, CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb, DefaultDuration: 0x23e383,
  MaxBlockAdditionID: 0x55ee,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0,
  Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
  BlockAdditions: 0x75a1, BlockMore: 0xa6, BlockAddID: 0xee, BlockAdditional: 0xa5,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
};

function idBytes(id) {
  const out = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
}

function sizeBytes(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v % 256;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('EBML element too large');
}

function el(id, body) {
  const head = [...idBytes(id), ...sizeBytes(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

function master(id, ...children) {
  return el(id, concatBytes(children.filter(Boolean)));
}

function uint(id, v, width) {
  const bytes = [];
  let x = v;
  do {
    bytes.unshift(x % 256);
    x = Math.floor(x / 256);
  } while (x > 0);
  while (width && bytes.length < width) bytes.unshift(0);
  return el(id, new Uint8Array(bytes));
}

function float(id, v) {
  return el(id, new ByteWriter(8).f64(v).done());
}

function str(id, s) {
  return el(id, new TextEncoder().encode(s));
}

function bin(id, b) {
  return el(id, b);
}

function blockBytes(track, rel, flags, data) {
  const w = new ByteWriter(data.length + 4);
  w.u8(0x80 | track).i16(rel).u8(flags).bytes(data);
  return w.done();
}

/**
 * Build an OpusHead for a stream (used when the encoder gives none).
 * @param {number} channels
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
function opusHead(channels, sampleRate) {
  const b = new Uint8Array(19);
  b.set(new TextEncoder().encode('OpusHead'));
  const v = new DataView(b.buffer);
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, 312, true);
  v.setUint32(12, sampleRate, true);
  return b;
}

/** WebM muxer. Add chunks in decode order, then call finalize(). */
export class WebMMuxer {
  /**
   * @param {{width: number, height: number, fps: number, codec?: 'vp9'|'vp8'|'av1', alpha?: boolean, audio?: {sampleRate: number, channels: number}}} opts
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.fps = opts.fps;
    this.codec = opts.codec ?? 'vp9';
    this.alpha = !!opts.alpha;
    this.audio = opts.audio ?? null;
    this.blocks = [];
    this.opusPrivate = null;
    this.lastVideoMs = 0;
  }

  /**
   * Add an encoded video frame.
   * @param {Uint8Array} data
   * @param {{timestamp: number, key: boolean, alpha?: Uint8Array|null}} info timestamp in microseconds; alpha is the encoder's alphaSideData
   */
  addVideoChunk(data, info) {
    const ms = Math.round(info.timestamp / 1000);
    this.lastVideoMs = Math.max(this.lastVideoMs, ms);
    this.blocks.push({ track: 1, ms, key: !!info.key, data, alpha: info.alpha ?? null });
  }

  /**
   * Add an encoded Opus packet.
   * @param {Uint8Array} data
   * @param {{timestamp: number}} info microseconds
   * @param {{description?: ArrayBuffer|ArrayBufferView}} [decoderConfig]
   */
  addAudioChunk(data, info, decoderConfig) {
    if (!this.audio) return;
    if (decoderConfig && decoderConfig.description && !this.opusPrivate) {
      const d = decoderConfig.description;
      this.opusPrivate = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
    }
    this.blocks.push({ track: 2, ms: Math.round(info.timestamp / 1000), key: true, data, alpha: null });
  }

  /**
   * Write the file.
   * @returns {Uint8Array}
   */
  finalize() {
    const video = this.blocks.filter((b) => b.track === 1);
    if (!video.length) throw new Error('No video frames were encoded');
    const hasAudio = !!this.audio && this.blocks.some((b) => b.track === 2);
    const frameMs = 1000 / this.fps;
    const durationMs = this.lastVideoMs + frameMs;

    const ebml = master(ID.EBML,
      uint(ID.EBMLVersion, 1), uint(ID.EBMLReadVersion, 1), uint(ID.EBMLMaxIDLength, 4), uint(ID.EBMLMaxSizeLength, 8),
      str(ID.DocType, 'webm'), uint(ID.DocTypeVersion, 4), uint(ID.DocTypeReadVersion, 2));

    const info = master(ID.Info, uint(ID.TimestampScale, 1000000), str(ID.MuxingApp, 'Qubibyte Graphics'), str(ID.WritingApp, 'Qubibyte Graphics'), float(ID.Duration, durationMs));
    const codecId = { vp9: 'V_VP9', vp8: 'V_VP8', av1: 'V_AV1' }[this.codec];
    const videoTrack = master(ID.TrackEntry,
      uint(ID.TrackNumber, 1), uint(ID.TrackUID, 1), uint(ID.TrackType, 1), uint(ID.FlagLacing, 0), str(ID.CodecID, codecId),
      uint(ID.DefaultDuration, Math.round(1e9 / this.fps)),
      this.alpha ? uint(ID.MaxBlockAdditionID, 1) : null,
      master(ID.Video, uint(ID.PixelWidth, this.width), uint(ID.PixelHeight, this.height), this.alpha ? uint(ID.AlphaMode, 1) : null));
    let audioTrack = null;
    if (hasAudio) {
      const priv = this.opusPrivate ?? opusHead(this.audio.channels, this.audio.sampleRate);
      const preSkip = new DataView(priv.buffer, priv.byteOffset).getUint16(10, true);
      audioTrack = master(ID.TrackEntry,
        uint(ID.TrackNumber, 2), uint(ID.TrackUID, 2), uint(ID.TrackType, 2), uint(ID.FlagLacing, 0), str(ID.CodecID, 'A_OPUS'),
        bin(ID.CodecPrivate, priv), uint(ID.CodecDelay, Math.round((preSkip / 48000) * 1e9)), uint(ID.SeekPreRoll, 80000000),
        master(ID.Audio, float(ID.SamplingFrequency, this.audio.sampleRate), uint(ID.Channels, this.audio.channels)));
    }
    const tracks = master(ID.Tracks, videoTrack, audioTrack);

    const ordered = this.blocks.slice().sort((a, b) => a.ms - b.ms || a.track - b.track);
    const clusters = [];
    let cur = null;
    for (const b of ordered) {
      const startNew = !cur || (b.track === 1 && b.key && b.ms > cur.ms) || b.ms - cur.ms > 30000;
      if (startNew) {
        cur = { ms: b.ms, blocks: [] };
        clusters.push(cur);
      }
      cur.blocks.push(b);
    }
    const clusterBytes = clusters.map((c) => master(ID.Cluster, uint(ID.Timestamp, c.ms), ...c.blocks.map((b) => {
      const rel = b.ms - c.ms;
      if (b.alpha && b.alpha.length) {
        return master(ID.BlockGroup,
          el(ID.Block, blockBytes(b.track, rel, 0, b.data)),
          master(ID.BlockAdditions, master(ID.BlockMore, uint(ID.BlockAddID, 1), bin(ID.BlockAdditional, b.alpha))),
          b.key ? null : el(ID.ReferenceBlock, new Uint8Array([0xff])));
      }
      return el(ID.SimpleBlock, blockBytes(b.track, rel, b.key ? 0x80 : 0, b.data));
    })));

    // Segment layout: SeekHead, Info, Tracks, Clusters, Cues. Positions are
    // relative to the start of the Segment's data. SeekPosition uses fixed
    // eight-byte integers so the SeekHead size does not depend on them.
    const seekHead = (infoPos, tracksPos, cuesPos) => master(ID.SeekHead,
      master(ID.Seek, bin(ID.SeekID, new Uint8Array(idBytes(ID.Info))), uint(ID.SeekPosition, infoPos, 8)),
      master(ID.Seek, bin(ID.SeekID, new Uint8Array(idBytes(ID.Tracks))), uint(ID.SeekPosition, tracksPos, 8)),
      master(ID.Seek, bin(ID.SeekID, new Uint8Array(idBytes(ID.Cues))), uint(ID.SeekPosition, cuesPos, 8)));
    const headLen = seekHead(0, 0, 0).length;
    const infoPos = headLen;
    const tracksPos = infoPos + info.length;
    let pos = tracksPos + tracks.length;
    const cuePoints = [];
    clusters.forEach((c, i) => {
      if (c.blocks.some((b) => b.track === 1 && b.key)) cuePoints.push(master(ID.CuePoint, uint(ID.CueTime, c.ms), master(ID.CueTrackPositions, uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, pos))));
      pos += clusterBytes[i].length;
    });
    const cues = master(ID.Cues, ...cuePoints);
    const segment = master(ID.Segment, seekHead(infoPos, tracksPos, pos), info, tracks, ...clusterBytes, cues);
    return concatBytes([ebml, segment]);
  }
}
