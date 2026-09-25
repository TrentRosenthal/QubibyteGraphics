/**
 * Lights and light presets. Lights are plain objects. Directional lights
 * point from the surface toward the light and live in world space or camera
 * space (x right, y up, z toward the viewer), so a studio rig can follow the
 * camera the way a photographer's lights do.
 *
 * Presets are keyed by the theme's `light` token: 'studio' (key, fill, rim,
 * soft hemisphere), 'blackboard' (flat bright ink lines, no shading, for
 * chalk and marker boards), and 'blueprint' (white line work only).
 * @module three/lighting
 */

/**
 * @typedef {Object} Light
 * @property {'directional'|'point'|'ambient'|'hemisphere'} kind
 * @property {number} intensity
 * @property {number[]} [direction] toward the light (directional)
 * @property {number[]} [position] point lights
 * @property {number} [range] point light falloff distance (0 for none)
 * @property {number} [ground] hemisphere intensity from below, as a fraction of `intensity`
 * @property {number[]} [up] hemisphere up axis (world)
 * @property {'world'|'camera'} [space]
 * @property {number} [specular] weight of this light in specular highlights
 */

/**
 * @param {number[]} direction toward the light
 * @param {number} [intensity=1]
 * @param {{space?: 'world'|'camera', specular?: number}} [opts]
 * @returns {Light}
 */
export function directionalLight(direction, intensity = 1, opts = {}) {
  const L = Math.hypot(...direction) || 1;
  return { kind: 'directional', direction: direction.map((v) => v / L), intensity, space: opts.space ?? 'world', specular: opts.specular ?? 1 };
}

/**
 * @param {number[]} position
 * @param {number} [intensity=1]
 * @param {{range?: number, space?: 'world'|'camera'}} [opts]
 * @returns {Light}
 */
export function pointLight(position, intensity = 1, opts = {}) {
  return { kind: 'point', position, intensity, range: opts.range ?? 0, space: opts.space ?? 'world', specular: 1 };
}

/** @param {number} [intensity=0.2] @returns {Light} */
export function ambientLight(intensity = 0.2) {
  return { kind: 'ambient', intensity };
}

/**
 * Sky light from above that fades to a weaker ground bounce below.
 * @param {number} [intensity=0.35] @param {number} [ground=0.35] fraction of intensity from below
 * @param {number[]} [up=[0,0,1]]
 * @returns {Light}
 */
export function hemisphereLight(intensity = 0.35, ground = 0.35, up = [0, 0, 1]) {
  return { kind: 'hemisphere', intensity, ground, up };
}

/**
 * Light rigs by preset name.
 * @type {Record<string, () => Light[]>}
 */
export const LIGHT_PRESETS = {
  studio: () => [
    directionalLight([-0.5, 0.65, 0.58], 0.78, { space: 'camera', specular: 1 }),
    directionalLight([0.8, 0.05, 0.6], 0.2, { space: 'camera', specular: 0.2 }),
    directionalLight([0.3, 0.6, -0.75], 0.3, { space: 'camera', specular: 0.5 }),
    hemisphereLight(0.2, 0.3),
    ambientLight(0.1),
  ],
  blackboard: () => [ambientLight(1)],
  blueprint: () => [ambientLight(1)],
};

/**
 * Preset for a theme. An explicit non-default `light` token wins; otherwise
 * board themes map to 'blackboard' and blueprint themes to 'blueprint'.
 * @param {import('../themes/tokens.js').Theme} theme
 * @returns {'studio'|'blackboard'|'blueprint'|string}
 */
export function resolveLightPreset(theme) {
  const t = theme && theme.light;
  if (t && t !== 'studio' && LIGHT_PRESETS[t]) return t;
  const board = theme && theme.board;
  if (board === 'blueprint' || (theme && /blueprint/.test(theme.id || ''))) return 'blueprint';
  if (board) return 'blackboard';
  return 'studio';
}

/**
 * Bring camera-space lights into world space for one frame.
 * @param {Light[]} lights
 * @param {{right: number[], up: number[], forward: number[]}} basis camera basis
 * @returns {Light[]}
 */
export function worldLights(lights, basis) {
  return lights.map((l) => {
    if (l.space !== 'camera') return l;
    const toWorld = (v) => [
      basis.right[0] * v[0] + basis.up[0] * v[1] - basis.forward[0] * v[2],
      basis.right[1] * v[0] + basis.up[1] * v[1] - basis.forward[1] * v[2],
      basis.right[2] * v[0] + basis.up[2] * v[1] - basis.forward[2] * v[2],
    ];
    if (l.kind === 'directional') return { ...l, direction: toWorld(l.direction), space: 'world' };
    if (l.kind === 'point') return { ...l, position: toWorld(l.position), space: 'world' };
    return l;
  });
}

/**
 * Diffuse irradiance (a scalar near 1 for a well lit face) at a point with
 * unit normal n. Directional terms use a soft wrap so the terminator is gentle.
 * @param {Light[]} lights world-space lights
 * @param {number[]} n
 * @param {number[]} p
 * @returns {number}
 */
export function diffuseAt(lights, n, p) {
  let d = 0;
  for (const l of lights) {
    if (l.kind === 'ambient') d += l.intensity;
    else if (l.kind === 'hemisphere') {
      const u = l.up ?? [0, 0, 1];
      const k = 0.5 + 0.5 * (n[0] * u[0] + n[1] * u[1] + n[2] * u[2]);
      d += l.intensity * (l.ground + (1 - l.ground) * k);
    } else if (l.kind === 'directional') {
      const c = n[0] * l.direction[0] + n[1] * l.direction[1] + n[2] * l.direction[2];
      d += l.intensity * wrap(c);
    } else if (l.kind === 'point') {
      let lx = l.position[0] - p[0];
      let ly = l.position[1] - p[1];
      let lz = l.position[2] - p[2];
      const dist = Math.hypot(lx, ly, lz) || 1;
      lx /= dist;
      ly /= dist;
      lz /= dist;
      const att = l.range > 0 ? Math.max(0, 1 - dist / l.range) ** 2 : 1;
      d += l.intensity * att * wrap(n[0] * lx + n[1] * ly + n[2] * lz);
    }
  }
  return d;
}

function wrap(c) {
  const w = 0.2;
  return Math.max(0, (c + w) / (1 + w));
}

/**
 * Blinn-Phong specular term.
 * @param {Light[]} lights world-space lights
 * @param {number[]} n unit normal
 * @param {number[]} p surface point
 * @param {number[]} v unit vector from the surface toward the eye
 * @param {number} shininess
 * @returns {number}
 */
export function specularAt(lights, n, p, v, shininess) {
  let s = 0;
  for (const l of lights) {
    let L;
    if (l.kind === 'directional') L = l.direction;
    else if (l.kind === 'point') {
      const d = [l.position[0] - p[0], l.position[1] - p[1], l.position[2] - p[2]];
      const len = Math.hypot(...d) || 1;
      L = d.map((x) => x / len);
    } else continue;
    if (n[0] * L[0] + n[1] * L[1] + n[2] * L[2] <= 0) continue;
    const h = [L[0] + v[0], L[1] + v[1], L[2] + v[2]];
    const hl = Math.hypot(...h) || 1;
    const nh = Math.max(0, (n[0] * h[0] + n[1] * h[1] + n[2] * h[2]) / hl);
    s += (l.specular ?? 1) * l.intensity * nh ** shininess;
  }
  return s;
}
