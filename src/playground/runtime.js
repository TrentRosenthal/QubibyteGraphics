/**
 * Page-side client of the scene sandbox. It owns the preview canvas,
 * transfers it to a module Worker (or, without OffscreenCanvas, runs a
 * sandboxed iframe and draws the ImageBitmaps it sends), and exposes a
 * promise API: load, seek, pick, inspect, export.
 * @module playground/runtime
 */

/* global EventTarget */

const WORKER_URL = new URL('./runtime-worker.js', import.meta.url);
const SANDBOX_URL = new URL('./sandbox.html', import.meta.url);
const BUILD_TIMEOUT_MS = 20000;

/**
 * Whether this browser can render in a worker.
 * @returns {boolean}
 */
function offscreenSupported() {
  return typeof OffscreenCanvas !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

/**
 * A scene runtime bound to one preview canvas.
 * Events: `frame` (detail: {t, n, captions, blocks}), `progress`, `restart`.
 */
export class Runtime extends EventTarget {
  /**
   * @param {HTMLElement|null} host element that receives the preview canvas; null for a headless runtime
   * @param {{mode?: 'worker'|'iframe'}} [opts]
   */
  constructor(host, opts = {}) {
    super();
    this.host = host;
    const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('runtime') : null;
    this.mode = opts.mode ?? (forced === 'iframe' || !offscreenSupported() ? 'iframe' : 'worker');
    this.nextId = 1;
    this.waiting = new Map();
    this.inflight = false;
    this.wantT = null;
    this.sentT = null;
    this.viewport = null;
    this.lastLoad = null;
    this.ready = this.spawn();
  }

  /** Create the canvas and the sandbox. @returns {Promise<void>} */
  spawn() {
    if (this.host) {
      if (this.canvas) this.canvas.remove();
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'preview-canvas';
      this.canvas.setAttribute('aria-label', 'Scene preview');
      this.canvas.setAttribute('role', 'img');
      this.host.prepend(this.canvas);
    }
    this.inflight = false;
    return new Promise((resolve) => {
      const onMessage = (m) => {
        if (m.type === 'ready') {
          resolve();
          return;
        }
        this.receive(m);
      };
      if (this.mode === 'worker') {
        this.worker = new Worker(WORKER_URL, { type: 'module' });
        this.worker.onmessage = (e) => onMessage(e.data);
        this.worker.onerror = (e) => {
          e.preventDefault();
          this.failAll(new Error(e.message || 'The scene worker stopped'));
        };
        this.post = (msg, transfer) => this.worker.postMessage(msg, transfer || []);
        if (this.canvas) {
          const off = this.canvas.transferControlToOffscreen();
          this.post({ type: 'init', canvas: off, id: 0 }, [off]);
        }
      } else {
        this.iframe = document.createElement('iframe');
        this.iframe.setAttribute('sandbox', 'allow-scripts');
        this.iframe.setAttribute('aria-hidden', 'true');
        this.iframe.tabIndex = -1;
        this.iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
        this.iframe.src = SANDBOX_URL.href;
        this.listener = (e) => {
          if (e.source === this.iframe.contentWindow) onMessage(e.data);
        };
        window.addEventListener('message', this.listener);
        document.body.append(this.iframe);
        this.post = (msg, transfer) => this.iframe.contentWindow.postMessage(msg, '*', transfer || []);
      }
    });
  }

  /** Stop the sandbox and start a fresh one (after a hung build). */
  async restart() {
    this.teardown();
    this.ready = this.spawn();
    await this.ready;
    if (this.viewport) this.post({ type: 'viewport', ...this.viewport });
    this.dispatchEvent(new Event('restart'));
  }

  teardown() {
    if (this.worker) this.worker.terminate();
    if (this.iframe) this.iframe.remove();
    if (this.listener) window.removeEventListener('message', this.listener);
    this.worker = null;
    this.iframe = null;
    this.failAll(new Error('The runtime restarted'));
  }

  /** Release the sandbox and the canvas. */
  destroy() {
    this.teardown();
    if (this.canvas) this.canvas.remove();
  }

  failAll(err) {
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }

  receive(m) {
    if (m.type === 'result') {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.ok) w.resolve(m.value);
      else {
        const err = new Error(m.error.message);
        Object.assign(err, m.error);
        w.reject(err);
      }
      return;
    }
    if (m.type === 'frame') {
      this.inflight = false;
      if (m.bitmap && this.canvas) {
        if (this.canvas.width !== m.bitmap.width) this.canvas.width = m.bitmap.width;
        if (this.canvas.height !== m.bitmap.height) this.canvas.height = m.bitmap.height;
        this.canvas.getContext('bitmaprenderer').transferFromImageBitmap(m.bitmap);
      } else if (m.bitmap) m.bitmap.close();
      this.dispatchEvent(new CustomEvent('frame', { detail: m }));
      if (this.wantT != null && this.sentT === null) this.flushSeek();
      return;
    }
    this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
  }

  /**
   * Send a request and wait for its reply.
   * @param {string} type
   * @param {Record<string, any>} [payload]
   * @param {{transfer?: any[], timeout?: number}} [opts]
   * @returns {Promise<any>}
   */
  async request(type, payload = {}, opts = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer = null;
      if (opts.timeout) {
        timer = setTimeout(() => {
          if (!this.waiting.has(id)) return;
          this.waiting.delete(id);
          reject(Object.assign(new Error(`The scene took longer than ${Math.round(opts.timeout / 1000)} seconds to build and was stopped.`), { line: null, col: null }));
          this.restart();
        }, opts.timeout);
      }
      this.waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.post({ ...payload, type, id }, opts.transfer);
    });
  }

  /**
   * Load a source and build its scene.
   * @param {'module'|'document'} kind
   * @param {{source?: string, doc?: any, baseURL?: string}} payload
   * @param {Record<string, any>} [options] width, height, fps, theme, board, themes
   * @returns {Promise<any>} scene info
   */
  async load(kind, payload, options = {}) {
    this.lastLoad = { kind, payload, options };
    this.inflight = false;
    return this.request('load', { kind, ...payload, options }, { timeout: BUILD_TIMEOUT_MS });
  }

  /**
   * Show the frame at an output time. Requests are coalesced: while a frame
   * is rendering, only the latest time is kept.
   * @param {number} t seconds
   * @param {boolean} [layout] documents only: show every block at rest instead of the animated frame
   */
  seek(t, layout = false) {
    if (this.wantT !== t || this.wantLayout !== layout) this.sentT = null;
    this.wantT = t;
    this.wantLayout = layout;
    if (!this.inflight) this.flushSeek();
  }

  flushSeek() {
    if (!this.post) return;
    this.inflight = true;
    this.sentT = this.wantT;
    this.post({ type: 'seek', t: this.wantT, layout: this.wantLayout });
  }

  /**
   * Set the preview size in device pixels.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this.viewport = { width: Math.round(width), height: Math.round(height) };
    this.ready.then(() => this.post({ type: 'viewport', ...this.viewport }));
  }

  /** @param {number} index @param {number} value @returns {Promise<any>} */
  setControl(index, value) {
    return this.request('control', { index, value });
  }

  /** @param {string} source @param {string} [color] @returns {Promise<{svg: string, width: number, height: number}>} */
  texPreview(source, color) {
    return this.request('texPreview', { source, color });
  }

  /**
   * Export the loaded scene. Progress arrives as `progress` events.
   * @param {Record<string, any>} options format, width, height, fps, transparent, gif, t
   * @returns {Promise<{blob: Blob, ext: string, notes: string[], frames: number, width: number, height: number}>}
   */
  exportScene(options) {
    return this.request('export', { options });
  }

  /** Stop a running export. */
  cancelExport() {
    if (this.post) this.post({ type: 'cancelExport' });
  }
}
