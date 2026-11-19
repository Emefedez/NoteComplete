// Java subset library: the course's TADs (es.uvigo.esei.aed1.tads.* and es.uvigo.esei.aed2.*),
// following the owner's replicas in "Taller de TADs AED2" and "Taller de Mapas y Grafos" and the
// published jars (tads 1.0.12 and 2.2.0): same method names, same exceptions, and the same
// iteration order (getVertices()/getAdjacentsVertex() build java.util.HashSets, the course's
// HashMap keeps 50 buckets of pairs indexed by Math.abs(hashCode % 50)).

import { LibObject, JIterator, listString } from './base.js';
import { JSet, JList } from './util.js';

// ── aed1: List (LinkedList), Queue (LinkedQueue), Stack (LinkedStack) ──
export class AedList extends LibObject {
  constructor(rt) { super(rt); this.a = []; this.modCount = 0; }
  get _jname() { return 'LinkedList'; }
  get _pkg() { return 'es.uvigo.esei.aed1.tads.list'; }
  get _types() { return ['LinkedList', 'List', 'Iterable', 'Object']; }
  _items() { return this.a.slice(); }
  _kind() { return 'array'; }
  _snap() { return { items: this.a.map((x) => this.rt.item(x)) }; }
  _nn(x) { if (x === null || x === undefined) this.rt.throwJava('NullPointerException', null); }
  _ne() { if (!this.a.length) this.rt.throwJava('EmptyException', 'la lista está vacía'); }
  _idx(i, n) { if (i < 0 || i >= n) this.rt.throwJava('IndexOutOfBoundsException', 'Index ' + i + ' out of bounds for length ' + n); }
  isEmpty() { return this.a.length === 0; }
  size() { return this.a.length; }
  contains(x) { this._nn(x); return this.a.some((y) => this.rt.equals(x, y)); }
  getFirst() { this._ne(); return this.a[0]; }
  getLast() { this._ne(); return this.a[this.a.length - 1]; }
  get(i) { this._idx(i, this.a.length); return this.a[i]; }
  set(i, v) { this._idx(i, this.a.length); this._nn(v); const o = this.a[i]; this.a[i] = v; this._mut('set', [i], this.rt.item(o), this.rt.item(v)); return o; }
  addFirst(x) { this._nn(x); this.modCount++; this.a.unshift(x); this._mut('add', [0], null, this.rt.item(x)); }
  addLast(x) { this._nn(x); this.modCount++; this.a.push(x); this._mut('add', [this.a.length - 1], null, this.rt.item(x)); }
  add(i, x) { if (i < 0 || i > this.a.length) this._idx(i, this.a.length); this._nn(x); this.modCount++; this.a.splice(i, 0, x); this._mut('add', [i], null, this.rt.item(x)); }
  removeFirst() { this._ne(); this.modCount++; const x = this.a.shift(); this._mut('remove', [0], this.rt.item(x), null); return x; }
  removeLast() { this._ne(); this.modCount++; const x = this.a.pop(); this._mut('remove', [this.a.length], this.rt.item(x), null); return x; }
  removeValue(x) {
    this._nn(x);
    const i = this.a.findIndex((y) => this.rt.equals(x, y));
    if (i < 0) return false;
    this.modCount++;
    this.a.splice(i, 1);
    this._mut('remove', [i], this.rt.item(x), null);
    return true;
  }
  remove(i) { this._idx(i, this.a.length); this.modCount++; const x = this.a.splice(i, 1)[0]; this._mut('remove', [i], this.rt.item(x), null); return x; }
  clear() { this.modCount++; this.a.length = 0; this._mut('clear', [], null, null); }
  iterator() { return new JIterator(this.rt, this.a, { owner: this, onRemove: (x, i) => { this.modCount++; this.a.splice(i, 1); } }); }
  iteratorList() { return this.iterator(); }
  forEach(f) { for (const x of this.a.slice()) this.rt.callFn(f, 'accept', [x]); }
  equals(o) { return o instanceof AedList && o.a.length === this.a.length && this.a.every((x, i) => this.rt.equals(x, o.a[i])); }
  toString() { return listString(this.rt, this.a); }
}

export class LinkedQueue extends LibObject {
  constructor(rt) { super(rt); this.a = []; }
  get _jname() { return 'LinkedQueue'; }
  get _pkg() { return 'es.uvigo.esei.aed1.tads.queue'; }
  get _types() { return ['LinkedQueue', 'Queue', 'Object']; }
  _items() { return this.a.slice(); }
  _kind() { return 'queue'; }
  _snap() { return { items: this.a.map((x) => this.rt.item(x)) }; }
  isEmpty() { return this.a.length === 0; }
  size() { return this.a.length; }
  first() { if (!this.a.length) this.rt.throwJava('EmptyException', 'la cola está vacía'); return this.a[0]; }
  add(x) { if (x === null || x === undefined) this.rt.throwJava('NullPointerException', null); this.a.push(x); this._mut('add', [this.a.length - 1], null, this.rt.item(x)); }
  remove() { if (!this.a.length) this.rt.throwJava('EmptyException', 'la cola está vacía'); const x = this.a.shift(); this._mut('remove', [0], this.rt.item(x), null); return x; }
  clear() { this.a.length = 0; this._mut('clear', [], null, null); }
  toString() { return listString(this.rt, this.a); }
}

export class LinkedStack extends LibObject {
  constructor(rt) { super(rt); this.a = []; }
  get _jname() { return 'LinkedStack'; }
  get _pkg() { return 'es.uvigo.esei.aed1.tads.stack'; }
  get _types() { return ['LinkedStack', 'Stack', 'Object']; }
  _items() { return this.a.slice().reverse(); }
  _kind() { return 'stack'; }
  _snap() { return { items: this.a.map((x) => this.rt.item(x)) }; }
  isEmpty() { return this.a.length === 0; }
  size() { return this.a.length; }
  top() { if (!this.a.length) this.rt.throwJava('EmptyException', 'la pila está vacía'); return this.a[this.a.length - 1]; }
  push(x) { if (x === null || x === undefined) this.rt.throwJava('NullPointerException', null); this.a.push(x); this._mut('add', [this.a.length - 1], null, this.rt.item(x)); }
  pop() { if (!this.a.length) this.rt.throwJava('EmptyException', 'la pila está vacía'); const x = this.a.pop(); this._mut('remove', [this.a.length], this.rt.item(x), null); return x; }
  clear() { this.a.length = 0; this._mut('clear', [], null, null); }
  toString() { return listString(this.rt, this.a.slice().reverse()); }
}

// ── aed2: graphs ──────────────────────────────────────────────────
export class Vertex extends LibObject {
  constructor(rt, value) {
    super(rt);
    if (value === null || value === undefined) rt.throwJava('NullPointerException', 'value cannot be null');
    this.value = value;
  }
  get _jname() { return 'Vertex'; }
  get _pkg() { return 'es.uvigo.esei.aed2.graph'; }
  get _types() { return ['Vertex', 'Object']; }
  getValue() { return this.value; }
  equals(o) { return o instanceof Vertex && this.rt.equals(this.value, o.value); }
  hashCode() { return this.rt.hash(this.value); }
  toString() { return ' ' + this.rt.str(this.value); } // the jar's Vertex prints " " + value
}

export class Edge extends LibObject {
  constructor(rt, source, target, label) {
    super(rt);
    if (source === null || source === undefined) rt.throwJava('NullPointerException', 'Source vertex cannot be null');
    if (target === null || target === undefined) rt.throwJava('NullPointerException', 'Target vertex cannot be null');
    this.source = source; this.target = target; this.label = label;
  }
  get _jname() { return 'Edge'; }
  get _pkg() { return 'es.uvigo.esei.aed2.graph'; }
  get _types() { return ['Edge', 'Object']; }
  getSource() { return this.source; }
  getTarget() { return this.target; }
  getLabel() { return this.label; }
  equals(o) { return o instanceof Edge && this.rt.equals(this.source, o.source) && this.rt.equals(this.target, o.target) && this.rt.equals(this.label, o.label); }
  hashCode() { let h = 1; for (const x of [this.source, this.target, this.label]) h = (Math.imul(31, h) + this.rt.hash(x)) | 0; return h; }
  toString() { return this.rt.str(this.source) + '-' + this.rt.str(this.target) + ': ' + this.rt.str(this.label); }
}

// Graph<T,E> as the course's AdjacencyList: a list of sources, each with a list of
// (target, label). One edge per ordered pair of vertices.
export class AdjacencyList extends LibObject {
  constructor(rt) { super(rt); this.list = []; }
  get _jname() { return 'AdjacencyList'; }
  get _pkg() { return 'es.uvigo.esei.aed2.graph'; }
  get _types() { return ['AdjacencyList', 'Graph', 'Object']; }
  _kind() { return 'graph'; }
  _snap() {
    const rt = this.rt;
    return {
      nodes: this.list.map((s) => ({ id: rt.item(s.v), label: rt.item(s.v) })),
      edges: this.list.flatMap((s) => s.adj.map((a) => ({ from: rt.item(s.v), to: rt.item(a.t), w: rt.item(a.l), directed: true }))),
    };
  }
  _nn(v, msg = 'vertex cannot be null') { if (v === null || v === undefined) this.rt.throwJava('NullPointerException', msg); }
  _src(v) { return this.list.find((s) => this.rt.equals(s.v, v)) || null; }
  isEmpty() { return this.list.length === 0; }
  numberOfVertices() { return this.list.length; }
  containsVertex(v) { return !!this._src(v); }
  containsEdge(s, t, l) {
    const src = this._src(s);
    if (!src) return false;
    return src.adj.some((a) => this.rt.equals(a.t, t) && (a.l === null ? this.rt.throwJava('NullPointerException', null) : this.rt.equals(a.l, l)));
  }
  getVertices() { return JSet.fromItems(this.rt, this.list.map((s) => s.v), 'hash', { cap: 16 }); }
  getEdges() {
    const items = [];
    for (const s of this.list) for (const a of s.adj) items.push(new Edge(this.rt, s.v, a.t, a.l));
    return JSet.fromItems(this.rt, items, 'hash', { cap: 16 });
  }
  getAdjacentsVertex(v) {
    this._nn(v);
    const src = this._src(v);
    return JSet.fromItems(this.rt, src ? src.adj.map((a) => a.t) : [], 'hash', { cap: 16 });
  }
  addVertex(v) {
    this._nn(v);
    if (this.containsVertex(v)) return false;
    this.list.push({ v, adj: [] });
    this._mut('add', [this.rt.item(v)], null, this.rt.item(v));
    return true;
  }
  addEdge(s, t, l) {
    if (s === null || s === undefined || t === null || t === undefined) this.rt.throwJava('NullPointerException', 'vertex cannot be null');
    if (!this.containsVertex(s) || !this.containsVertex(t)) this.rt.throwJava('IllegalArgumentException', 'some vertex is missing');
    const src = this._src(s);
    if (src.adj.some((a) => this.rt.equals(a.t, t))) return false;
    src.adj.push({ t, l });
    this._mut('add', [this.rt.item(s), this.rt.item(t)], null, this.rt.item(l));
    return true;
  }
  removeVertex(v) {
    this._nn(v);
    const src = this._src(v);
    if (!src) return false;
    this.list.splice(this.list.indexOf(src), 1);
    for (const s of this.list) s.adj = s.adj.filter((a) => !this.rt.equals(a.t, v));
    this._mut('remove', [this.rt.item(v)], this.rt.item(v), null);
    return true;
  }
  removeEdge(s, t, l) {
    if (s === null || s === undefined || t === null || t === undefined) this.rt.throwJava('NullPointerException', 'vertex cannot be null');
    const src = this._src(s);
    if (!src) return false;
    const i = src.adj.findIndex((a) => this.rt.equals(a.t, t) && this.rt.equals(a.l, l));
    if (i < 0) return false;
    src.adj.splice(i, 1);
    this._mut('remove', [this.rt.item(s), this.rt.item(t)], this.rt.item(l), null);
    return true;
  }
  clear() { this.list = []; this._mut('clear', [], null, null); }
  forEachVertex(f) { for (const s of this.list.slice()) this.rt.callFn(f, 'accept', [s.v]); }
  forEachEdge(f) { for (const s of this.list.slice()) for (const a of s.adj.slice()) this.rt.callFn(f, 'accept', [new Edge(this.rt, s.v, a.t, a.l)]); }
  _show() { return '{' + this.list.map((s) => this.rt.str(s.v) + '=[' + s.adj.map((a) => this.rt.str(a.t) + (a.l === null ? '' : '(' + this.rt.str(a.l) + ')')).join(', ') + ']').join(', ') + '}'; }
}

// MapOfMap: Map<Vertex, Map<Vertex, E>> with the course's HashMap (activity 6 exercise)
export class MapOfMap extends AdjacencyList {
  constructor(rt) { super(rt); this.mapOfVertices = new CourseHashMap(rt); }
  get _jname() { return 'MapOfMap'; }
  get _pkg() { return 'es.uvigo.esei.aed2.activity6.mapofmap'; }
  get _types() { return ['MapOfMap', 'Graph', 'Object']; }
  // keep the AdjacencyList list for snapshots, but iterate like a map of maps
  getVertices() { return this.mapOfVertices.getKeys(); }
  getAdjacentsVertex(v) { this._nn(v); const m = this.mapOfVertices.get(v); return m ? m.getKeys() : JSet.fromItems(this.rt, [], 'hash'); }
  addVertex(v) {
    if (!super.addVertex(v)) return false;
    this.mapOfVertices.add(v, new CourseHashMap(this.rt));
    return true;
  }
  addEdge(s, t, l) {
    if (!super.addEdge(s, t, l)) return false;
    this.mapOfVertices.get(s).add(t, l);
    return true;
  }
  removeVertex(v) {
    if (!super.removeVertex(v)) return false;
    this.mapOfVertices.remove(v);
    this.mapOfVertices.forEach((k, m) => m.remove(v), true);
    return true;
  }
  removeEdge(s, t, l) {
    if (!super.removeEdge(s, t, l)) return false;
    this.mapOfVertices.get(s).remove(t);
    return true;
  }
  clear() { super.clear(); this.mapOfVertices.clear(); }
}

// ── aed2: Map<K,V> and its HashMap (50 buckets of pairs) ──────────
export class CoursePair extends LibObject {
  constructor(rt, k, v) { super(rt); this.k = k; this.v = v; }
  get _jname() { return 'HashMap.Pair'; }
  getKey() { return this.k; }
  getValue() { return this.v; }
  setValue(v) { this.v = v; }
  equals(o) { return o instanceof CoursePair && this.rt.equals(this.k, o.k) && this.rt.equals(this.v, o.v); }
  hashCode() { return this.rt.hash(this.k) ^ this.rt.hash(this.v); }
}

export class CourseHashMap extends LibObject {
  constructor(rt) { super(rt); this.buckets = Array.from({ length: 50 }, () => []); this.count = 0; }
  get _jname() { return 'HashMap'; }
  get _pkg() { return 'es.uvigo.esei.aed2.map'; }
  get _types() { return ['HashMap', 'Map', 'Object']; }
  _kind() { return 'map'; }
  _entries() { return this.buckets.flat(); }
  _snap() { return { entries: this._entries().map((p) => ({ k: this.rt.item(p.k), v: this.rt.item(p.v) })) }; }
  _index(k) { return Math.abs((this.rt.hash(k) % 50) | 0); }
  size() { return this.count; }
  get(k) {
    if (k === null || k === undefined) return null;
    for (const p of this.buckets[this._index(k)]) if (this.rt.equals(p.k, k)) return p.v;
    return null;
  }
  add(k, v) {
    if (k === null || k === undefined) this.rt.throwJava('NullPointerException', null);
    const b = this.buckets[this._index(k)];
    for (const p of b) if (this.rt.equals(p.k, k)) { const o = p.v; p.v = v; this._mut('set', [this.rt.item(k)], this.rt.item(o), this.rt.item(v)); return; }
    b.push(new CoursePair(this.rt, k, v));
    this.count++;
    this._mut('add', [this.rt.item(k)], null, this.rt.item(v));
  }
  remove(k) {
    if (k === null || k === undefined) return null;
    const b = this.buckets[this._index(k)];
    for (let i = 0; i < b.length; i++) {
      if (this.rt.equals(b[i].k, k)) {
        const v = b[i].v;
        b.splice(i, 1);
        this.count--;
        this._mut('remove', [this.rt.item(k)], this.rt.item(v), null);
        return v;
      }
    }
    return null;
  }
  getKeys() { return JSet.fromItems(this.rt, this._entries().map((p) => p.k), 'hash', { cap: 16 }); }
  getValues() { return new JIterator(this.rt, this._entries().map((p) => p.v)); }
  clear() { for (const b of this.buckets) b.length = 0; this.count = 0; this._mut('clear', [], null, null); }
  forEach(f, js) { for (const p of this._entries()) { if (js) f(p.k, p.v); else this.rt.callFn(f, 'accept', [p.k, p.v]); } }
  _show() { return '{' + this._entries().map((p) => this.rt.str(p.k) + '=' + this.rt.str(p.v)).join(', ') + '}'; }
}

// Pair as in the owner's simulators (value1/value2, also first/second and key/value)
export class Pair extends LibObject {
  constructor(rt, a, b) { super(rt); this.value1 = a; this.value2 = b; }
  get _jname() { return 'Pair'; }
  get _types() { return ['Pair', 'Object']; }
  getValue1() { return this.value1; }
  getValue2() { return this.value2; }
  setValue1(v) { this.value1 = v; }
  setValue2(v) { this.value2 = v; }
  getFirst() { return this.value1; }
  getSecond() { return this.value2; }
  getKey() { return this.value1; }
  getValue() { return this.value2; }
  setValue(v) { this.value2 = v; }
  equals(o) { return o instanceof Pair && this.rt.equals(this.value1, o.value1) && this.rt.equals(this.value2, o.value2); }
  hashCode() { return (Math.imul(31, this.rt.hash(this.value1)) + this.rt.hash(this.value2)) | 0; }
  toString() { return '(' + this.rt.str(this.value1) + ',' + this.rt.str(this.value2) + ')'; }
}

// ── aed2: trees ───────────────────────────────────────────────────
export class LinkedBinaryTreeNode extends LibObject {
  constructor(rt, value = null, left = null, right = null) { super(rt); this.value = value; this.leftNode = left; this.rightNode = right; }
  get _jname() { return 'LinkedBinaryTreeNode'; }
  get _pkg() { return 'es.uvigo.esei.aed2.tree.binary'; }
  get _types() { return ['LinkedBinaryTreeNode', 'Object']; }
  getValue() { return this.value; }
  setValue(v) { this.value = v; }
  hasLeftNode() { return this.leftNode !== null; }
  getLeftNode() { return this.leftNode; }
  setLeftNode(n) { this.leftNode = n; }
  hasRightNode() { return this.rightNode !== null; }
  getRightNode() { return this.rightNode; }
  setRightNode(n) { this.rightNode = n; }
}
const copyB = (rt, n) => (n === null ? null : new LinkedBinaryTreeNode(rt, n.value, copyB(rt, n.leftNode), copyB(rt, n.rightNode)));

function showB(rt, n) {
  if (n === null) return '∅';
  const v = rt.str(n.value);
  if (!n.leftNode && !n.rightNode) return v;
  return v + '(' + (n.leftNode ? showB(rt, n.leftNode) : '') + ',' + (n.rightNode ? showB(rt, n.rightNode) : '') + ')';
}
function snapB(rt, n, id = 'r') {
  if (n === null) return null;
  return { id, label: rt.item(n.value), left: snapB(rt, n.leftNode, id + 'L'), right: snapB(rt, n.rightNode, id + 'R') };
}

export class LinkedBinaryTree extends LibObject {
  constructor(rt, ...a) {
    super(rt);
    this.rootNode = null;
    if (a.length === 0) return;
    if (a.length === 1 && a[0] instanceof LinkedBinaryTreeNode) { this.rootNode = a[0]; return; }
    if (a[0] === null || a[0] === undefined) rt.throwJava('NullPointerException', 'value cannot be null');
    if (a.length === 1) { this.rootNode = new LinkedBinaryTreeNode(rt, a[0]); return; }
    if (a[1] === null || a[2] === null) rt.throwJava('NullPointerException', 'children cannot be null');
    this.rootNode = new LinkedBinaryTreeNode(rt, a[0], copyB(rt, a[1].rootNode), copyB(rt, a[2].rootNode));
  }
  get _jname() { return 'LinkedBinaryTree'; }
  get _pkg() { return 'es.uvigo.esei.aed2.tree.binary'; }
  get _types() { return ['LinkedBinaryTree', 'BinaryTree', 'Object']; }
  _kind() { return 'binarytree'; }
  _snap() { return { root: snapB(this.rt, this.rootNode) }; }
  _wrap(n) { const t = new this.constructor(this.rt); t.rootNode = n; return t; }
  _ne() { if (this.rootNode === null) this.rt.throwJava('EmptyTreeException', 'the tree is empty'); }
  getRootValue() { this._ne(); return this.rootNode.value; }
  setRootValue(v) { this._ne(); if (v === null) this.rt.throwJava('NullPointerException', null); const o = this.rootNode.value; this.rootNode.value = v; this._mut('set', ['r'], this.rt.item(o), this.rt.item(v)); }
  contains(v) { const go = (n) => n !== null && (this.rt.equals(n.value, v) || go(n.leftNode) || go(n.rightNode)); return go(this.rootNode); }
  hasLeftChild() { return this.rootNode !== null && this.rootNode.leftNode !== null; }
  getLeftChild() { this._ne(); return this._wrap(this.rootNode.leftNode); }
  setLeftChild(t) { this._ne(); if (t === null) this.rt.throwJava('NullPointerException', null); this.rootNode.leftNode = copyB(this.rt, t.rootNode); this._mut('set', ['rL'], null, null); }
  removeLeftChild() { this._ne(); this.rootNode.leftNode = null; this._mut('remove', ['rL'], null, null); }
  hasRightChild() { return this.rootNode !== null && this.rootNode.rightNode !== null; }
  getRightChild() { this._ne(); return this._wrap(this.rootNode.rightNode); }
  setRightChild(t) { this._ne(); if (t === null) this.rt.throwJava('NullPointerException', null); this.rootNode.rightNode = copyB(this.rt, t.rootNode); this._mut('set', ['rR'], null, null); }
  removeRightChild() { this._ne(); this.rootNode.rightNode = null; this._mut('remove', ['rR'], null, null); }
  clear() { this.rootNode = null; this._mut('clear', [], null, null); }
  isEmpty() { return this.rootNode === null; }
  _each(order, f) {
    const call = (v) => this.rt.callFn(f, 'accept', [v]);
    const go = (n) => {
      if (!n) return;
      if (order === 'pre') call(n.value);
      go(n.leftNode);
      if (order === 'in') call(n.value);
      go(n.rightNode);
      if (order === 'post') call(n.value);
    };
    if (order === 'level') {
      const q = this.rootNode ? [this.rootNode] : [];
      while (q.length) { const n = q.shift(); call(n.value); if (n.leftNode) q.push(n.leftNode); if (n.rightNode) q.push(n.rightNode); }
    } else go(this.rootNode);
  }
  forEachPreOrder(f) { this._each('pre', f); }
  forEachInOrder(f) { this._each('in', f); }
  forEachPostOrder(f) { this._each('post', f); }
  forEachLevelOrder(f) { this._each('level', f); }
  equals(o) { return o instanceof LinkedBinaryTree && showB(this.rt, this.rootNode) === showB(this.rt, o.rootNode); }
  toString() { return showB(this.rt, this.rootNode); }
}

export class LinkedBinarySearchTree extends LinkedBinaryTree {
  constructor(rt) { super(rt); }
  get _jname() { return 'LinkedBinarySearchTree'; }
  get _pkg() { return 'es.uvigo.esei.aed2.tree.binary.search'; }
  get _types() { return ['LinkedBinarySearchTree', 'BinarySearchTree', 'Object']; }
  insert(v) {
    if (v === null || v === undefined) this.rt.throwJava('NullPointerException', null);
    if (!this.rootNode) { this.rootNode = new LinkedBinaryTreeNode(this.rt, v); this._mut('add', ['r'], null, this.rt.item(v)); return; }
    let n = this.rootNode;
    for (;;) {
      const c = this.rt.compare(v, n.value);
      if (c === 0) return;
      if (c < 0) { if (!n.leftNode) { n.leftNode = new LinkedBinaryTreeNode(this.rt, v); break; } n = n.leftNode; }
      else { if (!n.rightNode) { n.rightNode = new LinkedBinaryTreeNode(this.rt, v); break; } n = n.rightNode; }
    }
    this._mut('add', [], null, this.rt.item(v));
  }
  remove(v) {
    const rt = this.rt;
    const rm = (n, x) => {
      if (!n) return null;
      const c = rt.compare(x, n.value);
      if (c < 0) { n.leftNode = rm(n.leftNode, x); return n; }
      if (c > 0) { n.rightNode = rm(n.rightNode, x); return n; }
      if (!n.leftNode) return n.rightNode;
      if (!n.rightNode) return n.leftNode;
      let m = n.rightNode; while (m.leftNode) m = m.leftNode;
      n.value = m.value; n.rightNode = rm(n.rightNode, m.value); return n;
    };
    this.rootNode = rm(this.rootNode, v);
    this._mut('remove', [], rt.item(v), null);
  }
}

export class LinkedTreeNode extends LibObject {
  constructor(rt, value = null, leftChild = null, rightSibling = null) { super(rt); this.value = value; this.leftChild = leftChild; this.rightSibling = rightSibling; }
  get _jname() { return 'LinkedTreeNode'; }
  get _pkg() { return 'es.uvigo.esei.aed2.tree.nary'; }
  getValue() { return this.value; }
  setValue(v) { this.value = v; }
  hasLeftChild() { return this.leftChild !== null; }
  getLeftChild() { return this.leftChild; }
  setLeftChild(n) { this.leftChild = n; }
  hasRightSibling() { return this.rightSibling !== null; }
  getRightSibling() { return this.rightSibling; }
  setRightSibling(n) { this.rightSibling = n; }
}
const copyChain = (rt, n) => (n === null ? null : new LinkedTreeNode(rt, n.value, copyChain(rt, n.leftChild), copyChain(rt, n.rightSibling)));
const copyT = (rt, n) => (n === null ? null : new LinkedTreeNode(rt, n.value, copyChain(rt, n.leftChild), null));
function kids(n) { const k = []; for (let c = n.leftChild; c; c = c.rightSibling) k.push(c); return k; }
function showT(rt, n) {
  if (n === null) return '∅';
  const k = kids(n).map((c) => showT(rt, c));
  return rt.str(n.value) + (k.length ? '(' + k.join(',') + ')' : '');
}
function snapT(rt, n, id = 'r') {
  if (n === null) return null;
  return { id, label: rt.item(n.value), children: kids(n).map((c, i) => snapT(rt, c, id + '.' + i)) };
}

export class LinkedTree extends LibObject {
  constructor(rt, ...a) {
    super(rt);
    this.rootNode = null;
    if (a.length === 0) return;
    if (a.length === 1 && a[0] instanceof LinkedTreeNode) { this.rootNode = a[0]; return; }
    if (a[0] === null || a[0] === undefined) rt.throwJava('NullPointerException', 'value cannot be null');
    this.rootNode = new LinkedTreeNode(rt, a[0]);
    let last = null;
    const children = a.length === 2 && a[1] && a[1].a && Array.isArray(a[1].a) && a[1].t ? a[1].a : a.slice(1); // varargs array
    for (const c of children) {
      if (c === null || c === undefined) rt.throwJava('NullPointerException', null);
      if (c.rootNode === null) continue;
      const cp = copyT(rt, c.rootNode);
      if (last) last.rightSibling = cp; else this.rootNode.leftChild = cp;
      last = cp;
    }
  }
  get _jname() { return 'LinkedTree'; }
  get _pkg() { return 'es.uvigo.esei.aed2.tree.nary'; }
  get _types() { return ['LinkedTree', 'Tree', 'Object']; }
  _kind() { return 'tree'; }
  _snap() { return { root: snapT(this.rt, this.rootNode) }; }
  _wrap(n) { const t = new LinkedTree(this.rt); t.rootNode = n; return t; }
  _ne() { if (this.rootNode === null) this.rt.throwJava('EmptyTreeException', 'the tree is empty'); }
  getRootValue() { this._ne(); return this.rootNode.value; }
  setRootValue(v) { this._ne(); if (v === null) this.rt.throwJava('NullPointerException', null); this.rootNode.value = v; this._mut('set', ['r'], null, this.rt.item(v)); }
  contains(v) {
    const go = (n) => n !== null && (this.rt.equals(n.value, v) || go(n.leftChild) || go(n.rightSibling));
    return this.rootNode !== null && (this.rt.equals(this.rootNode.value, v) || go(this.rootNode.leftChild));
  }
  hasChildren() { return this.rootNode !== null && this.rootNode.leftChild !== null; }
  hasRightSibling() { return this.rootNode !== null && this.rootNode.rightSibling !== null; }
  getLeftMostChild() { this._ne(); return this._wrap(this.rootNode.leftChild); }
  getRightSibling() { this._ne(); return this._wrap(this.rootNode.rightSibling); }
  insertLeftMostChild(t) {
    this._ne(); if (t === null) this.rt.throwJava('NullPointerException', null); if (t.rootNode === null) return;
    const cp = copyT(this.rt, t.rootNode); cp.rightSibling = this.rootNode.leftChild; this.rootNode.leftChild = cp;
    this._mut('add', [], null, null);
  }
  removeLeftMostChild() {
    this._ne(); if (!this.rootNode.leftChild) this.rt.throwJava('EmptyTreeException', 'the tree has no children');
    this.rootNode.leftChild = this.rootNode.leftChild.rightSibling;
    this._mut('remove', [], null, null);
  }
  insertRightMostChild(t) {
    this._ne(); if (t === null) this.rt.throwJava('NullPointerException', null); if (t.rootNode === null) return;
    const cp = copyT(this.rt, t.rootNode);
    if (!this.rootNode.leftChild) this.rootNode.leftChild = cp;
    else { let n = this.rootNode.leftChild; while (n.rightSibling) n = n.rightSibling; n.rightSibling = cp; }
    this._mut('add', [], null, null);
  }
  removeRightMostChild() {
    this._ne(); const r = this.rootNode; if (!r.leftChild) this.rt.throwJava('EmptyTreeException', 'the tree has no children');
    if (!r.leftChild.rightSibling) r.leftChild = null;
    else { let n = r.leftChild; while (n.rightSibling.rightSibling) n = n.rightSibling; n.rightSibling = null; }
    this._mut('remove', [], null, null);
  }
  clear() { this.rootNode = null; this._mut('clear', [], null, null); }
  isEmpty() { return this.rootNode === null; }
  _each(order, f) {
    const call = (v) => this.rt.callFn(f, 'accept', [v]);
    if (!this.rootNode) return;
    if (order === 'level') { const q = [this.rootNode]; while (q.length) { const n = q.shift(); call(n.value); q.push(...kids(n)); } return; }
    const go = (n) => {
      const k = kids(n);
      if (order === 'pre') { call(n.value); k.forEach(go); }
      else if (order === 'post') { k.forEach(go); call(n.value); }
      else { if (k.length) go(k[0]); call(n.value); k.slice(1).forEach(go); }
    };
    go(this.rootNode);
  }
  forEachPreOrder(f) { this._each('pre', f); }
  forEachPostOrder(f) { this._each('post', f); }
  forEachInOrder(f) { this._each('in', f); }
  forEachLevelOrder(f) { this._each('level', f); }
  equals(o) { return o instanceof LinkedTree && showT(this.rt, this.rootNode) === showT(this.rt, o.rootNode); }
  toString() { return showT(this.rt, this.rootNode); }
}

// ── aed2: BinaryMaxHeap (arrayHeap with null at index 0) ──────────
export class BinaryMaxHeap extends LibObject {
  constructor(rt) { super(rt); this.arrayHeap = new JList(rt, 'ArrayList', [null]); }
  get _jname() { return 'BinaryMaxHeap'; }
  get _pkg() { return 'es.uvigo.esei.aed2.tree.binary.heap'; }
  get _types() { return ['BinaryMaxHeap', 'MaxHeap', 'Object']; }
  _kind() { return 'heap'; }
  _snap() { return { items: this.arrayHeap.a.slice(1).map((x) => this.rt.item(x)), kind: 'max' }; }
  _a() { return this.arrayHeap.a; }
  isEmpty() { return this._a().length === 1; }
  getMaxValue() { if (this.isEmpty()) this.rt.throwJava('HeapEmptyException', 'the heap is empty'); return this._a()[1]; }
  removeMaxValue() {
    if (this.isEmpty()) this.rt.throwJava('HeapEmptyException', 'the heap is empty');
    const a = this._a();
    const max = a[1];
    const last = a.pop();
    if (a.length > 1) { a[1] = last; this._sink(1); }
    this._mut('remove', [0], this.rt.item(max), null);
    return max;
  }
  _sink(i) {
    const a = this._a();
    const n = a.length;
    for (;;) {
      let c = 2 * i;
      if (c >= n) return;
      if (c + 1 < n && this.rt.compare(a[c + 1], a[c]) > 0) c++;
      if (this.rt.compare(a[c], a[i]) <= 0) return;
      const t = a[i]; a[i] = a[c]; a[c] = t; i = c;
    }
  }
  add(v) {
    if (v === null || v === undefined) this.rt.throwJava('NullPointerException', null);
    const a = this._a();
    a.push(v);
    let i = a.length - 1;
    while (i > 1 && this.rt.compare(a[i], a[i >> 1]) > 0) { const p = i >> 1; const t = a[i]; a[i] = a[p]; a[p] = t; i = p; }
    this._mut('add', [i - 1], null, this.rt.item(v));
  }
  clear() { this.arrayHeap.a = [null]; this._mut('clear', [], null, null); }
  insert(v) { if (v === null || v === undefined) this.rt.throwJava('NullPointerException', null); this._a().push(v); this._mut('add', [this._a().length - 2], null, this.rt.item(v)); }
  orderHeap() { for (let i = (this._a().length - 1) >> 1; i >= 1; i--) this._sink(i); this._mut('set', [], null, null); }
  toString() { return listString(this.rt, this._a().slice(1)); }
}
