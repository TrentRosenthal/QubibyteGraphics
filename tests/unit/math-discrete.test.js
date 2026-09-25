import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGraph, bfs, dfs, dijkstra, bellmanFord, aStar, prim, kruskal, topologicalSort, stronglyConnectedComponents,
  maxFlow, circularLayout, gridLayout, forceLayout, treeFromGraph, treeLayout, treeTraversals, factorial, binomial,
  permutationsCount, permutations, combinations, catalan, stirlingFirst, stirlingSecond, partitionCount, partitions,
  sieve, gcd, lcm, extendedGcd, modPow, modInverse, crt, isPrime, factorize, totient, continuedFraction, runDFA, runNFA,
  epsilonClosure, subsetConstruction, union, intersection, difference, symmetricDifference, complement, powerSet,
  cartesianProduct, vennRegions, SeededRandom,
} from '../../src/math/index.js';

const G = () => createGraph({ edges: [['A', 'B', 4], ['A', 'C', 2], ['B', 'C', 5], ['B', 'D', 10], ['C', 'E', 3], ['E', 'D', 4], ['D', 'F', 11]] });

test('BFS and DFS record frontiers and visit order', () => {
  const g = G();
  const b = bfs(g, 'A');
  assert.deepEqual(b.order, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(b.steps[0].frontier, ['B', 'C']);
  assert.equal(b.dist.F, 3);
  const d = dfs(g, 'A');
  assert.deepEqual(d.order, ['A', 'B', 'C', 'E', 'D', 'F']);
  assert.equal(d.steps.filter((s) => s.type === 'finish').length, 6);
  assert.deepEqual(d.steps[3].stack, ['A', 'B', 'C', 'E']);
  assert.equal(d.finishOrder[d.finishOrder.length - 1], 'A');
});

test('shortest paths: Dijkstra, Bellman-Ford and A*', () => {
  const g = G();
  const dj = dijkstra(g, 'A');
  assert.deepEqual(dj.dist, { A: 0, B: 4, C: 2, D: 9, E: 5, F: 20 });
  assert.deepEqual(dj.path('F'), ['A', 'C', 'E', 'D', 'F']);
  assert.equal(dj.steps[0].settled, 'A');
  assert.deepEqual(dj.steps[0].relaxed.map((r) => r.to), ['B', 'C']);
  assert.deepEqual(bellmanFord(g, 'A').dist, dj.dist);
  const neg = createGraph({ directed: true, edges: [['a', 'b', 1], ['b', 'c', -3], ['c', 'a', 1]] });
  assert.equal(bellmanFord(neg, 'a').negativeCycle, true);
  assert.throws(() => dijkstra(neg, 'a'), /non-negative/);
  // A* on a grid with the Manhattan heuristic finds an optimal path.
  const edges = [];
  const id = (x, y) => x + ',' + y;
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
    if (x < 4 && !(x === 2 && y < 4)) edges.push([id(x, y), id(x + 1, y), 1]);
    if (y < 4) edges.push([id(x, y), id(x, y + 1), 1]);
  }
  const grid = createGraph({ edges });
  const h = (v) => {
    const [x, y] = v.split(',').map(Number);
    return Math.abs(4 - x) + Math.abs(0 - y);
  };
  const a = aStar(grid, '0,0', '4,0', h);
  assert.equal(a.cost, dijkstra(grid, '0,0').dist['4,0']);
  assert.equal(a.path[0], '0,0');
  assert.equal(a.path[a.path.length - 1], '4,0');
});

test('minimum spanning trees agree and Kruskal shows union-find state', () => {
  const g = G();
  const k = kruskal(g);
  const p = prim(g);
  assert.equal(k.weight, 24);
  assert.equal(p.weight, 24);
  assert.equal(k.edges.length, 5);
  const rejected = k.steps.filter((s) => !s.accepted);
  assert.ok(rejected.every((s) => s.reason === 'Would form a cycle'));
  assert.ok(k.steps.every((s) => Object.keys(s.parent).length === 6));
  // Random graphs: both algorithms give the same total weight.
  const rng = new SeededRandom(8);
  for (let t = 0; t < 10; t++) {
    const n = rng.int(4, 9);
    const edges = [];
    for (let i = 1; i < n; i++) edges.push([i, rng.int(0, i - 1), rng.int(1, 20)]);
    for (let e = 0; e < n; e++) edges.push([rng.int(0, n - 1), rng.int(0, n - 1), rng.int(1, 20)]);
    const rg = createGraph({ edges: edges.filter(([u, v]) => u !== v) });
    assert.equal(kruskal(rg).weight, prim(rg, rg.nodes[0]).weight);
  }
});

test('topological sort, SCCs and max flow', () => {
  const dag = createGraph({ directed: true, edges: [['shirt', 'tie'], ['tie', 'jacket'], ['pants', 'shoes'], ['pants', 'belt'], ['belt', 'jacket']] });
  const t = topologicalSort(dag);
  assert.ok(t.ok);
  const pos = Object.fromEntries(t.order.map((v, i) => [v, i]));
  for (const e of dag.edges) assert.ok(pos[e.from] < pos[e.to]);
  assert.equal(topologicalSort(createGraph({ directed: true, edges: [[1, 2], [2, 1]] })).ok, false);
  const scc = stronglyConnectedComponents(createGraph({ directed: true, edges: [[1, 2], [2, 3], [3, 1], [3, 4], [4, 5], [5, 4]] }));
  assert.deepEqual(scc.map((c) => c.sort().join('')).sort(), ['123', '45']);
  const fg = createGraph({ directed: true, edges: [['s', 'a', 10], ['s', 'b', 5], ['a', 'b', 15], ['a', 't', 10], ['b', 't', 10]] });
  const f = maxFlow(fg, 's', 't');
  assert.equal(f.value, 15);
  assert.ok(f.steps.length >= 2);
  // Flow conservation at inner nodes and capacity limits.
  for (const v of ['a', 'b']) {
    const inflow = fg.edges.filter((e) => e.to === v).reduce((s, e) => s + f.flow[e.id], 0);
    const outflow = fg.edges.filter((e) => e.from === v).reduce((s, e) => s + f.flow[e.id], 0);
    assert.equal(inflow, outflow);
  }
  for (const e of fg.edges) assert.ok(f.flow[e.id] <= e.weight);
  assert.deepEqual(f.minCut, ['s']);
});

test('layouts and trees', () => {
  const g = G();
  const c = circularLayout(g, { radius: 2 });
  for (const v of g.nodes) assert.ok(Math.abs(Math.hypot(c[v].x, c[v].y) - 2) < 1e-12);
  assert.deepEqual(gridLayout(g, { cols: 3 }).D, { x: 0, y: -1 });
  const f1 = forceLayout(g, { seed: 5, iterations: 100 });
  const f2 = forceLayout(g, { seed: 5, iterations: 100 });
  assert.deepEqual(f1.positions, f2.positions);
  assert.equal(f1.frames.length, 11);
  // Connected nodes end up closer than the average pair.
  const dist = (a, b) => Math.hypot(f1.positions[a].x - f1.positions[b].x, f1.positions[a].y - f1.positions[b].y);
  const edgeMean = g.edges.reduce((s, e) => s + dist(e.from, e.to), 0) / g.edges.length;
  let all = 0;
  let pairs = 0;
  for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) {
    all += dist(g.nodes[i], g.nodes[j]);
    pairs++;
  }
  assert.ok(edgeMean < all / pairs);
  const tree = treeFromGraph(createGraph({ edges: [[1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [5, 7], [5, 8]] }), 1);
  const lay = treeLayout(tree);
  assert.deepEqual(lay['1'], { x: 0, y: 0 });
  for (const [p, kids] of Object.entries(tree.children)) {
    if (!kids.length) continue;
    const xs = kids.map((k) => lay[k].x);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - lay[p].x) < 1e-12, 'parent centered');
    for (const k of kids) assert.equal(lay[k].y, lay[p].y - 1);
  }
  const byDepth = {};
  for (const pt of Object.values(lay)) (byDepth[pt.y] ||= []).push(pt.x);
  for (const xs of Object.values(byDepth)) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 1 - 1e-12, 'nodes on a level keep the gap');
  }
  const tr = treeTraversals(tree);
  assert.deepEqual(tr.preorder, ['1', '2', '4', '5', '7', '8', '3', '6']);
  assert.deepEqual(tr.postorder, ['4', '7', '8', '5', '2', '6', '3', '1']);
  assert.deepEqual(tr.levelorder, ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(tr.inorder, ['4', '2', '7', '5', '8', '1', '6', '3']);
});

test('combinatorics with exact BigInt counts', () => {
  assert.equal(factorial(25), 15511210043330985984000000n);
  assert.equal(binomial(52, 5), 2598960n);
  assert.equal(binomial(100, 50), 100891344545564193334812497256n);
  assert.equal(binomial(5, 7), 0n);
  assert.equal(permutationsCount(10, 3), 720n);
  const perms = [...permutations([1, 2, 3])];
  assert.deepEqual(perms, [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]);
  assert.equal([...permutations(['a', 'b', 'c', 'd'])].length, 24);
  const combos = [...combinations(['a', 'b', 'c', 'd'], 2)];
  assert.equal(combos.length, 6);
  assert.deepEqual(combos[0], ['a', 'b']);
  assert.equal([...combinations([1, 2, 3, 4, 5, 6, 7], 3)].length, Number(binomial(7, 3)));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map(catalan), [1n, 1n, 2n, 5n, 14n, 42n, 16796n]);
  assert.equal(stirlingFirst(5, 2), 50n);
  assert.equal(stirlingSecond(5, 2), 15n);
  assert.equal(stirlingSecond(10, 4), 34105n);
  let bell = 0n;
  for (let k = 0; k <= 6; k++) bell += stirlingSecond(6, k);
  assert.equal(bell, 203n);
  assert.equal(partitionCount(100), 190569292n);
  const parts = [...partitions(5)];
  assert.equal(parts.length, 7);
  assert.deepEqual(parts[0], [5]);
  assert.ok(parts.every((p) => p.reduce((a, b) => a + b, 0) === 5));
});

test('number theory', () => {
  assert.deepEqual(sieve(30), [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  assert.equal(gcd(462, 1071), 21n);
  assert.equal(lcm(4, 6), 12n);
  const e = extendedGcd(240, 46);
  assert.equal(e.g, 2n);
  assert.equal(240n * e.x + 46n * e.y, 2n);
  assert.deepEqual(e.steps[0], { a: 240n, b: 46n, q: 5n, r: 10n, s: 1n, t: -5n });
  assert.equal(modPow(4, 13, 497), 445n);
  assert.equal(modPow(2n, 10n ** 18n, 1000000007n), 719476260n);
  assert.equal(modInverse(3, 11), 4n);
  assert.throws(() => modInverse(6, 9), /no inverse/);
  const c = crt([2, 3, 2], [3, 5, 7]);
  assert.equal(c.x, 23n);
  assert.equal(c.modulus, 105n);
  assert.throws(() => crt([1, 2], [4, 6]), /inconsistent/);
  assert.ok(isPrime(1000000007n) && !isPrime(561) && isPrime(2n ** 61n - 1n));
  const f = factorize(2n ** 62n - 1n);
  assert.equal(f.reduce((p, q) => p * q.prime ** BigInt(q.exponent), 1n), 2n ** 62n - 1n);
  assert.ok(f.every((q) => isPrime(q.prime)));
  assert.deepEqual(factorize(360).map((q) => [Number(q.prime), q.exponent]), [[2, 3], [3, 2], [5, 1]]);
  assert.equal(totient(36), 12n);
  const cf = continuedFraction('415/93');
  assert.deepEqual(cf.quotients, [4n, 2n, 6n, 7n]);
  assert.equal(cf.convergents[cf.convergents.length - 1].toString(), '415/93');
  const pi = continuedFraction(Math.PI, 4);
  assert.deepEqual(pi.quotients, [3n, 7n, 15n, 1n]);
  assert.equal(pi.convergents[3].toString(), '355/113');
});

test('finite automata and the subset construction', () => {
  const even0 = {
    states: ['E', 'O'], alphabet: ['0', '1'], start: 'E', accept: ['E'],
    transitions: { E: { 0: 'O', 1: 'E' }, O: { 0: 'E', 1: 'O' } },
  };
  const r = runDFA(even0, '10010');
  assert.equal(r.accepted, false);
  assert.deepEqual(r.trace.map((t) => t.state), ['E', 'E', 'O', 'E', 'E', 'O']);
  assert.equal(runDFA(even0, '1001').accepted, true);
  assert.equal(runDFA(even0, '12').accepted, false);
  // NFA for strings ending in "ab", with an epsilon move.
  const nfa = {
    states: ['s', 'q0', 'q1', 'q2'], alphabet: ['a', 'b'], start: 's', accept: ['q2'],
    transitions: { s: { '': ['q0'] }, q0: { a: ['q0', 'q1'], b: ['q0'] }, q1: { b: ['q2'] } },
  };
  assert.deepEqual(epsilonClosure(nfa, ['s']), ['q0', 's']);
  assert.equal(runNFA(nfa, 'aab').accepted, true);
  assert.equal(runNFA(nfa, 'aba').accepted, false);
  const { dfa, steps } = subsetConstruction(nfa);
  assert.ok(steps.some((s) => s.isNew));
  for (const w of ['', 'a', 'b', 'ab', 'ba', 'aab', 'abab', 'abba', 'bbab']) {
    assert.equal(runDFA(dfa, w).accepted, runNFA(nfa, w).accepted, w);
  }
});

test('set operations and Venn regions', () => {
  const A = [1, 2, 3, 4];
  const B = [3, 4, 5];
  assert.deepEqual(union(A, B), [1, 2, 3, 4, 5]);
  assert.deepEqual(intersection(A, B), [3, 4]);
  assert.deepEqual(difference(A, B), [1, 2]);
  assert.deepEqual(symmetricDifference(A, B), [1, 2, 5]);
  assert.deepEqual(complement(A, [1, 2, 3, 4, 5, 6]), [5, 6]);
  assert.equal(powerSet([1, 2, 3]).length, 8);
  assert.deepEqual(powerSet([1, 2])[3], [1, 2]);
  assert.equal(cartesianProduct([1, 2], ['a', 'b', 'c']).length, 6);
  const v2 = vennRegions({ A, B });
  assert.deepEqual(v2.regions.map((r) => [r.key, r.elements]), [['A&!B', [1, 2]], ['!A&B', [5]], ['A&B', [3, 4]]]);
  const v3 = vennRegions({ A: [1, 2, 7], B: [2, 3, 7], C: [7, 4] }, [1, 2, 3, 4, 7, 9]);
  assert.equal(v3.regions.length, 8);
  assert.deepEqual(v3.regions.find((r) => r.key === 'A&B&C').elements, [7]);
  assert.deepEqual(v3.regions.find((r) => r.key === '!A&!B&!C').elements, [9]);
  assert.throws(() => vennRegions({ A }), /2 or 3/);
});
