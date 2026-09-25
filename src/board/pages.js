/**
 * Page transitions for paper styles: flip (a page turns over its left edge)
 * and scroll (the page slides up to fresh lines).
 * @module board/pages
 */

import { Animation } from '../core/animations.js';
import { Rect } from '../core/shapes.js';
import { ColorMix } from '../core/node.js';
import { linear, easeInOutSine } from '../core/easing.js';

/**
 * Turn the current page over its left edge. The outgoing content rides on a
 * page that folds away and reveals whatever is underneath (content added
 * before the flip starts, or added later, shows on the new page).
 */
export class PageFlip extends Animation {
  /** @param {import('../core/node.js').Node} content outgoing content @param {Record<string, any>} [opts] */
  constructor(content, opts = {}) {
    super(opts);
    this.content = content;
    this.defaultDuration = 1.4;
    this.defaultEase = easeInOutSine;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const W = scene.frameWidth;
    const H = scene.frameHeight;
    const spine = -W / 2;
    const page = new Rect({ width: W, height: H, fill: 'background', stroke: null, zIndex: 50, meta: { noBoard: true, page: true } });
    page._init.visible = false;
    scene.root.add(page);
    page.tween('visible', s, s, true, linear);
    const content = this.content;
    content.tween('zIndex', s, s, 51, linear);
    const x0 = content._cur.x;
    const sx0 = content._cur.scaleX;
    // Pseudo-3D turn: horizontal scale follows cos(pi u) about the spine; past the midpoint the back of the page shows.
    const k = (u) => Math.cos(Math.PI * u);
    page.tween('scaleX', s, e, -1, this.ease, (u) => k(u) || 1e-4);
    page.tween('x', s, e, spine - W / 2, this.ease, (u) => spine + (W / 2) * k(u));
    page.tween('fill', s, e, 'background', this.ease, (u) => new ColorMix('background', 'muted', 0.35 * Math.sin(Math.PI * u)));
    content.tween('scaleX', s, e, sx0, this.ease, (u) => (u < 0.5 ? sx0 * Math.max(1e-4, k(u)) : 1e-4));
    content.tween('x', s, e, x0, this.ease, (u) => spine + (x0 - spine) * Math.max(0, k(u)));
    content.tween('opacity', s, e, 0, this.ease, (u) => (u < 0.5 ? 1 : 0));
    page.tween('visible', e, e, false, linear);
    content.tween('visible', e, e, false, linear);
    content.tween('scaleX', e, e, sx0, linear);
    content.tween('x', e, e, x0, linear);
    content.tween('opacity', e, e, 1, linear);
    content.tween('zIndex', e, e, 0, linear);
    return e;
  }
}

/**
 * @param {import('../core/node.js').Node} content
 * @param {Record<string, any>} [opts]
 * @returns {PageFlip}
 */
export function pageFlip(content, opts) {
  return new PageFlip(content, opts);
}

/**
 * Scroll the page by moving the camera down; ruled lines and grids move with it.
 */
export class PageScroll extends Animation {
  /** @param {number} distance world units (positive scrolls down to new lines) @param {Record<string, any>} [opts] */
  constructor(distance, opts = {}) {
    super(opts);
    this.distance = distance;
    this.defaultDuration = 1.2;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const cam = scene.camera;
    cam.tween('y', s, e, cam._cur.y - this.distance, this.ease);
    return e;
  }
}

/**
 * @param {number} distance
 * @param {Record<string, any>} [opts]
 * @returns {PageScroll}
 */
export function pageScroll(distance, opts) {
  return new PageScroll(distance, opts);
}
