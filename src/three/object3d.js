/**
 * 3D scene objects. Every object is a Node with tracked 3D transform
 * properties (x, y, z; Euler rotX, rotY, rotZ applied x then y then z about
 * fixed axes; an extra orientation quaternion `quat` for arbitrary-axis
 * rotation; scaleX, scaleY, scaleZ), opacity, and draw range. Objects live
 * under a Scene3D, which projects them; placed directly in a 2D scene an
 * object renders itself through a default Scene3D view.
 * @module three/object3d
 */

import { Node, PROP_KIND } from '../core/node.js';
import { polyPath, emptyPath } from '../core/path.js';
import * as M from './mat4.js';
import * as Q from './quat.js';
import {
  makeMesh, meshBounds, faceNormals, faceCentroids, meshEdges, extrudePath, cylinder, cone, parametricSurface, translateMesh,
} from './geometry.js';
import { triangulatePolygon } from './triangulate.js';

PROP_KIND.quat = 'step';
PROP_KIND.material = 'step';
PROP_KIND.sweepAxis = 'step';

/**
 * Hooks set by the scene module to avoid a circular import: projecting a
 * point for 2D bounds and rendering an object standalone.
 * @type {{project: ((node: Node, p: number[]) => number[]|null)|null, standalone: ((obj: Object3D, args: any) => void)|null}}
 */
export const sceneHooks = { project: null, standalone: null };

/**
 * The Scene3D that contains a node, if any.
 * @param {Node} node
 * @returns {Node|null}
 */
export function scene3dOf(node) {
  let n = node.parent;
  while (n) {
    if (n.type === 'scene3d') return n;
    n = n.parent;
  }
  return null;
}

/** Base class of all 3D objects. */
export class Object3D extends Node {
  /**
   * @param {string} [type='object3d']
   * @param {Record<string, any>} [props] position [x, y, z], rotation [rx, ry, rz], scale (number or [sx, sy, sz]), opacity, and node props
   */
  constructor(type = 'object3d', props = {}) {
    const { position, rotation, scale, ...rest } = props;
    super(type, rest);
    this._define('z', props.z ?? 0);
    this._define('rotX', props.rotX ?? 0);
    this._define('rotY', props.rotY ?? 0);
    this._define('rotZ', props.rotZ ?? 0);
    this._define('scaleZ', props.scaleZ ?? 1);
    this._define('quat', props.quat ?? [0, 0, 0, 1]);
    if (position) this.set('position', position);
    if (rotation) this.set({ rotX: rotation[0], rotY: rotation[1], rotZ: rotation[2] });
    if (scale != null) this.set('scale', scale);
  }

  /**
   * Set properties; `position` takes [x, y, z] and `scale` a number or [sx, sy, sz].
   * @param {string|Record<string, any>} key
   * @param {any} [value]
   * @returns {this}
   */
  set(key, value) {
    if (key === 'position' && Array.isArray(value)) {
      this.set('x', value[0]);
      this.set('y', value[1]);
      return this.set('z', value[2] ?? 0);
    }
    if (key === 'scale') {
      const s = Array.isArray(value) ? value : [value, value, value];
      this.set('scaleX', s[0]);
      this.set('scaleY', s[1]);
      return this.set('scaleZ', s[2] ?? s[0]);
    }
    return super.set(key, value);
  }

  /** Position [x, y, z]. @returns {number[]} */
  get position3() {
    return [this.get('x'), this.get('y'), this.get('z')];
  }

  /**
   * The 2D matrix of a 3D object is the identity: its 2D geometry is already
   * expressed in the enclosing Scene3D's local 2D frame.
   * @returns {number[]}
   */
  localMatrix() {
    return [1, 0, 0, 1, 0, 0];
  }

  /**
   * Local 3D matrix: translate, then the quaternion, then Euler, then scale.
   * @returns {import('./mat4.js').Mat4}
   */
  matrix3D() {
    const R = M.multiply(M.fromQuat(this.get('quat')), M.fromEulerXYZ(this.get('rotX'), this.get('rotY'), this.get('rotZ')));
    const S = M.scaling(this.get('scaleX'), this.get('scaleY'), this.get('scaleZ'));
    const m = M.multiply(R, S);
    m[12] = this.get('x');
    m[13] = this.get('y');
    m[14] = this.get('z');
    return m;
  }

  /**
   * World 3D matrix (product of 3D ancestors up to the Scene3D).
   * @returns {import('./mat4.js').Mat4}
   */
  worldMatrix3D() {
    const m = this.matrix3D();
    return this.parent instanceof Object3D ? M.multiply(this.parent.worldMatrix3D(), m) : m;
  }

  /**
   * Rotate instantly about an axis through a pivot (default: the object's position).
   * @param {number[]} axis @param {number} angle radians @param {number[]} [pivot]
   * @returns {this}
   */
  rotateAbout(axis, angle, pivot) {
    const q = Q.fromAxisAngle(axis, angle);
    this.set('quat', Q.multiply(q, this.get('quat')));
    if (pivot) {
      const p = this.position3;
      const d = Q.rotate(q, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
      this.set('position', [pivot[0] + d[0], pivot[1] + d[1], pivot[2] + d[2]]);
    }
    return this;
  }

  /**
   * Local-space bounds of this object's own geometry, or null.
   * @returns {{min: number[], max: number[]}|null}
   */
  localBounds() {
    return null;
  }

  /**
   * Projected 2D outline (convex hull of the projected bounding box) in the
   * enclosing Scene3D's local frame; null when the object has no geometry.
   * @returns {import('../core/path.js').Path|null}
   */
  geometry() {
    const b = this.localBounds();
    if (!b || !sceneHooks.project) return null;
    const W = this.worldMatrix3D();
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const p = M.transformPoint(W, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
      const q = sceneHooks.project(this, p);
      if (q) pts.push(q);
    }
    if (pts.length < 3) return emptyPath();
    return polyPath(hull2D(pts), true);
  }

  /**
   * Collect render units for this object and its descendants.
   * @param {any} ctx render context
   * @param {import('./mat4.js').Mat4} parentM
   * @param {number} parentOpacity
   */
  collect(ctx, parentM, parentOpacity) {
    if (!this.get('visible')) return;
    const op = parentOpacity * this.get('opacity');
    if (op <= 0) return;
    const m = M.multiply(parentM, this.matrix3D());
    this.emit(ctx, m, op);
    for (const c of this.children) if (c instanceof Object3D) c.collect(ctx, m, op);
  }

  /**
   * Push this object's own render units (subclasses override).
   * @param {any} _ctx @param {import('./mat4.js').Mat4} _m @param {number} _opacity
   */
  emit(_ctx, _m, _opacity) {
    return this;
  }

  /**
   * Draw through the enclosing Scene3D; outside one, draw with a default view.
   * @param {any} args sampler callback arguments
   */
  sampleItems(args) {
    if (scene3dOf(this) || !sceneHooks.standalone) return;
    if (this.parent instanceof Object3D) return;
    sceneHooks.standalone(this, args);
  }
}

/** A group of 3D objects. */
export class Group3D extends Object3D {
  /** @param {Object3D[]} [children] @param {Record<string, any>} [props] */
  constructor(children = [], props = {}) {
    super(props.type ?? 'group3d', props);
    this.add(...children);
  }

  /** @returns {null} */
  geometry() {
    return null;
  }
}

/** A mesh. */
export class Mesh3D extends Object3D {
  /**
   * @param {import('./geometry.js').MeshGeometry} mesh
   * @param {Record<string, any>} [props] color (face color, default the theme accent softened), material ('flat', 'matte', 'glossy', 'glass', 'wireframe', 'ink', or an object), edgeColor, edgeWidth, castShadow, capColor
   */
  constructor(mesh, props = {}) {
    const { color, material, ...rest } = props;
    super(props.type ?? 'mesh3d', { fill: color ?? 'auto', stroke: props.edgeColor ?? 'ink', strokeWidth: 1.5, ...rest });
    /** @type {import('./geometry.js').MeshGeometry} */
    this.mesh = mesh;
    /** @type {import('./geometry.js').MeshGeometry|null} */
    this.morphTarget = null;
    this.castShadow = props.castShadow ?? true;
    this.capColor = props.capColor ?? 'accent';
    this._define('material', material ?? 'matte');
    this._define('edgeWidth', props.edgeWidth ?? null);
    this._define('morph', 0);
    this._define('sweep', 1);
    this._define('sweepAxis', 'u');
    this._define('explode', 0);
    this._define('explodeDistance', props.explodeDistance ?? 1);
    this._define('unfold', 0);
    this._define('clip', 0);
    this._define('clipNX', 0);
    this._define('clipNY', 0);
    this._define('clipNZ', 1);
    this._define('clipD', 0);
  }

  /** @returns {{min: number[], max: number[]}} */
  localBounds() {
    return meshBounds(this.mesh);
  }

  /**
   * The mesh to draw at the current time, after morph, sweep, clipping,
   * explode, and unfold. World matrix m is needed for world-space clip planes.
   * @param {import('./mat4.js').Mat4} m
   * @returns {{mesh: import('./geometry.js').MeshGeometry, capFaces: number}}
   */
  currentMesh(m) {
    let mesh = this.baseMesh();
    const mo = this.get('morph');
    if (this.morphTarget && mo > 0) mesh = lerpMesh(mesh, this.morphTarget, mo);
    let capFaces = 0;
    if (this.get('clip') > 0.5) {
      const r = clipMesh(mesh, worldPlaneToModel(m, [this.get('clipNX'), this.get('clipNY'), this.get('clipNZ'), this.get('clipD')]));
      mesh = r.mesh;
      capFaces = r.capFaces;
    }
    const sw = this.get('sweep');
    if (sw < 1 && mesh.faceParams) mesh = sweepFaces(mesh, sw, this.get('sweepAxis'));
    const u = this.get('unfold');
    if (u > 0) mesh = unfoldMesh(mesh, u, this);
    const ex = this.get('explode');
    if (ex > 0) mesh = explodeMesh(mesh, ex * this.get('explodeDistance'));
    return { mesh, capFaces };
  }

  /**
   * Geometry before per-frame deformations (subclasses may regenerate it).
   * @returns {import('./geometry.js').MeshGeometry}
   */
  baseMesh() {
    return this.mesh;
  }

  emit(ctx, m, opacity) {
    const { mesh, capFaces } = this.currentMesh(m);
    if (!mesh.faces.length) return;
    ctx.units.push({
      kind: 'mesh',
      obj: this,
      id: this.id,
      mesh,
      M: m,
      opacity,
      fill: this.get('fill'),
      fillOpacity: this.get('fillOpacity'),
      edgeColor: this.get('stroke'),
      edgeOpacity: this.get('strokeOpacity'),
      edgeWidth: this.get('edgeWidth'),
      material: this.get('material'),
      draw: this.get('draw'),
      drawStart: this.get('drawStart'),
      castShadow: this.castShadow,
      capFaces,
      capColor: this.capColor,
      deformed: mesh !== this.mesh,
    });
  }
}

/** Parametric surface that can be swept in along u or v. */
export class Surface3D extends Mesh3D {
  /**
   * @param {(u: number, v: number) => number[]} f
   * @param {{u?: number[], v?: number[], nu?: number, nv?: number, grid?: number[]|false}} [opts] grid: draw every n-th u and v parameter line (default about eight per direction)
   * @param {Record<string, any>} [props]
   */
  constructor(f, opts = {}, props = {}) {
    const nu = opts.nu ?? 32;
    const nv = opts.nv ?? 32;
    const lines = opts.grid === false ? undefined : opts.grid ?? [Math.max(1, Math.round(nu / 8)), Math.max(1, Math.round(nv / 8))];
    const o = { u: opts.u ?? [0, 1], v: opts.v ?? [0, 1], nu, nv, lines };
    super(parametricSurface(f, o), { type: 'surface3d', ...props });
    this.fn = f;
    this.opts = o;
    this._sweepCache = { key: '', mesh: null };
  }

  baseMesh() {
    const sw = this.get('sweep');
    if (sw >= 1) return this.mesh;
    const axis = this.get('sweepAxis');
    const key = `${axis}${sw.toFixed(4)}`;
    if (this._sweepCache.key === key) return this._sweepCache.mesh;
    const o = this.opts;
    const s = Math.max(1e-4, sw);
    const opts = { ...o };
    if (axis === 'v') {
      opts.v = [o.v[0], o.v[0] + (o.v[1] - o.v[0]) * s];
      opts.nv = Math.max(1, Math.ceil(o.nv * s));
      if (o.lines) opts.lines = [o.lines[0], 0];
    } else {
      opts.u = [o.u[0], o.u[0] + (o.u[1] - o.u[0]) * s];
      opts.nu = Math.max(1, Math.ceil(o.nu * s));
      if (o.lines) opts.lines = [0, o.lines[1]];
    }
    const mesh = parametricSurface(this.fn, opts);
    mesh.faceParams = null;
    this._sweepCache = { key, mesh };
    return mesh;
  }
}

/** Polylines in 3D. */
export class Lines3D extends Object3D {
  /**
   * @param {Array<number[][]|{points: number[][], closed?: boolean}>} polylines
   * @param {Record<string, any>} [props] color (stroke), strokeWidth (px at 1080p), dash [on, off] in 3D units, draw
   */
  constructor(polylines, props = {}) {
    const { color, dash, ...rest } = props;
    super(props.type ?? 'lines3d', { stroke: color ?? 'ink', strokeWidth: 3, ...rest });
    this.polylines = polylines.map((p) => (Array.isArray(p) ? { points: p, closed: false } : { points: p.points, closed: !!p.closed }));
    this.dash3 = dash ?? null;
    this.lineRole = props.role ?? 'line';
  }

  /** @returns {{min: number[], max: number[]}|null} */
  localBounds() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const pl of this.polylines) for (const p of pl.points) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
    return min[0] === Infinity ? null : { min, max };
  }

  emit(ctx, m, opacity) {
    ctx.units.push({
      kind: 'lines',
      obj: this,
      id: this.id,
      polylines: this.polylines.map((pl) => ({ points: pl.points.map((p) => M.transformPoint(m, p)), closed: pl.closed })),
      color: this.get('stroke'),
      alpha: this.get('strokeOpacity'),
      width: this.get('strokeWidth'),
      dash: this.dash3,
      opacity,
      draw: this.get('draw'),
      drawStart: this.get('drawStart'),
      role: this.lineRole,
    });
  }
}

/** Point cloud drawn as round dots whose radius is in 3D units. */
export class Points3D extends Object3D {
  /**
   * @param {number[][]} points
   * @param {Record<string, any>} [props] color, radius, radii (per point), colors (per point)
   */
  constructor(points, props = {}) {
    const { color, ...rest } = props;
    super(props.type ?? 'points3d', { fill: color ?? 'accent', ...rest });
    this.points = points;
    this.radii = props.radii ?? null;
    this.colors = props.colors ?? null;
    this._define('radius', props.radius ?? 0.04);
  }

  /** @returns {{min: number[], max: number[]}|null} */
  localBounds() {
    if (!this.points.length) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.points) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
    return { min, max };
  }

  emit(ctx, m, opacity) {
    const scale = Math.cbrt(Math.abs(m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]))) || 1;
    const r = this.get('radius');
    ctx.units.push({
      kind: 'points',
      obj: this,
      id: this.id,
      points: this.points.map((p) => M.transformPoint(m, p)),
      radii: this.points.map((_, i) => (this.radii ? this.radii[i] : r) * scale),
      color: this.get('fill'),
      colors: this.colors,
      opacity: opacity * this.get('fillOpacity'),
      draw: this.get('draw'),
    });
  }
}

/**
 * A label that always faces the camera. Content is a string (drawn through
 * the label factory or the text module), a Path, or an object with a `path`.
 */
export class Label3D extends Object3D {
  /**
   * @param {string|import('../core/path.js').Path|{path: import('../core/path.js').Path}} content
   * @param {Record<string, any>} [props] position, size (2D units at the focus distance, default 0.3), color (default 'ink'), offset [dx, dy] in label-size units, align ('center', 'left', 'right'), factory (text to Path)
   */
  constructor(content, props = {}) {
    const { color, ...rest } = props;
    super(props.type ?? 'label3d', { fill: color ?? 'ink', ...rest });
    this.content = content;
    this.factory = props.factory ?? null;
    this.offset = props.offset ?? [0, 0];
    this.align = props.align ?? 'center';
    this._define('size', props.size ?? 0.3);
  }

  emit(ctx, m, opacity) {
    ctx.units.push({
      kind: 'label',
      obj: this,
      id: this.id,
      position: M.transformPoint(m, [0, 0, 0]),
      content: this.content,
      factory: this.factory,
      size: this.get('size'),
      color: this.get('fill'),
      opacity: opacity * this.get('fillOpacity'),
      offset: this.offset,
      align: this.align,
    });
  }
}

const unitShaftMesh = translateMesh(cylinder(1, 1, 20), 0, 0, 0.5);
const unitHead = translateMesh(cone(1, 1, 24), 0, 0, 0.5);

/** An arrow between two animatable 3D points: a cylinder shaft and a cone head. */
export class Arrow3D extends Object3D {
  /**
   * @param {number[]} start @param {number[]} end
   * @param {Record<string, any>} [props] color, material, shaftRadius (0.022), headRadius (0.07), headLength (0.22)
   */
  constructor(start, end, props = {}) {
    const { color, material, ...rest } = props;
    super(props.type ?? 'arrow3d', { fill: color ?? 'accent', stroke: 'ink', ...rest });
    this._define('sx', start[0]);
    this._define('sy', start[1]);
    this._define('sz', start[2]);
    this._define('ex', end[0]);
    this._define('ey', end[1]);
    this._define('ez', end[2]);
    this._define('shaftRadius', props.shaftRadius ?? 0.022);
    this._define('headRadius', props.headRadius ?? 0.07);
    this._define('headLength', props.headLength ?? 0.22);
    this._define('material', material ?? 'glossy');
  }

  /** @returns {{min: number[], max: number[]}} */
  localBounds() {
    const s = [this.get('sx'), this.get('sy'), this.get('sz')];
    const e = [this.get('ex'), this.get('ey'), this.get('ez')];
    const r = this.get('headRadius');
    return { min: s.map((v, i) => Math.min(v, e[i]) - r), max: s.map((v, i) => Math.max(v, e[i]) + r) };
  }

  /**
   * Set both endpoints.
   * @param {number[]} start @param {number[]} end
   * @returns {this}
   */
  setPoints(start, end) {
    return this.set({ sx: start[0], sy: start[1], sz: start[2], ex: end[0], ey: end[1], ez: end[2] });
  }

  emit(ctx, m, opacity) {
    const s = [this.get('sx'), this.get('sy'), this.get('sz')];
    const e = [this.get('ex'), this.get('ey'), this.get('ez')];
    const d = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const len = Math.hypot(...d);
    if (len < 1e-6) return;
    const q = Q.fromUnitVectors([0, 0, 1], d.map((v) => v / len));
    const hl = Math.min(this.get('headLength'), len * 0.6);
    const hr = this.get('headRadius');
    const sr = this.get('shaftRadius');
    const base = M.multiply(m, M.compose(s, q, [1, 1, 1]));
    const common = {
      kind: 'mesh', obj: this, opacity, fill: this.get('fill'), fillOpacity: this.get('fillOpacity'), edgeColor: this.get('stroke'),
      edgeOpacity: this.get('strokeOpacity'), edgeWidth: null, material: this.get('material'), draw: this.get('draw'), drawStart: this.get('drawStart'),
      castShadow: true, capFaces: 0, deformed: false,
    };
    const shaftLen = len - hl;
    if (shaftLen > 1e-4) ctx.units.push({ ...common, id: this.id + ':shaft', mesh: unitShaftMesh, M: M.multiply(base, M.scaling(sr, sr, shaftLen)) });
    ctx.units.push({ ...common, id: this.id + ':head', mesh: unitHead, M: M.multiply(base, M.multiply(M.translation(0, 0, shaftLen), M.scaling(hr, hr, hl))) });
  }
}

/**
 * Extruded 2D outline (for example glyph outlines from a label factory) as a
 * solid, centered on its bounds in x and y, extruded along +z.
 * @param {import('../core/path.js').Path} path
 * @param {{depth?: number, size?: number}} [opts] size scales the path uniformly
 * @param {Record<string, any>} [props]
 * @returns {Mesh3D}
 */
export function text3D(path, opts = {}, props = {}) {
  let mesh = extrudePath(path, { depth: opts.depth ?? 0.15 });
  const b = meshBounds(mesh);
  const k = opts.size ?? 1;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const P = mesh.positions.slice();
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (P[i] - cx) * k;
    P[i + 1] = (P[i + 1] - cy) * k;
    P[i + 2] *= k;
  }
  mesh = makeMesh(P, mesh.faces, { closed: mesh.closed });
  return new Mesh3D(mesh, { type: 'text3d', ...props });
}

/**
 * Linear blend of two meshes with identical topology.
 * @param {import('./geometry.js').MeshGeometry} a
 * @param {import('./geometry.js').MeshGeometry} b
 * @param {number} t
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function lerpMesh(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const P = new Float64Array(a.positions.length);
  for (let i = 0; i < P.length; i++) P[i] = a.positions[i] + (b.positions[i] - a.positions[i]) * t;
  return makeMesh(P, a.faces, { convex: a.convex && b.convex && (t < 1e-3 || t > 1 - 1e-3), closed: a.closed, faceColors: a.faceColors, edgeClass: a.edgeClass });
}

function worldPlaneToModel(m, plane) {
  const [nx, ny, nz, d] = plane;
  const L = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / L, ny / L, nz / L];
  const dd = d / L;
  const mn = [m[0] * n[0] + m[1] * n[1] + m[2] * n[2], m[4] * n[0] + m[5] * n[1] + m[6] * n[2], m[8] * n[0] + m[9] * n[1] + m[10] * n[2]];
  const md = dd - (n[0] * m[12] + n[1] * m[13] + n[2] * m[14]);
  const k = Math.hypot(...mn) || 1;
  return [mn[0] / k, mn[1] / k, mn[2] / k, md / k];
}

/**
 * Clip a mesh to the back side of a plane (n . x <= d) and cap the cut with
 * section polygons (triangulated, holes included). Cap faces come last.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {number[]} plane [nx, ny, nz, d] with unit normal
 * @returns {{mesh: import('./geometry.js').MeshGeometry, capFaces: number, section: number[][][]}}
 */
export function clipMesh(mesh, plane) {
  const [nx, ny, nz, d] = plane;
  const P = mesh.positions;
  const pos = [];
  const faces = [];
  const colors = mesh.faceColors ? [] : null;
  const vmap = new Map();
  const side = (i) => nx * P[i * 3] + ny * P[i * 3 + 1] + nz * P[i * 3 + 2] - d;
  const keep = (i) => {
    let k = vmap.get(i);
    if (k === undefined) {
      k = pos.length / 3;
      pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      vmap.set(i, k);
    }
    return k;
  };
  const cutKey = new Map();
  const cut = (i, j) => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    let k = cutKey.get(key);
    if (k === undefined) {
      const si = side(i);
      const sj = side(j);
      const t = si / (si - sj);
      k = pos.length / 3;
      pos.push(P[i * 3] + (P[j * 3] - P[i * 3]) * t, P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * t, P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * t);
      cutKey.set(key, k);
    }
    return k;
  };
  const segs = [];
  mesh.faces.forEach((f, fi) => {
    const s = f.map(side);
    if (s.every((v) => v <= 0)) {
      faces.push(f.map(keep));
      if (colors) colors.push(mesh.faceColors[fi]);
      return;
    }
    if (s.every((v) => v >= 0)) return;
    const out = [];
    let enter = -1;
    let exit = -1;
    for (let k = 0; k < f.length; k++) {
      const a = f[k];
      const b = f[(k + 1) % f.length];
      const sa = s[k];
      const sb = s[(k + 1) % f.length];
      if (sa <= 0) out.push(keep(a));
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
        const c = cut(a, b);
        out.push(c);
        if (sa < 0) exit = c;
        else enter = c;
      }
    }
    if (out.length >= 3) {
      faces.push(out);
      if (colors) colors.push(mesh.faceColors[fi]);
    }
    if (exit >= 0 && enter >= 0) segs.push([exit, enter]);
  });
  const next = new Map(segs.map(([a, b]) => [a, b]));
  const loops = [];
  const used = new Set();
  for (const [a] of segs) {
    if (used.has(a)) continue;
    const loop = [];
    let v = a;
    while (v !== undefined && !used.has(v)) {
      used.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (loop.length >= 3 && v === a) loops.push(loop);
  }
  const helper = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let ex = [ny * helper[2] - nz * helper[1], nz * helper[0] - nx * helper[2], nx * helper[1] - ny * helper[0]];
  const el = Math.hypot(...ex);
  ex = ex.map((v) => v / el);
  const ey = [ny * ex[2] - nz * ex[1], nz * ex[0] - nx * ex[2], nx * ex[1] - ny * ex[0]];
  const to2 = (k) => [pos[k * 3] * ex[0] + pos[k * 3 + 1] * ex[1] + pos[k * 3 + 2] * ex[2], pos[k * 3] * ey[0] + pos[k * 3 + 1] * ey[1] + pos[k * 3 + 2] * ey[2]];
  const area = (loop) => {
    let A = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = to2(loop[i]);
      const q = to2(loop[(i + 1) % loop.length]);
      A += p[0] * q[1] - q[0] * p[1];
    }
    return A / 2;
  };
  const inside = (pt, loop) => {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = to2(loop[i]);
      const b = to2(loop[j]);
      if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const outers = loops.filter((l) => !loops.some((o) => o !== l && Math.abs(area(o)) > Math.abs(area(l)) && inside(to2(l[0]), o)));
  let capFaces = 0;
  const section = [];
  for (const o of outers) {
    const holes = loops.filter((h) => h !== o && !outers.includes(h) && inside(to2(h[0]), o));
    const oPts = o.map(to2);
    const hPts = holes.map((h) => h.map(to2));
    const idx = [...o, ...holes.flat()];
    const tris = triangulatePolygon(oPts, hPts);
    section.push([o, ...holes].map((l) => l.map((k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]])));
    for (const t of tris) {
      faces.push(t.map((k) => idx[k]));
      if (colors) colors.push(null);
      capFaces++;
    }
  }
  const res = makeMesh(Float64Array.from(pos), faces, { convex: mesh.convex, faceColors: colors });
  return { mesh: res, capFaces, section };
}

function sweepFaces(mesh, sweep, axis) {
  const k = axis === 'v' ? 1 : 0;
  const faces = [];
  const colors = mesh.faceColors ? [] : null;
  mesh.faces.forEach((f, i) => {
    if (mesh.faceParams[i * 2 + k] <= sweep + 1e-9) {
      faces.push(f);
      if (colors) colors.push(mesh.faceColors[i]);
    }
  });
  return makeMesh(mesh.positions, faces, { faceColors: colors, closed: false });
}

/**
 * Separate faces and push each outward from the mesh centroid by `amount`
 * along the direction from the centroid to the face center.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {number} amount
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function explodeMesh(mesh, amount) {
  const C = faceCentroids(mesh);
  const P = mesh.positions;
  const b = meshBounds(mesh);
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const pos = [];
  const faces = [];
  mesh.faces.forEach((f, i) => {
    let d = [C[i * 3] - c[0], C[i * 3 + 1] - c[1], C[i * 3 + 2] - c[2]];
    const L = Math.hypot(...d);
    const N = faceNormals(mesh);
    d = L > 1e-9 ? d.map((v) => v / L) : [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
    const base = pos.length / 3;
    for (const v of f) pos.push(P[v * 3] + d[0] * amount, P[v * 3 + 1] + d[1] * amount, P[v * 3 + 2] + d[2] * amount);
    faces.push(f.map((_, k) => base + k));
  });
  return makeMesh(Float64Array.from(pos), faces, { faceColors: mesh.faceColors, closed: false });
}

/**
 * Spanning tree of the face adjacency graph (breadth first from a root face),
 * the hinge structure of a polyhedron net.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {number} [root=0]
 * @returns {{parent: Int32Array, hinge: Array<number[]|null>, order: number[]}} hinge is the shared edge [a, b] with the parent
 */
export function netTree(mesh, root = 0) {
  const E = meshEdges(mesh);
  const adj = mesh.faces.map(() => []);
  for (let i = 0; i < E.count; i++) {
    if (E.f1[i] < 0) continue;
    adj[E.f0[i]].push([E.f1[i], E.a[i], E.b[i]]);
    adj[E.f1[i]].push([E.f0[i], E.a[i], E.b[i]]);
  }
  const parent = new Int32Array(mesh.faces.length).fill(-2);
  const hinge = mesh.faces.map(() => null);
  parent[root] = -1;
  const order = [root];
  for (let qi = 0; qi < order.length; qi++) {
    const f = order[qi];
    for (const [g, a, b] of adj[f]) {
      if (parent[g] !== -2) continue;
      parent[g] = f;
      hinge[g] = [a, b];
      order.push(g);
    }
  }
  return { parent, hinge, order };
}

const netCache = new WeakMap();

/**
 * Unfold a polyhedron into its net: every face rotates about the hinge it
 * shares with its parent in the spanning tree, by `t` times the angle that
 * makes it coplanar with the parent.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {number} t in [0, 1]
 * @param {{unfoldRoot?: number}} [owner]
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function unfoldMesh(mesh, t, owner = {}) {
  let net = netCache.get(mesh);
  if (!net) {
    const N = faceNormals(mesh);
    let root = owner.unfoldRoot ?? -1;
    if (root < 0) {
      root = 0;
      for (let i = 1; i < mesh.faces.length; i++) if (N[i * 3 + 2] < N[root * 3 + 2]) root = i;
    }
    net = netTree(mesh, root);
    netCache.set(mesh, net);
  }
  const P = mesh.positions;
  const N = faceNormals(mesh);
  const xf = new Array(mesh.faces.length);
  for (const f of net.order) {
    const p = net.parent[f];
    if (p < 0) {
      xf[f] = M.identity();
      continue;
    }
    const [a, b] = net.hinge[f];
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
    const axis = [P[b * 3] - pa[0], P[b * 3 + 1] - pa[1], P[b * 3 + 2] - pa[2]];
    const L = Math.hypot(...axis);
    const ax = axis.map((v) => v / L);
    const nc = [N[f * 3], N[f * 3 + 1], N[f * 3 + 2]];
    const np = [N[p * 3], N[p * 3 + 1], N[p * 3 + 2]];
    const cr = [nc[1] * np[2] - nc[2] * np[1], nc[2] * np[0] - nc[0] * np[2], nc[0] * np[1] - nc[1] * np[0]];
    const ang = Math.atan2(cr[0] * ax[0] + cr[1] * ax[1] + cr[2] * ax[2], nc[0] * np[0] + nc[1] * np[1] + nc[2] * np[2]);
    const R = M.multiply(M.translation(pa[0], pa[1], pa[2]), M.multiply(M.axisAngle(ax, ang * t), M.translation(-pa[0], -pa[1], -pa[2])));
    xf[f] = M.multiply(xf[p], R);
  }
  const pos = [];
  const faces = [];
  mesh.faces.forEach((f, i) => {
    const base = pos.length / 3;
    for (const v of f) pos.push(...M.transformPoint(xf[i], [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]));
    faces.push(f.map((_, k) => base + k));
  });
  return makeMesh(Float64Array.from(pos), faces, { faceColors: mesh.faceColors, closed: false });
}

/**
 * Resample a star-shaped closed mesh onto a cube-sphere topology by casting
 * rays from its center; two resampled meshes share topology and can be
 * blended vertex by vertex.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {import('./geometry.js').MeshGeometry} template unit-sphere-like template (for example cubeSphere(1, n))
 * @returns {import('./geometry.js').MeshGeometry}
 */
export function resampleRadial(mesh, template) {
  const b = meshBounds(mesh);
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const tri = [];
  const P = mesh.positions;
  for (const f of mesh.faces) for (let k = 1; k + 1 < f.length; k++) tri.push(f[0], f[k], f[k + 1]);
  const T = template.positions;
  const out = new Float64Array(T.length);
  for (let i = 0; i < T.length; i += 3) {
    const L = Math.hypot(T[i], T[i + 1], T[i + 2]) || 1;
    const d = [T[i] / L, T[i + 1] / L, T[i + 2] / L];
    let best = 0;
    for (let k = 0; k < tri.length; k += 3) {
      const tHit = rayTriangle(c, d, P, tri[k], tri[k + 1], tri[k + 2]);
      if (tHit > best) best = tHit;
    }
    out[i] = c[0] + d[0] * best;
    out[i + 1] = c[1] + d[1] * best;
    out[i + 2] = c[2] + d[2] * best;
  }
  return makeMesh(out, template.faces, { closed: template.closed });
}

function rayTriangle(o, d, P, a, b, c) {
  const ax = P[a * 3];
  const ay = P[a * 3 + 1];
  const az = P[a * 3 + 2];
  const e1 = [P[b * 3] - ax, P[b * 3 + 1] - ay, P[b * 3 + 2] - az];
  const e2 = [P[c * 3] - ax, P[c * 3 + 1] - ay, P[c * 3 + 2] - az];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const s = [o[0] - ax, o[1] - ay, o[2] - az];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
}

/**
 * 2D convex hull (monotone chain).
 * @param {number[][]} pts
 * @returns {number[][]} counterclockwise
 */
export function hull2D(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
