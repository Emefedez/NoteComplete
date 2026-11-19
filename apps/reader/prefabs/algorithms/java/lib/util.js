// Java subset library: java.util collections, with Java's behaviour where a program can see
// it: HashMap/HashSet iterate in Java's bucket order (same hashing, same resizing), the
// PriorityQueue keeps Java's array layout, iterators fail fast with
// ConcurrentModificationException, exceptions and messages match the JDK's.
//
// Simplifications: keySet()/values()/entrySet()/subList() return copies, not live views.

import { LibObject, JIterator, listString } from './base.js';
import { JArray } from '../values.js';

const tableSizeFor = (c) => { let n = 1; while (n < c) n *= 2; return Math.max(1, Math.min(n, 1 << 30)); };
const spread = (h) => (h ^ (h >>> 16)) | 0;

function toArray(rt, c) {
  if (c === null || c === undefined) rt.throwJava('NullPointerException', null);
  if (c instanceof JArray) return c.a.slice();
  if (typeof c._items === 'function') return c._items();
  // a user Iterable
  return rt.iterateToArray(c);
}

// ── lists: ArrayList, LinkedList, Vector, Stack, List.of ──────────
export class JList extends LibObject {
  constructor(rt, name = 'ArrayList', items = [], opts = {}) {
    super(rt);
    this.name = name;
    this.a = items;
    this.modCount = 0;
    this.immutable = !!opts.immutable;
  }
  get _jname() { return this.immutable ? 'ImmutableCollections.ListN' : this.name; }
  get _pkg() { return 'java.util'; }
  get _types() {
    const base = ['List', 'Collection', 'Iterable', 'Object', 'SequencedCollection'];
    if (this.name === 'LinkedList') return ['LinkedList', 'AbstractList', 'Deque', 'Queue', ...base];
    if (this.name === 'Stack') return ['Stack', 'Vector', 'AbstractList', 'RandomAccess', ...base];
    if (this.name === 'Vector') return ['Vector', 'AbstractList', 'RandomAccess', ...base];
    return [this.name, 'AbstractList', 'RandomAccess', ...base];
  }
  _items() { return this.a.slice(); }
  _kind(declared) {
    if (this.name === 'Stack') return 'stack';
    if (declared === 'Queue') return 'queue';
    if (declared === 'Deque') return 'deque';
    return 'array';
  }
  _snap() { return { items: this.a.map((x) => this.rt.item(x)) }; }
  _w() { if (this.immutable) this.rt.throwJava('UnsupportedOperationException', null); this.modCount++; }
  _idx(i, n) {
    if (typeof i !== 'number') this.rt.throwJava('ClassCastException', 'index must be an int');
    if (i < 0 || i >= n) this.rt.throwJava('IndexOutOfBoundsException', 'Index ' + i + ' out of bounds for length ' + n);
  }
  _ne() { if (!this.a.length) this.rt.throwJava('NoSuchElementException', null); }

  size() { return this.a.length; }
  isEmpty() { return this.a.length === 0; }
  get(i) { this._idx(i, this.a.length); return this.a[i]; }
  set(i, v) { this._idx(i, this.a.length); if (this.immutable) this._w(); const o = this.a[i]; this.a[i] = v; this._mut('set', [i], this.rt.item(o), this.rt.item(v)); return o; }
  add(a, b) {
    this._w();
    if (arguments.length === 2) {
      if (typeof a !== 'number' || a < 0 || a > this.a.length) this.rt.throwJava('IndexOutOfBoundsException', 'Index: ' + a + ', Size: ' + this.a.length);
      this.a.splice(a, 0, b);
      this._mut('add', [a], null, this.rt.item(b));
      return;
    }
    this.a.push(a);
    this._mut('add', [this.a.length - 1], null, this.rt.item(a));
    return true;
  }
  addAll(a, b) {
    if (arguments.length === 2) {
      const xs = toArray(this.rt, b);
      if (a < 0 || a > this.a.length) this.rt.throwJava('IndexOutOfBoundsException', 'Index: ' + a + ', Size: ' + this.a.length);
      this._w();
      this.a.splice(a, 0, ...xs);
      xs.forEach((x, k) => this._mut('add', [a + k], null, this.rt.item(x)));
      return xs.length > 0;
    }
    const xs = toArray(this.rt, a);
    this._w();
    for (const x of xs) { this.a.push(x); this._mut('add', [this.a.length - 1], null, this.rt.item(x)); }
    return xs.length > 0;
  }
  contains(x) { return this.indexOf(x) >= 0; }
  containsAll(c) { return toArray(this.rt, c).every((x) => this.contains(x)); }
  indexOf(x) { for (let i = 0; i < this.a.length; i++) if (this.rt.equals(x, this.a[i])) return i; return -1; }
  lastIndexOf(x) { for (let i = this.a.length - 1; i >= 0; i--) if (this.rt.equals(x, this.a[i])) return i; return -1; }
  // remove(int index) when the argument is an int, remove(Object) otherwise
  remove(x) {
    if (arguments.length === 0) return this.removeFirst();
    if (typeof x === 'number') {
      this._idx(x, this.a.length);
      this._w();
      const o = this.a.splice(x, 1)[0];
      this._mut('remove', [x], this.rt.item(o), null);
      return o;
    }
    const i = this.indexOf(x);
    if (i < 0) return false;
    this._w();
    this.a.splice(i, 1);
    this._mut('remove', [i], this.rt.item(x), null);
    return true;
  }
  removeAll(c) { const xs = toArray(this.rt, c); return this.removeIf((x) => xs.some((y) => this.rt.equals(x, y)), true); }
  retainAll(c) { const xs = toArray(this.rt, c); return this.removeIf((x) => !xs.some((y) => this.rt.equals(x, y)), true); }
  removeIf(pred, js) {
    let changed = false;
    for (let i = 0; i < this.a.length;) {
      const x = this.a[i];
      if (js ? pred(x) : this.rt.truthy(this.rt.callFn(pred, 'test', [x]))) { this._w(); this.a.splice(i, 1); this._mut('remove', [i], this.rt.item(x), null); changed = true; } else i++;
    }
    return changed;
  }
  clear() { this._w(); this.a.length = 0; this._mut('clear', [], null, null); }
  iterator() {
    return new JIterator(this.rt, this.a, { owner: this, onRemove: (x, i) => { this.modCount++; this.a.splice(i, 1); this._mut('remove', [i], this.rt.item(x), null); } });
  }
  listIterator() { return this.iterator(); }
  forEach(f) {
    const mc = this.modCount;
    for (let i = 0; i < this.a.length; i++) {
      this.rt.callFn(f, 'accept', [this.a[i]]);
      if (this.modCount !== mc) this.rt.throwJava('ConcurrentModificationException', null);
    }
  }
  sort(cmp) { this._w(); this.rt.sortArray(this.a, cmp); this._mut('sort', [], null, null); }
  replaceAll(f) { for (let i = 0; i < this.a.length; i++) this.set(i, this.rt.callFn(f, 'apply', [this.a[i]])); }
  subList(from, to) {
    if (from < 0 || to > this.a.length || from > to) this.rt.throwJava('IndexOutOfBoundsException', 'fromIndex: ' + from + ', toIndex: ' + to + ', size: ' + this.a.length);
    return new JList(this.rt, 'ArrayList', this.a.slice(from, to));
  }
  toArray(arr) {
    const t = arr instanceof JArray ? arr.t : { name: 'Object', dims: 0 };
    return new JArray(t, this.a.slice());
  }
  stream() { this.rt.throwJava('UnsupportedOperationException', 'streams are not supported by the simulator'); }
  reversed() { return new JList(this.rt, 'ArrayList', this.a.slice().reverse()); }
  // SequencedCollection (Java 21) and Deque/Queue methods (LinkedList)
  getFirst() { this._ne(); return this.a[0]; }
  getLast() { this._ne(); return this.a[this.a.length - 1]; }
  addFirst(x) { this._w(); this.a.unshift(x); this._mut('add', [0], null, this.rt.item(x)); }
  addLast(x) { this._w(); this.a.push(x); this._mut('add', [this.a.length - 1], null, this.rt.item(x)); }
  removeFirst() { this._ne(); this._w(); const x = this.a.shift(); this._mut('remove', [0], this.rt.item(x), null); return x; }
  removeLast() { this._ne(); this._w(); const x = this.a.pop(); this._mut('remove', [this.a.length], this.rt.item(x), null); return x; }
  offer(x) { this.addLast(x); return true; }
  offerLast(x) { this.addLast(x); return true; }
  offerFirst(x) { this.addFirst(x); return true; }
  poll() { return this.a.length ? this.removeFirst() : null; }
  pollFirst() { return this.poll(); }
  pollLast() { return this.a.length ? this.removeLast() : null; }
  peekFirst() { return this.a.length ? this.a[0] : null; }
  peekLast() { return this.a.length ? this.a[this.a.length - 1] : null; }
  element() { return this.getFirst(); }
  descendingIterator() { return new JIterator(this.rt, this.a.slice().reverse()); }
  // LinkedList: push/pop/peek work at the head; Stack overrides them
  push(x) { this.addFirst(x); }
  pop() { return this.removeFirst(); }
  peek() { return this.a.length ? this.a[0] : null; }
  equals(o) {
    if (!(o instanceof JList)) return false;
    if (o.a.length !== this.a.length) return false;
    return this.a.every((x, i) => this.rt.equals(x, o.a[i]));
  }
  hashCode() { let h = 1; for (const x of this.a) h = (Math.imul(31, h) + this.rt.hash(x)) | 0; return h; }
  toString() { return listString(this.rt, this.a); }
}

export class JStack extends JList {
  constructor(rt, items = []) { super(rt, 'Stack', items); }
  push(x) { this.addLast(x); return x; }
  pop() { if (!this.a.length) this.rt.throwJava('EmptyStackException', null); return this.removeLast(); }
  peek() { if (!this.a.length) this.rt.throwJava('EmptyStackException', null); return this.a[this.a.length - 1]; }
  empty() { return this.a.length === 0; }
  search(x) { const i = this.lastIndexOf(x); return i < 0 ? -1 : this.a.length - i; }
  _snap() { return { items: this.a.map((x) => this.rt.item(x)) }; }
}

// ── ArrayDeque ────────────────────────────────────────────────────
export class JArrayDeque extends JList {
  constructor(rt, items = []) { super(rt, 'ArrayDeque', items); }
  get _types() { return ['ArrayDeque', 'Deque', 'Queue', 'Collection', 'Iterable', 'Object']; }
  _kind(declared) { return declared === 'Queue' ? 'queue' : 'deque'; }
  _nn(x) { if (x === null || x === undefined) this.rt.throwJava('NullPointerException', null); }
  addFirst(x) { this._nn(x); super.addFirst(x); }
  addLast(x) { this._nn(x); super.addLast(x); }
  add(x) { this.addLast(x); return true; }
  get(i) { this.rt.throwJava('NoSuchMethodError', 'ArrayDeque has no get(int)'); return i; }
  remove(x) {
    if (arguments.length === 0) return this.removeFirst();
    const i = this.indexOf(x);
    if (i < 0) return false;
    this._w();
    this.a.splice(i, 1);
    this._mut('remove', [i], this.rt.item(x), null);
    return true;
  }
}

// ── PriorityQueue (Java's binary heap layout) ─────────────────────
export class JPriorityQueue extends LibObject {
  constructor(rt, cmp = null, items = []) {
    super(rt);
    this.cmp = cmp;
    this.a = [];
    this.modCount = 0;
    for (const x of items) this.a.push(x);
    for (let i = (this.a.length >>> 1) - 1; i >= 0; i--) this._down(i, this.a[i]);
  }
  get _jname() { return 'PriorityQueue'; }
  get _pkg() { return 'java.util'; }
  get _types() { return ['PriorityQueue', 'AbstractQueue', 'Queue', 'Collection', 'Iterable', 'Object']; }
  _items() { return this.a.slice(); }
  _kind() { return 'pq'; }
  _snap() { return { items: this.a.map((x) => ({ key: this.rt.item(x), prio: this.rt.prio(x) })) }; }
  _c(x, y) { return this.cmp ? this.rt.intOf(this.rt.callFn(this.cmp, 'compare', [x, y])) : this.rt.compare(x, y); }
  _up(k, x) {
    const q = this.a;
    while (k > 0) {
      const parent = (k - 1) >>> 1;
      const e = q[parent];
      if (this._c(x, e) >= 0) break;
      q[k] = e;
      k = parent;
    }
    q[k] = x;
  }
  _down(k, x) {
    const q = this.a;
    const n = q.length;
    const half = n >>> 1;
    while (k < half) {
      let child = 2 * k + 1;
      let c = q[child];
      const right = child + 1;
      if (right < n && this._c(c, q[right]) > 0) c = q[child = right];
      if (this._c(x, c) <= 0) break;
      q[k] = c;
      k = child;
    }
    q[k] = x;
  }
  size() { return this.a.length; }
  isEmpty() { return this.a.length === 0; }
  add(x) { return this.offer(x); }
  offer(x) {
    if (x === null || x === undefined) this.rt.throwJava('NullPointerException', null);
    this.modCount++;
    const i = this.a.length;
    this.a.push(x);
    if (i === 0 && !this.cmp) this.rt.compare(x, x); // a non-Comparable first element fails like Java
    this._up(i, x);
    this._mut('add', [this.a.indexOf(x)], null, this.rt.item(x));
    return true;
  }
  peek() { return this.a.length ? this.a[0] : null; }
  element() { if (!this.a.length) this.rt.throwJava('NoSuchElementException', null); return this.a[0]; }
  poll() {
    if (!this.a.length) return null;
    this.modCount++;
    const result = this.a[0];
    const x = this.a.pop();
    if (this.a.length) this._down(0, x);
    this._mut('remove', [0], this.rt.item(result), null);
    return result;
  }
  remove(x) {
    if (arguments.length === 0) { if (!this.a.length) this.rt.throwJava('NoSuchElementException', null); return this.poll(); }
    const i = this.a.findIndex((y) => this.rt.equals(x, y));
    if (i < 0) return false;
    this._removeAt(i);
    return true;
  }
  _removeAt(i) {
    this.modCount++;
    const removed = this.a[i];
    const s = this.a.length - 1;
    if (s === i) this.a.pop();
    else {
      const moved = this.a.pop();
      this._down(i, moved);
      if (this.a[i] === moved) this._up(i, moved);
    }
    this._mut('remove', [i], this.rt.item(removed), null);
  }
  contains(x) { return this.a.some((y) => this.rt.equals(x, y)); }
  clear() { this.modCount++; this.a.length = 0; this._mut('clear', [], null, null); }
  addAll(c) { const xs = toArray(this.rt, c); for (const x of xs) this.offer(x); return xs.length > 0; }
  iterator() { return new JIterator(this.rt, this.a, { owner: this, onRemove: (x, i) => this._removeAt(i) }); }
  forEach(f) { for (const x of this.a.slice()) this.rt.callFn(f, 'accept', [x]); }
  toArray() { return new JArray({ name: 'Object', dims: 0 }, this.a.slice()); }
  comparator() { return this.cmp; }
  toString() { return listString(this.rt, this.a); }
}

// ── maps: HashMap, LinkedHashMap, TreeMap ─────────────────────────
export class JEntry extends LibObject {
  constructor(rt, k, v, h, map) { super(rt); this.k = k; this.v = v; this.h = h; this.map = map; }
  get _jname() { return 'Map.Entry'; }
  get _types() { return ['Entry', 'Map.Entry', 'Object']; }
  getKey() { return this.k; }
  getValue() { return this.v; }
  setValue(v) {
    if (this.map && this.map.immutable) this.rt.throwJava('UnsupportedOperationException', null);
    const o = this.v; this.v = v;
    if (this.map) this.map._mut('set', [this.rt.item(this.k)], this.rt.item(o), this.rt.item(v));
    return o;
  }
  equals(o) { return o instanceof JEntry && this.rt.equals(this.k, o.k) && this.rt.equals(this.v, o.v); }
  hashCode() { return this.rt.hash(this.k) ^ this.rt.hash(this.v); }
  toString() { return this.rt.str(this.k) + '=' + this.rt.str(this.v); }
}

export class JMap extends LibObject {
  // mode: 'hash' (bucket order), 'linked' (insertion order), 'tree' (sorted)
  constructor(rt, mode = 'hash', opts = {}) {
    super(rt);
    this.mode = mode;
    this.cmp = opts.cmp || null;
    this.cap = opts.cap ? tableSizeFor(opts.cap) : 16;
    this.table = null; // lazily allocated, as in Java
    this.order = []; // linked: insertion order; tree: sorted entries
    this.count = 0;
    this.modCount = 0;
    this.immutable = !!opts.immutable;
  }
  get _jname() { return this.mode === 'tree' ? 'TreeMap' : this.mode === 'linked' ? 'LinkedHashMap' : this.immutable ? 'ImmutableCollections.MapN' : 'HashMap'; }
  get _pkg() { return 'java.util'; }
  get _types() {
    const t = ['Map', 'AbstractMap', 'Object'];
    if (this.mode === 'tree') return ['TreeMap', 'SortedMap', 'NavigableMap', 'SequencedMap', ...t];
    if (this.mode === 'linked') return ['LinkedHashMap', 'HashMap', 'SequencedMap', ...t];
    return ['HashMap', ...t];
  }
  _kind() { return 'map'; }
  _snap() { return { entries: this._entries().map((e) => ({ k: this.rt.item(e.k), v: this.rt.item(e.v) })) }; }
  _w() { if (this.immutable) this.rt.throwJava('UnsupportedOperationException', null); }
  _entries() {
    if (this.mode !== 'hash') return this.order.slice();
    const out = [];
    if (this.table) for (const b of this.table) if (b) for (const e of b) out.push(e);
    return out;
  }
  _tcmp(a, b) { return this.cmp ? this.rt.intOf(this.rt.callFn(this.cmp, 'compare', [a, b])) : this.rt.compare(a, b); }
  // tree: binary search → { i, found }
  _tfind(k) {
    if (k === null || k === undefined) { if (!this.cmp) this.rt.throwJava('NullPointerException', null); }
    let lo = 0, hi = this.order.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = this._tcmp(k, this.order[mid].k);
      if (c === 0) return { i: mid, found: true };
      if (c < 0) hi = mid - 1; else lo = mid + 1;
    }
    return { i: lo, found: false };
  }
  _find(k) {
    if (this.mode === 'tree') { const r = this._tfind(k); return r.found ? this.order[r.i] : null; }
    if (!this.table) return null;
    const h = spread(this.rt.hash(k));
    const b = this.table[h & (this.cap - 1)];
    if (!b) return null;
    for (const e of b) if (e.h === h && (e.k === k || this.rt.equals(k, e.k))) return e;
    return null;
  }
  _resize() {
    const old = this.table;
    if (!old) { this.table = new Array(this.cap).fill(null); return; }
    this.cap *= 2;
    this.table = new Array(this.cap).fill(null);
    for (const b of old) if (b) for (const e of b) { const j = e.h & (this.cap - 1); (this.table[j] || (this.table[j] = [])).push(e); }
  }
  size() { return this.count; }
  isEmpty() { return this.count === 0; }
  get(k) { const e = this._find(k); return e ? e.v : null; }
  getOrDefault(k, d) { const e = this._find(k); return e ? e.v : d; }
  containsKey(k) { return !!this._find(k); }
  containsValue(v) { return this._entries().some((e) => this.rt.equals(v, e.v)); }
  // atHead: HashMap.merge/compute/computeIfAbsent link a new node at the bucket's head (JDK)
  put(k, v, atHead) {
    this._w();
    if (this.mode === 'tree') {
      const r = this._tfind(k);
      if (r.found) { const e = this.order[r.i]; const o = e.v; e.v = v; this._mut('set', [this.rt.item(k)], this.rt.item(o), this.rt.item(v)); return o; }
      if (this.count === 0) this._tcmp(k, k);
      this.order.splice(r.i, 0, new JEntry(this.rt, k, v, 0, this));
      this.count++; this.modCount++;
      this._mut('add', [this.rt.item(k)], null, this.rt.item(v));
      return null;
    }
    const e0 = this._find(k);
    if (e0) { const o = e0.v; e0.v = v; this._mut('set', [this.rt.item(k)], this.rt.item(o), this.rt.item(v)); return o; }
    if (!this.table) this._resize();
    const h = spread(this.rt.hash(k));
    const j = h & (this.cap - 1);
    const e = new JEntry(this.rt, k, v, h, this);
    const bucket = this.table[j] || (this.table[j] = []);
    if (atHead) bucket.unshift(e); else bucket.push(e);
    if (this.mode === 'linked') this.order.push(e);
    this.count++; this.modCount++;
    if (this.count > this.cap * 0.75) this._resize();
    this._mut('add', [this.rt.item(k)], null, this.rt.item(v));
    return null;
  }
  putIfAbsent(k, v) { const e = this._find(k); if (e && e.v !== null) return e.v; this.put(k, v); return null; }
  putAll(m) { for (const e of m._entries()) this.put(e.k, e.v); }
  remove(k) {
    this._w();
    if (this.mode === 'tree') {
      const r = this._tfind(k);
      if (!r.found) return null;
      const e = this.order.splice(r.i, 1)[0];
      this.count--; this.modCount++;
      this._mut('remove', [this.rt.item(k)], this.rt.item(e.v), null);
      return e.v;
    }
    const e = this._find(k);
    if (!e) return null;
    const b = this.table[e.h & (this.cap - 1)];
    b.splice(b.indexOf(e), 1);
    if (this.mode === 'linked') this.order.splice(this.order.indexOf(e), 1);
    this.count--; this.modCount++;
    this._mut('remove', [this.rt.item(k)], this.rt.item(e.v), null);
    return e.v;
  }
  clear() { this._w(); if (this.table) this.table.fill(null); this.order = []; this.count = 0; this.modCount++; this._mut('clear', [], null, null); }
  keySet() { return JSet.fromItems(this.rt, this._entries().map((e) => e.k), this.mode === 'tree' ? 'tree-view' : 'linked'); }
  values() { return new JList(this.rt, 'ArrayList', this._entries().map((e) => e.v)); }
  entrySet() { return JSet.fromItems(this.rt, this._entries(), 'linked'); }
  forEach(f) {
    const mc = this.modCount;
    for (const e of this._entries()) {
      this.rt.callFn(f, 'accept', [e.k, e.v]);
      if (this.modCount !== mc) this.rt.throwJava('ConcurrentModificationException', null);
    }
  }
  computeIfAbsent(k, f) {
    const e = this._find(k);
    if (e && e.v !== null) return e.v;
    const v = this.rt.callFn(f, 'apply', [k]);
    if (v !== null) this.put(k, v, !e);
    return v;
  }
  computeIfPresent(k, f) {
    const e = this._find(k);
    if (!e || e.v === null) return null;
    const v = this.rt.callFn(f, 'apply', [k, e.v]);
    if (v === null) this.remove(k); else this.put(k, v);
    return v;
  }
  compute(k, f) {
    const e = this._find(k);
    const v = this.rt.callFn(f, 'apply', [k, e ? e.v : null]);
    if (v === null) { if (e) this.remove(k); } else this.put(k, v, !e);
    return v;
  }
  merge(k, v, f) {
    const e = this._find(k);
    const nv = e && e.v !== null ? this.rt.callFn(f, 'apply', [e.v, v]) : v;
    if (nv === null) this.remove(k); else this.put(k, nv, !e);
    return nv;
  }
  replace(k, v) { const e = this._find(k); if (!e) return null; return this.put(k, v); }
  // TreeMap navigation
  _tn() { if (this.mode !== 'tree') this.rt.throwJava('NoSuchMethodError', 'not a TreeMap'); }
  firstKey() { this._tn(); if (!this.count) this.rt.throwJava('NoSuchElementException', null); return this.order[0].k; }
  lastKey() { this._tn(); if (!this.count) this.rt.throwJava('NoSuchElementException', null); return this.order[this.count - 1].k; }
  firstEntry() { this._tn(); return this.order[0] || null; }
  lastEntry() { this._tn(); return this.order[this.count - 1] || null; }
  pollFirstEntry() { this._tn(); if (!this.count) return null; const e = this.order[0]; this.remove(e.k); return e; }
  pollLastEntry() { this._tn(); if (!this.count) return null; const e = this.order[this.count - 1]; this.remove(e.k); return e; }
  floorKey(k) { this._tn(); const r = this._tfind(k); if (r.found) return this.order[r.i].k; return r.i > 0 ? this.order[r.i - 1].k : null; }
  ceilingKey(k) { this._tn(); const r = this._tfind(k); return r.i < this.count ? this.order[r.i].k : null; }
  lowerKey(k) { this._tn(); const r = this._tfind(k); return r.i > 0 ? this.order[r.i - 1].k : null; }
  higherKey(k) { this._tn(); const r = this._tfind(k); const i = r.found ? r.i + 1 : r.i; return i < this.count ? this.order[i].k : null; }
  headMap(k) { this._tn(); const m = new JMap(this.rt, 'tree', { cmp: this.cmp }); for (const e of this.order) if (this._tcmp(e.k, k) < 0) m.put(e.k, e.v); return m; }
  tailMap(k) { this._tn(); const m = new JMap(this.rt, 'tree', { cmp: this.cmp }); for (const e of this.order) if (this._tcmp(e.k, k) >= 0) m.put(e.k, e.v); return m; }
  equals(o) {
    if (!(o instanceof JMap) || o.count !== this.count) return false;
    return this._entries().every((e) => { const f = o._find(e.k); return !!f && this.rt.equals(e.v, f.v); });
  }
  hashCode() { let h = 0; for (const e of this._entries()) h = (h + (this.rt.hash(e.k) ^ this.rt.hash(e.v))) | 0; return h; }
  toString() { return '{' + this._entries().map((e) => (e.k === this ? '(this Map)' : this.rt.str(e.k)) + '=' + (e.v === this ? '(this Map)' : this.rt.str(e.v))).join(', ') + '}'; }
}

// ── sets: HashSet, LinkedHashSet, TreeSet (a map's keys) ──────────
export class JSet extends LibObject {
  constructor(rt, mode = 'hash', opts = {}) {
    super(rt);
    this.m = new JMap(rt, mode === 'tree-view' ? 'linked' : mode, opts);
    this.mode = mode;
    this.immutable = !!opts.immutable;
  }
  static fromItems(rt, items, mode = 'hash', opts = {}) {
    const s = new JSet(rt, mode, opts.cap ? opts : { ...opts, cap: Math.max(16, Math.ceil(items.length / 0.75)) });
    s.immutable = false;
    for (const x of items) s.add(x);
    s.immutable = !!opts.immutable;
    return s;
  }
  get modCount() { return this.m.modCount; }
  get _jname() { return this.mode === 'tree' ? 'TreeSet' : this.mode === 'linked' ? 'LinkedHashSet' : this.immutable ? 'ImmutableCollections.SetN' : 'HashSet'; }
  get _pkg() { return 'java.util'; }
  get _types() {
    const t = ['Set', 'AbstractSet', 'Collection', 'Iterable', 'Object'];
    if (this.mode === 'tree') return ['TreeSet', 'SortedSet', 'NavigableSet', ...t];
    if (this.mode === 'linked') return ['LinkedHashSet', 'HashSet', ...t];
    return ['HashSet', ...t];
  }
  _items() { return this.m._entries().map((e) => e.k); }
  _kind() { return 'set'; }
  _snap() { return { items: this._items().map((x) => this.rt.item(x)) }; }
  _w() { if (this.immutable) this.rt.throwJava('UnsupportedOperationException', null); }
  size() { return this.m.count; }
  isEmpty() { return this.m.count === 0; }
  contains(x) { return !!this.m._find(x); }
  add(x) {
    this._w();
    if (this.m._find(x)) return false;
    const was = this.m._sid; this.m._sid = null;
    this.m.put(x, true);
    this.m._sid = was;
    this._mut('add', [this.rt.item(x)], null, this.rt.item(x));
    return true;
  }
  remove(x) {
    this._w();
    if (!this.m._find(x)) return false;
    this.m.remove(x);
    this._mut('remove', [this.rt.item(x)], this.rt.item(x), null);
    return true;
  }
  addAll(c) { let ch = false; for (const x of toArray(this.rt, c)) if (this.add(x)) ch = true; return ch; }
  removeAll(c) { let ch = false; for (const x of toArray(this.rt, c)) if (this.remove(x)) ch = true; return ch; }
  retainAll(c) {
    const keep = toArray(this.rt, c);
    let ch = false;
    for (const x of this._items()) if (!keep.some((y) => this.rt.equals(x, y))) { this.remove(x); ch = true; }
    return ch;
  }
  containsAll(c) { return toArray(this.rt, c).every((x) => this.contains(x)); }
  removeIf(pred) { let ch = false; for (const x of this._items()) if (this.rt.truthy(this.rt.callFn(pred, 'test', [x]))) { this.remove(x); ch = true; } return ch; }
  clear() { this._w(); this.m.clear(); this._mut('clear', [], null, null); }
  iterator() {
    return new JIterator(this.rt, this._items(), { owner: this, onRemove: (x) => this.remove(x) });
  }
  forEach(f) { for (const x of this._items()) this.rt.callFn(f, 'accept', [x]); }
  toArray(arr) { return new JArray(arr instanceof JArray ? arr.t : { name: 'Object', dims: 0 }, this._items()); }
  stream() { this.rt.throwJava('UnsupportedOperationException', 'streams are not supported by the simulator'); }
  // TreeSet navigation
  _t() { if (this.mode !== 'tree') this.rt.throwJava('NoSuchMethodError', 'not a TreeSet'); }
  first() { this._t(); return this.m.firstKey(); }
  last() { this._t(); return this.m.lastKey(); }
  floor(x) { this._t(); return this.m.floorKey(x); }
  ceiling(x) { this._t(); return this.m.ceilingKey(x); }
  lower(x) { this._t(); return this.m.lowerKey(x); }
  higher(x) { this._t(); return this.m.higherKey(x); }
  pollFirst() { this._t(); const e = this.m.pollFirstEntry(); if (e) this._mut('remove', [this.rt.item(e.k)], this.rt.item(e.k), null); return e ? e.k : null; }
  pollLast() { this._t(); const e = this.m.pollLastEntry(); if (e) this._mut('remove', [this.rt.item(e.k)], this.rt.item(e.k), null); return e ? e.k : null; }
  equals(o) { return o instanceof JSet && o.size() === this.size() && this._items().every((x) => o.contains(x)); }
  hashCode() { let h = 0; for (const x of this._items()) h = (h + this.rt.hash(x)) | 0; return h; }
  toString() { return listString(this.rt, this._items()); }
}

export { toArray };
