// "Run the Java version": the built-in algorithms whose shown source runs as it is through the
// Java layer (java/index.js runJava). The shown source becomes a class with a prefix on its
// FIRST line (imports and the class header, so its line numbers stay those of the code pane)
// and a suffix after it (helpers it calls, the closing brace, a small driver when needed);
// `args(input)` turns the algorithm's input into the entry's arguments.
import { parseOps } from './hashmap.js';
import { parseItems } from './recursion.js';

const UTIL = 'import java.util.List; import java.util.LinkedList; import java.util.ArrayList; import java.util.Set; import java.util.HashSet; import java.util.PriorityQueue; import java.util.Comparator; import java.util.Iterator;';
const COURSE = 'import es.uvigo.esei.aed2.map.Map; import es.uvigo.esei.aed2.map.HashMap; import es.uvigo.esei.aed2.graph.*; import es.uvigo.esei.aed1.tads.queue.*;';
const header = (cls = 'Algorithm') => `${UTIL} ${COURSE} public class ${cls} { `;
const close = '\n}\n';
// A graph input as the Java layer reads it: "A-B 4, …" (both ways when undirected).
const graphArg = (g) => {
  const parts = g.edges.map((e) => `${e.from}${g.directed ? '->' : '-'}${e.to}${e.w != null ? ` ${e.w}` : ''}`);
  const used = new Set(g.edges.flatMap((e) => [e.from, e.to]));
  for (const n of g.nodes) if (!used.has(n.id)) parts.push(n.id);
  return { vertices: g.nodes.map((n) => n.id), edges: g.edges.flatMap((e) => (g.directed ? [[e.from, e.to, e.w ?? null]] : [[e.from, e.to, e.w ?? null], [e.to, e.from, e.w ?? null]])) };
};
const WEIGHT = `
  private static <T> int weight(Graph<T, Integer> graph, Vertex<T> u, Vertex<T> v) {
    for (Edge<T, Integer> edge : graph.getEdges()) {
      if (edge.getSource().equals(u) && edge.getTarget().equals(v)) return edge.getLabel();
    }
    throw new IllegalArgumentException("no edge " + u + " -> " + v);
  }`;
const EXCHANGE = `
  private static void exchange(int[] array, int i, int j) {
    int aux = array[i];
    array[i] = array[j];
    array[j] = aux;
  }`;

export const JAVA_VERSIONS = {
  factorial: { entry: 'Algorithm.factorial', args: (i) => [i.n] },
  'sum-digits': { entry: 'Algorithm.sumDigits', args: (i) => [i.n] },
  gcd: { entry: 'Algorithm.mcd', args: (i) => [i.a, i.b] },
  'invert-string': { entry: 'Algorithm.invert', args: (i) => [i.s] },
  'invert-array': { entry: 'Algorithm.invertArray', args: (i) => [i.values] },
  minimum: { entry: 'Algorithm.minimum', args: (i) => [i.values] },
  'binary-search': { entry: 'Algorithm.binarySearch', args: (i) => [i.values, i.number] },
  dfs: { entry: 'Algorithm.dfs', args: (i) => [graphArg(i.graph), i.start] },
  bfs: { entry: 'Algorithm.bfs', args: (i) => [graphArg(i.graph), i.start] },
  dijkstra: { entry: 'Algorithm.dijkstra', args: (i) => [graphArg(i.graph), i.start], suffix: `
  private static <T> Comparator<Pair<Vertex<T>, Integer>> byDistance() {
    return (a, b) -> a.getSecond() - b.getSecond();
  }` },
  prim: { entry: 'Algorithm.prim', args: (i) => [graphArg(i.graph), i.start], suffix: `${WEIGHT}
  private static <T> Comparator<Edge<T, Integer>> byLabel() {
    return (a, b) -> a.getLabel() - b.getLabel();
  }` },
  queens: { entry: 'Algorithm.placeQueens', args: (i) => [0, Array(i.n).fill(-1)] },
  quickselect: { entry: 'Algorithm.quickSelection', args: (i) => [i.values, i.k, 0, i.values.length - 1], suffix: EXCHANGE },
  quicksort: { entry: 'Algorithm.quickSort', args: (i) => [i.values, 0, i.values.length - 1] },
  hanoi: { entry: 'Algorithm.hanoi', args: (i) => [i.n, 'A', 'B', 'C'] },
  fibonacci: { entry: 'Algorithm.fibonacciDynamic', args: (i) => [i.n] },
  knapsack: { entry: 'Algorithm.knapsack', args: (i) => { const items = parseItems(i.items).items; return [i.capacity, items.map((x) => x.name), items.map((x) => x.weight), items.map((x) => x.value)]; } },
  'bubble-sort': { entry: 'Algorithm.bubbleSort', args: (i) => [i.values], suffix: EXCHANGE },
  'insertion-sort': { entry: 'Algorithm.insertionSort', args: (i) => [i.values] },
  'selection-sort': { entry: 'Algorithm.selectionSort', args: (i) => [i.values], suffix: EXCHANGE },
  heap: {
    // The shown methods are BinaryMaxHeap's own: the class wraps them with its array and a
    // driver that inserts the values and removes the maximum `removes` times.
    prefix: `${UTIL} public class BinaryMaxHeap<T extends Comparable<T>> { private ArrayList<T> arrayHeap = new ArrayList<>(); `,
    suffix: `
  public BinaryMaxHeap() { arrayHeap.add(null); }
  public boolean isEmpty() { return arrayHeap.size() <= 1; }

  public static List<Integer> run(int[] values, int removes) {
    BinaryMaxHeap<Integer> heap = new BinaryMaxHeap<>();
    for (int v : values) heap.add(v);
    List<Integer> removed = new ArrayList<>();
    for (int k = 0; k < removes && !heap.isEmpty(); k++) removed.add(heap.removeMaxValue());
    return removed;
  }
}
class HeapEmptyException extends RuntimeException {}
`,
    noClose: true,
    entry: 'BinaryMaxHeap.run', args: (i) => [i.values, i.removes],
  },
  hashmap: {
    // The shown class is the whole HashMap; a driver class after it runs the operations.
    prefix: `${UTIL} import es.uvigo.esei.aed2.map.Map; `,
    suffix: `

class Driver {
  public static List<String> run(String[] ops, int capacity) {
    HashMap<String, String> map = new HashMap<>(capacity);
    List<String> results = new ArrayList<>();
    for (String op : ops) {
      String[] p = op.split(" ");
      if (p[0].equals("add")) map.add(p[1], p[2]);
      else if (p[0].equals("get")) results.add(String.valueOf(map.get(p[1])));
      else results.add(String.valueOf(map.remove(p[1])));
    }
    return results;
  }
}
`,
    noClose: true,
    entry: 'Driver.run', args: (i) => [parseOps(i.ops).ops.map((o) => [o.op, o.key, o.value].filter((x) => x !== undefined).join(' ')), i.capacity],
  },
};

// The runnable source of a built-in's Java version (its lines are the shown source's).
export function javaProgram(algo) {
  const v = JAVA_VERSIONS[algo.id];
  if (!v) return null;
  return `${v.prefix ?? header()}${algo.source}${v.suffix ?? ''}${v.noClose ? '' : close}`;
}
// The same, written out for editing: the imports and the class header on lines of their own.
export function javaProgramForEditing(algo) {
  const v = JAVA_VERSIONS[algo.id];
  if (!v) return null;
  const prefix = (v.prefix ?? header()).trim().replace(/;\s+/g, ';\n').replace(/\s*((public )?class [^{]+\{)\s*/, '\n\n$1\n');
  return `${prefix}\n${algo.source}${v.suffix ?? ''}${v.noClose ? '' : close}`;
}
