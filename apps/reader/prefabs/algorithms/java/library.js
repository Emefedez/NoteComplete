// Java subset library: the registry of library classes by fully qualified name, the packages
// that star imports open, and the simple names that resolve without an import.
//
// make(rt, args) builds an instance for `new X(args)`.

import { JList, JStack, JArrayDeque, JPriorityQueue, JMap, JSet, toArray } from './lib/util.js';
import {
  AedList, LinkedQueue, LinkedStack, Vertex, Edge, AdjacencyList, MapOfMap, CourseHashMap, Pair,
  LinkedBinaryTree, LinkedBinarySearchTree, LinkedTree, LinkedBinaryTreeNode, LinkedTreeNode, BinaryMaxHeap,
} from './lib/aed.js';
import { StringBuilder, Scanner, Random } from './lib/lang.js';
import { JArray } from './values.js';

const isColl = (x) => x !== null && x !== undefined && (x instanceof JArray || typeof x._items === 'function' || (x.cls && x.cls.name));
const listArgs = (rt, args) => (args.length && typeof args[0] !== 'number' && isColl(args[0]) ? toArray(rt, args[0]) : []);
const capArg = (args) => (args.length && typeof args[0] === 'number' ? args[0] : undefined);
const cmpArg = (args) => args.find((a) => a !== null && typeof a === 'object' && !isColl(a) && !(a instanceof JArray)) || null;

function checkCap(rt, args) {
  const c = capArg(args);
  if (c !== undefined && c < 0) rt.throwJava('IllegalArgumentException', 'Illegal Capacity: ' + c);
}

export const LIB_CLASSES = {
  'java.util.ArrayList': { make: (rt, a) => { checkCap(rt, a); return new JList(rt, 'ArrayList', listArgs(rt, a)); } },
  'java.util.LinkedList': { make: (rt, a) => new JList(rt, 'LinkedList', listArgs(rt, a)) },
  'java.util.Vector': { make: (rt, a) => new JList(rt, 'Vector', listArgs(rt, a)) },
  'java.util.Stack': { make: (rt) => new JStack(rt) },
  'java.util.ArrayDeque': { make: (rt, a) => new JArrayDeque(rt, listArgs(rt, a)) },
  'java.util.PriorityQueue': {
    make: (rt, a) => {
      if (a.length && isColl(a[0]) && !(a[0] && a[0].cls)) {
        const src = a[0];
        return new JPriorityQueue(rt, src instanceof JPriorityQueue ? src.cmp : null, toArray(rt, src));
      }
      const c = capArg(a);
      if (c !== undefined && c < 1) rt.throwJava('IllegalArgumentException', null);
      return new JPriorityQueue(rt, cmpArg(a));
    },
  },
  'java.util.HashMap': { make: (rt, a) => mapFrom(rt, 'hash', a) },
  'java.util.LinkedHashMap': { make: (rt, a) => mapFrom(rt, 'linked', a) },
  'java.util.TreeMap': { make: (rt, a) => (a.length && a[0] instanceof JMap ? mapFrom(rt, 'tree', a) : new JMap(rt, 'tree', { cmp: cmpArg(a) })) },
  'java.util.Hashtable': { make: (rt, a) => mapFrom(rt, 'hash', a) },
  'java.util.HashSet': { make: (rt, a) => setFrom(rt, 'hash', a) },
  'java.util.LinkedHashSet': { make: (rt, a) => setFrom(rt, 'linked', a) },
  'java.util.TreeSet': {
    make: (rt, a) => {
      if (a.length && isColl(a[0]) && !(a[0] && a[0].cls)) { const s = new JSet(rt, 'tree'); s.addAll(a[0]); return s; }
      return new JSet(rt, 'tree', { cmp: cmpArg(a) });
    },
  },
  'java.util.Scanner': { make: (rt, a) => new Scanner(rt, a[0]) },
  'java.util.Random': { make: (rt, a) => new Random(rt, a[0]) },
  'java.lang.StringBuilder': { make: (rt, a) => new StringBuilder(rt, a[0]) },
  'java.lang.StringBuffer': { make: (rt, a) => new StringBuilder(rt, a[0]) },
  // the course's TADs
  'es.uvigo.esei.aed1.tads.list.LinkedList': { make: (rt) => new AedList(rt) },
  'es.uvigo.esei.aed1.tads.queue.LinkedQueue': { make: (rt) => new LinkedQueue(rt) },
  'es.uvigo.esei.aed1.tads.stack.LinkedStack': { make: (rt) => new LinkedStack(rt) },
  'es.uvigo.esei.aed2.graph.Vertex': { make: (rt, a) => new Vertex(rt, a[0]) },
  'es.uvigo.esei.aed2.graph.Edge': { make: (rt, a) => new Edge(rt, a[0], a[1], a[2]) },
  'es.uvigo.esei.aed2.graph.AdjacencyList': { make: (rt) => new AdjacencyList(rt) },
  'es.uvigo.esei.aed2.activity6.mapofmap.MapOfMap': { make: (rt) => new MapOfMap(rt) },
  'es.uvigo.esei.aed2.map.HashMap': { make: (rt) => new CourseHashMap(rt) },
  'es.uvigo.esei.aed2.tree.binary.LinkedBinaryTree': { make: (rt, a) => new LinkedBinaryTree(rt, ...a) },
  'es.uvigo.esei.aed2.tree.binary.LinkedBinaryTreeNode': { make: (rt, a) => new LinkedBinaryTreeNode(rt, ...a) },
  'es.uvigo.esei.aed2.tree.binary.search.LinkedBinarySearchTree': { make: (rt) => new LinkedBinarySearchTree(rt) },
  'es.uvigo.esei.aed2.tree.nary.LinkedTree': { make: (rt, a) => new LinkedTree(rt, ...a) },
  'es.uvigo.esei.aed2.tree.nary.LinkedTreeNode': { make: (rt, a) => new LinkedTreeNode(rt, ...a) },
  'es.uvigo.esei.aed2.tree.binary.heap.BinaryMaxHeap': { make: (rt) => new BinaryMaxHeap(rt) },
  'es.uvigo.esei.aed2.util.Pair': { make: (rt, a) => new Pair(rt, a[0], a[1]) },
};

function mapFrom(rt, mode, a) {
  checkCap(rt, a);
  if (a.length && a[0] instanceof JMap) { const m = new JMap(rt, mode, { cmp: mode === 'tree' ? a[0].cmp : null, cap: Math.max(16, Math.ceil(a[0].count / 0.75) + 1) }); m.putAll(a[0]); return m; }
  return new JMap(rt, mode, { cap: capArg(a) });
}
function setFrom(rt, mode, a) {
  checkCap(rt, a);
  if (a.length && typeof a[0] !== 'number' && isColl(a[0])) return JSet.fromItems(rt, toArray(rt, a[0]), mode);
  return new JSet(rt, mode, { cap: capArg(a) });
}

// interfaces and other names that exist only as types (erased), by fully qualified name
const TYPE_ONLY = [
  'java.util.List', 'java.util.Map', 'java.util.Set', 'java.util.Queue', 'java.util.Deque', 'java.util.Collection',
  'java.util.Iterator', 'java.util.Comparator', 'java.util.SortedMap', 'java.util.SortedSet', 'java.util.NavigableMap',
  'java.util.NavigableSet', 'java.util.Map.Entry', 'java.util.Objects', 'java.util.Arrays', 'java.util.Collections',
  'java.util.function.Function', 'java.util.function.BiFunction', 'java.util.function.Consumer', 'java.util.function.BiConsumer',
  'java.util.function.Supplier', 'java.util.function.Predicate', 'java.util.function.BiPredicate', 'java.util.function.UnaryOperator',
  'java.util.function.BinaryOperator', 'java.util.function.IntBinaryOperator', 'java.util.function.ToIntFunction',
  'es.uvigo.esei.aed1.tads.list.List', 'es.uvigo.esei.aed1.tads.list.IteratorList', 'es.uvigo.esei.aed1.tads.queue.Queue',
  'es.uvigo.esei.aed1.tads.stack.Stack', 'es.uvigo.esei.aed2.graph.Graph', 'es.uvigo.esei.aed2.map.Map',
  'es.uvigo.esei.aed2.tree.binary.BinaryTree', 'es.uvigo.esei.aed2.tree.nary.Tree', 'es.uvigo.esei.aed2.heap.MaxHeap',
  'es.uvigo.esei.aed2.tree.binary.search.BinarySearchTree',
];
export const ALL_LIB_NAMES = new Set([...Object.keys(LIB_CLASSES), ...TYPE_ONLY]);

// what a simple name means when nothing imports it (java.lang, then the course's defaults)
export const DEFAULT_NAMES = {
  StringBuilder: 'java.lang.StringBuilder', StringBuffer: 'java.lang.StringBuffer',
  ArrayList: 'java.util.ArrayList', LinkedList: 'java.util.LinkedList', Vector: 'java.util.Vector',
  Stack: 'java.util.Stack', ArrayDeque: 'java.util.ArrayDeque', PriorityQueue: 'java.util.PriorityQueue',
  LinkedHashMap: 'java.util.LinkedHashMap', TreeMap: 'java.util.TreeMap', Hashtable: 'java.util.Hashtable',
  HashSet: 'java.util.HashSet', LinkedHashSet: 'java.util.LinkedHashSet', TreeSet: 'java.util.TreeSet',
  Scanner: 'java.util.Scanner', Random: 'java.util.Random',
  // the course's TADs: Map/HashMap are the course's (add/get/remove/getKeys/getValues)
  HashMap: 'es.uvigo.esei.aed2.map.HashMap',
  LinkedQueue: 'es.uvigo.esei.aed1.tads.queue.LinkedQueue', LinkedStack: 'es.uvigo.esei.aed1.tads.stack.LinkedStack',
  Vertex: 'es.uvigo.esei.aed2.graph.Vertex', Edge: 'es.uvigo.esei.aed2.graph.Edge',
  AdjacencyList: 'es.uvigo.esei.aed2.graph.AdjacencyList', MapOfMap: 'es.uvigo.esei.aed2.activity6.mapofmap.MapOfMap',
  LinkedBinaryTree: 'es.uvigo.esei.aed2.tree.binary.LinkedBinaryTree',
  LinkedBinaryTreeNode: 'es.uvigo.esei.aed2.tree.binary.LinkedBinaryTreeNode',
  LinkedBinarySearchTree: 'es.uvigo.esei.aed2.tree.binary.search.LinkedBinarySearchTree',
  LinkedTree: 'es.uvigo.esei.aed2.tree.nary.LinkedTree', LinkedTreeNode: 'es.uvigo.esei.aed2.tree.nary.LinkedTreeNode',
  BinaryMaxHeap: 'es.uvigo.esei.aed2.tree.binary.heap.BinaryMaxHeap', Pair: 'es.uvigo.esei.aed2.util.Pair',
};

// static holders (Math, Integer, …) are always visible
export const STATIC_HOLDERS = new Set(['Math', 'StrictMath', 'Integer', 'Long', 'Double', 'Float', 'Short', 'Byte', 'Character',
  'Boolean', 'String', 'Objects', 'System', 'Thread', 'Arrays', 'Collections', 'List', 'Set', 'Map', 'Comparator', 'Object']);

export function packageOf(full) { return full.slice(0, full.lastIndexOf('.')); }
export function simpleOf(full) { return full.slice(full.lastIndexOf('.') + 1); }
