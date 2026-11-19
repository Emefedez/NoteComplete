// Prim's minimum spanning tree (greedy, activity 8): from one vertex, the lightest edge that
// leaves the tree is added each time (a priority queue of edges).
import { ACTIVITY_GRAPH } from './greedy-more.js';
import { lineFinder, normalizeGraph, placed, adjacency, edgeKey, randomGraph, startOf, rng } from './common.js';

const source = `public static <T> Graph<T, Integer> prim(Graph<T, Integer> graph, Vertex<T> start) {
  Graph<T, Integer> tree = new AdjacencyList<>();
  Set<Vertex<T>> inTree = new HashSet<>();
  PriorityQueue<Edge<T, Integer>> edges = new PriorityQueue<>(byLabel());
  inTree.add(start);
  tree.addVertex(start);
  addEdgesOf(graph, start, inTree, edges);
  while (!edges.isEmpty() && inTree.size() < graph.getVertices().size()) {
    Edge<T, Integer> edge = edges.remove();          // the lightest edge waiting
    Vertex<T> v = edge.getTarget();
    if (inTree.contains(v)) continue;                // both ends in the tree: a cycle
    inTree.add(v);
    tree.addVertex(v);
    tree.addEdge(edge.getSource(), v, edge.getLabel());
    addEdgesOf(graph, v, inTree, edges);
  }
  return tree;
}

private static <T> void addEdgesOf(Graph<T, Integer> graph, Vertex<T> v,
    Set<Vertex<T>> inTree, PriorityQueue<Edge<T, Integer>> edges) {
  for (Vertex<T> w : graph.getAdjacentsVertex(v)) {
    if (!inTree.contains(w)) {
      edges.add(new Edge<>(v, w, weight(graph, v, w)));
    }
  }
}`;
const at = lineFinder(source);

const PRESET = {
  nodes: [{ id: 'A', x: 40, y: 140 }, { id: 'B', x: 160, y: 40 }, { id: 'C', x: 160, y: 240 }, { id: 'D', x: 300, y: 140 }, { id: 'E', x: 420, y: 40 }, { id: 'F', x: 420, y: 240 }],
  edges: [{ from: 'A', to: 'B', w: 6 }, { from: 'A', to: 'C', w: 3 }, { from: 'B', to: 'C', w: 5 }, { from: 'B', to: 'D', w: 2 }, { from: 'C', to: 'D', w: 4 }, { from: 'B', to: 'E', w: 7 }, { from: 'D', to: 'E', w: 8 }, { from: 'D', to: 'F', w: 3 }, { from: 'E', to: 'F', w: 1 }, { from: 'C', to: 'F', w: 9 }],
  directed: false,
};

export default {
  id: 'prim',
  topic: 'greedy',
  name: 'Prim',
  hint: 'Minimum spanning tree: grow the tree by the lightest edge that leaves it',
  fields: [
    { key: 'graph', type: 'graph', label: 'Graph (undirected)', weighted: true, directed: false },
    { key: 'start', type: 'vertex', label: 'Start vertex', of: 'graph' },
  ],
  presets: [{ label: 'Six vertices', input: { graph: PRESET, start: 'A' } }, { label: 'Activity 8 graph from SIX', input: { graph: ACTIVITY_GRAPH, start: 'SIX' } }],
  random(seed) { const r = rng(seed); return { graph: randomGraph(r, { n: r.int(5, 7), weighted: true, extra: 4 }), start: 'A' }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? PRESET, { weighted: true, directed: false }); return { graph, start: startOf(graph, raw.start) }; },
  source,
  run({ graph, start }, t) {
    if (!start) throw Error('The graph has no vertices');
    const adj = adjacency(graph);
    t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: false }, { label: 'Graph (tree edges in green)' });
    const pq = t.pq('edges', { label: 'edges (priority queue)' });
    const inTree = t.hashSet('inTree', [], { label: 'inTree' });
    const total = t.value('total', 0, { label: 'tree weight' });
    const chosen = [];
    const addEdgesOf = (v) => {
      t.call('addEdgesOf', v);
      for (const { to: w, w: weight } of adj.get(v)) {
        if (inTree.has(w)) continue;
        pq.add(`${v}-${w}`, weight);
        t.mark('graph', edgeKey(v, w), 'queued');
        t.step(`Edge ${v}–${w} (${weight}) leaves the tree: it waits in the queue`, { line: at('edges.add(new Edge<>'), vars: { v, w, weight }, marks: { graph: { [v]: 'current', [w]: 'compare' } } });
      }
      t.ret();
    };
    inTree.add(start); t.mark('graph', start, 'done');
    t.step(`Start the tree at ${start}`, { line: at('inTree.add(start)'), vars: { start } });
    addEdgesOf(start);
    while (pq.size() && inTree.size() < graph.nodes.length) {
      const { key, prio } = pq.remove();
      const [u, v] = key.split('-');
      t.step(`Take the lightest edge waiting: ${u}–${v} (${prio})`, { line: at('edges.remove()'), vars: { edge: `${u}-${v}`, weight: prio }, marks: { graph: { [edgeKey(u, v)]: 'current', [v]: 'compare' } } });
      if (inTree.has(v)) {
        t.mark('graph', edgeKey(u, v), 'removed');
        t.step(`${v} is already in the tree: ${u}–${v} would close a cycle; drop it`, { line: at('if (inTree.contains(v)) continue'), marks: { graph: { [v]: 'error' } } });
        continue;
      }
      inTree.add(v); t.mark('graph', v, 'done');
      t.mark('graph', edgeKey(u, v), 'path');
      chosen.push({ from: u, to: v, w: prio });
      total.set(total.get() + prio);
      t.step(`Add ${v} and the edge ${u}–${v} (${prio}) to the tree; weight so far ${total.get()}`, { line: at('tree.addEdge('), vars: { v }, marks: { graph: { [v]: 'current' } } });
      addEdgesOf(v);
    }
    for (const n of graph.nodes) if (!inTree.has(n.id)) t.mark('graph', n.id, 'error');
    const all = inTree.size() === graph.nodes.length;
    t.step(all ? `Done: the minimum spanning tree has ${chosen.length} edges and weighs ${total.get()}` : `Done: the graph is not connected; the tree from ${start} spans ${inTree.size()} vertices (weight ${total.get()})`, { line: at('return tree'), vars: {} });
    return { weight: total.get(), edges: chosen };
  },
};
