/**
 * 3D animations. Each records tracks with `node.tween` when scheduled, so
 * any frame can be sampled directly.
 * @module three/animations3d
 */

import { Animation, stagger } from '../core/animations.js';
import { linear } from '../core/easing.js';
import * as Q from './quat.js';
import { Object3D, Mesh3D, Lines3D, Points3D, Label3D, Arrow3D, resampleRadial } from './object3d.js';
import { cubeSphere, meshBounds } from './geometry.js';

/** Rotation about an arbitrary axis, interpolated as a true rotation (quaternion slerp). */
export class Rotate3D extends Animation {
  /**
   * @param {Object3D} obj
   * @param {number[]} axis
   * @param {number} angle radians (any size; more than half a turn composes axis-angle steps)
   * @param {Record<string, any>} [opts] about: pivot point in the parent frame (default the object's position)
   */
  constructor(obj, axis, angle, opts = {}) {
    super(opts);
    this.obj = obj;
    this.axis = axis;
    this.angle = angle;
    this.about = opts.about ?? null;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const o = this.obj;
    const q0 = o._cur.quat.slice();
    const q1 = Q.multiply(Q.fromAxisAngle(this.axis, this.angle), q0);
    const small = Math.abs(this.angle) <= Math.PI;
    const qAt = (u) => (small ? Q.slerp(q0, q1, u) : Q.multiply(Q.fromAxisAngle(this.axis, this.angle * u), q0));
    o.tween('quat', s, e, q1, this.ease, (u) => qAt(u));
    if (this.about) {
      const c = this.about;
      const p0 = [o._cur.x, o._cur.y, o._cur.z];
      const d0 = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
      const at = (u, k) => c[k] + Q.rotate(Q.fromAxisAngle(this.axis, this.angle * u), d0)[k];
      ['x', 'y', 'z'].forEach((key, k) => o.tween(key, s, e, at(1, k), this.ease, (u) => at(u, k)));
    }
    return e;
  }
}

/**
 * @param {Object3D} obj @param {number[]} axis @param {number} angle
 * @param {Record<string, any>} [opts]
 * @returns {Rotate3D}
 */
export function rotate3D(obj, axis, angle, opts) {
  return new Rotate3D(obj, axis, angle, opts);
}

const templates = new Map();

function template(n) {
  if (!templates.has(n)) templates.set(n, cubeSphere(1, n));
  return templates.get(n);
}

/**
 * Resample two star-shaped meshes onto one cube-sphere topology so they can
 * be blended vertex by vertex.
 * @param {import('./geometry.js').MeshGeometry} a
 * @param {import('./geometry.js').MeshGeometry} b
 * @param {number} [resolution=12] quads per cube edge
 * @returns {{from: import('./geometry.js').MeshGeometry, to: import('./geometry.js').MeshGeometry}}
 */
export function matchMeshes(a, b, resolution = 12) {
  const t = template(resolution);
  return { from: resampleRadial(a, t), to: resampleRadial(b, t) };
}

/** Morph a mesh into another shape through a shared sphere parameterization. */
export class MeshMorph extends Animation {
  /**
   * @param {Mesh3D} mesh
   * @param {import('./geometry.js').MeshGeometry} target
   * @param {Record<string, any>} [opts] resolution (quads per cube edge, default 12)
   */
  constructor(mesh, target, opts = {}) {
    super(opts);
    this.mesh = mesh;
    this.target = target;
    this.resolution = opts.resolution ?? 12;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const m = this.mesh;
    const prev = m._cur.morph;
    const source = prev && prev.to ? prev.to : m.mesh;
    const { from, to } = matchMeshes(source, this.target, this.resolution);
    m.tween('morph', s, e, { from, to, t: 1 }, this.ease, (u) => ({ from, to, t: u }));
    return e;
  }
}

/**
 * @param {Mesh3D} mesh @param {import('./geometry.js').MeshGeometry} target
 * @param {Record<string, any>} [opts]
 * @returns {MeshMorph}
 */
export function morphMesh(mesh, target, opts) {
  return new MeshMorph(mesh, target, opts);
}

/** Draw a parametric surface in along u or v. */
export class SurfaceSweep extends Animation {
  /** @param {Mesh3D} surface @param {Record<string, any>} [opts] axis ('u' or 'v') */
  constructor(surface, opts = {}) {
    super(opts);
    this.surface = surface;
    this.axis = opts.axis ?? 'u';
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    this.surface.tween('sweepAxis', s, s, this.axis, linear);
    this.surface.tween('sweep', s, e, 1, this.ease, null, 0);
    return e;
  }
}

/**
 * @param {Mesh3D} surface @param {Record<string, any>} [opts]
 * @returns {SurfaceSweep}
 */
export function surfaceSweep(surface, opts) {
  return new SurfaceSweep(surface, opts);
}

/** Unfold a polyhedron into its net (or fold it back with `reverse`). */
export class Unfold extends Animation {
  /** @param {Mesh3D} mesh @param {Record<string, any>} [opts] root (face index), reverse */
  constructor(mesh, opts = {}) {
    super(opts);
    this.mesh = mesh;
    this.reverse = !!opts.reverse;
    if (opts.root != null) mesh.unfoldRoot = opts.root;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    this.mesh.tween('unfold', s, e, this.reverse ? 0 : 1, this.ease);
    return e;
  }
}

/**
 * @param {Mesh3D} mesh @param {Record<string, any>} [opts]
 * @returns {Unfold}
 */
export function unfold(mesh, opts) {
  return new Unfold(mesh, opts);
}

/**
 * Exploded view. A group's children move outward from the group center
 * along the direction to their own centers; a single mesh separates its faces.
 */
export class Explode extends Animation {
  /** @param {Object3D} target @param {Record<string, any>} [opts] distance (1), reverse */
  constructor(target, opts = {}) {
    super(opts);
    this.target = target;
    this.distance = opts.distance ?? 1;
    this.reverse = !!opts.reverse;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const t = this.target;
    if (t instanceof Mesh3D) {
      t.tween('explodeDistance', s, s, this.distance, linear);
      t.tween('explode', s, e, this.reverse ? 0 : 1, this.ease);
      return e;
    }
    const kids = t.children.filter((c) => c instanceof Object3D);
    const centers = kids.map((c) => {
      const b = c.localBounds();
      const local = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0];
      return [c._cur.x + local[0] * c._cur.scaleX, c._cur.y + local[1] * c._cur.scaleY, c._cur.z + local[2] * c._cur.scaleZ];
    });
    const g = centers.reduce((a, c) => [a[0] + c[0] / centers.length, a[1] + c[1] / centers.length, a[2] + c[2] / centers.length], [0, 0, 0]);
    kids.forEach((c, i) => {
      let d = [centers[i][0] - g[0], centers[i][1] - g[1], centers[i][2] - g[2]];
      const L = Math.hypot(...d);
      d = L > 1e-9 ? d.map((v) => v / L) : [0, 0, 1];
      const k = (this.reverse ? -1 : 1) * this.distance;
      c.tween('x', s, e, c._cur.x + d[0] * k, this.ease);
      c.tween('y', s, e, c._cur.y + d[1] * k, this.ease);
      c.tween('z', s, e, c._cur.z + d[2] * k, this.ease);
    });
    return e;
  }
}

/**
 * @param {Object3D} target @param {Record<string, any>} [opts]
 * @returns {Explode}
 */
export function explode(target, opts) {
  return new Explode(target, opts);
}

/**
 * Moving cutting plane: the mesh is clipped to the back side of the plane
 * n . x = d (world space) each frame and the section is capped in 'accent'.
 */
export class CrossSection extends Animation {
  /**
   * @param {Mesh3D} mesh
   * @param {Record<string, any>} [opts] normal ([0, 0, 1]), from and to (plane offsets; default the mesh's extent along the normal), capColor
   */
  constructor(mesh, opts = {}) {
    super(opts);
    this.mesh = mesh;
    this.normal = opts.normal ?? [0, 0, 1];
    this.from = opts.from;
    this.to = opts.to;
    if (opts.capColor) mesh.capColor = opts.capColor;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const m = this.mesh;
    const L = Math.hypot(...this.normal) || 1;
    const n = this.normal.map((v) => v / L);
    let from = this.from;
    let to = this.to;
    if (from == null || to == null) {
      const b = meshBounds(m.mesh);
      let lo = Infinity;
      let hi = -Infinity;
      const W = m.worldMatrix3D();
      for (let i = 0; i < 8; i++) {
        const p = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
        const w = [W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13], W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]];
        const d = w[0] * n[0] + w[1] * n[1] + w[2] * n[2];
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      from = from ?? hi + 1e-3;
      to = to ?? lo + (hi - lo) * 0.35;
    }
    m.tween('clip', s, s, 1, linear);
    m.tween('clipNX', s, s, n[0], linear);
    m.tween('clipNY', s, s, n[1], linear);
    m.tween('clipNZ', s, s, n[2], linear);
    m.tween('clipD', s, e, to, this.ease, null, from);
    return e;
  }
}

/**
 * @param {Mesh3D} mesh @param {Record<string, any>} [opts]
 * @returns {CrossSection}
 */
export function crossSection(mesh, opts) {
  return new CrossSection(mesh, opts);
}

/** Orbit the camera (orbit form): change theta, phi, and distance together. */
export class OrbitCamera extends Animation {
  /**
   * @param {import('./camera.js').Camera3D} camera
   * @param {Record<string, any>} [opts] dTheta (default a full turn), dPhi, distance (target value)
   */
  constructor(camera, opts = {}) {
    super(opts);
    this.camera = camera;
    this.dTheta = opts.dTheta ?? 2 * Math.PI;
    this.dPhi = opts.dPhi ?? 0;
    this.distance = opts.distance;
    this.defaultEase = 'linear';
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const c = this.camera;
    if (c._cur.mode === 'free') {
      c.tween('mode', s, s, 'orbit', linear);
    }
    c.tween('theta', s, e, c._cur.theta + this.dTheta, this.ease);
    if (this.dPhi) c.tween('phi', s, e, Math.min(Math.PI - 1e-3, Math.max(1e-3, c._cur.phi + this.dPhi)), this.ease);
    if (this.distance != null) c.tween('distance', s, e, this.distance, this.ease);
    return e;
  }
}

/**
 * @param {import('./camera.js').Camera3D} camera @param {Record<string, any>} [opts]
 * @returns {OrbitCamera}
 */
export function orbitCamera(camera, opts) {
  return new OrbitCamera(camera, opts);
}

function pathSampler(path) {
  if (typeof path === 'function') return path;
  const pts = path;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const total = cum[cum.length - 1] || 1;
  return (u) => {
    const d = Math.max(0, Math.min(1, u)) * total;
    let k = 0;
    while (k < pts.length - 2 && cum[k + 1] < d) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    const t = (d - cum[k]) / seg;
    const p0 = pts[Math.max(0, k - 1)];
    const p1 = pts[k];
    const p2 = pts[k + 1];
    const p3 = pts[Math.min(pts.length - 1, k + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    return [0, 1, 2].map((i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
  };
}

/** Fly the camera along a 3D path (points through which a Catmull-Rom spline passes, or a function of u in [0, 1]). */
export class FlyThrough extends Animation {
  /**
   * @param {import('./camera.js').Camera3D} camera
   * @param {number[][]|((u: number) => number[])} path
   * @param {Record<string, any>} [opts] lookAt: a point to keep in view (default: look ahead along the path)
   */
  constructor(camera, path, opts = {}) {
    super(opts);
    this.camera = camera;
    this.path = pathSampler(path);
    this.lookAt = opts.lookAt ?? null;
    this.defaultEase = 'smooth';
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const c = this.camera;
    const P = this.path;
    const look = (u) => this.lookAt ?? P(Math.min(1, u + 0.02 + 1e-3));
    const orient = (u) => {
      const p = P(u);
      let t = look(u);
      if (!this.lookAt && u > 0.97) {
        const a = P(u - 0.02);
        t = [2 * p[0] - a[0], 2 * p[1] - a[1], 2 * p[2] - a[2]];
      }
      return Q.lookRotation(p, t);
    };
    const target = this.lookAt ?? P(1);
    c.tween('mode', s, s, 'free', linear);
    c.tween('targetX', s, s, target[0], linear);
    c.tween('targetY', s, s, target[1], linear);
    c.tween('targetZ', s, s, target[2], linear);
    c.tween('camX', s, e, P(1)[0], this.ease, (u) => P(u)[0]);
    c.tween('camY', s, e, P(1)[1], this.ease, (u) => P(u)[1]);
    c.tween('camZ', s, e, P(1)[2], this.ease, (u) => P(u)[2]);
    c.tween('orient', s, e, orient(1), this.ease, (u) => orient(u));
    return e;
  }
}

/**
 * @param {import('./camera.js').Camera3D} camera
 * @param {number[][]|((u: number) => number[])} path
 * @param {Record<string, any>} [opts]
 * @returns {FlyThrough}
 */
export function flyThrough(camera, path, opts) {
  return new FlyThrough(camera, path, opts);
}

/** Move the camera to a new position and aim; orientation interpolates by slerp. */
export class CameraTo extends Animation {
  /**
   * @param {import('./camera.js').Camera3D} camera
   * @param {Record<string, any>} opts position, target, fov, ortho, and animation options
   */
  constructor(camera, opts = {}) {
    super(opts);
    this.camera = camera;
    this.to = opts;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const c = this.camera;
    const b = c.basis();
    const q0 = Q.fromBasis(b.right, b.up, b.forward.map((v) => -v));
    const T0 = c.target();
    const T1 = this.to.target ?? T0;
    const p1 = this.to.position ?? b.eye;
    const q1 = Q.lookRotation(p1, T1);
    c.tween('mode', s, s, 'free', linear);
    c.tween('roll', s, s, 0, linear);
    ['camX', 'camY', 'camZ'].forEach((k, i) => c.tween(k, s, e, p1[i], this.ease, null, b.eye[i]));
    ['targetX', 'targetY', 'targetZ'].forEach((k, i) => c.tween(k, s, e, T1[i], this.ease, null, T0[i]));
    c.tween('orient', s, e, q1, this.ease, (u) => Q.slerp(q0, q1, u));
    if (this.to.fov != null) c.tween('fov', s, e, this.to.fov, this.ease);
    if (this.to.ortho != null) c.tween('ortho', s, e, this.to.ortho, this.ease);
    return e;
  }
}

/**
 * @param {import('./camera.js').Camera3D} camera @param {Record<string, any>} opts
 * @returns {CameraTo}
 */
export function cameraTo(camera, opts) {
  return new CameraTo(camera, opts);
}

/**
 * 3D create: wireframe edges and lines draw on, then faces fade in; labels
 * and points fade in. Objects are staggered by lagRatio.
 */
export class Create3D extends Animation {
  /** @param {Object3D} target @param {Record<string, any>} [opts] */
  constructor(target, opts = {}) {
    super(opts);
    this.target = target;
    this.defaultLag = 0.08;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const leaves = this.target.family().filter((n) => n instanceof Mesh3D || n instanceof Lines3D || n instanceof Points3D || n instanceof Label3D || n instanceof Arrow3D);
    const times = stagger(leaves.length, s, this.duration, this.lagRatio);
    leaves.forEach((n, i) => {
      const [a, b] = times[i];
      const d = b - a;
      if (n instanceof Mesh3D || n instanceof Arrow3D) {
        const fo = n._cur.fillOpacity;
        n.tween('draw', a, a + d * 0.6, 1, this.ease, null, 0);
        n.tween('fillOpacity', a, a, 0, linear);
        n.tween('fillOpacity', a + d * 0.45, b, fo, this.ease, null, 0);
      } else if (n instanceof Lines3D) {
        n.tween('draw', a, b, 1, this.ease, null, 0);
      } else {
        n.tween('opacity', a, b, n._cur.opacity, this.ease, null, 0);
      }
    });
    return s + this.duration;
  }
}

/**
 * @param {Object3D} target @param {Record<string, any>} [opts]
 * @returns {Create3D}
 */
export function create3D(target, opts) {
  return new Create3D(target, opts);
}
