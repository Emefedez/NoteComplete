// The catalog: every built-in algorithm, by id, and the cards' order (topics by heading, then
// algorithms by name inside each; a card is named "Topic: Algorithm").
import { TOPICS, topicOf } from './common.js';
import dijkstra from './dijkstra.js';
import prim from './prim.js';
import { bfs, dfs, topological } from './traversals.js';
import { heapInsertRemove, heapsort } from './heaps.js';
import hashmap from './hashmap.js';
import { quicksort, mergeInversions } from './sorting.js';
import { hanoi, queens, fibonacci, knapsack } from './recursion.js';
import * as basics from './recursion-basics.js';
import * as binary from './binary-trees.js';
import * as general from './general-trees.js';
import * as mapsGraphs from './maps-graphs.js';
import * as greedyMore from './greedy-more.js';
import * as backtrackingMore from './backtracking-more.js';
import * as classics from './classics.js';

export { TOPICS, topicOf };
const algorithms = (module) => Object.values(module).filter((v) => v && typeof v === 'object' && typeof v.run === 'function' && v.id);
const ALL = [dijkstra, prim, bfs, dfs, topological, heapInsertRemove, heapsort, hashmap, quicksort, mergeInversions, hanoi, queens, fibonacci, knapsack,
  ...algorithms(basics), ...algorithms(binary), ...algorithms(general), ...algorithms(mapsGraphs), ...algorithms(greedyMore), ...algorithms(backtrackingMore), ...algorithms(classics)];
// "Greedy: Dijkstra".
export const fullName = (a) => `${topicOf(a.topic).short}: ${a.name}`;
const topicIndex = (a) => TOPICS.findIndex((t) => t.id === a.topic);
export const ALGORITHMS = [...ALL].sort((a, b) => topicIndex(a) - topicIndex(b) || a.name.localeCompare(b.name));
export const algorithmById = (id) => ALGORITHMS.find((a) => a.id === id) || null;
// The algorithms in an order: "topic" (headings, as the cards), "name" (by full name), or
// "recent" (the ids given first, then the rest by topic).
export function ordered(by = 'topic', recent = []) {
  if (by === 'name') return [...ALGORITHMS].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  if (by === 'recent') return [...recent.map(algorithmById).filter(Boolean), ...ALGORITHMS.filter((a) => !recent.includes(a.id))];
  return [...ALGORITHMS];
}
