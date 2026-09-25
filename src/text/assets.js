/**
 * Environment-neutral loading of bundled binary assets (fonts). Node reads
 * from the file system; the browser fetches relative to this module, so the
 * same code path serves both and neither needs a bundler.
 *
 * @module text/assets
 */

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

/** @type {Map<string, ArrayBuffer>} */
const overrides = new Map();

/**
 * Supply the bytes for an asset path ahead of time, so {@link loadBinary}
 * returns them instead of reading the file system or the network. Use this
 * in single-file bundles, offline embeds, or to swap a bundled font for a
 * custom build (TTF, OTF, WOFF or WOFF2) under the same path.
 * @param {string} name Asset path relative to the repository root, e.g. `vendor/fonts/inter/Inter-Regular.ttf`.
 * @param {ArrayBuffer} bytes File contents.
 * @returns {void}
 */
export function registerFontBytes(name, bytes) {
  if (!(bytes instanceof ArrayBuffer)) throw new TypeError('registerFontBytes: bytes must be an ArrayBuffer');
  overrides.set(name, bytes);
}

/**
 * Load a file that ships with the package.
 * @param {string} rel Path relative to the repository root, e.g. `vendor/fonts/inter/Inter-Regular.ttf`.
 * @returns {Promise<ArrayBuffer>} The file contents.
 */
export async function loadBinary(rel) {
  const pre = overrides.get(rel);
  if (pre) return pre;
  const url = new URL('../../' + rel, import.meta.url);
  if (isNode && url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const buf = await fs.readFile(fileURLToPath(url));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadBinary: ${rel}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Load a bundled text file (Hershey `.jhf` fonts).
 * @param {string} rel Path relative to the repository root.
 * @returns {Promise<string>} The file decoded as UTF-8.
 */
export async function loadText(rel) {
  return new TextDecoder('utf-8').decode(await loadBinary(rel));
}

/**
 * Inflate zlib-compressed bytes (RFC 1950), as used by WOFF 1.0 tables.
 * Uses `node:zlib` under Node and `DecompressionStream('deflate')` in browsers.
 * @param {Uint8Array} bytes Compressed data.
 * @returns {Promise<Uint8Array>} Decompressed data.
 */
export async function inflate(bytes) {
  if (isNode) {
    const zlib = await import('node:zlib');
    const out = zlib.inflateSync(bytes);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
