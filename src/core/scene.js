/**
 * Scene: the root of the scene graph plus the build clock. A scene is built
 * by an async function that adds nodes and plays animations; building
 * records tracks and never renders. Rendering samples the recorded tracks.
 *
 *   export default async function build(scene) {
 *     const c = scene.add(new Circle({ radius: 1.5 }));
 *     await scene.play(create(c));
 *     await scene.play(c.animate.shift([2, 0]).set('fill', 'accent'));
 *     await scene.wait(1);
 *   }
 *
 * @module core/scene
 */

import { Node, Group, ctx, resetIds } from './node.js';
import { Random } from './random.js';
import { Animation, toAnimation } from './animations.js';

/** Frame short side in world units. A 1920x1080 frame is 16 x 9 units. */
export const FRAME_SHORT_SIDE = 9;

/**
 * Camera: position, zoom, and rotation of the view, animatable like any node.
 */
export class Camera extends Node {
  constructor() {
    super('camera', { id: 'camera' });
    this._define('zoom', 1);
  }

  /** @returns {number} */
  get zoom() {
    return this.get('zoom');
  }

  set zoom(v) {
    this.set('zoom', v);
  }

  /**
   * Center the view on a node or point and zoom so it fills the frame with a margin.
   * @param {Node|number[]} target
   * @param {number} [margin=1]
   * @returns {this}
   */
  frameTo(target, margin = 1) {
    if (!this.scene) throw new Error('Camera is not attached to a scene');
    if (Array.isArray(target)) {
      this.set('x', target[0]);
      return this.set('y', target[1]);
    }
    const b = target.bounds();
    if (!b) return this;
    this.set('x', b.x + b.w / 2);
    this.set('y', b.y + b.h / 2);
    const z = Math.min(this.scene.frameWidth / (b.w + 2 * margin), this.scene.frameHeight / (b.h + 2 * margin));
    return this.set('zoom', z);
  }

  /** Reset to the default view. @returns {this} */
  reset() {
    return this.set({ x: 0, y: 0, zoom: 1, rotation: 0 });
  }
}

/**
 * @typedef {Object} SceneOptions
 * @property {number} [width=1920] Output width in pixels.
 * @property {number} [height=1080] Output height in pixels.
 * @property {number} [fps=60]
 * @property {number|string} [seed=1]
 * @property {string|Object} [theme='qubibyte'] Theme id or theme object.
 * @property {string} [board] Board style override ('chalkboard', 'whiteboard', 'paper', 'blueprint').
 * @property {string} [title]
 */

/**
 * @typedef {Object} Updater
 * @property {(t: number, dt: number) => void} fn
 * @property {number} t0
 * @property {number} t1
 */

/** The scene. */
export class Scene {
  /** @param {SceneOptions} [opts] */
  constructor(opts = {}) {
    resetIds();
    this.width = opts.width ?? 1920;
    this.height = opts.height ?? 1080;
    this.fps = opts.fps ?? 60;
    this.seed = opts.seed ?? 1;
    this.theme = opts.theme ?? 'qubibyte';
    this.board = opts.board ?? null;
    this.title = opts.title ?? '';
    const short = Math.min(this.width, this.height);
    /** World units per pixel. */
    this.unit = FRAME_SHORT_SIDE / short;
    this.frameWidth = this.width * this.unit;
    this.frameHeight = this.height * this.unit;
    this.root = new Group([], { id: 'root' });
    this.root._attach(this);
    /** Group that `add` puts new nodes into: the root, or an included scene's group. */
    this.container = this.root;
    this.camera = new Camera();
    this.camera._attach(this);
    this.clock = 0;
    this.building = false;
    this._maxTime = 0;
    /** @type {Map<string, number>} */
    this.labels = new Map();
    /** @type {Array<{time: number, name: string}>} */
    this.pauses = [];
    /** @type {Array<{start: number, end: number, text: string}>} */
    this.captions = [];
    /** @type {Array<Object>} */
    this.audio = [];
    /** @type {Updater[]} */
    this.updaters = [];
    /** @type {Array<{time: number, rate: number}>} */
    this.rateChanges = [];
    /** @type {Array<{time: number, duration: number}>} */
    this.holds = [];
    /** @type {Map<string, any>} */
    this.assets = new Map();
    /** Interactive controls exposed to an embedding page. @type {Array<Object>} */
    this.controls = [];
    this.rng = new Random(this.seed);
  }

  /** @param {number} t @internal */
  _noteTime(t) {
    if (t > this._maxTime && Number.isFinite(t)) this._maxTime = t;
  }

  /** Scene duration in scene time (seconds). @returns {number} */
  get sceneDuration() {
    return Math.max(this.clock, this._maxTime);
  }

  /** Output duration in seconds, after speed changes and holds. @returns {number} */
  get duration() {
    return this.sceneToOutputTime(this.sceneDuration);
  }

  /** Number of output frames. @returns {number} */
  get frameCount() {
    return Math.max(1, Math.round(this.duration * this.fps));
  }

  /**
   * Add nodes to the scene. Nodes added after time 0 appear at the current clock.
   * @template {Node} T
   * @param {T} node
   * @param {...Node} more
   * @returns {T}
   */
  add(node, ...more) {
    for (const n of [node, ...more].flat()) {
      if (!n) continue;
      if (n.parent === this.container && n.scene === this) {
        n.set('visible', true);
        continue;
      }
      const appearsLater = this.building && this.clock > 0;
      this.container.add(n);
      if (appearsLater) {
        n._init.visible = false;
        n.tween('visible', this.clock, this.clock, true, (u) => u, null, false);
      } else {
        n.set('visible', true);
      }
    }
    return node;
  }

  /**
   * Compose scenes: run another scene's build function on this timeline,
   * with everything it adds placed in one group that can be moved, scaled,
   * or animated as a unit. Its animations play from the current clock; the
   * clock advances past them.
   *
   *   const inset = await scene.include(taylorScene, { x: 4, y: -2, scale: 0.4 });
   *
   * @param {(scene: Scene) => any} build a scene function (the default export of a scene module)
   * @param {Record<string, any>} [props] Group props for the container (x, y, scale, opacity, ...)
   * @returns {Promise<Group>} the container
   */
  async include(build, props = {}) {
    const { x, y, scale, rotation, ...rest } = props;
    const group = new Group([], { type: 'include', ...rest });
    this.add(group);
    const outer = this.container;
    this.container = group;
    try {
      // The sub-scene builds with its container at the identity, so world
      // coordinates it computes while building (axes points, bounds) are
      // container coordinates; the placement applies afterwards, from time 0.
      await build(this);
    } finally {
      this.container = outer;
    }
    const placement = { x, y, scale, rotation };
    const saved = this.clock;
    this.clock = 0;
    for (const [k, v] of Object.entries(placement)) if (v !== undefined) group.set(k, v);
    this.clock = saved;
    return group;
  }

  /**
   * Hide nodes from the current clock on.
   * @param {...Node} nodes
   * @returns {this}
   */
  remove(...nodes) {
    for (const n of nodes.flat()) if (n) n.set('visible', false);
    return this;
  }

  /**
   * Play animations starting at the clock and advance the clock to the end
   * of the longest one. A trailing plain object sets options for all of
   * them: duration, ease, lagRatio.
   * @param {...any} items Animations, `.animate` chains, or a final options object.
   * @returns {Promise<void>}
   */
  play(...items) {
    let opts = {};
    const last = items[items.length - 1];
    if (last && !(last instanceof Animation) && !last.__isAnimateBuilder && typeof last === 'object' && !Array.isArray(last)) {
      opts = items.pop();
    }
    const anims = items.flat().map(toAnimation);
    if (!anims.length) return Promise.resolve();
    const t0 = this.clock;
    let end = t0;
    for (const a of anims) {
      a.applyDefaults(opts, this);
      end = Math.max(end, a.schedule(this, t0));
    }
    this.clock = end;
    this._noteTime(end);
    return Promise.resolve();
  }

  /**
   * Advance the clock.
   * @param {number} [seconds=1]
   * @returns {Promise<void>}
   */
  wait(seconds = 1) {
    this.clock += Math.max(0, seconds);
    this._noteTime(this.clock);
    return Promise.resolve();
  }

  /**
   * Name the current time.
   * @param {string} name
   * @returns {this}
   */
  label(name) {
    this.labels.set(name, this.clock);
    return this;
  }

  /**
   * Define named times (voiceover markers, beats) in scene time.
   * @param {Record<string, number>} marks
   * @returns {this}
   */
  markers(marks) {
    for (const [k, v] of Object.entries(marks)) this.labels.set(k, v);
    return this;
  }

  /**
   * Advance the clock to a label or marker. Waiting for a time that has
   * already passed does nothing.
   * @param {string} name
   * @returns {Promise<void>}
   */
  waitUntil(name) {
    if (!this.labels.has(name)) throw new Error(`No label or marker named "${name}"`);
    const t = this.labels.get(name);
    if (t > this.clock) this.clock = t;
    this._noteTime(this.clock);
    return Promise.resolve();
  }

  /**
   * Run a block at an absolute scene time, then restore the clock.
   * @param {number|string} time seconds or a label name
   * @param {(scene: Scene) => any} fn
   * @returns {Promise<void>}
   */
  async at(time, fn) {
    const saved = this.clock;
    this.clock = typeof time === 'string' ? this.labels.get(time) ?? 0 : time;
    await fn(this);
    this._noteTime(this.clock);
    this.clock = saved;
  }

  /**
   * Run several blocks from the same start time (nested timelines); the
   * clock ends at the latest end.
   * @param {...((scene: Scene) => any)} fns
   * @returns {Promise<void>}
   */
  async parallel(...fns) {
    const start = this.clock;
    let end = start;
    for (const fn of fns) {
      this.clock = start;
      await fn(this);
      end = Math.max(end, this.clock);
    }
    this.clock = end;
    this._noteTime(end);
  }

  /**
   * Mark a pause point for interactive playback (exports ignore it).
   * @param {string} [name]
   * @returns {this}
   */
  pause(name = `pause${this.pauses.length + 1}`) {
    this.pauses.push({ time: this.clock, name });
    return this;
  }

  /**
   * Change playback rate from the current scene time on (time remapping).
   * A rate of 2 plays twice as fast; the output gets shorter.
   * @param {number} rate
   * @returns {this}
   */
  setSpeed(rate) {
    if (!(rate > 0)) throw new Error('Speed must be positive; use hold() to freeze time');
    this.rateChanges.push({ time: this.clock, rate });
    this.rateChanges.sort((a, b) => a.time - b.time);
    return this;
  }

  /**
   * Speed ramp over a scene-time range: rate eases from `from` to `to` in `steps` pieces.
   * @param {number} from
   * @param {number} to
   * @param {number} duration scene seconds
   * @param {number} [steps=12]
   * @returns {this}
   */
  speedRamp(from, to, duration, steps = 12) {
    const t0 = this.clock;
    for (let i = 0; i < steps; i++) {
      const u = (i + 0.5) / steps;
      this.rateChanges.push({ time: t0 + (duration * i) / steps, rate: from + (to - from) * u });
    }
    this.rateChanges.sort((a, b) => a.time - b.time);
    return this;
  }

  /**
   * Freeze scene time for a number of output seconds (variable-length hold).
   * @param {number} seconds
   * @returns {this}
   */
  hold(seconds) {
    this.holds.push({ time: this.clock, duration: seconds });
    return this;
  }

  /** @param {number} t scene time @returns {number} rate at t @private */
  _rateAt(t) {
    let r = 1;
    for (const c of this.rateChanges) if (c.time <= t) r = c.rate;
    return r;
  }

  /**
   * Convert scene time to output time.
   * @param {number} t
   * @returns {number}
   */
  sceneToOutputTime(t) {
    const cuts = [...new Set([0, t, ...this.rateChanges.map((c) => c.time).filter((x) => x > 0 && x < t)])].sort((a, b) => a - b);
    let T = 0;
    for (let i = 0; i + 1 < cuts.length; i++) T += (cuts[i + 1] - cuts[i]) / this._rateAt(cuts[i]);
    for (const h of this.holds) if (h.time < t) T += h.duration;
    return T;
  }

  /**
   * Convert output time to scene time (inverse of sceneToOutputTime; holds map to a constant).
   * @param {number} T
   * @returns {number}
   */
  outputToSceneTime(T) {
    if (!this.rateChanges.length && !this.holds.length) return T;
    let lo = 0;
    let hi = this.sceneDuration;
    if (T >= this.sceneToOutputTime(hi)) return hi;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (this.sceneToOutputTime(mid) <= T) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Scene time of output frame n.
   * @param {number} n
   * @returns {number}
   */
  frameTime(n) {
    return this.outputToSceneTime(n / this.fps);
  }

  /**
   * Register an updater that runs every frame from now on. It may read
   * sampled values and set properties for that frame.
   * @param {(t: number, dt: number) => void} fn
   * @returns {{stop: () => void}}
   */
  always(fn) {
    const u = { fn, t0: this.clock, t1: Infinity };
    this.updaters.push(u);
    return {
      stop: () => {
        u.t1 = this.clock;
      },
    };
  }

  /**
   * Show a caption from the clock for a duration (exported as SRT and burned in on request).
   * @param {string} text
   * @param {number} [duration=2]
   * @returns {this}
   */
  caption(text, duration = 2) {
    this.captions.push({ start: this.clock, end: this.clock + duration, text });
    this._noteTime(this.clock + duration);
    return this;
  }

  /**
   * Attach an audio track or clip at the clock.
   * @param {string} source asset id or URL
   * @param {{volume?: number, offset?: number}} [opts]
   * @returns {this}
   */
  sound(source, opts = {}) {
    this.audio.push({ kind: 'file', source, time: this.clock, volume: opts.volume ?? 1, offset: opts.offset ?? 0 });
    return this;
  }

  /**
   * Synthesized tone or sweep at the clock.
   * @param {{from?: number, to?: number, duration?: number, volume?: number, wave?: 'sine'|'triangle'|'square'}} [opts]
   * @returns {this}
   */
  tone(opts = {}) {
    this.audio.push({ kind: 'tone', time: this.clock, from: opts.from ?? 440, to: opts.to ?? opts.from ?? 440, duration: opts.duration ?? 0.3, volume: opts.volume ?? 0.2, wave: opts.wave ?? 'sine' });
    return this;
  }

  /**
   * Short click at the clock.
   * @param {{volume?: number}} [opts]
   * @returns {this}
   */
  click(opts = {}) {
    this.audio.push({ kind: 'click', time: this.clock, volume: opts.volume ?? 0.3 });
    return this;
  }

  /**
   * Register an interactive control (slider, toggle). In the browser the
   * player renders it; exports use the tracker's recorded value.
   * @param {Object} control
   * @returns {Object}
   */
  control(control) {
    this.controls.push(control);
    return control;
  }

  /**
   * Evaluate a function with the scene sampled at time t (read-only helper for tests and tools).
   * @template T
   * @param {number} t
   * @param {() => T} fn
   * @returns {T}
   */
  evaluateAt(t, fn) {
    const prev = { sampling: ctx.sampling, t: ctx.t, frame: ctx.frame };
    ctx.sampling = true;
    ctx.t = t;
    ctx.frame = new Map();
    try {
      return fn();
    } finally {
      ctx.sampling = prev.sampling;
      ctx.t = prev.t;
      ctx.frame = prev.frame;
    }
  }

  /**
   * Find a node by id.
   * @param {string} id
   * @returns {Node|undefined}
   */
  find(id) {
    return this.root.family().find((n) => n.id === id);
  }
}

const preloads = [];

/**
 * Register an async task that must finish before any scene builds (fonts,
 * stroke fonts). Tasks run once; later builds reuse the result.
 * @param {() => Promise<any>} fn
 */
export function registerPreload(fn) {
  preloads.push({ fn, promise: null });
}

/**
 * Run registered preload tasks.
 * @returns {Promise<void>}
 */
export async function preload() {
  for (const p of preloads) {
    if (!p.promise) p.promise = p.fn();
    await p.promise;
  }
}

/**
 * Build a scene by running an async build function.
 * @param {(scene: Scene) => any} buildFn
 * @param {SceneOptions} [opts]
 * @returns {Promise<Scene>}
 */
export async function buildScene(buildFn, opts = {}) {
  await preload();
  const scene = new Scene(opts);
  scene.building = true;
  const outer = ctx.building;
  ctx.building = scene;
  try {
    await buildFn(scene);
  } finally {
    scene.building = false;
    ctx.building = outer;
  }
  return scene;
}
