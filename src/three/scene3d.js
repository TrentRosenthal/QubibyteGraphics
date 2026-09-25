/**
 * Scene3D: a 3D viewport placed in the 2D scene graph. It holds Object3D
 * children and one or more cameras, and at sample time projects its content
 * into depth-ordered 2D PathItems in its own local 2D frame (width x height
 * world units centered on its position). Because the output is plain paths,
 * it renders the same in Node and the browser, in SVG export, and through
 * board-style renderers.
 * @module three/scene3d
 */

import { Node, PROP_KIND } from '../core/node.js';
import * as M from './mat4.js';
import { Camera3D } from './camera.js';
import { Object3D, sceneHooks, scene3dOf } from './object3d.js';
import { LIGHT_PRESETS, resolveLightPreset, worldLights } from './lighting.js';
import { renderUnits } from './render.js';

PROP_KIND.activeCamera = 'step';
PROP_KIND.background = 'color';

/** Default edge-class styles (for grid lines drawn on meshes). */
const EDGE_STYLES = {
  grid: { opacity: 0.22, width: 1.2 },
  major: { opacity: 0.42, width: 1.6 },
};

/** A 3D viewport node. */
export class Scene3D extends Node {
  /**
   * @param {Record<string, any>} [props] width and height (2D world units, default 8 x 6), background (color or null for transparent), camera (Camera3D or its props), lights (preset name or Light[]), shadow (true or {z, opacity}), labelFactory (text to Path), edgeStyles
   */
  constructor(props = {}) {
    const { camera, lights, shadow, labelFactory, edgeStyles, children, ...rest } = props;
    super('scene3d', rest);
    this._define('width', props.width ?? 8);
    this._define('height', props.height ?? 6);
    this._define('background', props.background ?? null);
    this._define('activeCamera', 0);
    /** @type {Camera3D[]} */
    this.cameras = [];
    this.lights = lights ?? null;
    this.shadow = shadow ?? false;
    this.labelFactory = labelFactory ?? null;
    this.edgeStyles = { ...EDGE_STYLES, ...(edgeStyles || {}) };
    this.addCamera(camera instanceof Camera3D ? camera : new Camera3D(camera || {}));
    if (children) this.add(...children);
  }

  /**
   * Add a camera; returns its index for {@link Scene3D#cut}.
   * @param {Camera3D} cam
   * @returns {number}
   */
  addCamera(cam) {
    this.cameras.push(cam);
    this.add(cam);
    return this.cameras.length - 1;
  }

  /** The active camera (at the current build or sample time). @returns {Camera3D} */
  get camera() {
    return this.cameras[Math.max(0, Math.min(this.cameras.length - 1, this.get('activeCamera') | 0))];
  }

  /**
   * Cut to another camera from the current clock on.
   * @param {Camera3D|number} cam
   * @returns {this}
   */
  cut(cam) {
    const i = typeof cam === 'number' ? cam : this.cameras.indexOf(cam);
    if (i < 0) throw new Error('Scene3D.cut: camera is not part of this scene');
    return this.set('activeCamera', i);
  }

  /** @returns {null} */
  geometry() {
    return null;
  }

  /**
   * Camera state for the viewport's aspect ratio.
   * @returns {import('./camera.js').CameraState}
   */
  cameraState() {
    return this.camera.state(this.get('width') / this.get('height'));
  }

  /**
   * Project a world point to this viewport's local 2D frame.
   * @param {number[]} p
   * @returns {number[]|null} [x, y], or null behind the camera
   */
  project(p) {
    const s = this.cameraState();
    const c = M.transformVec4(s.viewProj, [p[0], p[1], p[2], 1]);
    if (c[3] <= 1e-9) return null;
    return [(c[0] / c[3]) * (this.get('width') / 2), (c[1] / c[3]) * (this.get('height') / 2)];
  }

  /**
   * Render into sampler items.
   * @param {any} args sampler callback arguments
   */
  sampleItems(args) {
    const units = [];
    const ctx = { units, t: args.t };
    for (const c of this.children) if (c instanceof Object3D) c.collect(ctx, M.identity(), 1);
    renderScene(this, units, args, this.get('width'), this.get('height'), this.cameraState(), this.get('background'));
  }
}

function renderScene(owner, units, args, width, height, cam, background) {
  const preset = resolveLightPreset(args.theme);
  const rigSource = owner && owner.lights;
  const rig = Array.isArray(rigSource) ? rigSource : (LIGHT_PRESETS[typeof rigSource === 'string' ? rigSource : preset] || LIGHT_PRESETS.studio)();
  renderUnits({
    units,
    cam,
    lights: worldLights(rig, cam),
    preset,
    color: args.color,
    theme: args.theme,
    width,
    height,
    matrix: args.matrix,
    opacity: args.opacity,
    background,
    shadow: owner ? owner.shadow : false,
    labelFactory: owner ? owner.labelFactory : null,
    edgeStyles: owner ? owner.edgeStyles : EDGE_STYLES,
  }, args.items);
}

const standaloneCamera = new Camera3D();

sceneHooks.project = (node, p) => {
  const s = scene3dOf(node);
  if (s instanceof Scene3D) return s.project(p);
  const st = standaloneCamera.state(1);
  const c = M.transformVec4(st.viewProj, [p[0], p[1], p[2], 1]);
  return c[3] > 1e-9 ? [(c[0] / c[3]) * 4, (c[1] / c[3]) * 4] : null;
};

sceneHooks.standalone = (obj, args) => {
  const units = [];
  const own = obj.get('opacity');
  obj.collect({ units, t: args.t }, M.identity(), own > 0 ? 1 / own : 1);
  renderScene(null, units, args, 8, 8, standaloneCamera.state(1), null);
};
