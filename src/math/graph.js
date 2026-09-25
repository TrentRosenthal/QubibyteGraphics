/**
 * Graph algorithms with per-step state for animation (BFS and DFS frontiers,
 * Dijkstra, Bellman-Ford, A*, Prim, Kruskal with union-find snapshots,
 * topological sort, strongly connected components, Edmonds-Karp max flow),
 * layouts (force-directed with a seeded start, circular, grid, and the
 * Reingold-Tilford tidy tree), and tree traversals.
 * @module math/graph
 */
import { SeededRandom } from './random.js';

/**
 * @typedef {object} Edge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {number} weight
 */

/**
 * @typedef {object} Graph
 * @property {string[]} nodes
 * @property {Edge[]} edges
 * @property {boolean} directed
 * @property {Map<string, {to: string, weight: number, edge: Edge}[]>} adj outgoing neighbours (both directions when undirected)
 */

/**
 * Build a graph. Edges are [from, to, weight?] arrays or {from, to, weight} objects.
 * @param {{nodes?: Array<string|number>, edges?: Array<Array<string|number>|{from: string|number, to: string|number, weight?: number}>, directed?: boolean}} spec
 * @returns {Graph}
 */
export function createGraph(spec) {
  const directed = !!spec.directed;
  const nodes = [];
  const seen = new Set();
  const addNode = (v) => {
    const k = String(v);
    if (!seen.has(k)) {
      seen.add(k);
      nodes.push(k);
    }
    return k;
  };
  (spec.nodes || []).forEach(addNode);
  const edges = (spec.edges || []).map((e, i) => {
    const [from, to, weight] = Array.isArray(e) ? e : [e.from, e.to, e.weight];
    return { id: 'e' + i, from: addNode(from), to: addNode(to), weight: weight ?? 1 };
  });
  const adj = new Map(nodes.map((v) => [v, []]));
  for (const e of edges) {
    adj.get(e.from).push({ to: e.to, weight: e.weight, edge: e });
    if (!directed) adj.get(e.to).push({ to: e.from, weight: e.weight, edge: e });
  }
  return { nodes, edges, directed, adj };
}

function neighbours(g, v) {
  return g.adj.get(String(v)) || [];
}

/**
 * Breadth-first search, recording the queue (frontier) and visited set at
 * every step.
 * @param {Graph} g
 * @param {string|number} start
 * @returns {{order: string[], parent: Record<string, string|null>, dist: Record<string, number>, steps: {node: string, via: string|null, frontier: string[], visited: string[]}[]}}
 */
export function bfs(g, start) {
  const s = String(start);
  const parent = { [s]: null };
  const dist = { [s]: 0 };
  const queue = [s];
  const visited = new Set([s]);
  const order = [];
  const steps = [];
  while (queue.length) {
    const v = queue.shift();
    order.push(v);
    for (const { to } of neighbours(g, v)) {
      if (visited.has(to)) continue;
      visited.add(to);
      parent[to] = v;
      dist[to] = dist[v] + 1;
      queue.push(to);
    }
    steps.push({ node: v, via: parent[v], frontier: queue.slice(), visited: [...visited] });
  }
  return { order, parent, dist, steps };
}

/**
 * Depth-first search (neighbours taken in insertion order), recording the
 * stack and the visit and finish events.
 * @param {Graph} g
 * @param {string|number} start
 * @returns {{order: string[], finishOrder: string[], parent: Record<string, string|null>, steps: {type: 'visit'|'finish', node: string, stack: string[], visited: string[]}[]}}
 */
export function dfs(g, start) {
  const s = String(start);
  const parent = { [s]: null };
  const visited = new Set();
  const order = [];
  const finishOrder = [];
  const steps = [];
  const stack = [{ v: s, i: 0 }];
  visited.add(s);
  order.push(s);
  steps.push({ type: 'visit', node: s, stack: [s], visited: [...visited] });
  while (stack.length) {
    const top = stack[stack.length - 1];
    const nb = neighbours(g, top.v);
    if (top.i < nb.length) {
      const { to } = nb[top.i++];
      if (visited.has(to)) continue;
      visited.add(to);
      parent[to] = top.v;
      order.push(to);
      stack.push({ v: to, i: 0 });
      steps.push({ type: 'visit', node: to, stack: stack.map((f) => f.v), visited: [...visited] });
    } else {
      stack.pop();
      finishOrder.push(top.v);
      steps.push({ type: 'finish', node: top.v, stack: stack.map((f) => f.v), visited: [...visited] });
    }
  }
  return { order, finishOrder, parent, steps };
}

function pathTo(prev, target) {
  const path = [];
  for (let v = target; v != null; v = prev[v]) path.unshift(v);
  return path;
}

/**
 * Dijkstra's shortest paths (non-negative weights), with each settled node
 * and the edges it relaxed.
 * @param {Graph} g
 * @param {string|number} source
 * @returns {{dist: Record<string, number>, prev: Record<string, string|null>, path: (to: string|number) => string[], steps: {settled: string, dist: Record<string, number>, relaxed: {from: string, to: string, dist: number}[]}[]}}
 */
export function dijkstra(g, source) {
  const s = String(source);
  const dist = Object.fromEntries(g.nodes.map((v) => [v, Infinity]));
  const prev = Object.fromEntries(g.nodes.map((v) => [v, null]));
  dist[s] = 0;
  const done = new Set();
  const steps = [];
  for (;;) {
    let u = null;
    for (const v of g.nodes) if (!done.has(v) && dist[v] < Infinity && (u === null || dist[v] < dist[u])) u = v;
    if (u === null) break;
    done.add(u);
    const relaxed = [];
    for (const { to, weight } of neighbours(g, u)) {
      if (weight < 0) throw new RangeError('Dijkstra needs non-negative weights; use bellmanFord');
      if (dist[u] + weight < dist[to]) {
        dist[to] = dist[u] + weight;
        prev[to] = u;
        relaxed.push({ from: u, to, dist: dist[to] });
      }
    }
    steps.push({ settled: u, dist: { ...dist }, relaxed });
  }
  return { dist, prev, path: (to) => (dist[String(to)] === Infinity ? [] : pathTo(prev, String(to))), steps };
}

/**
 * Bellman-Ford shortest paths; reports a reachable negative cycle.
 * @param {Graph} g
 * @param {string|number} source
 * @returns {{dist: Record<string, number>, prev: Record<string, string|null>, negativeCycle: boolean, path: (to: string|number) => string[], steps: {round: number, dist: Record<string, number>, updates: number}[]}}
 */
export function bellmanFord(g, source) {
  const s = String(source);
  const dist = Object.fromEntries(g.nodes.map((v) => [v, Infinity]));
  const prev = Object.fromEntries(g.nodes.map((v) => [v, null]));
  dist[s] = 0;
  const arcs = [];
  for (const e of g.edges) {
    arcs.push([e.from, e.to, e.weight]);
    if (!g.directed) arcs.push([e.to, e.from, e.weight]);
  }
  const steps = [];
  for (let round = 1; round < g.nodes.length; round++) {
    let updates = 0;
    for (const [u, v, w] of arcs) {
      if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        prev[v] = u;
        updates++;
      }
    }
    steps.push({ round, dist: { ...dist }, updates });
    if (!updates) break;
  }
  const negativeCycle = arcs.some(([u, v, w]) => dist[u] + w < dist[v]);
  return { dist, prev, negativeCycle, path: (to) => (negativeCycle || dist[String(to)] === Infinity ? [] : pathTo(prev, String(to))), steps };
}

/**
 * A* search with a heuristic (admissible for optimal paths).
 * @param {Graph} g
 * @param {string|number} source
 * @param {string|number} target
 * @param {(node: string) => number} heuristic
 * @returns {{path: string[], cost: number, steps: {current: string, open: string[], closed: string[]}[]}}
 */
export function aStar(g, source, target, heuristic) {
  const s = String(source);
  const t = String(target);
  const gScore = { [s]: 0 };
  const prev = { [s]: null };
  const open = new Set([s]);
  const closed = new Set();
  const steps = [];
  while (open.size) {
    let cur = null;
    for (const v of open) if (cur === null || gScore[v] + heuristic(v) < gScore[cur] + heuristic(cur)) cur = v;
    steps.push({ current: cur, open: [...open], closed: [...closed] });
    if (cur === t) return { path: pathTo(prev, t), cost: gScore[t], steps };
    open.delete(cur);
    closed.add(cur);
    for (const { to, weight } of neighbours(g, cur)) {
      if (closed.has(to)) continue;
      const tentative = gScore[cur] + weight;
      if (!(to in gScore) || tentative < gScore[to]) {
        gScore[to] = tentative;
        prev[to] = cur;
        open.add(to);
      }
    }
  }
  return { path: [], cost: Infinity, steps };
}

/**
 * Prim's minimum spanning tree (undirected, connected component of `start`).
 * @param {Graph} g
 * @param {string|number} [start]
 * @returns {{edges: Edge[], weight: number, steps: {edge: Edge, inTree: string[]}[]}}
 */
export function prim(g, start = g.nodes[0]) {
  const inTree = new Set([String(start)]);
  const edges = [];
  const steps = [];
  let weight = 0;
  for (;;) {
    let best = null;
    for (const v of inTree) {
      for (const n of neighbours(g, v)) {
        if (!inTree.has(n.to) && (!best || n.weight < best.weight)) best = { ...n, from: v };
      }
    }
    if (!best) break;
    inTree.add(best.to);
    edges.push(best.edge);
    weight += best.weight;
    steps.push({ edge: best.edge, inTree: [...inTree] });
  }
  return { edges, weight, steps };
}

/**
 * Kruskal's minimum spanning forest with the union-find parent array at
 * every step.
 * @param {Graph} g
 * @returns {{edges: Edge[], weight: number, steps: {edge: Edge, accepted: boolean, reason: string, parent: Record<string, string>}[]}}
 */
export function kruskal(g) {
  const parent = Object.fromEntries(g.nodes.map((v) => [v, v]));
  const rank = Object.fromEntries(g.nodes.map((v) => [v, 0]));
  const find = (v) => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  const sorted = g.edges.slice().sort((a, b) => a.weight - b.weight);
  const edges = [];
  const steps = [];
  let weight = 0;
  for (const e of sorted) {
    const a = find(e.from);
    const b = find(e.to);
    if (a === b) {
      steps.push({ edge: e, accepted: false, reason: 'Would form a cycle', parent: { ...parent } });
      continue;
    }
    if (rank[a] < rank[b]) parent[a] = b;
    else if (rank[a] > rank[b]) parent[b] = a;
    else {
      parent[b] = a;
      rank[a]++;
    }
    edges.push(e);
    weight += e.weight;
    steps.push({ edge: e, accepted: true, reason: 'Joins two components', parent: { ...parent } });
  }
  return { edges, weight, steps };
}

/**
 * Topological sort by Kahn's algorithm (directed graphs).
 * @param {Graph} g
 * @returns {{ok: boolean, order: string[], steps: {node: string, ready: string[]}[], reason?: string}}
 */
export function topologicalSort(g) {
  const indeg = Object.fromEntries(g.nodes.map((v) => [v, 0]));
  for (const e of g.edges) indeg[e.to]++;
  const ready = g.nodes.filter((v) => indeg[v] === 0);
  const order = [];
  const steps = [];
  while (ready.length) {
    const v = ready.shift();
    order.push(v);
    for (const { to } of neighbours(g, v)) {
      indeg[to]--;
      if (indeg[to] === 0) ready.push(to);
    }
    steps.push({ node: v, ready: ready.slice() });
  }
  if (order.length < g.nodes.length) return { ok: false, order, steps, reason: 'The graph has a cycle' };
  return { ok: true, order, steps };
}

/**
 * Strongly connected components (Tarjan).
 * @param {Graph} g
 * @returns {string[][]}
 */
export function stronglyConnectedComponents(g) {
  let index = 0;
  const idx = {};
  const low = {};
  const onStack = new Set();
  const stack = [];
  const out = [];
  const visit = (v) => {
    idx[v] = low[v] = index++;
    stack.push(v);
    onStack.add(v);
    for (const { to } of neighbours(g, v)) {
      if (!(to in idx)) {
        visit(to);
        low[v] = Math.min(low[v], low[to]);
      } else if (onStack.has(to)) low[v] = Math.min(low[v], idx[to]);
    }
    if (low[v] === idx[v]) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const v of g.nodes) if (!(v in idx)) visit(v);
  return out;
}

/**
 * Maximum flow by Edmonds-Karp (BFS augmenting paths). Edge weights are
 * capacities; undirected edges carry flow either way.
 * @param {Graph} g
 * @param {string|number} source
 * @param {string|number} sink
 * @returns {{value: number, flow: Record<string, number>, minCut: string[], steps: {path: string[], bottleneck: number, total: number}[]}}
 */
export function maxFlow(g, source, sink) {
  const s = String(source);
  const t = String(sink);
  const cap = new Map();
  const key = (u, v) => u + '\u0000' + v;
  const addCap = (u, v, c) => cap.set(key(u, v), (cap.get(key(u, v)) || 0) + c);
  const nbrs = new Map(g.nodes.map((v) => [v, new Set()]));
  for (const e of g.edges) {
    addCap(e.from, e.to, e.weight);
    if (!g.directed) addCap(e.to, e.from, e.weight);
    nbrs.get(e.from).add(e.to);
    nbrs.get(e.to).add(e.from);
  }
  const res = (u, v) => cap.get(key(u, v)) || 0;
  const steps = [];
  let total = 0;
  for (;;) {
    const prev = { [s]: null };
    const q = [s];
    while (q.length && !(t in prev)) {
      const u = q.shift();
      for (const v of nbrs.get(u)) if (!(v in prev) && res(u, v) > 1e-12) {
        prev[v] = u;
        q.push(v);
      }
    }
    if (!(t in prev)) break;
    const path = pathTo(prev, t);
    let b = Infinity;
    for (let i = 0; i + 1 < path.length; i++) b = Math.min(b, res(path[i], path[i + 1]));
    for (let i = 0; i + 1 < path.length; i++) {
      cap.set(key(path[i], path[i + 1]), res(path[i], path[i + 1]) - b);
      cap.set(key(path[i + 1], path[i]), res(path[i + 1], path[i]) + b);
    }
    total += b;
    steps.push({ path, bottleneck: b, total });
  }
  const flow = {};
  for (const e of g.edges) {
    const used = e.weight - res(e.from, e.to);
    flow[e.id] = g.directed ? used : Math.max(0, used);
  }
  const reach = new Set([s]);
  const q = [s];
  while (q.length) {
    const u = q.shift();
    for (const v of nbrs.get(u)) if (!reach.has(v) && res(u, v) > 1e-12) {
      reach.add(v);
      q.push(v);
    }
  }
  return { value: total, flow, minCut: [...reach], steps };
}

/**
 * Nodes evenly spaced on a circle.
 * @param {Graph} g
 * @param {{radius?: number, cx?: number, cy?: number, startAngle?: number}} [opts]
 * @returns {Record<string, {x: number, y: number}>}
 */
export function circularLayout(g, opts = {}) {
  const { radius = 1, cx = 0, cy = 0, startAngle = Math.PI / 2 } = opts;
  const n = g.nodes.length;
  return Object.fromEntries(g.nodes.map((v, i) => {
    const a = startAngle - (2 * Math.PI * i) / n;
    return [v, { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }];
  }));
}

/**
 * Nodes on a grid, row by row.
 * @param {Graph} g
 * @param {{cols?: number, spacing?: number}} [opts]
 * @returns {Record<string, {x: number, y: number}>}
 */
export function gridLayout(g, opts = {}) {
  const cols = opts.cols ?? Math.ceil(Math.sqrt(g.nodes.length));
  const sp = opts.spacing ?? 1;
  return Object.fromEntries(g.nodes.map((v, i) => [v, { x: (i % cols) * sp, y: -Math.floor(i / cols) * sp }]));
}

/**
 * Fruchterman-Reingold force-directed layout from a seeded random start,
 * with intermediate frames for animation.
 * @param {Graph} g
 * @param {{seed?: number|string, iterations?: number, width?: number, height?: number, frameEvery?: number}} [opts]
 * @returns {{positions: Record<string, {x: number, y: number}>, frames: Record<string, {x: number, y: number}>[]}}
 */
export function forceLayout(g, opts = {}) {
  const rng = new SeededRandom(opts.seed ?? 1);
  const W = opts.width ?? 2;
  const H = opts.height ?? 2;
  const iterations = opts.iterations ?? 300;
  const every = opts.frameEvery ?? 10;
  const n = g.nodes.length;
  const k = Math.sqrt((W * H) / Math.max(1, n));
  const pos = Object.fromEntries(g.nodes.map((v) => [v, { x: rng.uniform(-W / 2, W / 2), y: rng.uniform(-H / 2, H / 2) }]));
  const frames = [JSON.parse(JSON.stringify(pos))];
  let temp = W / 10;
  for (let it = 0; it < iterations; it++) {
    const disp = Object.fromEntries(g.nodes.map((v) => [v, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = g.nodes[i];
        const b = g.nodes[j];
        let dx = pos[a].x - pos[b].x;
        let dy = pos[a].y - pos[b].y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-9) {
          dx = rng.uniform(-1e-3, 1e-3);
          dy = rng.uniform(-1e-3, 1e-3);
          d = Math.hypot(dx, dy);
        }
        const f = (k * k) / d;
        disp[a].x += (dx / d) * f;
        disp[a].y += (dy / d) * f;
        disp[b].x -= (dx / d) * f;
        disp[b].y -= (dy / d) * f;
      }
    }
    for (const e of g.edges) {
      const dx = pos[e.from].x - pos[e.to].x;
      const dy = pos[e.from].y - pos[e.to].y;
      const d = Math.max(1e-9, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp[e.from].x -= (dx / d) * f;
      disp[e.from].y -= (dy / d) * f;
      disp[e.to].x += (dx / d) * f;
      disp[e.to].y += (dy / d) * f;
    }
    for (const v of g.nodes) {
      const d = Math.max(1e-9, Math.hypot(disp[v].x, disp[v].y));
      pos[v].x = Math.min(W / 2, Math.max(-W / 2, pos[v].x + (disp[v].x / d) * Math.min(d, temp)));
      pos[v].y = Math.min(H / 2, Math.max(-H / 2, pos[v].y + (disp[v].y / d) * Math.min(d, temp)));
    }
    temp *= 0.98;
    if ((it + 1) % every === 0) frames.push(JSON.parse(JSON.stringify(pos)));
  }
  return { positions: pos, frames };
}

/**
 * Rooted tree from a graph by BFS from the root: children lists.
 * @param {Graph} g
 * @param {string|number} root
 * @returns {{root: string, children: Record<string, string[]>, parent: Record<string, string|null>}}
 */
export function treeFromGraph(g, root) {
  const r = bfs(g, root);
  const children = Object.fromEntries(r.order.map((v) => [v, []]));
  for (const v of r.order) if (r.parent[v] != null) children[r.parent[v]].push(v);
  return { root: String(root), children, parent: r.parent };
}

/**
 * Tidy tree layout (Reingold-Tilford): children centered under parents,
 * subtrees packed as close as their contours allow with a minimum gap,
 * depth mapped to y (root at y = 0, going down).
 * @param {{root: string, children: Record<string, string[]>}} tree
 * @param {{gap?: number, levelGap?: number}} [opts]
 * @returns {Record<string, {x: number, y: number}>}
 */
export function treeLayout(tree, opts = {}) {
  const gap = opts.gap ?? 1;
  const levelGap = opts.levelGap ?? 1;
  const rel = {};
  // Returns contours as arrays of [minX, maxX] per depth relative to the node.
  const layout = (v) => {
    const kids = tree.children[v] || [];
    if (!kids.length) {
      rel[v] = [];
      return [[0, 0]];
    }
    const contours = kids.map(layout);
    const offsets = [0];
    let merged = contours[0].map((c) => c.slice());
    for (let i = 1; i < kids.length; i++) {
      const c = contours[i];
      let shift = -Infinity;
      for (let d = 0; d < Math.min(merged.length, c.length); d++) shift = Math.max(shift, merged[d][1] - c[d][0] + gap);
      offsets.push(shift);
      for (let d = 0; d < c.length; d++) {
        if (d < merged.length) merged[d] = [Math.min(merged[d][0], c[d][0] + shift), Math.max(merged[d][1], c[d][1] + shift)];
        else merged.push([c[d][0] + shift, c[d][1] + shift]);
      }
    }
    const mid = (offsets[0] + offsets[offsets.length - 1]) / 2;
    rel[v] = kids.map((k, i) => ({ child: k, dx: offsets[i] - mid }));
    merged = merged.map(([a, b]) => [a - mid, b - mid]);
    return [[0, 0], ...merged];
  };
  layout(tree.root);
  const out = {};
  const place = (v, x, depth) => {
    out[v] = { x, y: depth ? -depth * levelGap : 0 };
    for (const { child, dx } of rel[v] || []) place(child, x + dx, depth + 1);
  };
  place(tree.root, 0, 0);
  return out;
}

/**
 * Tree traversal orders. `inorder` visits the first child, the node, then
 * the remaining children (the usual order for binary trees).
 * @param {{root: string, children: Record<string, string[]>}} tree
 * @returns {{preorder: string[], inorder: string[], postorder: string[], levelorder: string[]}}
 */
export function treeTraversals(tree) {
  const pre = [];
  const ino = [];
  const post = [];
  const walk = (v) => {
    const kids = tree.children[v] || [];
    pre.push(v);
    if (kids.length) walk(kids[0]);
    ino.push(v);
    kids.slice(1).forEach(walk);
    post.push(v);
  };
  walk(tree.root);
  const level = [];
  const q = [tree.root];
  while (q.length) {
    const v = q.shift();
    level.push(v);
    q.push(...(tree.children[v] || []));
  }
  return { preorder: pre, inorder: ino, postorder: post, levelorder: level };
}
