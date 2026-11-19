// Maps (activity 6: anagrams, related words, the graph as a map of maps) and graphs
// (activity 7: predecessors, regular, connected from a vertex, a path between two vertices,
// is a list a cycle, connected components).
import { lineFinder, normalizeGraph, placed, adjacency, edgeKey, randomGraph, startOf, rng } from './common.js';

const words = (text) => String(text || '').split(/[\s,;]+/).filter(Boolean).slice(0, 24);

const anaSource = `public static Set<Set<String>> getAnagrams(List<String> words) {
  Map<String, Set<String>> groups = new HashMap<>();
  for (String word : words) {
    char[] letters = word.toCharArray();
    Arrays.sort(letters);
    String key = new String(letters);             // the same for every anagram
    if (groups.get(key) == null) groups.add(key, new HashSet<>());
    groups.get(key).add(word);
  }
  Set<Set<String>> anagrams = new HashSet<>();
  groups.forEach((key, group) -> anagrams.add(group));
  return anagrams;
}`;
const aAt = lineFinder(anaSource);
export const anagrams = {
  id: 'anagrams', topic: 'maps', name: 'Anagrams',
  hint: 'Group words by their letters sorted: the key of a map of sets',
  fields: [{ key: 'words', type: 'text', label: 'Words', hint: 'Separated by spaces or new lines' }],
  presets: [{ label: 'rato arto tabo…', input: { words: 'rato arto tabo par taro bato' } }, { label: 'English', input: { words: 'listen silent enlist stone tones notes onset' } }],
  random(seed) { const r = rng(seed); const base = ['amor', 'roma', 'mora', 'ramo', 'pato', 'topa', 'sal', 'las']; return { words: base.filter(() => r.next() < 0.75).join(' ') || 'roma amor' }; },
  normalize(raw = {}) { const w = typeof raw.words === 'string' ? raw.words : 'rato arto tabo par taro bato'; if (!words(w).length) throw Error('Write some words'); return { words: w }; },
  source: anaSource,
  run(input, t) {
    const list = words(input.words);
    const arr = t.array('words', list, { label: 'words' });
    const groups = t.map('groups', [], { label: 'groups (key → words)' });
    const sets = new Map();
    list.forEach((w, i) => {
      arr.pointer('word', i);
      const key = [...w].sort().join('');
      t.step(`"${w}": its letters sorted are "${key}"`, { line: aAt('String key = new String(letters)'), vars: { word: w, key }, marks: { words: { [i]: 'current' } } });
      if (!sets.has(key)) { sets.set(key, []); groups.set(key, '{}'); t.step(`No group "${key}" yet: a new set`, { line: aAt('if (groups.get(key) == null)'), vars: { word: w, key }, marks: { groups: { [key]: 'new' } } }); }
      sets.get(key).push(w);
      groups.set(key, `{${sets.get(key).join(', ')}}`);
      t.mark('words', i, 'done');
      t.step(`"${w}" joins the group of "${key}"`, { line: aAt('groups.get(key).add(word)'), vars: { word: w, key }, marks: { groups: { [key]: 'current' } } });
    });
    arr.pointer('word', null);
    const result = [...sets.values()];
    t.step(`${result.length} group${result.length === 1 ? '' : 's'}: ${result.map((g) => `{${g.join(', ')}}`).join(' ')}`, { line: aAt('return anagrams'), vars: {} });
    return result;
  },
};

const relSource = `public static Graph<String, Integer> buildGraph(List<String> words) {
  Graph<String, Integer> graph = new MapOfMap<>();
  for (String word : words) graph.addVertex(new Vertex<>(word));
  Map<String, Set<String>> dictionary = new HashMap<>();
  for (String word : words) {
    for (String key : generateKeys(word)) {          // "fool" → _ool, f_ol, fo_l, foo_
      if (dictionary.get(key) == null) dictionary.add(key, new HashSet<>());
      dictionary.get(key).add(word);
    }
  }
  dictionary.forEach((key, related) -> {
    for (String a : related)
      for (String b : related)
        if (!a.equals(b)) graph.addEdge(new Vertex<>(a), new Vertex<>(b), 0);   // one letter apart
  });
  return graph;
}`;
const rAt = lineFinder(relSource);
export const relatedWords = {
  id: 'related-words', topic: 'maps', name: 'Related words',
  hint: 'Words one letter apart, joined in a graph: a dictionary of keys with one letter hidden',
  fields: [{ key: 'words', type: 'text', label: 'Words', hint: 'Separated by spaces or new lines' }],
  presets: [{ label: 'fool foul foil pool cool', input: { words: 'fool foul foil pool cool' } }, { label: 'coil instead of foil', input: { words: 'fool foul coil pool cool' } }],
  random(seed) { const r = rng(seed); return { words: ['cat', 'cot', 'cut', 'hat', 'hot', 'dog', 'dot', 'cog'].filter(() => r.next() < 0.7).join(' ') || 'cat cot' }; },
  normalize(raw = {}) { const w = typeof raw.words === 'string' ? raw.words : 'fool foul foil pool cool'; if (words(w).length > 12) throw Error('At most 12 words'); if (!words(w).length) throw Error('Write some words'); return { words: w }; },
  source: relSource,
  run(input, t) {
    const list = [...new Set(words(input.words))];
    const g = t.graph('graph', { nodes: placed({ nodes: list.map((id) => ({ id })) }), edges: [], directed: false }, { label: 'graph' });
    const dict = t.map('dictionary', [], { label: 'dictionary (key → words)' });
    const sets = new Map();
    t.step(`${list.length} vertices, no edges yet`, { line: rAt('for (String word : words) graph.addVertex') });
    for (const w of list) {
      for (let i = 0; i < w.length; i++) {
        const key = `${w.slice(0, i)}_${w.slice(i + 1)}`;
        if (!sets.has(key)) sets.set(key, []);
        sets.get(key).push(w);
        dict.set(key, sets.get(key).join(', '));
        t.step(`"${w}" → key "${key}"`, { line: rAt('dictionary.get(key).add(word)'), vars: { word: w, key }, marks: { graph: { [w]: 'current' }, dictionary: { [key]: sets.get(key).length > 1 ? 'path' : 'current' } } });
      }
    }
    const edges = [];
    // Edges come from the keys shared by more than one word.
    for (const [key, group] of sets) {
      if (group.length < 2) continue;
      for (const a of group) for (const b of group) {
        if (a === b || edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))) continue;
        edges.push({ from: a, to: b });
        g.addEdge(a, b, undefined, false);
      }
      t.step(`"${key}" holds ${group.join(', ')}: they are one letter apart`, { line: rAt('if (!a.equals(b)) graph.addEdge'), vars: { key }, marks: { dictionary: { [key]: 'current' }, graph: Object.fromEntries([...group.map((w) => [w, 'compare']), ...group.flatMap((a) => group.map((b) => [edgeKey(a, b), 'new']))]) } });
    }
    t.step(`The graph: ${edges.length} edge${edges.length === 1 ? '' : 's'}`, { line: rAt('return graph'), vars: {}, marks: { graph: Object.fromEntries(edges.map((e) => [edgeKey(e.from, e.to), 'path'])) } });
    return edges.map((e) => `${e.from}-${e.to}`);
  },
};

// ── Graphs ──
const DIRECTED = {
  nodes: [{ id: 'A', x: 40, y: 120 }, { id: 'B', x: 160, y: 40 }, { id: 'C', x: 160, y: 200 }, { id: 'D', x: 290, y: 40 }, { id: 'E', x: 290, y: 200 }, { id: 'F', x: 410, y: 120 }],
  edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'D' }, { from: 'C', to: 'D' }, { from: 'D', to: 'F' }, { from: 'E', to: 'C' }, { from: 'F', to: 'E' }],
  directed: true,
};
const TWO_PARTS = {
  nodes: [{ id: 'A', x: 40, y: 60 }, { id: 'B', x: 150, y: 30 }, { id: 'C', x: 120, y: 140 }, { id: 'D', x: 280, y: 60 }, { id: 'E', x: 380, y: 30 }, { id: 'F', x: 380, y: 140 }, { id: 'G', x: 250, y: 180 }],
  edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'A', to: 'C' }, { from: 'D', to: 'E' }, { from: 'E', to: 'F' }],
  directed: false,
};
const CYCLE6 = {
  nodes: [{ id: 'A', x: 150, y: 30 }, { id: 'B', x: 260, y: 90 }, { id: 'C', x: 260, y: 200 }, { id: 'D', x: 150, y: 260 }, { id: 'E', x: 40, y: 200 }, { id: 'F', x: 40, y: 90 }],
  edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'E' }, { from: 'E', to: 'F' }, { from: 'F', to: 'A' }, { from: 'A', to: 'D' }],
  directed: false,
};
const graphField = { key: 'graph', type: 'graph', label: 'Graph', weighted: false };
const vertexField = (key, label) => ({ key, type: 'vertex', label, of: 'graph' });
const randomPlain = (seed) => { const r = rng(seed); return randomGraph(r, { n: r.int(5, 7), weighted: false, extra: 2, directed: r.next() < 0.4 }); };
const show = (graph, t) => t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: graph.directed }, { label: 'graph' });

const predSource = `public static <T, E> Set<Vertex<T>> getPredecessors(Graph<T, E> graph, Vertex<T> vertex) {
  Set<Vertex<T>> result = new HashSet<>();
  for (Vertex<T> v : graph.getVertices()) {
    for (Vertex<T> adjacent : graph.getAdjacentsVertex(v)) {
      if (adjacent.equals(vertex)) result.add(v);        // an edge v → vertex
    }
  }
  return result;
}`;
const pAt = lineFinder(predSource);
export const predecessors = {
  id: 'predecessors', topic: 'graphs', name: 'Predecessors',
  hint: 'Every vertex with an edge into the given one',
  fields: [{ ...graphField, label: 'Graph (directed)', directed: true }, vertexField('vertex', 'Vertex')],
  presets: [{ label: 'Predecessors of D', input: { graph: DIRECTED, vertex: 'D' } }, { label: 'Of C', input: { graph: DIRECTED, vertex: 'C' } }],
  random(seed) { const r = rng(seed); return { graph: randomGraph(r, { n: 6, weighted: false, directed: true, extra: 4 }), vertex: 'C' }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? DIRECTED, { directed: true }); return { graph, vertex: startOf(graph, raw.vertex ?? 'D') }; },
  source: predSource,
  run({ graph, vertex }, t) {
    const adj = adjacency(graph);
    show(graph, t);
    const result = t.hashSet('result', [], { label: 'result' });
    t.mark('graph', vertex, 'current');
    for (const n of graph.nodes) {
      t.step(`The edges out of ${n.id}`, { line: pAt('for (Vertex<T> adjacent'), vars: { v: n.id }, marks: { graph: { [n.id]: 'compare' } } });
      for (const { to } of adj.get(n.id)) {
        const hit = to === vertex;
        if (hit) { result.add(n.id); t.mark('graph', n.id, 'path'); t.mark('graph', edgeKey(n.id, to), 'path'); }
        t.step(hit ? `${n.id} → ${vertex}: ${n.id} is a predecessor` : `${n.id} → ${to}: not ${vertex}`, { line: pAt('if (adjacent.equals(vertex)) result.add(v)'), vars: { v: n.id, adjacent: to }, marks: { graph: { [edgeKey(n.id, to)]: hit ? 'path' : 'compare' } } });
      }
    }
    t.step(`Predecessors of ${vertex}: {${result.toArray().join(', ')}}`, { line: pAt('return result'), vars: {} });
    return result.toArray();
  },
};

const regSource = `public static <T, E> boolean isRegular(Graph<T, E> graph) {
  int degree = -1;
  for (Vertex<T> v : graph.getVertices()) {
    int adjacents = graph.getAdjacentsVertex(v).size();
    if (degree == -1) degree = adjacents;                // the first one sets it
    else if (adjacents != degree) return false;
  }
  return true;
}`;
const gAt = lineFinder(regSource);
export const regular = {
  id: 'regular', topic: 'graphs', name: 'Regular graph?',
  hint: 'Whether every vertex has the same number of neighbours',
  fields: [graphField],
  presets: [{ label: 'A ring (yes)', input: { graph: { ...CYCLE6, edges: CYCLE6.edges.slice(0, 6) } } }, { label: 'A ring and a chord (no)', input: { graph: CYCLE6 } }],
  random: (seed) => ({ graph: randomPlain(seed) }),
  normalize(raw = {}) { return { graph: normalizeGraph(raw.graph ?? CYCLE6) }; },
  source: regSource,
  run({ graph }, t) {
    const adj = adjacency(graph);
    const g = show(graph, t);
    let degree = -1;
    for (const n of graph.nodes) {
      const k = adj.get(n.id).length;
      g.setValue(n.id, k);
      if (degree === -1) { degree = k; t.step(`${n.id} has ${k} neighbours: every vertex must have ${k}`, { line: gAt('if (degree == -1) degree = adjacents'), vars: { v: n.id, adjacents: k, degree }, marks: { graph: { [n.id]: 'current' } } }); continue; }
      if (k !== degree) { t.mark('graph', n.id, 'error'); t.step(`${n.id} has ${k}, not ${degree}: not regular`, { line: gAt('else if (adjacents != degree) return false'), vars: { v: n.id, adjacents: k, degree } }); return false; }
      t.mark('graph', n.id, 'done');
      t.step(`${n.id} has ${k} too`, { line: gAt('else if (adjacents != degree)'), vars: { v: n.id, adjacents: k, degree }, marks: { graph: { [n.id]: 'current' } } });
    }
    t.step(`Every vertex has ${degree} neighbours: regular`, { line: gAt('return true'), vars: {} });
    return true;
  },
};

const dfsHelper = `private static <T, E> void dfs(Graph<T, E> graph, Vertex<T> vertex, Set<Vertex<T>> visited) {
  visited.add(vertex);
  for (Vertex<T> adjacent : graph.getAdjacentsVertex(vertex)) {
    if (!visited.contains(adjacent)) dfs(graph, adjacent, visited);
  }
}`;
// A depth-first visit that steps at the helper's lines; `colour` marks each visited vertex.
function visit(t, adj, at, start, visited, { colour = 'visited', label = null } = {}) {
  const go = (v) => {
    t.call('dfs', v);
    visited.add(v); t.mark('graph', v, colour);
    if (label) t.steps.length >= 0 && label(v);
    t.step(`Visit ${v}`, { line: at('visited.add(vertex);'), vars: { vertex: v }, marks: { graph: { [v]: 'current' } } });
    for (const { to } of adj.get(v)) {
      if (visited.has(to)) continue;
      t.mark('graph', edgeKey(v, to), 'path');
      go(to);
    }
    t.ret();
  };
  go(start);
}

const connSource = `public static <T, E> boolean isConnectedFromVertex(Graph<T, E> graph, Vertex<T> vertex) {
  Set<Vertex<T>> visited = new HashSet<>();
  dfs(graph, vertex, visited);
  return visited.size() == graph.getVertices().size();   // it reached them all
}

${dfsHelper}`;
const cAt = lineFinder(connSource);
export const connectedFrom = {
  id: 'connected-from', topic: 'graphs', name: 'Connected from a vertex?',
  hint: 'Depth first from it: did it reach every vertex?',
  fields: [graphField, vertexField('vertex', 'Start vertex')],
  presets: [{ label: 'Two parts (no)', input: { graph: TWO_PARTS, vertex: 'A' } }, { label: 'Directed from A', input: { graph: DIRECTED, vertex: 'A' } }],
  random(seed) { return { graph: randomPlain(seed), vertex: 'A' }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? TWO_PARTS); return { graph, vertex: startOf(graph, raw.vertex) }; },
  source: connSource,
  run({ graph, vertex }, t) {
    const adj = adjacency(graph);
    show(graph, t);
    const visited = t.hashSet('visited', [], { label: 'visited' });
    t.step(`Depth first from ${vertex}`, { line: cAt('dfs(graph, vertex, visited);'), vars: { vertex } });
    visit(t, adj, cAt, vertex, visited);
    const ok = visited.size() === graph.nodes.length;
    for (const n of graph.nodes) if (!visited.has(n.id)) t.mark('graph', n.id, 'error');
    t.step(ok ? `Reached all ${graph.nodes.length}: true` : `Reached ${visited.size()} of ${graph.nodes.length}: false`, { line: cAt('return visited.size() == graph.getVertices().size()'), vars: {} });
    return ok;
  },
};

const pathSource = `public static <T, E> boolean thereIsPathBetweenVertices(Graph<T, E> graph, Vertex<T> source, Vertex<T> target) {
  return path(graph, source, target, new HashSet<>());
}

private static <T, E> boolean path(Graph<T, E> graph, Vertex<T> vertex, Vertex<T> target, Set<Vertex<T>> visited) {
  visited.add(vertex);
  if (vertex.equals(target)) return true;                // got there
  for (Vertex<T> adjacent : graph.getAdjacentsVertex(vertex)) {
    if (!visited.contains(adjacent) && path(graph, adjacent, target, visited)) return true;
  }
  return false;                                          // no way on from here
}`;
const qAt = lineFinder(pathSource);
export const pathBetween = {
  id: 'path-between', topic: 'graphs', name: 'Path between two vertices?',
  hint: 'Depth first from the source, stopping as soon as it reaches the target',
  fields: [graphField, vertexField('source', 'From'), vertexField('target', 'To')],
  presets: [{ label: 'A to F (directed)', input: { graph: DIRECTED, source: 'A', target: 'F' } }, { label: 'F to A (directed, no)', input: { graph: DIRECTED, source: 'F', target: 'A' } }, { label: 'Two parts', input: { graph: TWO_PARTS, source: 'A', target: 'F' } }],
  random(seed) { return { graph: randomPlain(seed), source: 'A', target: 'E' }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? DIRECTED); return { graph, source: startOf(graph, raw.source), target: startOf(graph, raw.target ?? graph.nodes.at(-1)?.id) }; },
  source: pathSource,
  run({ graph, source, target }, t) {
    const adj = adjacency(graph);
    show(graph, t);
    const visited = t.hashSet('visited', [], { label: 'visited' });
    t.mark('graph', target, 'queued');
    const go = (v) => {
      t.call('path', v);
      visited.add(v); t.mark('graph', v, 'visited');
      if (v === target) { t.mark('graph', v, 'path'); t.step(`${v} is the target: true`, { line: qAt('if (vertex.equals(target)) return true'), vars: { vertex: v } }); t.ret(); return true; }
      t.step(`At ${v}: try its neighbours`, { line: qAt('for (Vertex<T> adjacent'), vars: { vertex: v }, marks: { graph: { [v]: 'current' } } });
      for (const { to } of adj.get(v)) {
        if (visited.has(to)) continue;
        t.mark('graph', edgeKey(v, to), 'visited');
        if (go(to)) { t.mark('graph', edgeKey(v, to), 'path'); t.mark('graph', v, 'path'); t.ret(); return true; }
        t.mark('graph', edgeKey(v, to), 'removed');
      }
      t.mark('graph', v, 'done');
      t.step(`No way on from ${v}: back`, { line: qAt('return false;                                          // no way'), vars: { vertex: v } });
      t.ret();
      return false;
    };
    const ok = go(source);
    t.step(ok ? `There is a path from ${source} to ${target} (in green)` : `No path from ${source} to ${target}`, { line: null, vars: {} });
    return ok;
  },
};

const cycleSource = `public static <T, E> boolean isACycle(Graph<T, E> graph, List<Vertex<T>> path) {
  if (!path.getFirst().equals(path.getLast())) return false;   // it must come back
  Set<Vertex<T>> visited = new HashSet<>();
  for (int i = 0; i < path.size() - 1; i++) {
    if (!graph.getAdjacentsVertex(path.get(i)).contains(path.get(i + 1))) return false;
    if (visited.contains(path.get(i))) return false;           // a vertex twice
    visited.add(path.get(i));
  }
  return true;
}`;
const yAt = lineFinder(cycleSource);
export const isCycle = {
  id: 'is-cycle', topic: 'graphs', name: 'Is a list of vertices a cycle?',
  hint: 'Back to the first, each step along an edge, no vertex twice',
  fields: [graphField, { key: 'path', type: 'line', label: 'Path', placeholder: 'A B C D A' }],
  presets: [{ label: 'A B C D A (yes)', input: { graph: CYCLE6, path: 'A B C D A' } }, { label: 'A B C A (no edge C–A)', input: { graph: CYCLE6, path: 'A B C A' } }, { label: 'A D E F A (yes)', input: { graph: CYCLE6, path: 'A D E F A' } }],
  random(seed) { return { graph: CYCLE6, path: rng(seed).pick(['A B C D A', 'A F E D A', 'B C D B']) }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? CYCLE6); const path = typeof raw.path === 'string' ? raw.path : 'A B C D A'; const unknown = path.split(/[\s,]+/).filter(Boolean).find((v) => !graph.nodes.some((n) => n.id === v)); if (unknown) throw Error(`${unknown} is not a vertex`); return { graph, path }; },
  source: cycleSource,
  run({ graph, path }, t) {
    const adj = adjacency(graph);
    show(graph, t);
    const list = path.split(/[\s,]+/).filter(Boolean);
    const arr = t.array('path', list, { label: 'path' });
    const seen = new Set();
    if (list.length < 2 || list[0] !== list.at(-1)) { t.step(`The path does not end where it starts: false`, { line: yAt('if (!path.getFirst().equals(path.getLast())) return false'), marks: { path: { 0: 'error', [list.length - 1]: 'error' } } }); return false; }
    t.step(`It starts and ends at ${list[0]}`, { line: yAt('if (!path.getFirst().equals(path.getLast()))'), marks: { path: { 0: 'compare', [list.length - 1]: 'compare' } } });
    for (let i = 0; i < list.length - 1; i++) {
      arr.pointer('i', i);
      const a = list[i], b = list[i + 1];
      const edge = adj.get(a).some((x) => x.to === b);
      if (!edge) { t.mark('graph', a, 'error'); t.mark('graph', b, 'error'); t.step(`No edge ${a} → ${b}: false`, { line: yAt('if (!graph.getAdjacentsVertex(path.get(i)).contains'), vars: { i }, marks: { path: { [i]: 'error', [i + 1]: 'error' } } }); return false; }
      if (seen.has(a)) { t.mark('graph', a, 'error'); t.step(`${a} is in the path twice: false`, { line: yAt('if (visited.contains(path.get(i))) return false'), vars: { i }, marks: { path: { [i]: 'error' } } }); return false; }
      seen.add(a); t.mark('graph', a, 'visited'); t.mark('graph', edgeKey(a, b), 'path'); t.mark('path', i, 'done');
      t.step(`${a} → ${b} is an edge`, { line: yAt('visited.add(path.get(i))'), vars: { i }, marks: { graph: { [b]: 'current' } } });
    }
    arr.pointer('i', null);
    t.step(`${list.join(' → ')} is a cycle: true`, { line: yAt('return true'), vars: {} });
    return true;
  },
};

const compSource = `public static <T, E> int numberOfConnectedComponents(Graph<T, E> graph) {
  int components = 0;
  Set<Vertex<T>> visited = new HashSet<>();
  for (Vertex<T> vertex : graph.getVertices()) {
    if (!visited.contains(vertex)) {
      dfs(graph, vertex, visited);                  // everything joined to it
      components++;
    }
  }
  return components;
}

${dfsHelper}`;
const kAt = lineFinder(compSource);
export const components = {
  id: 'components', topic: 'graphs', name: 'Connected components',
  hint: 'A depth-first visit from each vertex not yet seen: each one is a new component',
  fields: [{ ...graphField, label: 'Graph (undirected)', directed: false }],
  presets: [{ label: 'Three parts', input: { graph: TWO_PARTS } }],
  random(seed) { const r = rng(seed); const g = randomGraph(r, { n: 7, weighted: false, extra: 0 }); g.edges = g.edges.filter(() => r.next() < 0.6); return { graph: g }; },
  normalize(raw = {}) { return { graph: normalizeGraph(raw.graph ?? TWO_PARTS, { directed: false }) }; },
  source: compSource,
  run({ graph }, t) {
    const adj = adjacency(graph);
    const g = show(graph, t);
    const visited = t.hashSet('visited', [], { label: 'visited' });
    const count = t.value('components', 0, { label: 'components' });
    for (const n of graph.nodes) {
      if (visited.has(n.id)) { t.step(`${n.id} was seen already`, { line: kAt('if (!visited.contains(vertex))'), vars: { vertex: n.id }, marks: { graph: { [n.id]: 'compare' } } }); continue; }
      const k = count.get() + 1;
      t.step(`${n.id} is not seen: a new component (${k})`, { line: kAt('dfs(graph, vertex, visited);'), vars: { vertex: n.id, components: k - 1 }, marks: { graph: { [n.id]: 'current' } } });
      visit(t, adj, kAt, n.id, visited, { colour: 'done', label: (v) => g.setValue(v, `#${k}`) });
      count.set(k);
      t.step(`Component ${k} done`, { line: kAt('components++'), vars: { components: k } });
    }
    t.step(`${count.get()} connected component${count.get() === 1 ? '' : 's'}`, { line: kAt('return components'), vars: {} });
    return count.get();
  },
};

const mapSource = `public class MapOfMap<T, E> implements Graph<T, E> {
  private Map<Vertex<T>, Map<Vertex<T>, E>> mapOfVertices = new HashMap<>();

  public boolean addVertex(Vertex<T> vertex) {
    if (mapOfVertices.get(vertex) != null) return false;
    mapOfVertices.add(vertex, new HashMap<>());       // no edges yet
    return true;
  }

  public boolean addEdge(Vertex<T> source, Vertex<T> target, E label) {
    Map<Vertex<T>, E> edges = mapOfVertices.get(source);
    if (edges == null || mapOfVertices.get(target) == null) throw new IllegalArgumentException();
    if (edges.get(target) != null) return false;      // one edge per pair
    edges.add(target, label);
    return true;
  }

  public boolean removeEdge(Vertex<T> source, Vertex<T> target, E label) {
    Map<Vertex<T>, E> edges = mapOfVertices.get(source);
    if (edges == null || edges.get(target) == null) return false;
    edges.remove(target);
    return true;
  }

  public boolean removeVertex(Vertex<T> vertex) {
    if (mapOfVertices.get(vertex) == null) return false;
    mapOfVertices.remove(vertex);
    mapOfVertices.forEach((v, edges) -> edges.remove(vertex));   // and the edges into it
    return true;
  }
}`;
const mAt = lineFinder(mapSource);
export const mapOfMap = {
  id: 'map-of-map', topic: 'maps', name: 'Graph as a map of maps',
  hint: 'Each vertex maps to a map of its neighbours and the edge labels',
  fields: [{ key: 'ops', type: 'text', label: 'Operations', hint: 'addVertex A · addEdge A B 3 · removeEdge A B · removeVertex A' }],
  presets: [{ label: 'Build and change', input: { ops: 'addVertex A\naddVertex B\naddVertex C\naddEdge A B 5\naddEdge A C 2\naddEdge C B 1\naddEdge A B 9\nremoveEdge A C\nremoveVertex B' } }],
  random(seed) { const r = rng(seed); const v = ['A', 'B', 'C', 'D']; return { ops: [...v.map((x) => `addVertex ${x}`), ...Array.from({ length: 4 }, () => `addEdge ${r.pick(v)} ${r.pick(v)} ${r.int(1, 9)}`), `removeVertex ${r.pick(v)}`].join('\n') }; },
  normalize(raw = {}) {
    const ops = typeof raw.ops === 'string' ? raw.ops : this.presets[0].input.ops;
    for (const line of ops.split(/\n|;/).map((l) => l.trim()).filter(Boolean)) if (!/^(addVertex \S+|removeVertex \S+|addEdge \S+ \S+( \S+)?|removeEdge \S+ \S+( \S+)?)$/i.test(line)) throw Error(`Not an operation: "${line}"`);
    return { ops };
  },
  source: mapSource,
  run({ ops }, t) {
    const outer = new Map();
    const view = t.map('map', [], { label: 'mapOfVertices (vertex → its edges)' });
    const ids = [];
    const g = t.graph('graph', { nodes: [], edges: [], directed: true }, { label: 'the graph it is' });
    let edgeCount = 0;
    const text = (m) => `{${[...m].map(([k, v]) => `${k}=${v}`).join(', ')}}`;
    // Vertices on a circle, placed again as they come and go.
    const draw = () => ids.forEach((id, i) => g.moveNode(id, 170 + 120 * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ids.length)), 130 + 100 * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ids.length))));
    t.step('An empty graph: an empty map', { line: mAt('private Map<Vertex<T>, Map<Vertex<T>, E>> mapOfVertices') });
    for (const line of ops.split(/\n|;/).map((l) => l.trim()).filter(Boolean)) {
      const [op, a, b, c] = line.split(/\s+/);
      const kind = op.toLowerCase();
      t.call(op, [a, b, c].filter(Boolean).join(', '));
      if (kind === 'addvertex') {
        if (outer.has(a)) t.step(`${a} is there already: false`, { line: mAt('if (mapOfVertices.get(vertex) != null) return false'), vars: { vertex: a } });
        else { outer.set(a, new Map()); ids.push(a); g.addNode({ id: a, x: 0, y: 0 }); view.set(a, '{}'); draw(); t.step(`${a} → an empty map`, { line: mAt('mapOfVertices.add(vertex, new HashMap<>())'), vars: { vertex: a }, marks: { graph: { [a]: 'new' } } }); }
      } else if (kind === 'addedge') {
        const label = c ?? '0';
        if (!outer.has(a) || !outer.has(b)) { t.step(`${outer.has(a) ? b : a} is not a vertex: IllegalArgumentException`, { line: mAt('throw new IllegalArgumentException()'), vars: { source: a, target: b }, marks: { map: { [a]: 'error' } } }); }
        else if (outer.get(a).has(b)) t.step(`${a} already has an edge to ${b}: false`, { line: mAt('if (edges.get(target) != null) return false'), vars: { source: a, target: b }, marks: { map: { [a]: 'error' }, graph: { [edgeKey(a, b)]: 'error' } } });
        else { outer.get(a).set(b, label); g.addEdge(a, b, label); edgeCount++; view.set(a, text(outer.get(a))); t.step(`In ${a}'s map: ${b} = ${label}`, { line: mAt('edges.add(target, label)'), vars: { source: a, target: b, label }, marks: { map: { [a]: 'current' }, graph: { [edgeKey(a, b)]: 'new' } } }); }
      } else if (kind === 'removeedge') {
        if (!outer.get(a)?.has(b)) t.step(`No edge ${a} → ${b}: false`, { line: mAt('if (edges == null || edges.get(target) == null) return false'), vars: { source: a, target: b } });
        else { t.step(`Remove ${b} from ${a}'s map`, { line: mAt('edges.remove(target)'), vars: { source: a, target: b }, marks: { map: { [a]: 'current' }, graph: { [edgeKey(a, b)]: 'removed' } } }); outer.get(a).delete(b); g.removeEdge(a, b); edgeCount--; view.set(a, text(outer.get(a))); }
      } else {
        if (!outer.has(a)) t.step(`${a} is not a vertex: false`, { line: mAt('if (mapOfVertices.get(vertex) == null) return false'), vars: { vertex: a } });
        else {
          t.step(`Remove ${a} and its map`, { line: mAt('mapOfVertices.remove(vertex)'), vars: { vertex: a }, marks: { graph: { [a]: 'removed' } } });
          edgeCount -= outer.get(a).size;
          outer.delete(a); view.remove(a); ids.splice(ids.indexOf(a), 1); g.removeNode(a);
          for (const [v, m] of outer) if (m.delete(a)) { view.set(v, text(m)); edgeCount--; }
          draw();
          t.step(`…and the edges into ${a}`, { line: mAt('mapOfVertices.forEach((v, edges) -> edges.remove(vertex))'), vars: { vertex: a } });
        }
      }
      t.ret();
    }
    t.step(`Done: ${ids.length} vertices, ${edgeCount} edges`, { line: null, vars: {} });
    return Object.fromEntries([...outer].map(([k, m]) => [k, Object.fromEntries(m)]));
  },
};
