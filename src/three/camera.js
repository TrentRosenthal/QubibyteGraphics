/**
 * 3D camera. Two forms share one node: an orbit form (theta, phi, distance
 * around a target, the usual math-figure camera) and a free form (a position
 * and an orientation quaternion, used by fly-throughs and slerped camera
 * moves). Every parameter is a tracked property, so camera keyframes are
 * ordinary tweens.
 *
 * World convention: z is up; theta is the azimuth from +x toward +y and phi
 * the polar angle from +z.
 * @module three/camera
 */

import { Node, PROP_KIND } from '../core/node.js';
import * as M from './mat4.js';
import * as Q from './quat.js';

PROP_KIND.orient = 'step';
PROP_KIND.mode = 'step';

/**
 * @typedef {Object} CameraState
 * @property {number[]} eye Effective eye (moved back during a projection morph).
 * @property {number[]} target
 * @property {number[]} right
 * @property {number[]} up
 * @property {number[]} forward
 * @property {import('./mat4.js').Mat4} view
 * @property {import('./mat4.js').Mat4} proj
 * @property {import('./mat4.js').Mat4} viewProj
 * @property {boolean} orthographic
 * @property {number[]} eyeH Homogeneous eye: [x, y, z, 1], or [-forward, 0] when orthographic.
 * @property {number} focus Distance from the unmorphed eye to the focus plane.
 * @property {number} near Near plane distance from the effective eye.
 * @property {number} aspect
 */

/** A perspective or orthographic camera. */
export class Camera3D extends Node {
  /**
   * @param {Record<string, any>} [props] theta, phi, distance, target [x, y, z], position [x, y, z] (switches to the free form), fov (degrees), ortho (0 to 1), roll, near, far
   */
  constructor(props = {}) {
    const { target, position, lookAt, ...rest } = props;
    super('camera3d', rest);
    this._define('mode', 'orbit');
    this._define('theta', props.theta ?? -Math.PI / 3.2);
    this._define('phi', props.phi ?? 1.18);
    this._define('distance', props.distance ?? 11);
    this._define('targetX', target ? target[0] : 0);
    this._define('targetY', target ? target[1] : 0);
    this._define('targetZ', target ? target[2] : 0);
    this._define('camX', 0);
    this._define('camY', 0);
    this._define('camZ', 0);
    this._define('orient', [0, 0, 0, 1]);
    this._define('fov', props.fov ?? 32);
    this._define('ortho', props.ortho ?? 0);
    this._define('roll', props.roll ?? 0);
    this._define('near', props.near ?? 0.05);
    this._define('far', props.far ?? 1000);
    if (position) this.setPosition(position, lookAt ?? target ?? [0, 0, 0]);
  }

  /** Target point. @returns {number[]} */
  target() {
    return [this.get('targetX'), this.get('targetY'), this.get('targetZ')];
  }

  /**
   * Unmorphed eye position and orthonormal basis.
   * @returns {{eye: number[], right: number[], up: number[], forward: number[]}}
   */
  basis() {
    let eye;
    let right;
    let up;
    let forward;
    if (this.get('mode') === 'free') {
      eye = [this.get('camX'), this.get('camY'), this.get('camZ')];
      const q = this.get('orient');
      right = Q.rotate(q, [1, 0, 0]);
      up = Q.rotate(q, [0, 1, 0]);
      const back = Q.rotate(q, [0, 0, 1]);
      forward = [-back[0], -back[1], -back[2]];
    } else {
      const th = this.get('theta');
      const ph = this.get('phi');
      const D = this.get('distance');
      const T = this.target();
      const dir = [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
      eye = [T[0] + D * dir[0], T[1] + D * dir[1], T[2] + D * dir[2]];
      forward = [-dir[0], -dir[1], -dir[2]];
      right = [-Math.sin(th), Math.cos(th), 0];
      up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
    }
    const roll = this.get('roll');
    if (roll) {
      const c = Math.cos(roll);
      const s = Math.sin(roll);
      const r2 = right.map((v, i) => v * c + up[i] * s);
      const u2 = up.map((v, i) => v * c - right[i] * s);
      right = r2;
      up = u2;
    }
    return { eye, right, up, forward };
  }

  /** Unmorphed eye position. @returns {number[]} */
  eye() {
    return this.basis().eye;
  }

  /** Orientation quaternion of the current view. @returns {number[]} */
  orientation() {
    const b = this.basis();
    return Q.fromBasis(b.right, b.up, b.forward.map((v) => -v));
  }

  /**
   * Resolve the camera for a viewport aspect ratio.
   * @param {number} aspect width / height
   * @returns {CameraState}
   */
  state(aspect) {
    const { eye, right, up, forward } = this.basis();
    const T = this.target();
    const focus = Math.max(1e-3, this.get('mode') === 'free' ? Math.max(0.5, (T[0] - eye[0]) * forward[0] + (T[1] - eye[1]) * forward[1] + (T[2] - eye[2]) * forward[2]) : this.get('distance'));
    const near = this.get('near');
    const morph = M.projectionMorph((this.get('fov') * Math.PI) / 180, aspect, near, this.get('far'), this.get('ortho'), focus);
    const e = [eye[0] - forward[0] * morph.back, eye[1] - forward[1] * morph.back, eye[2] - forward[2] * morph.back];
    const view = M.viewFromBasis(e, right, up, forward);
    const eyeH = morph.orthographic ? [-forward[0], -forward[1], -forward[2], 0] : [e[0], e[1], e[2], 1];
    return { eye: e, target: T, right, up, forward, view, proj: morph.proj, viewProj: M.multiply(morph.proj, view), orthographic: morph.orthographic, eyeH, focus, near: near + morph.back, aspect };
  }

  /**
   * Rotate around the target (orbit form).
   * @param {number} dTheta @param {number} [dPhi=0]
   * @returns {this}
   */
  orbit(dTheta, dPhi = 0) {
    this._toOrbit();
    this.set('theta', this.get('theta') + dTheta);
    return this.set('phi', Math.min(Math.PI - 1e-4, Math.max(1e-4, this.get('phi') + dPhi)));
  }

  /**
   * Move toward (factor below 1) or away from (above 1) the target.
   * @param {number} factor
   * @returns {this}
   */
  dolly(factor) {
    if (this.get('mode') === 'free') {
      const { eye } = this.basis();
      const T = this.target();
      return this.set({ camX: T[0] + (eye[0] - T[0]) * factor, camY: T[1] + (eye[1] - T[1]) * factor, camZ: T[2] + (eye[2] - T[2]) * factor });
    }
    return this.set('distance', this.get('distance') * factor);
  }

  /**
   * Move the camera and its target in the view plane.
   * @param {number} dx along the screen right @param {number} dy along the screen up
   * @returns {this}
   */
  pan(dx, dy) {
    const { right, up } = this.basis();
    const d = [right[0] * dx + up[0] * dy, right[1] * dx + up[1] * dy, right[2] * dx + up[2] * dy];
    const T = this.target();
    this.set({ targetX: T[0] + d[0], targetY: T[1] + d[1], targetZ: T[2] + d[2] });
    if (this.get('mode') === 'free') this.set({ camX: this.get('camX') + d[0], camY: this.get('camY') + d[1], camZ: this.get('camZ') + d[2] });
    return this;
  }

  /**
   * Aim at a point. In the orbit form this moves the target (the eye moves
   * with it); in the free form it turns the camera in place.
   * @param {number[]} target
   * @returns {this}
   */
  lookAt(target) {
    if (this.get('mode') === 'free') {
      this.set({ targetX: target[0], targetY: target[1], targetZ: target[2] });
      return this.set('orient', Q.lookRotation(this.eye(), target));
    }
    return this.set({ targetX: target[0], targetY: target[1], targetZ: target[2] });
  }

  /**
   * Place the camera at a position looking at a point (switches to the free form).
   * @param {number[]} position @param {number[]} [target]
   * @returns {this}
   */
  setPosition(position, target) {
    const T = target ?? this.target();
    this.set({ mode: 'free', camX: position[0], camY: position[1], camZ: position[2], targetX: T[0], targetY: T[1], targetZ: T[2] });
    return this.set('orient', Q.lookRotation(position, T));
  }

  /**
   * Switch to the free form, keeping the current view.
   * @returns {this}
   */
  toFree() {
    if (this.get('mode') === 'free') return this;
    const b = this.basis();
    const q = Q.fromBasis(b.right, b.up, b.forward.map((v) => -v));
    return this.set({ mode: 'free', camX: b.eye[0], camY: b.eye[1], camZ: b.eye[2], orient: q, roll: 0 });
  }

  /** @private */
  _toOrbit() {
    if (this.get('mode') !== 'free') return;
    const { eye } = this.basis();
    const T = this.target();
    const d = [eye[0] - T[0], eye[1] - T[1], eye[2] - T[2]];
    const D = Math.hypot(...d) || 1;
    this.set({ mode: 'orbit', distance: D, phi: Math.acos(Math.max(-1, Math.min(1, d[2] / D))), theta: Math.atan2(d[1], d[0]) });
  }
}
