/**
 * Byte helpers shared by the muxers and image encoders: a growable
 * big-endian writer, concatenation, and CRC-32.
 * @module playground/export/bytes
 */

/** Growable byte buffer with big-endian writers. */
export class ByteWriter {
  constructor(size = 1024) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }

  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v) {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
    return this;
  }

  u16(v) {
    this.ensure(2);
    this.view.setUint16(this.pos, v);
    this.pos += 2;
    return this;
  }

  i16(v) {
    this.ensure(2);
    this.view.setInt16(this.pos, v);
    this.pos += 2;
    return this;
  }

  u24(v) {
    return this.u8(v >>> 16).u8(v >>> 8).u8(v);
  }

  u32(v) {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0);
    this.pos += 4;
    return this;
  }

  i32(v) {
    this.ensure(4);
    this.view.setInt32(this.pos, v);
    this.pos += 4;
    return this;
  }

  u64(v) {
    this.ensure(8);
    this.view.setUint32(this.pos, Math.floor(v / 2 ** 32));
    this.view.setUint32(this.pos + 4, v >>> 0);
    this.pos += 8;
    return this;
  }

  f64(v) {
    this.ensure(8);
    this.view.setFloat64(this.pos, v);
    this.pos += 8;
    return this;
  }

  ascii(s) {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.pos++] = s.charCodeAt(i) & 0xff;
    return this;
  }

  bytes(b) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }

  /** @returns {Uint8Array} the written bytes (a copy-free view) */
  done() {
    return this.buf.subarray(0, this.pos);
  }
}

/**
 * Concatenate byte arrays.
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
export function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

let crcTable = null;

/**
 * CRC-32 (IEEE 802.3), as used by PNG chunks.
 * @param {Uint8Array} bytes
 * @param {number} [start=0]
 * @param {number} [end=bytes.length]
 * @returns {number}
 */
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
