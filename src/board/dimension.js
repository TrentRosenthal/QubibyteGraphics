/**
 * Drafting dimension lines: extension lines from two points, a dimension
 * line offset from the feature with small arrowheads, and an optional label
 * node centered on it. Styled as clean technical lines in every theme and as
 * drafting marks on the blueprint board.
 * @module board/dimension
 */

import { Group, PathNode } from '../core/node.js';
import { polyPath, PathBuilder } from '../core/path.js';

/**
 * Dimension line between two points.
 */
export class DimensionLine extends Group {
  /**
   * @param {number[]} a
   * @param {number[]} b
   * @param {Record<string, any>} [opts] offset (world units, sign picks the side, default 0.5), label (a Node placed at the middle), color ('muted'), gap (0.08), extend (0.12), arrow (0.14)
   */
  constructor(a, b, opts = {}) {
    super([], { type: 'dimension' });
    const off = opts.offset ?? 0.5;
    const color = opts.color ?? 'muted';
    const gap = opts.gap ?? 0.08;
    const ext = opts.extend ?? 0.12;
    const ah = opts.arrow ?? 0.14;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    const nx = -uy;
    const ny = ux;
    const s = Math.sign(off) || 1;
    const pa = [a[0] + nx * off, a[1] + ny * off];
    const pb = [b[0] + nx * off, b[1] + ny * off];
    const extA = polyPath([[a[0] + nx * gap * s, a[1] + ny * gap * s], [pa[0] + nx * ext * s, pa[1] + ny * ext * s]]);
    const extB = polyPath([[b[0] + nx * gap * s, b[1] + ny * gap * s], [pb[0] + nx * ext * s, pb[1] + ny * ext * s]]);
    const style = { stroke: color, strokeWidth: 2, meta: { noOvershoot: true } };
    this.extensionA = new PathNode(extA, style);
    this.extensionB = new PathNode(extB, style);
    this.line = new PathNode(polyPath([pa, pb]), style);
    const head = (p, dir) => {
      const bld = new PathBuilder();
      bld.moveTo(p[0], p[1]);
      bld.lineTo(p[0] + dir * ux * ah - nx * ah * 0.32, p[1] + dir * uy * ah - ny * ah * 0.32);
      bld.lineTo(p[0] + dir * ux * ah + nx * ah * 0.32, p[1] + dir * uy * ah + ny * ah * 0.32);
      bld.close();
      return new PathNode(bld.build(), { fill: color, stroke: null, meta: { solidFill: true } });
    };
    this.headA = head(pa, 1);
    this.headB = head(pb, -1);
    this.add(this.extensionA, this.extensionB, this.line, this.headA, this.headB);
    this.midpoint = [(pa[0] + pb[0]) / 2 + nx * 0.22 * s, (pa[1] + pb[1]) / 2 + ny * 0.22 * s];
    if (opts.label) {
      opts.label.moveTo(this.midpoint);
      this.label = opts.label;
      this.add(opts.label);
    }
  }
}
