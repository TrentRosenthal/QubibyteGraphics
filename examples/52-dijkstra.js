import { Circle, Line, Tex, Text, Group, create, fadeIn, crossFade, indicate, lagStart } from '../src/index.js';
import { createGraph, dijkstra } from '../src/math/index.js';

export const config = { theme: 'clean-dark', posterTime: 14 };

const POS = { A: [-5.6, 0.2], B: [-3, 2], C: [-3, -1.8], D: [0, 0.6], E: [0.3, -2.2], F: [3, 1.8], G: [5.4, -0.6] };
// Where each node's running distance sits, clear of its edges.
const LABEL = { A: [0, 1], B: [0, 1], C: [0, -1], D: [0, 1], E: [0, -1], F: [0, 1], G: [0, 1] };
const R = 0.36;
const EDGES = [['A', 'B', 4], ['A', 'C', 2], ['B', 'C', 1], ['B', 'D', 5], ['C', 'D', 8], ['C', 'E', 10], ['D', 'E', 2], ['D', 'F', 6], ['E', 'G', 3], ['F', 'G', 1]];

// Dijkstra's algorithm settles the nearest unsettled node, then relaxes its
// edges. The math engine records every step; the scene replays them.
export default async function (scene) {
  const title = new Text('Shortest paths, one settled node at a time', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const g = createGraph({ nodes: Object.keys(POS), edges: EDGES.map(([from, to, weight]) => ({ from, to, weight })) });
  const run = dijkstra(g, 'A');
  const shift = ([x, y]) => [x, y - 0.2];
  const edges = new Map();
  const weights = [];
  for (const [a, b, w] of EDGES) {
    const [p, q] = [shift(POS[a]), shift(POS[b])];
    const [ux, uy] = [(q[0] - p[0]) / Math.hypot(q[0] - p[0], q[1] - p[1]), (q[1] - p[1]) / Math.hypot(q[0] - p[0], q[1] - p[1])];
    // Edges stop at the node rims so nothing crosses a node's face.
    const line = new Line([p[0] + ux * R, p[1] + uy * R], [q[0] - ux * R, q[1] - uy * R], { stroke: 'grid', strokeWidth: 3.5 });
    edges.set(`${a}${b}`, line);
    edges.set(`${b}${a}`, line);
    const t = new Tex(String(w), { size: 0.36, color: 'muted' });
    const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
    const L = Math.hypot(dx, dy);
    t.moveTo([(p[0] + q[0]) / 2 - (dy / L) * 0.28, (p[1] + q[1]) / 2 + (dx / L) * 0.28]);
    weights.push(t);
  }
  const nodes = {};
  const dists = {};
  const distTex = (id, v) => {
    const t = new Tex(Number.isFinite(v) ? String(v) : '\\infty', { size: 0.34, color: Number.isFinite(v) ? 'accent2' : 'muted' });
    const [x, y] = shift(POS[id]);
    const [lx, ly] = LABEL[id];
    t.moveTo([x + lx * 0.72, y + ly * 0.72]);
    return t;
  };
  for (const id of Object.keys(POS)) {
    const [x, y] = shift(POS[id]);
    const c = new Circle({ radius: R, x, y, stroke: 'ink', strokeWidth: 3, fill: 'background', fillOpacity: 1 });
    const l = new Tex(id, { size: 0.42 });
    l.moveTo([x, y]);
    nodes[id] = new Group([c, l]);
    dists[id] = distTex(id, id === 'A' ? 0 : Infinity);
  }
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(lagStart([...new Set(edges.values())].map((e) => create(e)), { lag: 0.06 }), lagStart(Object.values(nodes).map((n) => fadeIn(n, { scale: 0.8 })), { lag: 0.06 }), { duration: 1.8 });
  await scene.play(lagStart(weights.map((w) => fadeIn(w)), { lag: 0.03 }), lagStart(Object.values(dists).map((d) => fadeIn(d)), { lag: 0.03 }), { duration: 0.8 });
  for (const step of run.steps) {
    const circle = nodes[step.settled].children[0];
    await scene.play(circle.animate.set('fill', 'accent').set('fillOpacity', 0.35).set('stroke', 'accent'), { duration: 0.45 });
    const anims = [];
    for (const r of step.relaxed) {
      const e = edges.get(`${r.from}${r.to}`);
      anims.push(indicate(e, { color: 'accent', scale: 1 }));
      const next = distTex(r.to, r.dist);
      anims.push(crossFade(dists[r.to], next));
      dists[r.to] = next;
    }
    if (anims.length) await scene.play(...anims, { duration: 0.7 });
  }
  const path = run.path('G');
  const along = [];
  for (let i = 0; i + 1 < path.length; i++) along.push(edges.get(`${path[i]}${path[i + 1]}`).animate.set('stroke', 'accent2').set('strokeWidth', 7));
  const result = new Text(`Shortest A to G: ${path.join(' ')}, length ${run.dist.G}`, { size: 'label', color: 'muted' });
  result.moveTo([0, -3.95]);
  await scene.play(lagStart(along, { lag: 0.25 }), fadeIn(result, { shift: 'up' }), { duration: 1.4 });
  await scene.wait(1.5);
}
