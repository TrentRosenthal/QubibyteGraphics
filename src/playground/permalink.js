/**
 * Permalinks: the current source (scene code, Qubi program, or scene
 * document) compressed with raw DEFLATE and written to the URL fragment as
 * base64url, so a link carries the whole scene and no server stores it.
 *
 *   #code=...   scene module source
 *   #qubi=...   Qubi program
 *   #doc=...    scene document JSON
 *
 * @module playground/permalink
 */

const KINDS = ['code', 'qubi', 'doc'];

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * Encode a source as a URL fragment.
 * @param {'code'|'qubi'|'doc'} kind
 * @param {string} text
 * @returns {Promise<string>} a fragment starting with `#`
 */
export async function encodePermalink(kind, text) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown permalink kind "${kind}"`);
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  return `#${kind}=${toBase64Url(packed)}`;
}

/**
 * Decode a URL fragment written by encodePermalink.
 * @param {string} hash `location.hash`
 * @returns {Promise<{kind: 'code'|'qubi'|'doc', text: string}|null>} null when the fragment holds no source
 */
export async function decodePermalink(hash) {
  const m = /^#?(code|qubi|doc)=([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return null;
  const bytes = await pipe(fromBase64Url(m[2]), new DecompressionStream('deflate-raw'));
  return { kind: /** @type {any} */ (m[1]), text: new TextDecoder().decode(bytes) };
}
