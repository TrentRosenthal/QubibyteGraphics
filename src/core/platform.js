/**
 * Platform adapter. The browser provides canvases and image decoding
 * natively; the Node CLI installs implementations from @napi-rs/canvas.
 * @module core/platform
 */

const impl = {
  /** @type {(w: number, h: number) => any} */
  createCanvas: (w, h) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },
  /** @type {(src: string|ArrayBuffer|Uint8Array|Blob) => Promise<any>} */
  loadImage: async (src) => {
    if (typeof src === 'string') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.src = src;
      await img.decode();
      return img;
    }
    const blob = src instanceof Blob ? src : new Blob([src]);
    return createImageBitmap(blob);
  },
};

/**
 * Replace platform functions (used by the Node CLI and tests).
 * @param {Partial<typeof impl>} overrides
 */
export function setPlatform(overrides) {
  Object.assign(impl, overrides);
}

/**
 * Create an offscreen canvas.
 * @param {number} w
 * @param {number} h
 * @returns {any}
 */
export function createCanvas(w, h) {
  return impl.createCanvas(w, h);
}

/**
 * Decode an image from a URL, path, or bytes.
 * @param {string|ArrayBuffer|Uint8Array|Blob} src
 * @returns {Promise<any>}
 */
export function loadImage(src) {
  return impl.loadImage(src);
}
