/**
 * `<qubibyte-scene>`: embed a scene with one script tag.
 *
 *   <script type="module" src="https://.../src/embed/qubibyte-scene.js"></script>
 *   <qubibyte-scene src="scene.js" autoplay loop controls></qubibyte-scene>
 *
 * Attributes: `src` (a scene module .js or a scene document .json),
 * `autoplay`, `loop`, `controls`, `theme`, `poster-time` (seconds shown
 * before playing). The scene loads when the element scrolls into view,
 * runs in the same sandboxed worker runtime as the playground, and honors
 * `prefers-reduced-motion` by showing the last frame without autoplay.
 *
 * Methods: `play()`, `pause()`, `seek(seconds)`. Properties: `currentTime`,
 * `duration`, `paused`. Events: `ready`, `play`, `pause`, `timeupdate`, `ended`.
 * @module embed/qubibyte-scene
 */

import { Runtime } from '../playground/runtime.js';

const STYLES = [new URL('../../styles/tokens.css', import.meta.url).href, new URL('../../styles/embed.css', import.meta.url).href];
const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 3.5v9l7.5-4.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z"/></svg>';

function fmt(t) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** The custom element. */
class QubibyteScene extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'theme', 'controls'];
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `${STYLES.map((h) => `<link rel="stylesheet" href="${h}">`).join('')}
      <div class="qs" part="frame">
        <div class="qs-stage" part="stage"><div class="qs-status" role="status"></div></div>
        <div class="qs-bar" part="controls" hidden>
          <button type="button" class="qs-play" aria-label="Play">${PLAY}</button>
          <input type="range" class="qs-seek" min="0" max="1" step="0.001" value="0" aria-label="Seek">
          <span class="qs-time">0:00.0</span>
        </div>
      </div>`;
    this.stage = this.root.querySelector('.qs-stage');
    this.statusEl = this.root.querySelector('.qs-status');
    this.bar = this.root.querySelector('.qs-bar');
    this.playBtn = this.root.querySelector('.qs-play');
    this.seekEl = this.root.querySelector('.qs-seek');
    this.timeEl = this.root.querySelector('.qs-time');
    this.t = 0;
    this.info = null;
    this.rate = 0;
    this.loaded = null;
    const toggle = () => {
      if (this.paused) this.play();
      else this.pause();
    };
    this.playBtn.addEventListener('click', toggle);
    this.seekEl.addEventListener('input', () => {
      this.pause();
      this.seek(Number(this.seekEl.value) * this.duration);
    });
    this.stage.addEventListener('click', () => {
      if (this.hasAttribute('controls')) toggle();
    });
  }

  connectedCallback() {
    this.bar.hidden = !this.hasAttribute('controls');
    if (this.io) return;
    this.io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        this.io.disconnect();
        this.load();
      }
    }, { rootMargin: '200px' });
    this.io.observe(this);
  }

  disconnectedCallback() {
    this.pause();
    if (this.io) this.io.disconnect();
    this.io = null;
    if (this.runtime) this.runtime.destroy();
    this.runtime = null;
    this.loaded = null;
  }

  attributeChangedCallback(name, oldValue, value) {
    if (name === 'controls') this.bar.hidden = value === null;
    else if (oldValue !== value && this.loaded) {
      this.loaded = null;
      this.load();
    }
  }

  /** @returns {number} seconds */
  get duration() {
    return this.info ? this.info.duration : 0;
  }

  /** @returns {number} seconds */
  get currentTime() {
    return this.t;
  }

  set currentTime(v) {
    this.seek(v);
  }

  /** @returns {boolean} */
  get paused() {
    return this.rate === 0;
  }

  /**
   * Load the scene (runs once the element is near the viewport).
   * @returns {Promise<void>}
   */
  load() {
    if (this.loaded) return this.loaded;
    this.loaded = (async () => {
      const src = this.getAttribute('src');
      if (!src) throw new Error('<qubibyte-scene> needs a src attribute');
      this.status('Loading');
      const url = new URL(src, document.baseURI);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load ${src}: HTTP ${res.status}`);
      const text = await res.text();
      if (!this.runtime) {
        this.runtime = new Runtime(this.stage);
        this.runtime.addEventListener('frame', () => this.status(''));
        new ResizeObserver(() => this.layout()).observe(this.stage);
      }
      const options = {};
      if (this.getAttribute('theme')) options.theme = this.getAttribute('theme');
      const isDoc = /\.json($|\?)/i.test(url.pathname) || text.trimStart().startsWith('{');
      this.info = isDoc ? await this.runtime.load('document', { doc: JSON.parse(text) }, options) : await this.runtime.load('module', { source: text, baseURL: url.href }, options);
      this.style.setProperty('--qs-aspect', `${this.info.width} / ${this.info.height}`);
      this.layout();
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const poster = Number(this.getAttribute('poster-time'));
      this.seek(reduced ? this.duration : Number.isFinite(poster) && this.hasAttribute('poster-time') ? poster : 0);
      this.dispatchEvent(new Event('ready'));
      if (this.hasAttribute('autoplay') && !reduced) this.play();
    })().catch((e) => {
      this.status(e.message, true);
      this.dispatchEvent(new CustomEvent('error', { detail: e }));
    });
    return this.loaded;
  }

  status(text, error = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-error', error);
  }

  layout() {
    if (!this.runtime) return;
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (r.width > 0 && r.height > 0) this.runtime.resize(Math.round(r.width * dpr), Math.round(r.height * dpr));
  }

  /** Start playing (after the scene has loaded). */
  async play() {
    await this.load();
    if (!this.info || this.rate) return;
    if (this.t >= this.duration - 1e-6) this.t = 0;
    this.rate = 1;
    this.playBtn.innerHTML = PAUSE;
    this.playBtn.setAttribute('aria-label', 'Pause');
    this.dispatchEvent(new Event('play'));
    let last = performance.now();
    let lastEvent = 0;
    const tick = (now) => {
      if (!this.rate) return;
      let t = this.t + ((now - last) / 1000) * this.rate;
      last = now;
      if (t >= this.duration) {
        if (this.hasAttribute('loop')) t = 0;
        else {
          this.seek(this.duration);
          this.pause();
          this.dispatchEvent(new Event('ended'));
          return;
        }
      }
      this.seek(t, now - lastEvent > 100);
      if (now - lastEvent > 100) lastEvent = now;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Stop playing. */
  pause() {
    if (!this.rate) return;
    this.rate = 0;
    cancelAnimationFrame(this.raf);
    this.playBtn.innerHTML = PLAY;
    this.playBtn.setAttribute('aria-label', 'Play');
    this.dispatchEvent(new Event('pause'));
  }

  /**
   * Show a time.
   * @param {number} seconds
   * @param {boolean} [notify=true] dispatch timeupdate
   */
  seek(seconds, notify = true) {
    const t = Math.max(0, Math.min(this.duration, Number(seconds) || 0));
    this.t = t;
    if (this.runtime) this.runtime.seek(t);
    this.seekEl.value = this.duration ? String(t / this.duration) : '0';
    this.timeEl.textContent = fmt(t);
    if (notify) this.dispatchEvent(new Event('timeupdate'));
  }
}

if (!customElements.get('qubibyte-scene')) customElements.define('qubibyte-scene', QubibyteScene);
