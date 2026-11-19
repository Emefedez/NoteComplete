// Java subset library: the base of every library object.
//
// A library object is a JS object whose Java methods are its own JS methods (called with Java
// values, already converted). Names starting with "_" are internal and not callable from Java.
// Every library object knows the runtime `rt` (for equals/hashCode/compareTo of user objects,
// for calling lambdas, for throwing Java exceptions) and can be a tracked structure: when the
// Java program binds it to a variable or field, the interpreter gives it a structure id (`_sid`)
// and then `_mut(...)` reports each change to the trace.

import { newIdentity, jstr, JLambda } from '../values.js';

export class LibObject {
  constructor(rt) {
    this.rt = rt;
    const ident = newIdentity();
    this.id = ident.id;
    this.hash = ident.hash;
    this._sid = null;
  }
  // Java class name and the types it can be assigned to (for instanceof and casts)
  get _jname() { return 'Object'; }
  get _types() { return ['Object']; }
  _mut(op, path, from, to) { if (this._sid) this.rt.structChanged(this, op, path, from, to); }
  // structure kind and snapshot for the trace (overridden by the collections)
  _kind() { return 'value'; }
  _snap() { return { value: this.rt.show(this) }; }
  hashCode() { return this.hash; }
  equals(o) { return this === o; }
  toString() { return this._qname() + '@' + this.hash.toString(16); }
  _qname() { return this._pkg ? this._pkg + '.' + this._jname : this._jname; }
  getClass() { return this.rt.classRefOf(this); }
}

// java.util.Iterator over a snapshot or a live array (checks concurrent modification)
export class JIterator extends LibObject {
  constructor(rt, src, opts = {}) {
    super(rt);
    this.src = src; // array (live or a copy)
    this.i = 0;
    this.owner = opts.owner || null; // the collection, for remove() and modCount checks
    this.expected = this.owner ? this.owner.modCount : 0;
    this.last = -1;
    this.onRemove = opts.onRemove || null;
  }
  get _jname() { return 'Iterator'; }
  get _types() { return ['Iterator', 'Object']; }
  _check() {
    if (this.owner && this.owner.modCount !== this.expected) this.rt.throwJava('ConcurrentModificationException', null);
  }
  hasNext() { return this.i < this.src.length; }
  next() {
    this._check();
    if (this.i >= this.src.length) this.rt.throwJava('NoSuchElementException', null);
    this.last = this.i;
    return this.src[this.i++];
  }
  remove() {
    if (this.last < 0) this.rt.throwJava('IllegalStateException', null);
    this._check();
    if (!this.onRemove) this.rt.throwJava('UnsupportedOperationException', 'remove');
    this.onRemove(this.src[this.last], this.last);
    if (this.src === (this.owner && this.owner.a)) this.i--; // live array shifted
    this.last = -1;
    if (this.owner) this.expected = this.owner.modCount;
  }
  forEachRemaining(f) { while (this.hasNext()) this.rt.callFn(f, 'accept', [this.next()]); }
}

// calls a functional value (lambda, method reference or object implementing the interface)
export function callFn(rt, f, method, args) {
  if (f === null || f === undefined) rt.throwJava('NullPointerException', null);
  return rt.callFn(f, method, args);
}

export function isLambda(v) { return v instanceof JLambda; }

export function listString(rt, items) {
  return '[' + items.map((x) => rt.str(x)).join(', ') + ']';
}

export { jstr };
