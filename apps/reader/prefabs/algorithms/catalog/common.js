// What the catalog's algorithms share: finding a line of their shown source by its text (so
// the trace's `line` follows the source when it is edited), the topics, a seeded random
// generator for "Random input", and graph input (an edge list "A-B 4", or nodes and edges).
import { layoutGraph } from '../structures/graph.js';

// The topics, with their heading (the catalog's groups, in alphabetical order of heading) and
// the short name before a card's ("Greedy: Dijkstra").
export const TOPICS = [
  { id: 'backtracking', heading: 'Backtracking', short: 'Backtracking' },
  { id: 'divide', heading: 'Divide and conquer', short: 'Divide and conquer' },
  { id: 'dp', heading: 'Dynamic programming', short: 'Dynamic programming' },
  { id: 'graphs', heading: 'Graphs', short: 'Graphs' },
  { id: 'greedy', heading: 'Greedy algorithms', short: 'Greedy' },
  { id: 'heaps', heading: 'Heaps', short: 'Heaps' },
  { id: 'maps', heading: 'Maps and hashing', short: 'Maps' },
  { id: 'recursion', heading: 'Recursion', short: 'Recursion' },
  { id: 'sorting', heading: 'Sorting', short: 'Sorting' },
  { id: 'trees', heading: 'Trees', short: 'Trees' },
].sort((a, b) => a.heading.localeCompare(b.heading));
export const topicOf = (id) => TOPICS.find((t) => t.id === id) || { id, heading: id, short: id };

// `at("text")`: the 1-based line of the source holding that text (the first one, or the
// `nth` one from 1); a missing text is a mistake in the catalog, so it throws.
export function lineFinder(source) {
  const lines = source.split('\n');
  return (text, nth = 1) => {
    let seen = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(text) && ++seen === nth) return i + 1;
    throw Error(`No line with "${text}" in the source`);
  };
}

// A small seeded generator (mulberry32): the same seed gives the same "random" input.
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (list) => list[Math.floor(next() * list.length)] };
}

export const ints = (list, { min = -999, max = 999, most = 24 } = {}) => (Array.isArray(list) ? list : [])
  .map((v) => Math.trunc(Number(v))).filter(Number.isFinite).map((v) => Math.max(min, Math.min(max, v))).slice(0, most);
export const clampInt = (v, lo, hi, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// ── Graphs ──
// Text → edges: lines or commas of "A-B 4", "A->B 4" (directed), "A B 4", or a lone "E".
export function parseEdges(text) {
  const nodes = [], edges = [], problems = [];
  const node = (id) => { if (!nodes.includes(id)) nodes.push(id); };
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^([\p{L}\p{N}_]+)\s*(->|→|-|–|\s)\s*([\p{L}\p{N}_]+)(?:\s*[:=]?\s*(-?\d+(?:\.\d+)?))?$/u);
    if (m) {
      node(m[1]); node(m[3]);
      edges.push({ from: m[1], to: m[3], ...(m[4] != null ? { w: Number(m[4]) } : {}), ...(m[2] === '->' || m[2] === '→' ? { arrow: true } : {}) });
    } else if (/^[\p{L}\p{N}_]+$/u.test(part)) node(part);
    else problems.push(part);
  }
  return { nodes, edges, problems };
}
export function edgesText(graph) {
  const g = graph || {};
  const used = new Set();
  const lines = (g.edges || []).map((e) => { used.add(e.from); used.add(e.to); return `${e.from}${g.directed ? '->' : '-'}${e.to}${e.w != null ? ` ${e.w}` : ''}`; });
  for (const n of g.nodes || []) if (!used.has(n.id)) lines.push(n.id);
  return lines.join('\n');
}
// A graph input made whole: nodes with ids (and positions when given), edges between known
// nodes (no loops, one per pair and direction), weights as numbers (default 1 when weighted).
export function normalizeGraph(raw, { weighted = false, directed = null, most = 16 } = {}) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const isDirected = directed ?? !!g.directed;
  const nodes = [];
  for (const n of Array.isArray(g.nodes) ? g.nodes : []) {
    const id = String(n?.id ?? n ?? '').trim();
    if (!id || nodes.some((q) => q.id === id) || nodes.length >= most) continue;
    nodes.push({ id, ...(Number.isFinite(+n?.x) && Number.isFinite(+n?.y) && n?.x !== null && n?.y !== null ? { x: +n.x, y: +n.y } : {}) });
  }
  const edges = [];
  for (const e of Array.isArray(g.edges) ? g.edges : []) {
    const from = String(e?.from ?? ''), to = String(e?.to ?? '');
    if (!nodes.some((n) => n.id === from) || !nodes.some((n) => n.id === to) || from === to) continue;
    if (edges.some((o) => (o.from === from && o.to === to) || (!isDirected && o.from === to && o.to === from))) continue;
    const w = Number(e?.w);
    edges.push({ from, to, ...(weighted ? { w: Number.isFinite(w) ? w : 1 } : Number.isFinite(w) && e?.w !== undefined && e?.w !== null ? { w } : {}) });
    if (edges.length >= 60) break;
  }
  return { nodes, edges, directed: isDirected };
}
// Positions for every node (the input's, else a circle), as drawn: a copy.
export function placed(graph) {
  const nodes = graph.nodes.map((n) => ({ ...n }));
  if (nodes.some((n) => !Number.isFinite(n.x))) {
    const free = nodes.filter((n) => !Number.isFinite(n.x));
    layoutGraph(free.length === nodes.length ? nodes : free);
  }
  return nodes;
}
// Neighbours of each vertex, in the order of the vertices (as the course's getAdjacentsVertex
// would give them with a sorted set): directed edges one way, undirected both ways.
export function adjacency(graph) {
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  for (const e of graph.edges) {
    adj.get(e.from).push({ to: e.to, w: e.w });
    if (!graph.directed) adj.get(e.to).push({ to: e.from, w: e.w });
  }
  for (const list of adj.values()) list.sort((a, b) => order.get(a.to) - order.get(b.to));
  return adj;
}
export const edgeKey = (a, b) => `${a}-${b}`;
// A random connected graph of n vertices (A, B…) with a few extra edges.
export function randomGraph(r, { n = 6, weighted = true, directed = false, extra = 3, acyclic = false } = {}) {
  const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const edges = [];
  const has = (a, b) => edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  for (let i = 1; i < n; i++) {
    const j = r.int(0, i - 1);
    const [from, to] = acyclic || !directed || r.next() < 0.5 ? [ids[j], ids[i]] : [ids[i], ids[j]];
    edges.push({ from, to, ...(weighted ? { w: r.int(1, 9) } : {}) });
  }
  for (let k = 0, tries = 0; k < extra && tries < 50; tries++) {
    let a = r.int(0, n - 1), b = r.int(0, n - 1);
    if (a === b || has(ids[a], ids[b])) continue;
    if (acyclic && a > b) [a, b] = [b, a];
    edges.push({ from: ids[a], to: ids[b], ...(weighted ? { w: r.int(1, 9) } : {}) });
    k++;
  }
  const radius = 120;
  const nodes = ids.map((id, i) => ({ id, x: Math.round(radius + radius * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n)), y: Math.round(radius + radius * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / n)) }));
  return { nodes, edges, directed };
}
// The fields a graph algorithm's input has, and its start vertex made whole.
export const startOf = (graph, start) => (graph.nodes.some((n) => n.id === String(start)) ? String(start) : graph.nodes[0]?.id ?? null);
