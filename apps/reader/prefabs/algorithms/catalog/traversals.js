// Graph traversals (activity 7): breadth first with a queue, depth first by recursion.
import { lineFinder, normalizeGraph, placed, adjacency, edgeKey, randomGraph, startOf, rng } from './common.js';

const GRAPH = {
  nodes: [{ id: 'A', x: 200, y: 30 }, { id: 'B', x: 80, y: 120 }, { id: 'C', x: 200, y: 120 }, { id: 'D', x: 320, y: 120 }, { id: 'E', x: 40, y: 220 }, { id: 'F', x: 150, y: 220 }, { id: 'G', x: 260, y: 220 }, { id: 'H', x: 370, y: 220 }],
  edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'A', to: 'D' }, { from: 'B', to: 'E' }, { from: 'B', to: 'F' }, { from: 'C', to: 'F' }, { from: 'D', to: 'G' }, { from: 'D', to: 'H' }, { from: 'G', to: 'H' }],
  directed: false,
};
const DIRECTED = {
  nodes: [{ id: '1', x: 40, y: 120 }, { id: '2', x: 150, y: 40 }, { id: '3', x: 150, y: 200 }, { id: '4', x: 270, y: 40 }, { id: '5', x: 270, y: 200 }, { id: '6', x: 380, y: 120 }],
  edges: [{ from: '1', to: '2' }, { from: '1', to: '3' }, { from: '2', to: '4' }, { from: '3', to: '2' }, { from: '3', to: '5' }, { from: '4', to: '6' }, { from: '5', to: '4' }, { from: '6', to: '5' }],
  directed: true,
};
const fields = [
  { key: 'graph', type: 'graph', label: 'Graph', weighted: false },
  { key: 'start', type: 'vertex', label: 'Start vertex', of: 'graph' },
];
const presets = [
  { label: 'Eight vertices', input: { graph: GRAPH, start: 'A' } },
  { label: 'Directed', input: { graph: DIRECTED, start: '1' } },
];
const random = (seed) => { const r = rng(seed); return { graph: randomGraph(r, { n: r.int(6, 8), weighted: false, extra: 3, directed: r.next() < 0.3 }), start: 'A' }; };
const normalize = (raw = {}) => { const graph = normalizeGraph(raw.graph ?? GRAPH); return { graph, start: startOf(graph, raw.start) }; };

const bfsSource = `public static <T, E> List<Vertex<T>> bfs(Graph<T, E> graph, Vertex<T> start) {
  List<Vertex<T>> order = new LinkedList<>();
  Set<Vertex<T>> visited = new HashSet<>();
  Queue<Vertex<T>> queue = new LinkedQueue<>();
  visited.add(start);
  queue.add(start);
  while (!queue.isEmpty()) {
    Vertex<T> v = queue.remove();
    order.add(v);
    for (Vertex<T> w : graph.getAdjacentsVertex(v)) {
      if (!visited.contains(w)) {
        visited.add(w);                // seen: it will not be queued twice
        queue.add(w);
      }
    }
  }
  return order;
}`;
const bfsAt = lineFinder(bfsSource);

export const bfs = {
  id: 'bfs',
  topic: 'graphs',
  name: 'Breadth-first search',
  hint: 'Visit by levels from a vertex, with a queue',
  fields, presets, random, normalize,
  source: bfsSource,
  run({ graph, start }, t) {
    if (!start) throw Error('The graph has no vertices');
    const at = bfsAt, adj = adjacency(graph);
    t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: graph.directed }, { label: 'Graph' });
    const queue = t.queue('queue', [], { label: 'queue' });
    const visited = t.hashSet('visited', [], { label: 'visited' });
    const order = t.array('order', [], { label: 'order' });
    visited.add(start); queue.add(start); t.mark('graph', start, 'queued');
    t.step(`Start at ${start}: seen, and in the queue`, { line: at('queue.add(start)'), vars: { start } });
    while (!queue.isEmpty()) {
      const v = queue.remove();
      t.step(`Take ${v} from the front of the queue`, { line: at('queue.remove()'), vars: { v }, marks: { graph: { [v]: 'current' } } });
      order.push(v); t.mark('graph', v, 'done');
      t.step(`Visit ${v} (number ${order.length})`, { line: at('order.add(v)'), marks: { graph: { [v]: 'current' } } });
      for (const { to: w } of adj.get(v)) {
        if (visited.has(w)) {
          t.step(`${w} was seen already`, { line: at('if (!visited.contains(w))'), vars: { v, w }, marks: { graph: { [v]: 'current', [w]: 'compare', [edgeKey(v, w)]: 'compare' } } });
          continue;
        }
        visited.add(w); queue.add(w);
        t.mark('graph', w, 'queued'); t.mark('graph', edgeKey(v, w), 'path');
        t.step(`${w} is new: mark it seen and queue it`, { line: at('queue.add(w)'), vars: { v, w }, marks: { graph: { [v]: 'current' } } });
      }
    }
    t.step(`Done: breadth-first order ${order.toArray().join(', ')}${visited.size() < graph.nodes.length ? ` (${graph.nodes.length - visited.size()} not reachable from ${start})` : ''}`, { line: at('return order'), vars: {} });
    return order.toArray();
  },
};

const dfsSource = `public static <T, E> List<Vertex<T>> dfs(Graph<T, E> graph, Vertex<T> start) {
  List<Vertex<T>> order = new LinkedList<>();
  dfs(graph, start, new HashSet<>(), order);
  return order;
}

private static <T, E> void dfs(Graph<T, E> graph, Vertex<T> v,
    Set<Vertex<T>> visited, List<Vertex<T>> order) {
  visited.add(v);
  order.add(v);
  for (Vertex<T> w : graph.getAdjacentsVertex(v)) {
    if (!visited.contains(w)) {
      dfs(graph, w, visited, order);   // go deep before the next neighbour
    }
  }
}                                      // back to the caller`;
const dfsAt = lineFinder(dfsSource);

export const dfs = {
  id: 'dfs',
  topic: 'graphs',
  name: 'Depth-first search',
  hint: 'Go as deep as possible first, by recursion (the call stack shows the way back)',
  fields, presets, random, normalize,
  source: dfsSource,
  run({ graph, start }, t) {
    if (!start) throw Error('The graph has no vertices');
    const at = dfsAt, adj = adjacency(graph);
    t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: graph.directed }, { label: 'Graph' });
    const visited = t.hashSet('visited', [], { label: 'visited' });
    const order = t.array('order', [], { label: 'order' });
    const path = [];
    t.step(`Depth first from ${start}`, { line: at('dfs(graph, start, new HashSet<>(), order)'), vars: { start } });
    const visit = (v, from) => {
      t.call('dfs', v);
      path.push(v);
      for (const p of path.slice(0, -1)) t.mark('graph', p, 'visited');
      visited.add(v); order.push(v);
      t.step(from ? `Go down from ${from} to ${v}: visit it` : `Visit ${v}`, { line: at('order.add(v)'), vars: { v }, marks: { graph: { [v]: 'current' } } });
      for (const { to: w } of adj.get(v)) {
        if (visited.has(w)) {
          t.step(`${w} was visited already`, { line: at('if (!visited.contains(w))'), vars: { v, w }, marks: { graph: { [v]: 'current', [w]: 'compare', [edgeKey(v, w)]: 'compare' } } });
          continue;
        }
        t.mark('graph', edgeKey(v, w), 'path');
        t.step(`${w} is new: call dfs(${w})`, { line: at('dfs(graph, w, visited, order)'), vars: { v, w }, marks: { graph: { [v]: 'current', [w]: 'compare' } } });
        visit(w, v);
        t.step(`Back in dfs(${v})`, { line: at('dfs(graph, w, visited, order)'), vars: { v, w }, marks: { graph: { [v]: 'current' } } });
      }
      path.pop();
      t.mark('graph', v, 'done');
      t.step(`Every neighbour of ${v} is visited: return`, { line: at('back to the caller'), vars: { v } });
      t.ret();
    };
    visit(start, null);
    t.step(`Done: depth-first order ${order.toArray().join(', ')}`, { line: at('return order'), vars: {} });
    return order.toArray();
  },
};

const topoSource = `public static <T, E> List<Vertex<T>> topologicalOrder(Graph<T, E> graph) {
  Map<Vertex<T>, Integer> inDegree = new HashMap<>();   // predecessors still to place
  Queue<Vertex<T>> ready = new LinkedQueue<>();         // no predecessors left
  List<Vertex<T>> result = new LinkedList<>();
  for (Vertex<T> v : graph.getVertices()) {
    inDegree.add(v, 0);
  }
  for (Vertex<T> v : graph.getVertices()) {
    for (Vertex<T> w : graph.getAdjacentsVertex(v)) {
      inDegree.add(w, inDegree.get(w) + 1);
    }
  }
  for (Vertex<T> v : graph.getVertices()) {
    if (inDegree.get(v) == 0) ready.add(v);
  }
  while (!ready.isEmpty()) {
    Vertex<T> v = ready.remove();
    result.add(v);
    for (Vertex<T> w : graph.getAdjacentsVertex(v)) {
      int pending = inDegree.get(w) - 1;               // v is placed: one less
      inDegree.add(w, pending);
      if (pending == 0) ready.add(w);
    }
  }
  return result;          // fewer vertices than the graph: it has a cycle
}`;
const topoAt = lineFinder(topoSource);
const COURSES = {
  nodes: [{ id: 'AED1', x: 40, y: 50 }, { id: 'P1', x: 40, y: 190 }, { id: 'P2', x: 180, y: 190 }, { id: 'AED2', x: 180, y: 50 }, { id: 'BD', x: 320, y: 120 }, { id: 'ISI', x: 320, y: 220 }, { id: 'TFG', x: 460, y: 120 }],
  edges: [{ from: 'P1', to: 'P2' }, { from: 'P1', to: 'AED1' }, { from: 'AED1', to: 'AED2' }, { from: 'P2', to: 'AED2' }, { from: 'AED2', to: 'BD' }, { from: 'P2', to: 'ISI' }, { from: 'BD', to: 'TFG' }, { from: 'ISI', to: 'TFG' }],
  directed: true,
};
const CYCLE = {
  nodes: [{ id: 'A', x: 40, y: 120 }, { id: 'B', x: 160, y: 40 }, { id: 'C', x: 280, y: 120 }, { id: 'D', x: 160, y: 200 }],
  edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'B' }],
  directed: true,
};

export const topological = {
  id: 'topological',
  topic: 'graphs',
  name: 'Topological ordering',
  hint: 'Order a directed graph so every edge points forward (Kahn: in-degrees and a queue)',
  fields: [{ key: 'graph', type: 'graph', label: 'Graph (directed)', weighted: false, directed: true }],
  presets: [{ label: 'Course prerequisites', input: { graph: COURSES } }, { label: 'With a cycle', input: { graph: CYCLE } }],
  random(seed) { const r = rng(seed); return { graph: randomGraph(r, { n: r.int(5, 7), weighted: false, directed: true, acyclic: true, extra: 3 }) }; },
  normalize(raw = {}) { return { graph: normalizeGraph(raw.graph ?? COURSES, { directed: true }) }; },
  source: topoSource,
  run({ graph }, t) {
    const at = topoAt, adj = adjacency(graph);
    t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: true }, { label: 'Graph' });
    const inDegree = t.map('inDegree', [], { label: 'inDegree' });
    const ready = t.queue('ready', [], { label: 'ready' });
    const result = t.array('result', [], { label: 'result' });
    for (const n of graph.nodes) inDegree.set(n.id, 0);
    t.step('Every vertex starts with no predecessors counted', { line: at('inDegree.add(v, 0)') });
    for (const n of graph.nodes) {
      for (const { to: w } of adj.get(n.id)) {
        inDegree.set(w, inDegree.get(w) + 1);
        t.step(`Edge ${n.id} → ${w}: ${w} has one more predecessor`, { line: at('inDegree.add(w, inDegree.get(w) + 1)'), vars: { v: n.id, w }, marks: { graph: { [edgeKey(n.id, w)]: 'current', [w]: 'compare' }, inDegree: { [w]: 'compare' } } });
      }
    }
    for (const n of graph.nodes) {
      if (inDegree.get(n.id) === 0) {
        ready.add(n.id); t.mark('graph', n.id, 'queued');
        t.step(`${n.id} has no predecessors: it is ready`, { line: at('if (inDegree.get(v) == 0) ready.add(v)'), vars: { v: n.id } });
      }
    }
    while (!ready.isEmpty()) {
      const v = ready.remove();
      result.push(v); t.mark('graph', v, 'done'); t.mark('inDegree', v, 'done');
      t.step(`Place ${v} next in the order`, { line: at('result.add(v)'), vars: { v }, marks: { graph: { [v]: 'current' } } });
      for (const { to: w } of adj.get(v)) {
        const pending = inDegree.get(w) - 1;
        inDegree.set(w, pending);
        t.mark('graph', edgeKey(v, w), 'done');
        if (pending === 0) { ready.add(w); t.mark('graph', w, 'queued'); }
        t.step(pending === 0 ? `${w} has no predecessors left: ready` : `${w} still waits for ${pending} predecessor${pending === 1 ? '' : 's'}`, { line: at(pending === 0 ? 'if (pending == 0) ready.add(w)' : 'inDegree.add(w, pending)'), vars: { v, w, pending }, marks: { graph: { [v]: 'current', [w]: 'compare', [edgeKey(v, w)]: 'current' }, inDegree: { [w]: 'compare' } } });
      }
    }
    const order = result.toArray();
    const cyclic = order.length < graph.nodes.length;
    if (cyclic) for (const n of graph.nodes) if (!order.includes(n.id)) t.mark('graph', n.id, 'error');
    t.step(cyclic ? `Stuck: ${graph.nodes.length - order.length} vertices still wait for each other, so the graph has a cycle and no topological order` : `Done: ${order.join(', ')}`, { line: at('return result'), vars: {} });
    return cyclic ? null : order;
  },
};
