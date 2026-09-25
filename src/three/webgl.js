/**
 * WebGL2 preview renderer for interactive orbiting of large meshes in the
 * browser. It uses the same camera matrices as the vector projector
 * (Camera3D.state) and the same lighting model: the shader is generated
 * from the shared SHADING and WRAP constants and mirrors `shade`,
 * `diffuseAt`, and `specularAt`. The projector remains the source of truth
 * for export; this path is for fast previews.
 * @module three/webgl
 */

import { ctx as nodeCtx, ColorMix } from '../core/node.js';
import { mix } from '../core/color.js';
import { resolveColor } from '../themes/tokens.js';
import * as M from './mat4.js';
import { SHADING, material as makeMaterial, presetMaterial } from './materials.js';
import { WRAP, LIGHT_PRESETS, resolveLightPreset, worldLights } from './lighting.js';
import { Object3D } from './object3d.js';
import { fillResolver } from './render.js';
import { triangulateMesh, faceNormals } from './geometry.js';

const S = SHADING;
const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));

/** Vertex shader (GLSL ES 3.00). */
export const VERTEX_SHADER = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNormal;
out vec4 vColor;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

/** Fragment shader (GLSL ES 3.00): per-face lighting and OKLab shading. */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
in vec4 vColor;
uniform vec3 uEye;
uniform vec3 uForward;
uniform float uOrtho;
uniform vec4 uDir[4];
uniform float uDirSpec[4];
uniform int uDirCount;
uniform vec2 uHemi;
uniform vec3 uHemiUp;
uniform float uAmbient;
uniform int uShading;
uniform float uSpecular;
uniform float uShininess;
uniform float uAlpha;
uniform float uRim;
out vec4 outColor;
float toLin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float toGam(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 rgb2lab(vec3 c) {
  vec3 l = vec3(toLin(c.r), toLin(c.g), toLin(c.b));
  float L = pow(0.4122214708 * l.r + 0.5363325363 * l.g + 0.0514459929 * l.b, 1.0 / 3.0);
  float m = pow(0.2119034982 * l.r + 0.6806995451 * l.g + 0.1073969566 * l.b, 1.0 / 3.0);
  float s = pow(0.0883024619 * l.r + 0.2817188376 * l.g + 0.6299787005 * l.b, 1.0 / 3.0);
  return vec3(0.2104542553 * L + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * L - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * L + 0.7827717662 * m - 0.808675766 * s);
}
vec3 lab2rgb(vec3 lab) {
  float l = pow(lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z, 3.0);
  float m = pow(lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z, 3.0);
  float s = pow(lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z, 3.0);
  vec3 c = vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  c = clamp(c, 0.0, 1.0);
  return vec3(toGam(c.r), toGam(c.g), toGam(c.b));
}
float wrapd(float c) { return max(0.0, (c + ${f(WRAP)}) / (1.0 + ${f(WRAP)})); }
void main() {
  if (uShading < 0) { outColor = vColor; return; }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = uOrtho > 0.5 ? -uForward : normalize(uEye - vPos);
  float d = uAmbient + uHemi.x * (uHemi.y + (1.0 - uHemi.y) * (0.5 + 0.5 * dot(n, uHemiUp)));
  float sp = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uDirCount) break;
    vec3 L = uDir[i].xyz;
    d += uDir[i].w * wrapd(dot(n, L));
    if (dot(n, L) > 0.0) sp += uDirSpec[i] * uDir[i].w * pow(max(0.0, dot(n, normalize(L + v))), uShininess);
  }
  if (!gl_FrontFacing) d *= 0.86;
  vec3 rgb = vColor.rgb;
  if (uShading > 0) {
    vec3 lab = rgb2lab(rgb);
    float k = clamp(d, 0.0, ${f(S.maxDiffuse)});
    float L = lab.x * (${f(S.shadowL)} + ${f(S.litL)} * k);
    float ch = ${f(S.chromaBase)} + ${f(1 - S.chromaBase)} * min(1.0, k);
    vec2 ab = lab.yz * ch;
    float s = uShading > 1 ? clamp(uSpecular * sp, 0.0, ${f(S.maxSpec)}) : 0.0;
    L += (${f(S.specWhite)} - L) * s;
    ab *= 1.0 - ${f(S.specChroma)} * s;
    rgb = lab2rgb(vec3(min(${f(S.maxL)}, L), ab));
  }
  float a = uAlpha * vColor.a;
  if (uRim > 0.0) a = min(1.0, a + uRim * pow(1.0 - abs(dot(n, v)), 2.5));
  outColor = vec4(rgb * a, a);
}
`;

/**
 * Per-vertex buffers for a mesh: triangles with face normals and base
 * colors, in world space.
 * @param {import('./geometry.js').MeshGeometry} mesh
 * @param {import('./mat4.js').Mat4} Mw model matrix
 * @param {(faceIndex: number) => import('../core/color.js').RGBA} colorOf base color per original face
 * @returns {{position: Float32Array, normal: Float32Array, color: Float32Array, count: number}}
 */
export function meshBuffers(mesh, Mw, colorOf) {
  const faceOf = [];
  const tri = triangulateMesh({ ...mesh, faceColors: mesh.faces.map((_, i) => i) });
  tri.faceColors.forEach((i) => faceOf.push(i));
  const N = faceNormals(tri);
  const count = tri.faces.length * 3;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 4);
  const P = tri.positions;
  const inv = M.invert(Mw);
  tri.faces.forEach((face, t) => {
    const n = [inv[0] * N[t * 3] + inv[1] * N[t * 3 + 1] + inv[2] * N[t * 3 + 2], inv[4] * N[t * 3] + inv[5] * N[t * 3 + 1] + inv[6] * N[t * 3 + 2], inv[8] * N[t * 3] + inv[9] * N[t * 3 + 1] + inv[10] * N[t * 3 + 2]];
    const L = Math.hypot(...n) || 1;
    const c = colorOf(faceOf[t]);
    for (let k = 0; k < 3; k++) {
      const v = face[k];
      const w = M.transformPoint(Mw, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      const o = (t * 3 + k) * 3;
      position.set(w, o);
      normal.set([n[0] / L, n[1] / L, n[2] / L], o);
      color.set([c.r, c.g, c.b, c.a], (t * 3 + k) * 4);
    }
  });
  return { position, normal, color, count };
}

/**
 * Uniform values for a light rig (up to four directional lights, one
 * hemisphere light, summed ambient). Point lights are approximated by their
 * direction from the origin.
 * @param {import('./lighting.js').Light[]} lights world-space lights
 * @returns {{dir: Float32Array, dirSpec: Float32Array, dirCount: number, hemi: number[], hemiUp: number[], ambient: number}}
 */
export function lightUniforms(lights) {
  const dir = new Float32Array(16);
  const dirSpec = new Float32Array(4);
  let n = 0;
  let ambient = 0;
  let hemi = [0, 0];
  let hemiUp = [0, 0, 1];
  for (const l of lights) {
    if (l.kind === 'ambient') ambient += l.intensity;
    else if (l.kind === 'hemisphere') {
      hemi = [l.intensity, l.ground];
      hemiUp = l.up ?? [0, 0, 1];
    } else if (n < 4) {
      const d = l.kind === 'directional' ? l.direction : l.position.map((v) => v / (Math.hypot(...l.position) || 1));
      dir.set([d[0], d[1], d[2], l.intensity], n * 4);
      dirSpec[n] = l.specular ?? 1;
      n++;
    }
  }
  return { dir, dirSpec, dirCount: n, hemi, hemiUp, ambient };
}

function themeColor(theme) {
  const base = (v) => {
    if (v == null) return null;
    if (v instanceof ColorMix) return mix(base(v.a), base(v.b), v.t);
    return resolveColor(v, theme);
  };
  return base;
}

/**
 * Sample a Scene3D at time t: camera state, world-space lights, and render
 * units, exactly as the projector sees them.
 * @param {import('./scene3d.js').Scene3D} scene3d
 * @param {number} t
 * @param {import('../themes/tokens.js').Theme} theme
 * @param {{theta?: number, phi?: number, zoom?: number}} [view] interactive orbit offsets
 * @returns {{cam: import('./camera.js').CameraState, lights: import('./lighting.js').Light[], units: any[], preset: string}}
 */
export function previewState(scene3d, t, theme, view = {}) {
  const prev = { sampling: nodeCtx.sampling, t: nodeCtx.t, frame: nodeCtx.frame };
  nodeCtx.sampling = true;
  nodeCtx.t = t;
  nodeCtx.frame = new Map();
  try {
    const camNode = scene3d.camera;
    if (view.theta || view.phi || (view.zoom && view.zoom !== 1)) {
      if (camNode.get('mode') !== 'free') {
        camNode.set('theta', camNode.get('theta') + (view.theta || 0));
        camNode.set('phi', Math.min(Math.PI - 1e-3, Math.max(1e-3, camNode.get('phi') + (view.phi || 0))));
        camNode.set('distance', camNode.get('distance') / (view.zoom || 1));
      }
    }
    const cam = scene3d.cameraState();
    const preset = resolveLightPreset(theme);
    const rig = Array.isArray(scene3d.lights) ? scene3d.lights : (LIGHT_PRESETS[typeof scene3d.lights === 'string' ? scene3d.lights : preset] || LIGHT_PRESETS.studio)();
    const units = [];
    for (const c of scene3d.children) if (c instanceof Object3D) c.collect({ units, t }, M.identity(), 1);
    return { cam, lights: worldLights(rig, cam), units, preset };
  } finally {
    nodeCtx.sampling = prev.sampling;
    nodeCtx.t = prev.t;
    nodeCtx.frame = prev.frame;
  }
}

/** Interactive WebGL2 preview of a Scene3D. */
export class WebGLPreview {
  /**
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas
   * @param {import('./scene3d.js').Scene3D} scene3d
   * @param {{theme: import('../themes/tokens.js').Theme}} opts
   */
  constructor(canvas, scene3d, opts) {
    const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true }));
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.scene3d = scene3d;
    this.theme = opts.theme;
    this.view = { theta: 0, phi: 0, zoom: 1 };
    this.program = link(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.buffers = { pos: gl.createBuffer(), nrm: gl.createBuffer(), col: gl.createBuffer() };
    this.loc = {};
    for (const a of ['aPos', 'aNormal', 'aColor']) this.loc[a] = gl.getAttribLocation(this.program, a);
    for (const u of ['uViewProj', 'uEye', 'uForward', 'uOrtho', 'uDir', 'uDirSpec', 'uDirCount', 'uHemi', 'uHemiUp', 'uAmbient', 'uShading', 'uSpecular', 'uShininess', 'uAlpha', 'uRim']) {
      this.loc[u] = gl.getUniformLocation(this.program, u);
    }
    this._detach = null;
  }

  /**
   * Draw the scene at time t.
   * @param {number} [t=0]
   */
  render(t = 0) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const { cam, lights, units, preset } = previewState(this.scene3d, t, this.theme, this.view);
    const color = themeColor(this.theme);
    const fill = fillResolver(color);
    const bg = color(this.theme.colors.background);
    gl.viewport(0, 0, W, H);
    gl.clearColor(bg.r, bg.g, bg.b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    const L = this.loc;
    gl.uniformMatrix4fv(L.uViewProj, false, Float32Array.from(cam.viewProj));
    gl.uniform3fv(L.uEye, Float32Array.from(cam.eye));
    gl.uniform3fv(L.uForward, Float32Array.from(cam.forward));
    gl.uniform1f(L.uOrtho, cam.orthographic ? 1 : 0);
    const lu = lightUniforms(lights);
    gl.uniform4fv(L.uDir, lu.dir);
    gl.uniform1fv(L.uDirSpec, lu.dirSpec);
    gl.uniform1i(L.uDirCount, lu.dirCount);
    gl.uniform2fv(L.uHemi, Float32Array.from(lu.hemi));
    gl.uniform3fv(L.uHemiUp, Float32Array.from(lu.hemiUp));
    gl.uniform1f(L.uAmbient, lu.ambient);
    const draws = [];
    for (const u of units) {
      if (u.kind !== 'mesh') continue;
      const mat = presetMaterial(makeMaterial(u.material), preset);
      if (!mat.faces) continue;
      const base = fill(u.fill);
      const colorOf = (fi) => (u.mesh.faceColors && u.mesh.faceColors[fi] != null ? fill(u.mesh.faceColors[fi]) : base);
      const alpha = mat.alpha * u.fillOpacity * u.opacity;
      draws.push({ buf: meshBuffers(u.mesh, u.M, mat.occluder ? () => bg : colorOf), mat, alpha, translucent: alpha < 0.995 || mat.rim > 0 });
    }
    draws.sort((a, b) => Number(a.translucent) - Number(b.translucent));
    for (const d of draws) {
      gl.depthMask(!d.translucent);
      gl.uniform1i(L.uShading, d.mat.occluder || d.mat.shading === 'none' ? 0 : d.mat.shading === 'phong' ? 2 : 1);
      gl.uniform1f(L.uSpecular, d.mat.specular);
      gl.uniform1f(L.uShininess, d.mat.shininess);
      gl.uniform1f(L.uAlpha, d.alpha);
      gl.uniform1f(L.uRim, d.mat.rim);
      this._attrib(this.buffers.pos, L.aPos, d.buf.position, 3);
      this._attrib(this.buffers.nrm, L.aNormal, d.buf.normal, 3);
      this._attrib(this.buffers.col, L.aColor, d.buf.color, 4);
      gl.drawArrays(gl.TRIANGLES, 0, d.buf.count);
    }
    gl.depthMask(true);
    gl.uniform1i(L.uShading, -1);
    for (const u of units) {
      if (u.kind !== 'lines') continue;
      const c = fill(u.color);
      const pts = [];
      for (const pl of u.polylines) {
        const n = pl.points.length;
        for (let i = 0; i + 1 < n + (pl.closed ? 1 : 0); i++) pts.push(...pl.points[i], ...pl.points[(i + 1) % n]);
      }
      if (!pts.length) continue;
      const count = pts.length / 3;
      const a = c.a * u.alpha * u.opacity;
      this._attrib(this.buffers.pos, L.aPos, Float32Array.from(pts), 3);
      this._attrib(this.buffers.nrm, L.aNormal, new Float32Array(count * 3), 3);
      const cols = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) cols.set([c.r * a, c.g * a, c.b * a, a], i * 4);
      this._attrib(this.buffers.col, L.aColor, cols, 4);
      gl.drawArrays(gl.LINES, 0, count);
    }
  }

  /** @private */
  _attrib(buf, loc, data, size) {
    const gl = this.gl;
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  /**
   * Orbit the preview camera by angle offsets (does not change the scene's tracks).
   * @param {number} dTheta @param {number} dPhi
   * @returns {this}
   */
  orbitBy(dTheta, dPhi) {
    this.view.theta += dTheta;
    this.view.phi += dPhi;
    return this;
  }

  /**
   * Drag to orbit and wheel to zoom on the canvas element; returns a detach function.
   * @param {() => void} [onChange] called after each change (for example to re-render)
   * @returns {() => void}
   */
  attachPointer(onChange) {
    const el = /** @type {HTMLCanvasElement} */ (this.canvas);
    let last = null;
    const down = (e) => {
      last = [e.clientX, e.clientY];
      el.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!last) return;
      this.orbitBy(-(e.clientX - last[0]) * 0.01, -(e.clientY - last[1]) * 0.01);
      last = [e.clientX, e.clientY];
      if (onChange) onChange();
    };
    const up = () => {
      last = null;
    };
    const wheel = (e) => {
      e.preventDefault();
      this.view.zoom *= Math.exp(-e.deltaY * 0.001);
      if (onChange) onChange();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    this._detach = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    };
    return this._detach;
  }

  /** Release GL resources and listeners. */
  dispose() {
    if (this._detach) this._detach();
    const gl = this.gl;
    for (const b of Object.values(this.buffers)) gl.deleteBuffer(b);
    gl.deleteProgram(this.program);
  }
}

function link(gl, vs, fs) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader compile error: ${gl.getShaderInfoLog(sh)}`);
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link error: ${gl.getProgramInfoLog(p)}`);
  return p;
}
