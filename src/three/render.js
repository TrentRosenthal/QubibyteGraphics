/**
 * The vector projector: turns collected 3D render units into depth-ordered
 * 2D PathItems. Faces are lit per face in OKLab, ordered exactly (see
 * order.js), and drawn with a hairline seam stroke in their own color so
 * neighboring faces never show anti-aliasing cracks. Edge lines are ordinary
 * segment primitives lying in their faces' planes, so the ordering draws them
 * right after their faces and hides them exactly when those faces are hidden;
 * dashed hidden edges (blueprint style) are drawn after their whole object.
 * @module three/render
 */

import * as M from './mat4.js';
import { faceNormals, meshEdges, meshBounds } from './geometry.js';
import { POLY, SEG, PT, planeOf, eyeSide, orderScene, splitPrim } from './order.js';
import { material as makeMaterial, presetMaterial, shade, softenColor, AlphaColor } from './materials.js';
import { diffuseAt, specularAt } from './lighting.js';
import { hull2D } from './object3d.js';
import { ColorMix } from '../core/node.js';
import { mix, parseColor } from '../core/color.js';
import { hashSeed } from '../core/random.js';
import { registerPreload } from '../core/scene.js';
import { pathBounds, mergePaths } from '../core/path.js';

let textModule = null;
let textLoading = null;

/**
 * Start loading the text module (src/text/index.js) used for labels that are
 * plain strings when no label factory is given. Resolves to true when it is
 * available; labels are skipped when it is not.
 * @returns {Promise<boolean>}
 */
export function loadLabelText() {
  if (!textLoading) {
    textLoading = import('../text/index.js')
      .then(async (m) => {
        if (typeof m.loadDefaultFonts === 'function') await m.loadDefaultFonts();
        textModule = m;
        return true;
      })
      .catch(() => false);
  }
  return textLoading;
}

// Label text (fonts and KaTeX) loads before any scene builds, so every 3D label renders on the first frame.
registerPreload(() => loadLabelText());

const labelCache = new Map();

function normalizePath(r) {
  if (!r) return null;
  if (r.subpaths) return r;
  if (r.path && r.path.subpaths) return r.path;
  return null;
}

/**
 * Resolve label content to a Path in em units (baseline at y = 0).
 * @param {any} content
 * @param {((text: string) => any)|null} factory
 * @returns {import('../core/path.js').Path|null}
 */
function labelPath(content, factory) {
  const direct = normalizePath(content);
  if (direct) return direct;
  if (typeof content !== 'string' || !content) return null;
  const key = content;
  let byFactory = labelCache.get(factory || 'text');
  if (!byFactory) {
    byFactory = new Map();
    labelCache.set(factory || 'text', byFactory);
  }
  if (byFactory.has(key)) return byFactory.get(key);
  let path = null;
  try {
    if (factory) path = normalizePath(factory(content));
    else if (textModule && /[\\^_{}]/.test(content) && typeof textModule.texToPaths === 'function') {
      // TeX labels (kets, subscripts) typeset with KaTeX; one em tall, baseline at y = 0.
      const r = textModule.texToPaths(content, { size: 1, display: false });
      path = r.paths.length ? mergePaths(...r.paths.map((q) => q.path)) : null;
    } else if (textModule && typeof textModule.textToPath === 'function') path = normalizePath(textModule.textToPath(content, { size: 1 }));
  } catch {
    path = null;
  }
  if (path || factory || textModule) byFactory.set(key, path);
  return path;
}

/**
 * A color resolver for 3D fills: theme tokens, hex, RGBA, ColorMix,
 * AlphaColor, and 'auto' (the softened accent).
 * @param {(v: any) => import('../core/color.js').RGBA|null} color base theme resolver
 * @returns {(v: any) => import('../core/color.js').RGBA}
 */
export function fillResolver(color) {
  const ctx = { color, auto: softenColor(color('accent')) };
  return (v) => resolveFill(v, ctx);
}

function resolveFill(v, ctx) {
  if (v === 'auto' || v == null) return ctx.auto;
  if (v instanceof AlphaColor) return withA(resolveFill(v.color, ctx), v.alpha);
  if (v instanceof ColorMix) {
    const a = resolveFill(v.a, ctx);
    const b = resolveFill(v.b, ctx);
    return mix(a, b, v.t);
  }
  if (typeof v === 'number') return ctx.auto;
  return ctx.color(v);
}

function withA(c, a) {
  return { r: c.r, g: c.g, b: c.b, a: Math.max(0, Math.min(1, c.a * a)) };
}

const shadeCache = new Map();

function shadeCached(base, d, s) {
  const key = `${base.r.toFixed(4)},${base.g.toFixed(4)},${base.b.toFixed(4)}|${Math.round(d * 400)}|${Math.round(s * 400)}`;
  let c = shadeCache.get(key);
  if (!c) {
    c = shade({ ...base, a: 1 }, Math.round(d * 400) / 400, Math.round(s * 400) / 400);
    if (shadeCache.size > 20000) shadeCache.clear();
    shadeCache.set(key, c);
  }
  return c;
}

/**
 * @typedef {Object} RenderInput
 * @property {any[]} units collected render units
 * @property {import('./camera.js').CameraState} cam
 * @property {import('./lighting.js').Light[]} lights world-space lights
 * @property {string} preset light preset
 * @property {(v: any) => import('../core/color.js').RGBA|null} color theme color resolver
 * @property {import('../themes/tokens.js').Theme} theme
 * @property {number} width viewport width (2D units)
 * @property {number} height viewport height (2D units)
 * @property {number[]} matrix 2D world matrix of the viewport
 * @property {number} opacity
 * @property {any} [background] color or null
 * @property {false|{z?: number, opacity?: number}} [shadow]
 * @property {((text: string) => any)|null} [labelFactory]
 * @property {Record<string, {opacity?: number, width?: number, color?: any}>} [edgeStyles]
 */

/**
 * Project, order, and emit PathItems.
 * @param {RenderInput} input
 * @param {any[]} items output list (sampler items)
 * @returns {{prims: number, items: number}}
 */
export function renderUnits(input, items) {
  const { cam, theme } = input;
  const ctx = {
    color: input.color,
    auto: softenColor(input.color('accent')),
    bg: parseColor(theme.colors.background),
    ink: input.color('ink'),
  };
  const P = cam.viewProj;
  const [ma, mb, mc, md, me, mf] = input.matrix;
  const hw = input.width / 2;
  const hh = input.height / 2;
  const proj = (x, y, z) => {
    const w = P[3] * x + P[7] * y + P[11] * z + P[15];
    const X = ((P[0] * x + P[4] * y + P[8] * z + P[12]) / w) * hw;
    const Y = ((P[1] * x + P[5] * y + P[9] * z + P[13]) / w) * hh;
    return [ma * X + mc * Y + me, mb * X + md * Y + mf];
  };
  const clipW = (x, y, z) => P[3] * x + P[7] * y + P[11] * z + P[15];
  const pxPerUnit = (w) => (P[5] * hh) / w;
  const focusW = clipW(...cam.target);
  const nearPlane = [cam.forward[0], cam.forward[1], cam.forward[2], cam.forward[0] * cam.eye[0] + cam.forward[1] * cam.eye[1] + cam.forward[2] * cam.eye[2] + cam.near * 1.0001];

  const scene = sceneExtent(input.units);
  const eps = 1e-7 * Math.max(1, scene.size);
  const prims = [];
  const groupItems = [];
  const meshInfos = [];
  const chopLen = Math.max(scene.size / 14, 1e-3);
  const viewDir = (c) => (cam.orthographic ? [-cam.forward[0], -cam.forward[1], -cam.forward[2]] : norm([cam.eye[0] - c[0], cam.eye[1] - c[1], cam.eye[2] - c[2]]));

  for (const unit of input.units) {
    if (unit.kind === 'mesh') {
      const U = buildMeshUnit(unit, input, ctx, cam, eps, viewDir);
      if (!U) continue;
      meshInfos.push(U);
      if (U.facePrims.length) {
        for (const x of U.facePrims) prims.push(x);
        for (const x of U.edgeSegs) prims.push(x);
        groupItems.push(U.facePrims.concat(U.edgeSegs));
      }
      for (const x of U.wireSegs) {
        const pieces = chop(x, chopLen);
        for (const y of pieces) {
          prims.push(y);
          groupItems.push([y]);
        }
      }
    } else if (unit.kind === 'lines') {
      const col = input.color(unit.color);
      if (!col) continue;
      const style = { kind: 'line', stroke: withA(col, unit.alpha * unit.opacity), width: unit.width, id: unit.id, role: unit.role };
      if (style.stroke.a <= 0.002) continue;
      const segs = lineSegments(unit);
      for (const s of segs) {
        const base = { k: SEG, p: s, u: null, f: -1, pl: null, whole: true, s: style };
        for (const y of chop(base, chopLen)) {
          prims.push(y);
          groupItems.push([y]);
        }
      }
    } else if (unit.kind === 'points') {
      const base = resolveFill(unit.color, ctx);
      const n = Math.max(0, Math.min(unit.points.length, Math.round(unit.points.length * Math.min(1, unit.draw))));
      for (let i = 0; i < n; i++) {
        const c = unit.colors ? resolveFill(unit.colors[i], ctx) : base;
        const x = { k: PT, p: unit.points[i].slice(0, 3), u: null, f: -1, pl: null, whole: true, s: { kind: 'point', fill: withA(c, unit.opacity), r: unit.radii[i], id: unit.id } };
        prims.push(x);
        groupItems.push([x]);
      }
    } else if (unit.kind === 'label') {
      const path = labelPath(unit.content, unit.factory || input.labelFactory || null);
      if (!path) continue;
      const col = input.color(unit.color);
      if (!col) continue;
      const x = { k: PT, p: unit.position.slice(0, 3), u: null, f: -1, pl: null, whole: true, s: { kind: 'label', fill: withA(col, unit.opacity), path, size: unit.size, offset: unit.offset, align: unit.align, id: unit.id } };
      prims.push(x);
      groupItems.push([x]);
    }
  }

  const ordered = orderScene(prims, cam, { eps, bias: 2e-3 * scene.size, items: groupItems });

  const bgItem = input.background ? input.color(input.background) : null;
  if (bgItem) {
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [ma * x + mc * y + me, mb * x + md * y + mf]);
    items.push(pathItem('scene3d-bg', 'scene3d', polygonPath(pts), withA(bgItem, input.opacity), null, 0, { three: true, role: 'background' }));
  }
  if (input.shadow && input.preset === 'studio') emitShadows(meshInfos, input, ctx, proj, clipW, items);

  const attach = attachEdges(meshInfos, ordered);
  const opacity = input.opacity;
  let run = null;
  const flush = () => {
    if (!run) return;
    items.push(pathItem(run.id, 'lines3d', { subpaths: run.subpaths }, null, withA(run.stroke, opacity), run.width, { three: true, role: run.role }, run.dash));
    run = null;
  };
  const pushSeg = (p, style, role, dash) => {
    const clipped = clipSegNear(p, nearPlane);
    if (!clipped) return;
    const a = proj(clipped[0], clipped[1], clipped[2]);
    const b = proj(clipped[3], clipped[4], clipped[5]);
    const key = `${style.stroke.r},${style.stroke.g},${style.stroke.b},${style.stroke.a}|${style.width}|${role}|${dash ? dash.join(',') : ''}`;
    if (!run || run.key !== key) {
      flush();
      run = { key, id: style.id, stroke: style.stroke, width: style.width, role, dash: dash || null, subpaths: [] };
    }
    run.subpaths.push(lineSubpath(a, b));
  };
  ordered.forEach((x, i) => {
    if (x.k === POLY) {
      flush();
      const s = x.s;
      if (s && s.fill) {
        let p = x.p;
        const r = splitPrim(x, nearPlane, 0);
        if (r.back && !r.front) p = null;
        else if (r.front && r.back) p = r.front.p;
        if (p) {
          const pts = [];
          for (let k = 0; k < p.length; k += 3) pts.push(proj(p[k], p[k + 1], p[k + 2]));
          if (s.texture) items.push(...texturedFace(s, pts, proj, opacity));
          else items.push(pathItem(s.id, s.nodeType, polygonPath(pts), withA(s.fill, opacity), s.seam ? withA(s.fill, opacity) : null, s.seam ? (s.meta.occluder ? 0.5 : 0.8) : 0, s.meta));
        }
      }
      const edges = attach.get(i);
      if (edges) {
        for (const e of edges) pushSeg(e.p, e.style, 'edge', e.style.dash);
        flush();
      }
    } else if (x.k === SEG) {
      pushSeg(x.p, x.s, x.s.role || 'line', x.s.dash);
    } else {
      flush();
      const [px, py, pz] = x.p;
      const w = clipW(px, py, pz);
      const depth = (px - cam.eye[0]) * cam.forward[0] + (py - cam.eye[1]) * cam.forward[1] + (pz - cam.eye[2]) * cam.forward[2];
      if (w <= 1e-9 || depth < cam.near) return;
      const c = proj(px, py, pz);
      if (x.s.kind === 'point') {
        const rLocal = x.s.r * pxPerUnit(w);
        const k = Math.sqrt(Math.abs(ma * md - mb * mc));
        items.push(pathItem(x.s.id, 'points3d', circlePath(c[0], c[1], rLocal * k), withA(x.s.fill, opacity), null, 0, { three: true, role: 'point' }));
      } else {
        const lp = labelItemPath(x.s, c, w, focusW, input.matrix);
        if (lp) items.push(pathItem(x.s.id, 'label3d', lp, withA(x.s.fill, opacity), null, 0, { three: true, role: 'label' }));
      }
    }
  });
  flush();
  return { prims: prims.length, items: items.length };
}

function norm(v) {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

function sceneExtent(units) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const add = (x, y, z) => {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  };
  for (const u of units) {
    if (u.kind === 'mesh') {
      const b = meshBounds(u.mesh);
      for (let i = 0; i < 8; i++) add(...M.transformPoint(u.M, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]));
    } else if (u.kind === 'lines') {
      for (const pl of u.polylines) for (const p of pl.points) add(p[0], p[1], p[2]);
    } else if (u.kind === 'points') {
      for (const p of u.points) add(p[0], p[1], p[2]);
    } else if (u.kind === 'label') add(...u.position);
  }
  if (min[0] === Infinity) return { size: 1, min: [0, 0, 0], max: [0, 0, 0] };
  return { size: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6), min, max };
}

function chop(x, maxLen) {
  const p = x.p;
  const L = Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]);
  const n = Math.ceil(L / maxLen);
  if (n <= 1) return [x];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    out.push({
      k: SEG, u: x.u, f: x.f, pl: null, whole: x.whole, s: x.s,
      p: [p[0] + (p[3] - p[0]) * t0, p[1] + (p[4] - p[1]) * t0, p[2] + (p[5] - p[2]) * t0, p[0] + (p[3] - p[0]) * t1, p[1] + (p[4] - p[1]) * t1, p[2] + (p[5] - p[2]) * t1],
    });
  }
  return out;
}

function lineSegments(unit) {
  const polys = unit.polylines.map((pl) => (pl.closed && pl.points.length > 2 ? [...pl.points, pl.points[0]] : pl.points));
  let total = 0;
  const lens = polys.map((pts) => {
    const l = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
      l.push(d);
      total += d;
    }
    return l;
  });
  const A = Math.max(0, unit.drawStart ?? 0) * total;
  const B = Math.min(1, unit.draw ?? 1) * total;
  if (B <= A) return [];
  const out = [];
  const dash = unit.dash && unit.dash.length >= 2 ? unit.dash : null;
  const period = dash ? dash[0] + dash[1] : 0;
  let acc = 0;
  polys.forEach((pts, pi) => {
    let along = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const L = lens[pi][i];
      const s0 = acc;
      const s1 = acc + L;
      acc = s1;
      if (L <= 0 || s1 <= A || s0 >= B) {
        along += L;
        continue;
      }
      const ta = Math.max(0, (A - s0) / L);
      const tb = Math.min(1, (B - s0) / L);
      const a = pts[i];
      const b = pts[i + 1];
      const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      if (!dash) {
        out.push([...at(ta), ...at(tb)]);
      } else {
        let t = ta;
        while (t < tb - 1e-12) {
          const pos = (along + t * L) % period;
          const on = pos < dash[0];
          const rest = on ? dash[0] - pos : period - pos;
          const t2 = Math.min(tb, t + rest / L);
          if (on && t2 > t) out.push([...at(t), ...at(t2)]);
          t = t2 + 1e-12;
        }
      }
      along += L;
    }
  });
  return out;
}

function buildMeshUnit(unit, input, ctx, cam, eps, viewDir) {
  const mesh = unit.mesh;
  const mat = presetMaterial(makeMaterial(unit.material), input.preset);
  const Mw = unit.M;
  const nv = mesh.positions.length / 3;
  const W = new Float64Array(mesh.positions.length);
  const src = mesh.positions;
  for (let i = 0; i < nv; i++) {
    const x = src[i * 3];
    const y = src[i * 3 + 1];
    const z = src[i * 3 + 2];
    W[i * 3] = Mw[0] * x + Mw[4] * y + Mw[8] * z + Mw[12];
    W[i * 3 + 1] = Mw[1] * x + Mw[5] * y + Mw[9] * z + Mw[13];
    W[i * 3 + 2] = Mw[2] * x + Mw[6] * y + Mw[10] * z + Mw[14];
  }
  const nf = mesh.faces.length;
  const flip = Mw[0] * (Mw[5] * Mw[10] - Mw[9] * Mw[6]) - Mw[4] * (Mw[1] * Mw[10] - Mw[9] * Mw[2]) + Mw[8] * (Mw[1] * Mw[6] - Mw[5] * Mw[2]) < 0;
  const planes = new Array(nf);
  const front = new Uint8Array(nf);
  let hasFront = false;
  for (let f = 0; f < nf; f++) {
    const face = mesh.faces[f];
    const p = new Array(face.length * 3);
    for (let k = 0; k < face.length; k++) {
      p[k * 3] = W[face[k] * 3];
      p[k * 3 + 1] = W[face[k] * 3 + 1];
      p[k * 3 + 2] = W[face[k] * 3 + 2];
    }
    const pl = planeOf(p);
    planes[f] = flip ? [-pl[0], -pl[1], -pl[2], -pl[3]] : pl;
    planes[f].pts = p;
    if (eyeSide(planes[f], cam.eyeH) > 0) {
      front[f] = 1;
      hasFront = true;
    }
  }
  const fillAlpha = mat.faces ? mat.alpha * unit.fillOpacity : 0;
  const facesDrawn = fillAlpha * unit.opacity > 0.003;
  const opaque = !mat.rim && fillAlpha * unit.opacity >= 0.995;
  const cull = facesDrawn && opaque && mesh.closed;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < nv; i++) {
    cx += W[i * 3];
    cy += W[i * 3 + 1];
    cz += W[i * 3 + 2];
  }
  const center = [cx / nv, cy / nv, cz / nv];
  let outR = 0;
  for (let i = 0; i < nv; i++) outR = Math.max(outR, Math.hypot(W[i * 3] - center[0], W[i * 3 + 1] - center[1], W[i * 3 + 2] - center[2]));
  let inR = Infinity;
  for (const pl of planes) inR = Math.min(inR, pl[3] - (pl[0] * center[0] + pl[1] * center[1] + pl[2] * center[2]));
  const U = {
    unit, id: unit.id, mat, convex: mesh.convex && mesh.closed, closed: mesh.closed, cull, hasFront, planes, front,
    worldPos: W, edges: meshEdges(mesh), center, inR: Math.max(0, inR), outR, M: Mw, polyCount: 0, facePrims: [], wireSegs: [],
    faceStyles: new Array(nf), facesDrawn, opaque,
  };
  const baseColor = unit.capFaces && (unit.fill === 'auto' || unit.fill == null) ? softenColor(ctx.color('accent'), 0.42) : resolveFill(unit.fill, ctx);
  const capColor = unit.capFaces ? resolveFill(unit.capColor ?? 'accent', ctx) : null;
  const explicitFill = unit.fill != null && unit.fill !== 'auto';
  const edgeCol = (mat.kind === 'ink' || mat.kind === 'wireframe') && explicitFill && !mat.edgeColor ? baseColor : input.color(mat.edgeColor ?? unit.edgeColor ?? 'ink') || ctx.ink;
  const faceColor = (f) => {
    if (capColor && f >= nf - unit.capFaces) return capColor;
    if (mesh.faceColors && mesh.faceColors[f] != null) return resolveFill(mesh.faceColors[f], ctx);
    return baseColor;
  };
  const styleOf = (f) => {
    let s = U.faceStyles[f];
    if (s) return s;
    const pl = planes[f];
    const isFront = front[f] === 1;
    const n = isFront ? [pl[0], pl[1], pl[2]] : [-pl[0], -pl[1], -pl[2]];
    const c = centroidOf(pl.pts);
    let fill;
    let meta = { three: true, role: 'face' };
    let alpha = fillAlpha;
    const isCap = capColor && f >= nf - unit.capFaces;
    if (mat.occluder && !isCap) {
      fill = ctx.bg;
      meta = { three: true, role: 'face', noBoard: true, occluder: true };
    } else {
      const base = faceColor(f);
      if (mat.shading === 'none' || isCap) fill = isCap ? shadeCached(base, 1, 0) : base;
      else {
        const d = diffuseAt(input.lights, n, c) * (isFront || !mesh.closed ? 1 : 0.9);
        const v = viewDir(c);
        const sp = mat.specular > 0 ? mat.specular * specularAt(input.lights, n, c, v, mat.shininess) : 0;
        fill = { ...shadeCached(base, isFront ? d : d * 0.86, sp), a: base.a };
      }
      if (mat.rim) {
        const v = viewDir(c);
        const nv2 = Math.abs(n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
        alpha = Math.min(1, fillAlpha + mat.rim * (1 - nv2) ** 2.5);
      }
      if (isCap) alpha = Math.max(alpha, Math.min(1, unit.fillOpacity));
    }
    const fa = withA(fill, alpha * unit.opacity);
    s = { fill: fa, seam: fa.a >= 0.99, id: unit.id, nodeType: unit.obj ? unit.obj.type : 'mesh3d', meta };
    if (unit.texture && mesh.uvs && !isCap) {
      // The face's first three corners pin an affine map from image space to the screen.
      const vs = mesh.faces[f];
      const tri = [];
      const uv = [];
      for (let k = 0; k < 3; k++) {
        const vi = vs[k];
        tri.push([W[vi * 3], W[vi * 3 + 1], W[vi * 3 + 2]]);
        uv.push([mesh.uvs[vi * 2], mesh.uvs[vi * 2 + 1]]);
      }
      const light = mat.shading === 'none' ? 1 : Math.max(0, Math.min(1, diffuseAt(input.lights, n, c)));
      s.texture = { source: unit.texture, tri, uv, shade: (1 - light) * (unit.textureShade ?? 0.55), opacity: unit.opacity };
    }
    U.faceStyles[f] = s;
    return s;
  };
  if (facesDrawn) {
    for (let f = 0; f < nf; f++) {
      if (cull && !front[f]) continue;
      const pl = planes[f];
      const pts = pl.pts;
      let dev = 0;
      let diam = 0;
      if (pts.length > 9) {
        for (let k = 0; k < pts.length; k += 3) {
          dev = Math.max(dev, Math.abs(pl[0] * pts[k] + pl[1] * pts[k + 1] + pl[2] * pts[k + 2] - pl[3]));
          diam = Math.max(diam, Math.abs(pts[k] - pts[0]) + Math.abs(pts[k + 1] - pts[1]) + Math.abs(pts[k + 2] - pts[2]));
        }
      }
      if (dev > 0.03 * diam) {
        for (let k = 3; k + 3 < pts.length; k += 3) {
          const tri = [pts[0], pts[1], pts[2], pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5]];
          U.facePrims.push({ k: POLY, p: tri, u: U, f, pl: planeOf(tri), whole: true, s: styleOf(f) });
        }
      } else U.facePrims.push({ k: POLY, p: pts, u: U, f, pl, whole: true, s: styleOf(f), dev: dev > eps ? dev * 1.001 : 0 });
    }
    U.polyCount = U.facePrims.length;
  }
  const edges = selectEdges(U, mesh, mat, unit, input, edgeCol);
  U.edgeList = [];
  U.edgeSegs = [];
  for (const e of edges) {
    if (!facesDrawn) U.wireSegs.push({ k: SEG, p: e.p, u: null, f: -1, pl: null, whole: true, s: e.style });
    else if (e.hidden && U.cull) U.edgeList.push(e);
    else U.edgeSegs.push({ k: SEG, p: e.p, u: U, f: -1, pl: null, whole: true, s: e.style });
  }
  return U;
}

function centroidOf(p) {
  const n = p.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < p.length; i += 3) {
    x += p[i];
    y += p[i + 1];
    z += p[i + 2];
  }
  return [x / n, y / n, z / n];
}

function selectEdges(U, mesh, mat, unit, input, edgeCol) {
  const E = U.edges;
  const W = U.worldPos;
  const out = [];
  const cosFeature = Math.cos((mat.featureAngle * Math.PI) / 180);
  const N = faceNormals(mesh);
  const boost = mat.faces ? 1 - Math.max(0, Math.min(1, unit.fillOpacity)) : 0;
  const lift = (a) => a + (Math.max(a, 0.85) - a) * boost;
  const baseA = lift(mat.edgeOpacity) * unit.edgeOpacity * unit.opacity;
  const silA = lift(mat.silhouetteOpacity) * unit.edgeOpacity * unit.opacity;
  const width = unit.edgeWidth ?? mat.edgeWidth;
  const classes = mesh.edgeClass;
  const styles = input.edgeStyles || {};
  const nE = E.count;
  const draw = Math.min(1, unit.draw ?? 1);
  const lag = 0.5;
  const nvCount = mesh.positions.length / 3 + 1;
  for (let i = 0; i < nE; i++) {
    const a = E.a[i];
    const b = E.b[i];
    const f0 = E.f0[i];
    const f1 = E.f1[i];
    const cls = classes ? classes.get(`${a},${b}`) : undefined;
    const boundary = f1 < 0;
    const sil = !boundary && U.front[f0] !== U.front[f1];
    let feature = false;
    if (!boundary) feature = N[f0 * 3] * N[f1 * 3] + N[f0 * 3 + 1] * N[f1 * 3 + 1] + N[f0 * 3 + 2] * N[f1 * 3 + 2] < cosFeature;
    let take;
    if (cls) take = true;
    else if (mat.edges === 'none') take = false;
    else if (mat.edges === 'all') take = true;
    else if (mat.edges === 'silhouette') take = sil || boundary;
    else take = feature || sil || boundary;
    if (!take) continue;
    let alpha = sil || boundary ? silA : baseA;
    let col = edgeCol;
    let w = width;
    if (cls) {
      const st = styles[cls] || {};
      alpha = (st.opacity ?? 0.2) * unit.edgeOpacity * unit.opacity;
      if (st.color) col = input.color(st.color) || col;
      if (st.width) w = st.width;
    }
    const visible = U.front[f0] || (!boundary && U.front[f1]);
    let dash = null;
    if (!visible && !U.facesDrawn) {
      if (mat.backEdges === 'hide') continue;
      alpha *= 0.35;
      if (mat.backEdges === 'dash') dash = [0.09, 0.07];
    } else if (!visible) {
      if (U.cull && mat.backEdges === 'hide') continue;
      if (!U.cull) alpha *= mat.backEdges === 'dim' ? 0.55 : 1;
      else {
        alpha *= 0.3;
        if (mat.backEdges === 'dash') dash = [0.09, 0.07];
      }
    }
    if (alpha <= 0.002) continue;
    let p = [W[a * 3], W[a * 3 + 1], W[a * 3 + 2], W[b * 3], W[b * 3 + 1], W[b * 3 + 2]];
    if (draw < 1) {
      const start = (lag * ((a * nvCount + b) % 997)) / 997;
      const frac = Math.max(0, Math.min(1, (draw - start) / (1 - lag)));
      if (frac <= 0) continue;
      p = [p[0], p[1], p[2], p[0] + (p[3] - p[0]) * frac, p[1] + (p[4] - p[1]) * frac, p[2] + (p[5] - p[2]) * frac];
    }
    out.push({ p, f0, f1, hidden: !visible, style: { stroke: withA(col, alpha), width: w, id: U.id, dash, role: 'edge' } });
  }
  return out;
}

function attachEdges(infos, ordered) {
  const map = new Map();
  if (!infos.some((U) => U.edgeList.length)) return map;
  const last = new Map();
  ordered.forEach((x, i) => {
    if (x.k !== POLY || !x.u) return;
    let arr = last.get(x.u);
    if (!arr) {
      arr = { max: -1 };
      last.set(x.u, arr);
    }
    if (i > arr.max) arr.max = i;
  });
  for (const U of infos) {
    const L = last.get(U);
    if (!L) continue;
    for (const e of U.edgeList) {
      if (!map.has(L.max)) map.set(L.max, []);
      map.get(L.max).push(e);
    }
  }
  return map;
}

function clipSegNear(p, pl) {
  const s0 = pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3];
  const s1 = pl[0] * p[3] + pl[1] * p[4] + pl[2] * p[5] - pl[3];
  if (s0 >= 0 && s1 >= 0) return p;
  if (s0 < 0 && s1 < 0) return null;
  const t = s0 / (s0 - s1);
  const m = [p[0] + (p[3] - p[0]) * t, p[1] + (p[4] - p[1]) * t, p[2] + (p[5] - p[2]) * t];
  return s0 < 0 ? [...m, p[3], p[4], p[5]] : [p[0], p[1], p[2], ...m];
}

function lineSubpath(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return { points: [a[0], a[1], a[0] + dx / 3, a[1] + dy / 3, a[0] + (2 * dx) / 3, a[1] + (2 * dy) / 3, b[0], b[1]], closed: false };
}

/**
 * Closed polygon path from 2D points with straight cubic segments.
 * @param {number[][]} pts
 * @returns {import('../core/path.js').Path}
 */
function polygonPath(pts) {
  const n = pts.length;
  const out = new Array(2 + 6 * n);
  out[0] = pts[0][0];
  out[1] = pts[0][1];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const o = 2 + 6 * i;
    out[o] = a[0] + dx / 3;
    out[o + 1] = a[1] + dy / 3;
    out[o + 2] = a[0] + (2 * dx) / 3;
    out[o + 3] = a[1] + (2 * dy) / 3;
    out[o + 4] = b[0];
    out[o + 5] = b[1];
  }
  return { subpaths: [{ points: out, closed: true }] };
}

function circlePath(cx, cy, r) {
  const k = 0.5522847498307936 * r;
  return {
    subpaths: [{
      points: [cx + r, cy, cx + r, cy + k, cx + k, cy + r, cx, cy + r, cx - k, cy + r, cx - r, cy + k, cx - r, cy, cx - r, cy - k, cx - k, cy - r, cx, cy - r, cx + k, cy - r, cx + r, cy - k, cx + r, cy],
      closed: true,
    }],
  };
}

function labelItemPath(s, c, w, focusW, m) {
  const b = pathBounds(s.path);
  if (!b) return null;
  const scale = s.size * (focusW > 0 && w > 0 ? focusW / w : 1);
  const [ma, mb, mc, md] = m;
  const det = ma * md - mb * mc;
  const inv = det ? [md / det, -mb / det, -mc / det, ma / det] : [1, 0, 0, 1];
  const lx = inv[0] * (c[0] - m[4]) + inv[2] * (c[1] - m[5]);
  const ly = inv[1] * (c[0] - m[4]) + inv[3] * (c[1] - m[5]);
  let ox = b.x + b.w / 2;
  if (s.align === 'left') ox = b.x;
  else if (s.align === 'right') ox = b.x + b.w;
  const oy = b.y + b.h / 2;
  const ax = lx + (s.offset ? s.offset[0] * s.size : 0);
  const ay = ly + (s.offset ? s.offset[1] * s.size : 0);
  return {
    subpaths: s.path.subpaths.map((sp) => {
      const q = sp.points;
      const out = new Array(q.length);
      for (let i = 0; i < q.length; i += 2) {
        const X = ax + (q[i] - ox) * scale;
        const Y = ay + (q[i + 1] - oy) * scale;
        out[i] = ma * X + mc * Y + m[4];
        out[i + 1] = mb * X + md * Y + m[5];
      }
      return { points: out, closed: sp.closed };
    }),
  };
}

function emitShadows(infos, input, ctx, proj, clipW, items) {
  const casters = infos.filter((U) => U.unit.castShadow && U.facesDrawn);
  if (!casters.length) return;
  let zmin = Infinity;
  for (const U of casters) for (let i = 2; i < U.worldPos.length; i += 3) zmin = Math.min(zmin, U.worldPos[i]);
  const opt = typeof input.shadow === 'object' ? input.shadow : {};
  const z = opt.z ?? zmin;
  const strength = opt.opacity ?? 1;
  const col = input.theme.dark ? mix(ctx.bg, '#000000', 0.6) : mix(ctx.ink, ctx.bg, 0.35);
  const layers = [];
  for (let i = 0; i < 7; i++) layers.push([0.9 + i * 0.05, input.theme.dark ? 0.05 : 0.022]);
  for (const U of casters) {
    const W = U.worldPos;
    const pts = [];
    for (let i = 0; i < W.length; i += 3) pts.push([W[i], W[i + 1]]);
    const hull = hull2D(pts);
    if (hull.length < 3) continue;
    let height = 0;
    for (let i = 2; i < W.length; i += 3) height = Math.max(height, W[i] - z);
    let lowest = Infinity;
    for (let i = 2; i < W.length; i += 3) lowest = Math.min(lowest, W[i] - z);
    const fade = Math.max(0, 1 - lowest / Math.max(0.5, height + 0.5));
    let cx = 0;
    let cy = 0;
    for (const p of hull) {
      cx += p[0];
      cy += p[1];
    }
    cx /= hull.length;
    cy /= hull.length;
    for (const [k, a] of layers) {
      const ring = hull.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k, z]);
      if (ring.some((p) => clipW(p[0], p[1], p[2]) <= 1e-6)) continue;
      const pts2 = ring.map((p) => proj(p[0], p[1], p[2]));
      items.push(pathItem(U.id + ':shadow', 'shadow3d', polygonPath(pts2), withA(col, a * strength * fade * input.opacity * U.unit.opacity), null, 0, { three: true, role: 'shadow', noBoard: true }));
    }
  }
}

/**
 * Image item for one textured face piece: the image is mapped by the affine
 * transform that takes the face's pinned corners to their screen positions
 * and clipped to the piece (grown a hair so neighbors meet without seams),
 * followed by a translucent shade for lighting.
 * @param {any} s face style with a texture
 * @param {number[][]} pts projected polygon of the piece
 * @param {(x: number, y: number, z: number) => number[]} proj
 * @param {number} opacity
 * @returns {any[]}
 */
function texturedFace(s, pts, proj, opacity) {
  const t = s.texture;
  const P = t.tri.map((q) => proj(q[0], q[1], q[2]));
  // Image local frame used by image items: centered unit square, y up.
  const L = t.uv.map(([u, v]) => [u - 0.5, 0.5 - v]);
  const A = affineFrom(L, P);
  if (!A) return [];
  let cx = 0;
  let cy = 0;
  for (const q of pts) {
    cx += q[0];
    cy += q[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  const grown = pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * 0.006, y + (dy / d) * 0.006];
  });
  const out = [{ kind: 'image', id: s.id, source: t.source, matrix: A, width: 1, height: 1, opacity: opacity * t.opacity, treatment: 'none', fit: 'fill', time: 0, clip: polygonPath(grown), meta: { three: true, role: 'texture' } }];
  if (t.shade > 0.01) out.push(pathItem(s.id + ':shade', s.nodeType, polygonPath(pts), { r: 0, g: 0, b: 0, a: t.shade * opacity * t.opacity }, null, 0, { three: true, role: 'textureShade', noBoard: true }));
  return out;
}

/**
 * Affine matrix [a, b, c, d, e, f] taking three source points to three targets.
 * @param {number[][]} src
 * @param {number[][]} dst
 * @returns {number[]|null}
 */
function affineFrom(src, dst) {
  const [[x0, y0], [x1, y1], [x2, y2]] = src;
  const det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (Math.abs(det) < 1e-12) return null;
  const solve = (r0, r1, r2) => [
    (r0 * (y1 - y2) - y0 * (r1 - r2) + (r1 * y2 - r2 * y1)) / det,
    (x0 * (r1 - r2) - r0 * (x1 - x2) + (x1 * r2 - x2 * r1)) / det,
    (x0 * (y1 * r2 - y2 * r1) - y0 * (x1 * r2 - x2 * r1) + r0 * (x1 * y2 - x2 * y1)) / det,
  ];
  const [a, c, e] = solve(dst[0][0], dst[1][0], dst[2][0]);
  const [b, d, f] = solve(dst[0][1], dst[1][1], dst[2][1]);
  return [a, b, c, d, e, f];
}

function pathItem(id, nodeType, path, fill, stroke, width, meta, dash = null) {
  return {
    kind: 'path',
    id,
    nodeType,
    path,
    fill: fill && fill.a > 0 ? fill : null,
    stroke: stroke && stroke.a > 0 && width > 0 ? stroke : null,
    strokeWidth: width,
    lineCap: 'round',
    lineJoin: 'round',
    dash,
    fillRule: 'nonzero',
    seed: hashSeed(id),
    meta,
    draw: 1,
  };
}
