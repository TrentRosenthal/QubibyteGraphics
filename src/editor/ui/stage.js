/**
 * The editor canvas: the rendered scene with an interaction overlay on top.
 * Click to select, Shift-click to add, drag to move, handles to resize and
 * rotate, snapping with alignment guides, generic block handles, drop
 * targets for library blocks and files, and the node-graph wire layer.
 * @module editor/ui/stage
 */

import { blockDefinition } from '../blocks.js';
import { snapBox } from './snapping.js';
import { esc } from '../../playground/ui.js';

const FRAME_SHORT_SIDE = 9;
const RESIZE = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SNAP_PX = 6;
/** Wire-mode card for a block with nothing drawn: width, padding, and port spacing in screen pixels. */
const CARD_W = 148;
const CARD_PAD = 12;
const PORT_GAP = 18;

function inverse(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** The canvas and its overlay. */
export class Stage {
  /**
   * @param {import('./editor-app.js').VisualEditor} ed
   * @param {HTMLElement} stageEl
   * @param {HTMLElement} frameEl
   */
  constructor(ed, stageEl, frameEl) {
    this.ed = ed;
    this.stage = stageEl;
    this.frame = frameEl;
    this.overlay = document.createElement('div');
    this.overlay.className = 've-overlay';
    this.wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.wires.setAttribute('class', 've-wires');
    this.wires.setAttribute('aria-hidden', 'true');
    this.caption = document.createElement('div');
    this.caption.className = 'caption-overlay';
    this.frame.append(this.caption, this.wires, this.overlay);
    this.guides = [];
    this.drag = null;
    this.hover = null;
    this.size = { w: 1, h: 1 };
    new ResizeObserver(() => this.layout()).observe(this.stage);
    this.frame.addEventListener('pointerdown', (e) => this.onDown(e));
    this.frame.addEventListener('pointermove', (e) => this.onMove(e));
    this.frame.addEventListener('pointerup', (e) => this.onUp(e));
    this.frame.addEventListener('pointerleave', () => {
      if (!this.drag && this.hover) {
        this.hover = null;
        this.render();
      }
    });
    this.frame.addEventListener('dblclick', (e) => this.onDouble(e));
    for (const el of [this.stage]) {
      el.addEventListener('dragover', (e) => {
        const types = [...(e.dataTransfer?.types || [])];
        if (!types.includes('application/x-qgfx-block') && !types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.stage.classList.add('is-drop');
      });
      el.addEventListener('dragleave', (e) => {
        if (!this.stage.contains(e.relatedTarget)) this.stage.classList.remove('is-drop');
      });
      el.addEventListener('drop', (e) => {
        this.stage.classList.remove('is-drop');
        const type = e.dataTransfer.getData('application/x-qgfx-block');
        const at = this.worldAt(e.clientX, e.clientY);
        if (type) {
          e.preventDefault();
          this.ed.addBlock(type, at);
        } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
          e.preventDefault();
          this.ed.importFiles([...e.dataTransfer.files], at);
        }
      });
    }
  }

  /** World units across and down the frame. */
  get world() {
    const m = this.ed.doc.meta;
    const unit = FRAME_SHORT_SIDE / Math.min(m.width, m.height);
    return { w: m.width * unit, h: m.height * unit };
  }

  /** Pixels per world unit on screen. */
  get scale() {
    return this.size.w / this.world.w;
  }

  layout() {
    const cs = getComputedStyle(this.stage);
    const aw = Math.max(1, this.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const ah = Math.max(1, this.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    const m = this.ed.doc.meta;
    const ar = m.width / m.height;
    let w = aw;
    let h = w / ar;
    if (h > ah) {
      h = ah;
      w = h * ar;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    if (this.size.w === w && this.size.h === h) return;
    this.size = { w, h };
    this.frame.style.width = `${w}px`;
    this.frame.style.height = `${h}px`;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.ed.runtime.resize(Math.round(w * dpr), Math.round(h * dpr));
    this.render();
  }

  /** @param {number[]} p world point @returns {number[]} frame pixels */
  toScreen(p) {
    const s = this.scale;
    return [(p[0] + this.world.w / 2) * s, (this.world.h / 2 - p[1]) * s];
  }

  /** @returns {number[]} world point under client coordinates */
  worldAt(cx, cy) {
    const r = this.frame.getBoundingClientRect();
    const s = this.scale;
    return [(cx - r.left) / s - this.world.w / 2, this.world.h / 2 - (cy - r.top) / s];
  }

  rectOf(b) {
    const [x0, y0] = this.toScreen([b.x, b.y + b.h]);
    const s = this.scale;
    return { left: x0, top: y0, width: b.w * s, height: b.h * s };
  }

  /** Topmost block whose bounds contain a world point. */
  hitBlock(p, tolerance = 0) {
    const inside = (b) => p[0] >= b.x - tolerance && p[0] <= b.x + b.w + tolerance && p[1] >= b.y - tolerance && p[1] <= b.y + b.h + tolerance;
    // In wire mode, blocks with nothing drawn are cards on the canvas and can be picked up like any other block.
    if (this.ed.showWires) {
      for (let i = this.ed.doc.blocks.length - 1; i >= 0; i--) {
        const block = this.ed.doc.blocks[i];
        const info = this.ed.info(block.id);
        if (info && info.bounds) continue;
        const box = this.cardBox(block);
        if (inside(box)) return { id: block.id, bounds: box, card: true };
      }
    }
    const infos = this.ed.orderedInfos();
    for (let i = infos.length - 1; i >= 0; i--) {
      const b = infos[i].bounds;
      if (!b) continue;
      if (inside(b)) return infos[i];
    }
    return null;
  }

  /**
   * World box of the wire-mode card for a block that draws nothing (a data
   * block such as a slider, or a block that failed to build): centered on
   * the block's own position, or on its stored card position.
   * @param {any} block
   * @returns {{x: number, y: number, w: number, h: number}}
   */
  cardBox(block) {
    const { inputs, outputs } = this.ed.portsOf(block);
    const n = Math.max(inputs.length, outputs.length, 1);
    const w = CARD_W / this.scale;
    const h = (CARD_PAD + n * PORT_GAP) / this.scale;
    const [cx, cy] = this.ed.cardPosition(block);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  onDouble(e) {
    const hit = this.hitBlock(this.worldAt(e.clientX, e.clientY));
    if (hit) this.ed.focusInspector();
  }

  onDown(e) {
    if (e.button !== 0) return;
    const t = e.target;
    const p = this.worldAt(e.clientX, e.clientY);
    const tol = 4 / this.scale;
    this.frame.setPointerCapture(e.pointerId);
    if (t.dataset.port && t.dataset.dir === 'out') {
      this.drag = { kind: 'wire', from: t.dataset.port, start: this.portPos(t) };
      return;
    }
    if (t.dataset.wire) {
      this.ed.selectWire(t.dataset.wire);
      this.drag = null;
      return;
    }
    if (t.dataset.knob) {
      const [id, hid] = t.dataset.knob.split('|');
      const info = this.ed.info(id);
      this.drag = { kind: 'knob', id, hid, inv: inverse(info.matrix) };
      return;
    }
    if (t.dataset.h) {
      const id = [...this.ed.selection][0];
      const info = this.ed.info(id);
      if (!info || !info.bounds) return;
      this.drag = { kind: 'resize', id, dir: t.dataset.h, b0: { ...info.bounds }, props0: { ...this.ed.block(id).props } };
      return;
    }
    if (t.dataset.rot) {
      const id = [...this.ed.selection][0];
      const info = this.ed.info(id);
      if (!info || !info.bounds) return;
      const c = [info.bounds.x + info.bounds.w / 2, info.bounds.y + info.bounds.h / 2];
      this.drag = { kind: 'rotate', id, c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), r0: this.ed.block(id).props.rotation ?? 0 };
      return;
    }
    const hit = this.hitBlock(p, tol);
    if (hit) {
      if (e.shiftKey) this.ed.toggleSelect(hit.id);
      else if (!this.ed.selection.has(hit.id)) this.ed.select([hit.id]);
      const ids = [...this.ed.selection];
      const starts = new Map(ids.map((id) => [id, { bounds: this.ed.info(id)?.bounds ? { ...this.ed.info(id).bounds } : null, props: { ...this.ed.block(id).props } }]));
      this.drag = { kind: 'move', p0: p, ids, starts, moved: false };
      return;
    }
    if (!e.shiftKey) this.ed.select([]);
    this.drag = { kind: 'marquee', p0: p, p1: p, additive: e.shiftKey };
  }

  onMove(e) {
    const p = this.worldAt(e.clientX, e.clientY);
    const d = this.drag;
    if (!d) {
      const hit = this.hitBlock(p, 4 / this.scale);
      const id = hit ? hit.id : null;
      if (id !== this.hover) {
        this.hover = id;
        this.render();
      }
      return;
    }
    if (d.kind === 'move') this.dragMove(d, p, e);
    else if (d.kind === 'resize') this.dragResize(d, p, e);
    else if (d.kind === 'rotate') {
      let r = d.r0 + Math.atan2(p[1] - d.c[1], p[0] - d.c[0]) - d.a0;
      if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      this.ed.previewRotate(d.id, Number(r.toFixed(4)));
      this.render();
    } else if (d.kind === 'knob') {
      const local = apply(d.inv, p[0], p[1]);
      this.ed.dragHandle(d.id, d.hid, local);
    } else if (d.kind === 'wire') {
      const r = this.frame.getBoundingClientRect();
      d.end = [e.clientX - r.left, e.clientY - r.top];
      this.renderWires();
    } else if (d.kind === 'marquee') {
      d.p1 = p;
      this.render();
    }
  }

  dragMove(d, p, e) {
    let dx = p[0] - d.p0[0];
    let dy = p[1] - d.p0[1];
    if (!d.moved && Math.hypot(dx, dy) * this.scale < 3) return;
    d.moved = true;
    const boxes = d.ids.map((id) => d.starts.get(id).bounds).filter(Boolean);
    this.guides = [];
    if (boxes.length && this.ed.snap && !e.altKey) {
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      const moved = { x: x0 + dx, y: y0 + dy, w: x1 - x0, h: y1 - y0 };
      const W = this.world;
      const targets = [{ x: -W.w / 2, y: -W.h / 2, w: W.w, h: W.h }];
      for (const info of this.ed.orderedInfos()) if (info.bounds && info.visible && !d.ids.includes(info.id)) targets.push(info.bounds);
      const snap = snapBox(moved, targets, { threshold: SNAP_PX / this.scale, grid: this.ed.grid ? this.ed.gridStep : null });
      dx += snap.dx;
      dy += snap.dy;
      this.guides = snap.guides;
    }
    d.delta = [dx, dy];
    this.ed.previewMove(d.ids, d.starts, dx, dy);
    this.render();
  }

  dragResize(d, p, e) {
    const b = d.b0;
    let x0 = b.x;
    let x1 = b.x + b.w;
    let y0 = b.y;
    let y1 = b.y + b.h;
    if (d.dir.includes('w')) x0 = Math.min(p[0], x1 - 0.05);
    if (d.dir.includes('e')) x1 = Math.max(p[0], x0 + 0.05);
    if (d.dir.includes('n')) y1 = Math.max(p[1], y0 + 0.05);
    if (d.dir.includes('s')) y0 = Math.min(p[1], y1 - 0.05);
    let kx = (x1 - x0) / b.w;
    let ky = (y1 - y0) / b.h;
    const free = 'width' in d.props0 && 'height' in d.props0 && typeof d.props0.width === 'number' && typeof d.props0.height === 'number';
    if (!free || e.shiftKey || d.dir.length === 2) {
      const k = d.dir === 'n' || d.dir === 's' ? ky : d.dir === 'e' || d.dir === 'w' ? kx : Math.max(kx, ky);
      if (!free || e.shiftKey) {
        kx = k;
        ky = k;
        if (d.dir.includes('w')) x0 = x1 - b.w * k;
        else x1 = x0 + b.w * k;
        if (d.dir.includes('s')) y0 = y1 - b.h * k;
        else y1 = y0 + b.h * k;
      }
    }
    const center = [(x0 + x1) / 2, (y0 + y1) / 2];
    this.ed.previewResize(d.id, d.props0, d.b0, kx, ky, center);
    this.resizeBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.render();
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    this.resizeBox = null;
    if (this.frame.hasPointerCapture(e.pointerId)) this.frame.releasePointerCapture(e.pointerId);
    if (!d) return;
    this.guides = [];
    if (d.kind === 'move' && d.moved) this.ed.commit('Move');
    else if (d.kind === 'resize' || d.kind === 'rotate' || d.kind === 'knob') this.ed.commit(d.kind === 'knob' ? 'Handle' : d.kind === 'resize' ? 'Resize' : 'Rotate');
    else if (d.kind === 'wire') {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.dataset && el.dataset.dir === 'in') this.ed.addWire(d.from, el.dataset.port);
    } else if (d.kind === 'marquee') {
      const x0 = Math.min(d.p0[0], d.p1[0]);
      const x1 = Math.max(d.p0[0], d.p1[0]);
      const y0 = Math.min(d.p0[1], d.p1[1]);
      const y1 = Math.max(d.p0[1], d.p1[1]);
      if ((x1 - x0) * this.scale > 4 || (y1 - y0) * this.scale > 4) {
        const ids = this.ed.orderedInfos().filter((i) => i.bounds && i.bounds.x >= x0 && i.bounds.x + i.bounds.w <= x1 && i.bounds.y >= y0 && i.bounds.y + i.bounds.h <= y1).map((i) => i.id);
        this.ed.select(d.additive ? [...this.ed.selection, ...ids] : ids);
      }
    }
    this.render();
  }

  /** Draw the overlay: hover, selection, handles, guides, marquee. */
  render() {
    const ed = this.ed;
    const parts = [];
    for (const info of ed.orderedInfos()) {
      if (!info.bounds) continue;
      const r = this.rectOf(info.bounds);
      const selected = ed.selection.has(info.id);
      const err = ed.blockErrors.has(info.id);
      if (!info.visible && !selected) parts.push(`<div class="ve-ghost" style="${css(r)}"></div>`);
      if (selected) continue;
      if (info.id === this.hover || err) parts.push(`<div class="ve-hover${err ? ' is-error' : ''}" style="${css(r)}"></div>`);
    }
    const sel = [...ed.selection].map((id) => ed.info(id)).filter((i) => i && i.bounds);
    for (const info of sel) {
      const box = this.resizeBox && this.drag && this.drag.id === info.id ? this.resizeBox : info.bounds;
      const r = this.rectOf(box);
      const single = sel.length === 1 && ed.selection.size === 1;
      parts.push(`<div class="ve-sel" style="${css(r)}">${single ? RESIZE.map((h) => `<span class="ve-h ve-h-${h}" data-h="${h}"></span>`).join('') + '<span class="ve-rot" data-rot="1" title="Rotate"></span>' : ''}${single ? `<span class="ve-sel-label">${esc(ed.block(info.id)?.id ?? '')}</span>` : ''}</div>`);
    }
    for (const info of ed.orderedInfos()) {
      for (const h of info.handles || []) {
        const [x, y] = this.toScreen(h.world);
        parts.push(`<span class="ve-knob" data-knob="${esc(info.id)}|${esc(h.id)}" style="left:${x}px;top:${y}px" title="${esc(h.label || 'Drag')}"></span>`);
      }
    }
    for (const g of this.guides) {
      if (g.axis === 'x') {
        const [x, ya] = this.toScreen([g.at, g.to]);
        const [, yb] = this.toScreen([g.at, g.from]);
        parts.push(`<div class="ve-guide ve-guide-v" style="left:${x}px;top:${ya}px;height:${yb - ya}px"></div>`);
      } else {
        const [xa, y] = this.toScreen([g.from, g.at]);
        const [xb] = this.toScreen([g.to, g.at]);
        parts.push(`<div class="ve-guide ve-guide-h" style="left:${xa}px;top:${y}px;width:${xb - xa}px"></div>`);
      }
    }
    if (this.drag && this.drag.kind === 'marquee') {
      const d = this.drag;
      const b = { x: Math.min(d.p0[0], d.p1[0]), y: Math.min(d.p0[1], d.p1[1]), w: Math.abs(d.p1[0] - d.p0[0]), h: Math.abs(d.p1[1] - d.p0[1]) };
      parts.push(`<div class="ve-marquee" style="${css(this.rectOf(b))}"></div>`);
    }
    this.overlay.innerHTML = parts.join('');
    this.frame.classList.toggle('is-wiring', ed.showWires);
    this.renderWires();
  }

  portPos(el) {
    return [Number(el.getAttribute('cx')), Number(el.getAttribute('cy'))];
  }

  /** Node cards, ports, and wires. */
  renderWires() {
    const ed = this.ed;
    if (!ed.showWires) {
      this.wires.innerHTML = '';
      return;
    }
    const cards = [];
    const pos = new Map();
    for (const block of ed.doc.blocks) {
      const info = ed.info(block.id);
      const { inputs, outputs } = ed.portsOf(block);
      const n = Math.max(inputs.length, outputs.length, 1);
      const r = this.rectOf(info && info.bounds ? info.bounds : this.cardBox(block));
      const top = r.top;
      const h = Math.max(r.height, n * PORT_GAP + 8);
      const slot = (i, count) => top + (h * (i + 1)) / (count + 1);
      const ins = inputs.map((p, i) => ({ ...p, x: r.left, y: slot(i, inputs.length) }));
      const outs = outputs.map((p, i) => ({ ...p, x: r.left + r.width, y: slot(i, outputs.length) }));
      for (const p of ins) pos.set(`${block.id}.${p.name}`, p);
      for (const p of outs) pos.set(`${block.id}.${p.name}`, p);
      cards.push({ block, r: { ...r, height: h }, ins, outs, data: !(info && info.bounds) });
    }
    const wires = ed.doc.wires.map((w) => {
      const a = pos.get(w.from);
      const b = pos.get(w.to);
      if (!a || !b) return '';
      const key = `${w.from}>${w.to}`;
      return `<path class="ve-wire${ed.selectedWire === key ? ' is-selected' : ''}" d="${curve(a.x, a.y, b.x, b.y)}"/><path class="ve-wire-hit" data-wire="${esc(key)}" d="${curve(a.x, a.y, b.x, b.y)}"/>`;
    }).join('');
    const d = this.drag && this.drag.kind === 'wire' && this.drag.end ? this.drag : null;
    const temp = d ? `<path class="ve-wire is-temp" d="${curve(d.start[0], d.start[1], d.end[0], d.end[1])}"/>` : '';
    const svgCards = cards.map((c) => {
      const title = `${blockDefinition(c.block.type).label}`;
      return `<g class="ve-card${c.data ? ' is-data' : ''}${c.data && ed.selection.has(c.block.id) ? ' is-selected' : ''}">
        <rect class="ve-card-box" x="${c.r.left}" y="${c.r.top}" width="${c.r.width}" height="${c.r.height}" rx="6"/>
        <text class="ve-card-title" x="${c.r.left + 8}" y="${c.r.top - 7}">${esc(title)}  ${esc(c.block.id)}</text>
        ${c.ins.map((p) => `<circle class="ve-port in" cx="${p.x}" cy="${p.y}" r="5" data-port="${esc(c.block.id)}.${esc(p.name)}" data-dir="in" data-kind="${esc(p.kind)}"/><text class="ve-port-label in" x="${p.x + 9}" y="${p.y + 3.5}">${esc(p.name)}</text>`).join('')}
        ${c.outs.map((p) => `<circle class="ve-port out" cx="${p.x}" cy="${p.y}" r="5" data-port="${esc(c.block.id)}.${esc(p.name)}" data-dir="out" data-kind="${esc(p.kind)}"/><text class="ve-port-label out" x="${p.x - 9}" y="${p.y + 3.5}" text-anchor="end">${esc(p.name)}</text>`).join('')}
      </g>`;
    }).join('');
    this.wires.setAttribute('viewBox', `0 0 ${this.size.w} ${this.size.h}`);
    this.wires.innerHTML = `${svgCards}${wires}${temp}`;
  }

  /** @param {string[]} captions */
  setCaptions(captions) {
    this.caption.textContent = captions && captions.length ? captions.join(' ') : '';
  }
}

function css(r) {
  return `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
}

function curve(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
  return `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}
