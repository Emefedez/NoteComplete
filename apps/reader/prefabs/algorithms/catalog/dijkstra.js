// Dijkstra's shortest paths from one vertex (greedy, activity 8): a priority queue of
// (vertex, distance); the nearest vertex not yet done is fixed and its edges relaxed.
import { ACTIVITY_GRAPH } from './greedy-more.js';
import { lineFinder, normalizeGraph, placed, adjacency, edgeKey, randomGraph, startOf, rng } from './common.js';

const source = `public static <T> Map<Vertex<T>, Integer> dijkstra(Graph<T, Integer> graph, Vertex<T> source) {
  Map<Vertex<T>, Integer> dist = new HashMap<>();
  Map<Vertex<T>, Vertex<T>> previous = new HashMap<>();
  Set<Vertex<T>> done = new HashSet<>();
  PriorityQueue<Pair<Vertex<T>, Integer>> pending = new PriorityQueue<>(byDistance());
  for (Vertex<T> v : graph.getVertices()) {
    dist.add(v, Integer.MAX_VALUE);                 // not reached yet: infinity
  }
  dist.add(source, 0);
  pending.add(new Pair<>(source, 0));
  while (!pending.isEmpty()) {
    Vertex<T> u = pending.remove().getFirst();      // the nearest one waiting
    if (done.contains(u)) continue;                 // an older, longer entry
    done.add(u);                                    // its distance is final
    for (Vertex<T> v : graph.getAdjacentsVertex(u)) {
      int candidate = dist.get(u) + weight(graph, u, v);
      if (!done.contains(v) && candidate < dist.get(v)) {
        dist.add(v, candidate);                     // a shorter way to v
        previous.add(v, u);
        pending.add(new Pair<>(v, candidate));
      }
    }
  }
  return dist;
}

private static <T> int weight(Graph<T, Integer> graph, Vertex<T> u, Vertex<T> v) {
  for (Edge<T, Integer> edge : graph.getEdges()) {
    if (edge.getSource().equals(u) && edge.getTarget().equals(v)) return edge.getLabel();
  }
  throw new IllegalArgumentException("no edge " + u + " -> " + v);
}`;
const at = lineFinder(source);

const PRESET = {
  nodes: [{ id: 'A', x: 40, y: 130 }, { id: 'B', x: 170, y: 40 }, { id: 'C', x: 170, y: 220 }, { id: 'D', x: 320, y: 40 }, { id: 'E', x: 320, y: 220 }, { id: 'F', x: 440, y: 130 }],
  edges: [{ from: 'A', to: 'B', w: 4 }, { from: 'A', to: 'C', w: 2 }, { from: 'B', to: 'C', w: 1 }, { from: 'B', to: 'D', w: 5 }, { from: 'C', to: 'D', w: 8 }, { from: 'C', to: 'E', w: 10 }, { from: 'D', to: 'E', w: 2 }, { from: 'D', to: 'F', w: 6 }, { from: 'E', to: 'F', w: 2 }],
  directed: false,
};
const DIRECTED = {
  nodes: [{ id: 'S', x: 40, y: 120 }, { id: 'A', x: 170, y: 40 }, { id: 'B', x: 170, y: 200 }, { id: 'C', x: 310, y: 40 }, { id: 'D', x: 310, y: 200 }],
  edges: [{ from: 'S', to: 'A', w: 10 }, { from: 'S', to: 'B', w: 3 }, { from: 'B', to: 'A', w: 4 }, { from: 'A', to: 'C', w: 2 }, { from: 'B', to: 'D', w: 8 }, { from: 'C', to: 'D', w: 5 }, { from: 'D', to: 'C', w: 1 }],
  directed: true,
};

export default {
  id: 'dijkstra',
  topic: 'greedy',
  name: 'Dijkstra',
  hint: 'Shortest distances from one vertex: a priority queue, the nearest vertex fixed each time',
  fields: [
    { key: 'graph', type: 'graph', label: 'Graph', weighted: true },
    { key: 'start', type: 'vertex', label: 'Start vertex', of: 'graph' },
  ],
  presets: [
    { label: 'Six cities', input: { graph: PRESET, start: 'A' } },
    { label: 'Directed', input: { graph: DIRECTED, start: 'S' } },
    { label: 'Activity 8 graph from ONE', input: { graph: ACTIVITY_GRAPH, start: 'ONE' } },
  ],
  random(seed) { const r = rng(seed); const graph = randomGraph(r, { n: r.int(5, 7), weighted: true }); return { graph, start: 'A' }; },
  normalize(raw = {}) {
    const graph = normalizeGraph(raw.graph ?? PRESET, { weighted: true });
    if (graph.edges.some((e) => e.w < 0)) throw Error('Dijkstra needs weights of 0 or more');
    return { graph, start: startOf(graph, raw.start) };
  },
  source,
  run(input, t) {
    const { graph, start } = input;
    if (!start) throw Error('The graph has no vertices');
    const adj = adjacency(graph);
    const g = t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: graph.directed }, { label: 'Graph' });
    const pq = t.pq('pending', { label: 'pending (priority queue)' });
    const dist = t.map('dist', [], { label: 'dist' });
    const done = t.hashSet('done', [], { label: 'done' });
    const previous = new Map();
    for (const n of graph.nodes) { dist.set(n.id, Infinity); g.setValue(n.id, Infinity); }
    t.step('Every vertex starts at distance ∞', { line: at('Integer.MAX_VALUE'), vars: { source: start } });
    dist.set(start, 0); g.setValue(start, 0);
    t.step(`The source ${start} is at distance 0`, { line: at('dist.add(source, 0)'), marks: { graph: { [start]: 'current' } } });
    pq.add(start, 0);
    t.step(`Put (${start}, 0) in the priority queue`, { line: at('pending.add(new Pair<>(source, 0))') });
    while (!pq.isEmpty()) {
      const { key: u, prio: d } = pq.remove();
      t.step(`Take ${u} (distance ${d}): the nearest one waiting`, { line: at('pending.remove()'), vars: { u, 'dist(u)': d }, marks: { graph: { [u]: 'current' } } });
      if (done.has(u)) {
        t.step(`${u} is already done: this entry (${d}) is an older, longer one; skip it`, { line: at('if (done.contains(u)) continue'), marks: { graph: { [u]: 'done' } } });
        continue;
      }
      done.add(u);
      t.mark('graph', u, 'done'); t.mark('dist', u, 'done');
      t.step(`${u} is done: ${d} is its shortest distance`, { line: at('done.add(u)'), marks: { graph: { [u]: 'current' } } });
      for (const { to: v, w } of adj.get(u)) {
        const cand = dist.get(u) + w;
        const better = !done.has(v) && cand < dist.get(v);
        const why = done.has(v) ? `${v} is done: nothing to change` : better ? `${cand} < ${dist.get(v) === Infinity ? '∞' : dist.get(v)}: a shorter way to ${v}` : `${cand} ≥ ${dist.get(v)}: no better`;
        t.step(`Edge ${u}–${v} (${w}): dist(${u}) + ${w} = ${cand}. ${why}`, { line: at('candidate < dist.get(v)'), vars: { u, v, candidate: cand, 'dist(v)': dist.get(v) }, marks: { graph: { [u]: 'current', [v]: 'compare', [edgeKey(u, v)]: 'current' }, dist: { [v]: 'compare' } } });
        if (better) {
          dist.set(v, cand); g.setValue(v, cand);
          const before = previous.get(v);
          if (before) t.mark('graph', edgeKey(before, v), null), t.mark('graph', edgeKey(v, before), null);
          previous.set(v, u);
          t.mark('graph', edgeKey(u, v), 'visited');
          pq.add(v, cand);
          t.step(`dist(${v}) = ${cand}, reached from ${u}; (${v}, ${cand}) waits in the queue`, { line: at('pending.add(new Pair<>(v, candidate))'), marks: { graph: { [u]: 'current', [v]: 'queued' } } });
        }
      }
    }
    t.clearMarks('graph', 'visited');
    for (const [v, u] of previous) t.mark('graph', edgeKey(u, v), 'path');
    const result = Object.fromEntries(dist.entries());
    t.step(`Done. Shortest distances from ${start}: ${dist.entries().map(([k, v]) => `${k} ${v === Infinity ? '∞' : v}`).join(', ')}; the edges used form the shortest-path tree`, { line: at('return dist'), vars: { } });
    return result;
  },
};
