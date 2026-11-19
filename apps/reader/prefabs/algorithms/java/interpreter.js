// Java subset: the tree-walking interpreter.
//
// Runs the AST from parser.js statement by statement. Each executed statement (and each loop
// or branch condition, each method entry and return) counts as a step: it is checked against the
// step limit, the time limit and the cancel hook, and recorded (line, caption, locals, the
// tracked structures) when a recorder is given. Library objects and arrays bound to a variable
// or field become tracked structures (see bind()).
//
// Java values are described in values.js. Control flow uses completion records returned by
// exec(): undefined (normal) or { c: 'b'|'c'|'r'|'y', l: label, v: value }. A Java exception is
// a JS throw of JavaThrow; the limits throw RunLimit, which Java code cannot catch.

import { CompileError } from './lexer.js';
import { parse, parseExpression } from './parser.js';
import {
  JDouble, JChar, JArray, JObject, JLambda, ClassRef, jchar, dbl, flt, isStr, sv, nkind, toNumber,
  jstr, doubleToString, javaHash, javaEquals, javaCompare,
} from './values.js';
import { LibObject } from './lib/base.js';
import { JList, JSet, JMap } from './lib/util.js';
import { Vertex } from './lib/aed.js';
import { STATICS, STATIC_FIELDS, stringMethod, boxedMethod, PrintStream, Random, defaultFor } from './lib/lang.js';
import { LIB_CLASSES, ALL_LIB_NAMES, DEFAULT_NAMES, STATIC_HOLDERS, packageOf, simpleOf } from './library.js';
import { preludeSource, PRELUDE_PACKAGES } from './prelude.js';

export class JavaThrow extends Error {
  constructor(ex) { super('Java exception'); this.ex = ex; }
}
export class RunLimit extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
class ExitSignal extends Error {
  constructor(code) { super('exit'); this.code = code; }
}

const PRIMS = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'char', 'boolean']);
const INTLIKE = new Set(['int', 'short', 'byte']);
const BOXES = { Integer: 'int', Long: 'long', Double: 'double', Float: 'float', Short: 'short', Byte: 'byte', Character: 'char', Boolean: 'boolean' };
const OBJECT_TYPE = { k: 'type', name: 'Object', args: [], dims: 0 };

// a functional object made by the library (Comparator.comparing, reverseOrder…)
class LibFn extends LibObject {
  constructor(rt, fn) { super(rt); this.fn = fn; }
  get _jname() { return 'Lambda'; }
  get _types() { return ['Comparator', 'Function', 'Consumer', 'BiConsumer', 'Predicate', 'Supplier', 'Runnable', 'Object']; }
  compare(a, b) { return this.fn(a, b); }
  apply(...a) { return this.fn(...a); }
  accept(...a) { return this.fn(...a); }
  test(...a) { return this.fn(...a); }
  get() { return this.fn(); }
  run() { return this.fn(); }
  reversed() { return new LibFn(this.rt, (a, b) => this.rt.intOf(this.fn(b, a))); }
  thenComparing(o) { return this.rt.makeComparator((a, b) => { const c = this.rt.intOf(this.fn(a, b)); return c !== 0 ? c : this.rt.thenCompare(o, a, b); }); }
}

export class Interpreter {
  constructor(sources, opts = {}) {
    this.opts = opts;
    this.recorder = opts.recorder || null;
    this.maxSteps = opts.maxSteps ?? 100000;
    this.maxMs = opts.maxMs ?? 10000;
    this.maxDepth = opts.maxDepth ?? 3000; // the JS stack usually ends first (~500 Java frames): see throwOverflow
    this.shouldCancel = opts.shouldCancel || null;
    this.cancelFlag = opts.cancelFlag || null;
    this.input = opts.input || '';
    this.out = '';
    this.err = '';
    this.steps = 0;
    this.depth = 0;
    this.quiet = 0; // > 0: no steps are recorded (library callbacks of display code, prelude)
    this.started = Date.now();
    this.cur = null; // node being executed (for exception locations)
    this.curFile = null;
    this.callStack = []; // [{ name, line, file }]
    this.files = new Map(); // file → source lines
    this.classes = new Map(); // simple name → [ClassInfo] (top level and nested, user code)
    this.prelude = new Map(); // simple name → ClassInfo (exceptions)
    this.units = [];
    this.structs = new Map(); // binding key → { id, obj }
    this.structIds = new Set();
    this.dirty = new Set();
    this.pendingChanges = new Map(); // obj → [change]
    this.sysOut = new PrintStream(this, false);
    this.sysErr = new PrintStream(this, true);
    this._random = null;
    this.load(preludeSource(), '<prelude>', true);
    for (const s of sources) this.load(s.text, s.name, false);
    this.overflow = null;
  }

  // ── loading ──────────────────────────────────────────────────────
  load(text, file, builtin) {
    const unit = parse(text, file);
    if (!builtin) this.files.set(file, text.split('\n'));
    unit.importMap = new Map();
    unit.starPkgs = [];
    unit.staticImports = [];
    for (const im of unit.imports) {
      if (im.static) { unit.staticImports.push(im); continue; }
      if (im.star) unit.starPkgs.push(im.name);
      else unit.importMap.set(simpleOf(im.name), im.name);
    }
    this.units.push(unit);
    for (const decl of unit.types) this.declareClass(decl, unit, null, builtin);
  }

  declareClass(decl, unit, outer, builtin) {
    const isStatic = !outer || decl.mods.has('static') || decl.kind !== 'class' || (outer && outer.isInterface);
    const cls = {
      name: decl.name, decl, unit, outer, builtin,
      fullName: outer ? outer.fullName + '$' + decl.name : (builtin ? (PRELUDE_PACKAGES[decl.name] || 'java.lang') + '.' : unit.pkg ? unit.pkg + '.' : '') + decl.name,
      isStatic, isInterface: decl.kind === 'interface', isEnum: decl.kind === 'enum', isRecord: decl.kind === 'record',
      sup: undefined, ifaces: undefined,
      staticFields: new Map(), instFields: new Map(), statics: Object.create(null),
      methods: new Map(), ctors: [], instInit: [], staticInit: [], nested: new Map(),
      typeParams: new Set(decl.typeParams.map((t) => t.name)), init: 0, mcache: new Map(),
      anonymous: !!decl.anonymous,
    };
    for (const m of decl.members) {
      switch (m.k) {
        case 'field': {
          const st = m.mods.has('static') || cls.isInterface;
          for (const d of m.decls) {
            (st ? cls.staticFields : cls.instFields).set(d.name, d.type);
            (st ? cls.staticInit : cls.instInit).push({ k: 'fieldInit', d, line: d.line, col: d.col });
          }
          break;
        }
        case 'method': {
          m.cls = cls;
          m.isStatic = m.mods.has('static');
          m.typeParamSet = new Set(m.typeParams.map((t) => t.name));
          if (!cls.methods.has(m.name)) cls.methods.set(m.name, []);
          cls.methods.get(m.name).push(m);
          break;
        }
        case 'ctor': m.cls = cls; m.typeParamSet = new Set(m.typeParams.map((t) => t.name)); cls.ctors.push(m); break;
        case 'init': (m.static ? cls.staticInit : cls.instInit).push(m); break;
        case 'class': cls.nested.set(m.name, this.declareClass(m, unit, cls, builtin)); break;
        default: break;
      }
    }
    if (cls.isRecord) for (const c of decl.recordComps) cls.instFields.set(c.name, c.type);
    if (!decl.anonymous) {
      const map = builtin ? this.prelude : this.classes;
      if (builtin) map.set(decl.name, cls);
      else { if (!map.has(decl.name)) map.set(decl.name, []); map.get(decl.name).push(cls); }
    }
    return cls;
  }

  superOf(cls) {
    if (cls.sup !== undefined) return cls.sup;
    cls.sup = null;
    const ext = cls.decl.ext;
    if (ext) {
      const r = this.resolveType(ext.name, cls, ext.qual);
      if (r && r.cls) cls.sup = r.cls;
      else if (r && r.lib && !cls.decl.anonymous) throw this.compileError('extending the library class ' + ext.name + ' is not supported', ext);
    }
    return cls.sup;
  }
  ifacesOf(cls) {
    if (cls.ifaces !== undefined) return cls.ifaces;
    cls.ifaces = [];
    const list = [...cls.decl.impls];
    if (cls.decl.anonymous && cls.decl.ext) list.push(cls.decl.ext);
    for (const t of list) {
      const r = this.resolveType(t.name, cls, t.qual);
      if (r && r.cls && r.cls.isInterface) cls.ifaces.push(r.cls);
    }
    return cls.ifaces;
  }
  isSubclass(c, target) {
    for (let k = c; k; k = this.superOf(k)) {
      if (k === target) return true;
      for (const i of this.ifacesOf(k)) if (this.isSubclass(i, target)) return true;
    }
    return false;
  }
  isSubclassName(c, name) {
    for (let k = c; k; k = this.superOf(k)) {
      if (k.name === name) return true;
      for (const t of k.decl.impls) if (t.name === name) return true;
      if (k.decl.anonymous && k.decl.ext && k.decl.ext.name === name) return true;
      for (const i of this.ifacesOf(k)) if (this.isSubclassName(i, name)) return true;
    }
    return false;
  }

  // resolve a simple (or qualified) type name from the context of class `ctx`
  // → { cls } | { lib: fullName } | { holder: name } | null
  resolveType(name, ctx, qual) {
    if (qual && qual.includes('.') && ALL_LIB_NAMES.has(qual)) return { lib: qual };
    for (let c = ctx; c; c = c.outer) {
      if (c.name === name && !c.anonymous) return { cls: c };
      const n = c.nested.get(name);
      if (n) return { cls: n };
      // nested classes inherited from superclasses
      for (let s = c.sup || null; s; s = s.sup || null) { const m = s.nested.get(name); if (m) return { cls: m }; }
    }
    const unit = ctx ? ctx.unit : null;
    if (unit && unit.importMap.has(name)) {
      const full = unit.importMap.get(name);
      const users = this.classes.get(name);
      if (users) { const u = users.find((c) => !c.outer && c.fullName === full) || users.find((c) => !c.outer); if (u && (u.fullName === full || !ALL_LIB_NAMES.has(full))) return { cls: u }; }
      if (ALL_LIB_NAMES.has(full)) return { lib: full };
    }
    const users = this.classes.get(name);
    if (users) {
      const top = users.find((c) => !c.outer) || users[0];
      return { cls: top };
    }
    if (this.prelude.has(name)) return { cls: this.prelude.get(name) };
    if (unit) for (const pkg of unit.starPkgs) { const full = pkg + '.' + name; if (ALL_LIB_NAMES.has(full)) return { lib: full }; }
    if (DEFAULT_NAMES[name]) return { lib: DEFAULT_NAMES[name] };
    if (STATIC_HOLDERS.has(name)) return { holder: name };
    for (const full of ALL_LIB_NAMES) if (simpleOf(full) === name) return { lib: full };
    return null;
  }

  // ── errors and limits ────────────────────────────────────────────
  compileError(msg, node) {
    return new CompileError(msg, node ? node.line : 0, node ? node.col : 0, this.curFile);
  }
  tick(node) {
    this.cur = node;
    if (++this.steps > this.maxSteps) throw new RunLimit('limit', 'Step limit reached (' + this.maxSteps + ' steps): an infinite loop or too much work for the simulator');
    if ((this.steps & 1023) === 0) {
      if (Date.now() - this.started > this.maxMs) throw new RunLimit('limit', 'Time limit reached (' + this.maxMs + ' ms)');
      if ((this.shouldCancel && this.shouldCancel()) || (this.cancelFlag && Atomics.load(this.cancelFlag, 0) !== 0)) throw new RunLimit('cancelled', 'Run cancelled');
    }
  }
  // create a Java exception from the library (prelude class) and throw it
  throwJava(name, message) {
    throw new JavaThrow(this.makeException(name, message));
  }
  makeException(name, message) {
    const cls = this.prelude.get(name) || this.prelude.get('RuntimeException');
    const msg = message === null || message === undefined ? null : String(message);
    this.quiet++;
    try {
      return this.newObject(cls, msg === null ? [] : [msg], null);
    } finally { this.quiet--; }
  }
  exceptionTypeName(ex) { return ex.cls.name; }

  // ── recording ───────────────────────────────────────────────────
  lineText(file, line) {
    const lines = this.files.get(file);
    if (!lines || !line) return '';
    let t = (lines[line - 1] || '').trim().replace(/\s*\/\/.*$/, '');
    if (t.length > 90) t = t.slice(0, 87) + '…';
    return t;
  }
  rec(frame, line, caption) {
    if (!this.recorder || this.quiet || frame.quiet) return;
    this.flushStructures();
    this.recorder.step(caption == null ? this.lineText(frame.file, line) : caption, { line, vars: this.varsOf(frame), file: this.files.size > 1 ? frame.file : undefined });
  }
  varsOf(frame) {
    const chain = [];
    for (let s = frame.scope; s; s = Object.getPrototypeOf(s)) chain.push(s);
    const vars = {};
    this.quiet++;
    try {
      for (let i = chain.length - 1; i >= 0; i--) for (const k of Object.keys(chain[i])) vars[k] = this.show(chain[i][k].v);
      if (frame.self) {
        let n = 0;
        for (const k of Object.keys(frame.self.f)) { if (n++ >= 12) break; vars['this.' + k] = this.show(frame.self.f[k]); }
      }
    } finally { this.quiet--; }
    return vars;
  }

  trackable(v) {
    if (v instanceof JArray) return true;
    return v instanceof LibObject && v._kind() !== 'value';
  }
  // a library object or array bound to a local variable or field becomes a structure
  bind(key, label, v, declared) {
    if (!this.recorder || this.quiet || !this.trackable(v) || v._sid) return;
    let s = this.structs.get(key);
    const kind = this.kindOf(v, declared);
    if (!s) {
      let id = label;
      for (let n = 2; this.structIds.has(id); n++) id = label + n;
      this.structIds.add(id);
      s = { id, obj: null };
      this.structs.set(key, s);
    }
    this.recorder.structure(s.id, kind, label);
    if (s.obj && s.obj._sid === s.id) s.obj._sid = null;
    s.obj = v;
    v._sid = s.id;
    this.dirty.add(v);
  }
  kindOf(v, declared) {
    if (v instanceof JArray) return v.t && v.t.dims > 0 ? 'matrix' : 'array';
    return v._kind(declared ? declared.name : null);
  }
  structChanged(obj, op, path, from, to) {
    this.dirty.add(obj);
    if (!this.pendingChanges.has(obj)) this.pendingChanges.set(obj, []);
    this.pendingChanges.get(obj).push({ op, path, from, to });
  }
  flushStructures() {
    if (!this.dirty.size) return;
    for (const obj of this.dirty) {
      if (!obj._sid) continue;
      this.recorder.set(obj._sid, this.snapshot(obj), this.pendingChanges.get(obj));
    }
    this.dirty.clear();
    this.pendingChanges.clear();
  }
  snapshot(obj) {
    this.quiet++;
    try {
      if (obj instanceof JArray) {
        if (obj.t && obj.t.dims > 0) {
          const rows = obj.a.map((r) => { if (r instanceof JArray) r._owner = obj; return r instanceof JArray ? r.a.map((x) => this.item(x)) : null; });
          return { rows: rows.length, cols: rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0), cells: rows };
        }
        const snap = { items: obj.a.map((x) => this.item(x)) };
        if (obj._ptr) snap.pointers = { ...obj._ptr };
        return snap;
      }
      return obj._snap();
    } finally { this.quiet--; }
  }
  arrayTouched(arr, i, op, from, to) {
    const target = arr._sid ? arr : arr._owner && arr._owner._sid ? arr._owner : null;
    if (!target || !this.recorder) return;
    const path = target === arr ? [i] : [target.a.indexOf(arr), i];
    if (op) this.structChanged(target, op, path, from, to);
    else this.dirty.add(target);
    this.recorder.mark(target._sid, path.join(','), op ? 'current' : 'compare');
  }

  // display of a value for vars and structures (never runs user code)
  show(v) {
    if (v === null || v === undefined) return 'null';
    switch (typeof v) {
      case 'number': case 'boolean': return v;
      case 'bigint': return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      case 'string': return JSON.stringify(v);
      default: break;
    }
    if (v instanceof String) return JSON.stringify(v.valueOf());
    if (v instanceof JDouble) return Number.isFinite(v.v) ? v.v : doubleToString(v.v);
    if (v instanceof JChar) return "'" + String.fromCharCode(v.c) + "'";
    if (v instanceof Vertex) return String(this.item(v.value));
    if (v instanceof LibObject && v._jname === 'StringBuilder') return JSON.stringify(v.s);
    if (v instanceof JArray) return '[' + v.a.slice(0, 30).map((x) => this.item(x)).map((x) => (typeof x === 'string' ? x : String(x))).join(', ') + (v.a.length > 30 ? ', …' : '') + ']';
    return this.displayStr(v);
  }
  // an element of a structure snapshot: numbers and booleans as such, the rest as text
  item(v) {
    if (v === null || v === undefined) return null;
    switch (typeof v) {
      case 'number': case 'boolean': return v;
      case 'bigint': return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      case 'string': return v;
      default: break;
    }
    if (v instanceof JDouble) return Number.isFinite(v.v) ? v.v : doubleToString(v.v);
    if (v instanceof JArray) return '[' + v.a.map((x) => String(this.item(x))).join(', ') + ']';
    if (v instanceof Vertex) return this.item(v.value); // a vertex is shown as its value
    return this.displayStr(v);
  }
  prio(v) { const k = nkind(v); return k ? toNumber(v) : this.item(v); }
  displayStr(v) {
    this.quiet++;
    const was = this.displayMode;
    this.displayMode = true;
    try { return v instanceof LibObject && v._show ? v._show() : this.str(v); } finally { this.displayMode = was; this.quiet--; }
  }
  // String.valueOf(v), calling the user's toString() (except while displaying)
  str(v) {
    return jstr(v, (o) => this.userToString(o));
  }
  userToString(o) {
    if (this.displayMode) {
      if (o.cls.isEnum) return o.f.$name;
      const m = this.findMethod(o.cls, 'toString', []);
      if (m && m.cls.builtin) return this.withQuiet(() => sv(this.invoke(m, o, [], null)));
      const fields = Object.keys(o.f).filter((k) => k[0] !== '$').slice(0, 6).map((k) => k + '=' + (o.f[k] instanceof JObject ? o.f[k].cls.name + '@…' : this.item(o.f[k])));
      return o.cls.name + (fields.length ? '{' + fields.join(', ') + '}' : '@' + o.hash.toString(16));
    }
    const m = this.findMethod(o.cls, 'toString', []);
    if (m) return this.str(this.invoke(m, o, [], null));
    if (o.cls.isEnum) return o.f.$name;
    if (o.cls.isRecord) return o.cls.name + '[' + o.cls.decl.recordComps.map((c) => c.name + '=' + this.str(o.f[c.name])).join(', ') + ']';
    return o.cls.fullName + '@' + o.hash.toString(16);
  }
  withQuiet(fn) { this.quiet++; try { return fn(); } finally { this.quiet--; } }
  print(text, isErr) {
    if (isErr) this.err += text; else this.out += text;
    if (this.recorder && !isErr) {
      if (!this.structIds.has('console')) { this.structIds.add('console'); this.recorder.structure('console', 'text', 'Console'); }
      this.recorder.set('console', { text: this.out });
    }
  }
  clock() { return this.started + Math.floor(this.steps / 10); }
  random() { if (!this._random) this._random = new Random(this, 42); return this._random; }
  exit(code) { throw new ExitSignal(code); }

  // ── equality, hashing, comparison used by the library ───────────
  equals(a, b) { return javaEquals(a, b, this); }
  hash(v) { return javaHash(v, this); }
  compare(a, b) { return javaCompare(a, b, this); }
  truthy(v) { return v === true; }
  intOf(v) { const k = nkind(v); if (k === 'i') return v; if (k) return Math.trunc(toNumber(v)); this.throwJava('ClassCastException', 'a comparator must return an int'); return 0; }
  userEquals(a, b) {
    const m = this.findMethod(a.cls, 'equals', [b]);
    if (m) return this.invoke(m, a, [b], null) === true;
    if (a.cls.isRecord) return b instanceof JObject && b.cls === a.cls && a.cls.decl.recordComps.every((c) => this.equals(a.f[c.name], b.f[c.name]));
    return a === b;
  }
  userHash(o) {
    const m = this.findMethod(o.cls, 'hashCode', []);
    if (m) return this.invoke(m, o, [], null) | 0;
    if (o.cls.isRecord) { let h = 0; for (const c of o.cls.decl.recordComps) h = (Math.imul(31, h) + this.hash(o.f[c.name])) | 0; return h; }
    return o.hash;
  }
  userCompare(a, b) {
    if (a.cls.isEnum && b instanceof JObject && b.cls.isEnum) return a.f.$ordinal - b.f.$ordinal;
    const m = this.findMethod(a.cls, 'compareTo', [b]);
    if (!m) this.throwJava('ClassCastException', 'class ' + a.cls.fullName + ' cannot be cast to class java.lang.Comparable');
    return this.intOf(this.invoke(m, a, [b], null));
  }
  className(v) {
    if (v === null) return 'null';
    if (isStr(v)) return 'java.lang.String';
    const k = nkind(v);
    if (k) return 'java.lang.' + { i: 'Integer', l: 'Long', d: 'Double', c: 'Character' }[k];
    if (typeof v === 'boolean') return 'java.lang.Boolean';
    if (v instanceof JObject) return v.cls.fullName;
    if (v instanceof LibObject) return v._qname();
    return 'java.lang.Object';
  }
  classRefOf(v) { return v instanceof JObject ? new ClassRef(v.cls, null) : new ClassRef(null, this.className(v)); }
  sortArray(arr, cmp) {
    const f = cmp ? (a, b) => this.intOf(this.callFn(cmp, 'compare', [a, b])) : (a, b) => this.compare(a, b);
    arr.sort(f);
  }
  makeComparator(fn) { return new LibFn(this, fn); }
  thenCompare(o, a, b) {
    // thenComparing(Comparator) or thenComparing(keyExtractor)
    if (o instanceof JLambda && o.params && o.params.length === 1) return this.compare(this.callFn(o, 'apply', [a]), this.callFn(o, 'apply', [b]));
    return this.intOf(this.callFn(o, 'compare', [a, b]));
  }
  iterateToArray(v) {
    const out = [];
    this.forEachValue(v, (x) => { out.push(x); }, null);
    return out;
  }
  noMethod(type, name, args) {
    throw this.compileError('cannot find symbol: method ' + name + '(' + args.map((a) => simpleOf(this.className(a))).join(', ') + ') in ' + simpleOf(type), this.cur);
  }

  // ── functional values ───────────────────────────────────────────
  callFn(f, method, args) {
    if (f === null || f === undefined) this.throwJava('NullPointerException', null);
    if (f instanceof JLambda) return this.invokeLambda(f, args);
    if (f instanceof LibFn) return f.fn(...args);
    if (f instanceof JObject) {
      let m = this.findMethod(f.cls, method, args);
      if (!m) m = this.singleMethod(f.cls, args.length);
      if (!m) this.throwJava('ClassCastException', 'class ' + f.cls.fullName + ' is not a functional interface with ' + method);
      return this.invoke(m, f, args, null);
    }
    if (f instanceof LibObject && typeof f[method] === 'function') return f[method](...args);
    this.throwJava('ClassCastException', 'not a functional interface');
    return null;
  }
  singleMethod(cls, arity) {
    for (let c = cls; c; c = this.superOf(c)) {
      for (const [name, ms] of c.methods) {
        if (['toString', 'equals', 'hashCode'].includes(name)) continue;
        const m = ms.find((x) => !x.isStatic && x.body && x.params.length === arity);
        if (m) return m;
      }
    }
    return null;
  }
  invokeLambda(f, args) {
    if (f.mref) return this.invokeMref(f, args);
    const frame = f.frame;
    const scope = Object.create(f.scope);
    f.params.forEach((p, i) => { scope[p.name] = { v: p.type ? this.coerce(args[i], p.type) : args[i], t: p.type }; });
    const lf = { cls: frame.cls, self: frame.self, scope, name: frame.name, file: frame.file, quiet: frame.quiet, method: frame.method };
    if (++this.depth > this.maxDepth) { this.depth--; this.throwOverflow(); }
    try {
      if (f.expr) {
        this.tick(f.expr);
        const v = this.eval(f.expr, lf);
        this.rec(lf, f.expr.line, this.lineText(lf.file, f.expr.line) + '  → ' + this.show(v));
        return v;
      }
      const r = this.execBlock(f.body, lf);
      return r && r.c === 'r' ? r.v : undefined;
    } finally { this.depth--; }
  }
  invokeMref(f, args) {
    const { target, name, frame, node } = f.mref;
    if (name === 'new') {
      if (target.arrayType) return this.newArray({ ...target.arrayType, dims: target.arrayType.dims }, [args[0]], node);
      return this.construct(target.typeName, target.ctx, args, node, frame);
    }
    if (target.value !== undefined) return this.invokeOn(target.value, name, args, node, frame);
    if (target.classRef) {
      const ref = target.classRef;
      // static method, or an instance method of the first argument (String::length)
      if (ref.cls) {
        const m = this.findMethod(ref.cls, name, args, true);
        if (m && m.isStatic) return this.invoke(m, null, args, node);
        return this.invokeOn(args[0], name, args.slice(1), node, frame);
      }
      const holder = STATICS[ref.lib];
      if (holder && holder[name] && !(args.length === 1 && ['toString', 'hashCode', 'intValue', 'length'].includes(name) && !(holder === STATICS.Integer && name === 'toString'))) return holder[name](this, args);
      return this.invokeOn(args[0], name, args.slice(1), node, frame);
    }
    return null;
  }

  // ── classes: initialisation, objects, methods ───────────────────
  ensureInit(cls) {
    if (cls.init) return;
    cls.init = 1;
    const sup = this.superOf(cls);
    if (sup) this.ensureInit(sup);
    for (const [name, t] of cls.staticFields) cls.statics[name] = defaultFor(t);
    const frame = this.staticFrame(cls);
    if (cls.isEnum) {
      cls.enumValues = [];
      cls.decl.enumConsts.forEach((ec, i) => {
        const args = ec.args.map((a) => this.eval(a, frame));
        const target = ec.body ? this.anonClass(ec.body, cls, frame) : cls;
        const obj = this.allocate(target, null);
        obj.f.$name = ec.name;
        obj.f.$ordinal = i;
        this.runCtor(target, obj, args, ec, frame);
        cls.statics[ec.name] = obj;
        cls.enumValues.push(obj);
      });
    }
    for (const init of cls.staticInit) this.runInit(init, frame, null, cls);
    cls.init = 2;
  }
  staticFrame(cls) {
    return { cls, self: null, scope: Object.create(null), name: cls.name + '.<clinit>', file: cls.unit.file, quiet: cls.builtin };
  }
  runInit(init, frame, obj, cls) {
    if (init.k === 'fieldInit') {
      const d = init.d;
      if (!d.init) return;
      this.tick(init);
      const v = this.coerce(d.init.k === 'arrayInit' ? this.evalArrayInit(d.init, frame) : this.eval(d.init, frame), d.type);
      if (obj) obj.f[d.name] = v; else cls.statics[d.name] = v;
      this.bind(cls.name + '.' + d.name, d.name, v, d.type);
      this.rec(frame, init.line);
      return;
    }
    const r = this.execBlock(init.body, frame);
    if (r) throw this.compileError('initializer must be able to complete normally', init);
  }
  allocate(cls, outerSelf) {
    const obj = new JObject(cls);
    const chain = [];
    for (let c = cls; c; c = this.superOf(c)) chain.unshift(c);
    for (const c of chain) for (const [name, t] of c.instFields) obj.f[name] = defaultFor(t);
    obj.outer = outerSelf;
    return obj;
  }
  newObject(cls, args, node, frame, outerSelf = null) {
    if (cls.isInterface || cls.decl.mods.has('abstract')) throw this.compileError(cls.name + ' is abstract; cannot be instantiated', node || this.cur);
    if (cls.isEnum) throw this.compileError('enum classes may not be instantiated', node || this.cur);
    this.ensureInit(cls);
    const obj = this.allocate(cls, outerSelf);
    if (this.isThrowable(cls)) {
      obj.$loc = this.cur ? { line: this.cur.line, col: this.cur.col, file: this.curFile } : null;
      obj.$stack = this.callStack.slice();
    }
    this.runCtor(cls, obj, args, node, frame);
    return obj;
  }
  objectClass() {
    if (!this._objectCls) {
      this.load('public class Object {}', '<object>', true);
      this._objectCls = this.prelude.get('Object');
    }
    return this._objectCls;
  }
  isThrowable(cls) { for (let c = cls; c; c = this.superOf(c)) if (c.name === 'Throwable' && c.builtin) return true; return false; }
  runCtor(cls, obj, args, node, callerFrame) {
    const sup = this.superOf(cls);
    let ctor = null;
    if (cls.ctors.length) {
      ctor = this.pickMethod(cls.ctors.filter((c) => !c.compact), args);
      if (!ctor && cls.isRecord && args.length === cls.decl.recordComps.length) ctor = null;
      else if (!ctor) throw this.compileError('no suitable constructor found for ' + cls.name + '(' + args.map((a) => simpleOf(this.className(a))).join(', ') + ')', node || this.cur);
    } else if (args.length && !cls.anonymous && !cls.isRecord) {
      throw this.compileError('constructor ' + cls.name + ' in class ' + cls.name + ' cannot be applied to given types', node || this.cur);
    }
    if (!ctor) {
      // implicit constructor (anonymous classes pass their arguments to the superclass)
      if (sup && !cls.isEnum) this.runCtor(sup, obj, cls.anonymous ? args : [], node, callerFrame);
      const frame = { cls, self: obj, scope: Object.create(null), name: cls.name + '.<init>', file: cls.unit.file, quiet: cls.builtin };
      if (cls.isRecord) {
        const compact = cls.ctors.find((c) => c.compact);
        cls.decl.recordComps.forEach((c, i) => { frame.scope[c.name] = { v: this.coerce(args[i], c.type), t: c.type }; });
        if (compact) this.execBlock(compact.body, frame);
        cls.decl.recordComps.forEach((c) => { obj.f[c.name] = frame.scope[c.name].v; });
      }
      for (const init of cls.instInit) this.runInit(init, frame, obj, cls);
      return;
    }
    const frame = this.enterFrame(ctor, obj, args, node, 'new ' + cls.name);
    try {
      const stmts = ctor.body.stmts;
      let start = 0;
      const first = stmts[0];
      if (first && first.k === 'ctorCall') {
        start = 1;
        this.tick(first);
        const a2 = first.args.map((a) => this.eval(a, frame));
        if (first.kind === 'this') {
          this.runCtor(cls, obj, a2, first, frame);
          this.rec(frame, first.line);
        } else {
          if (sup) this.runCtor(sup, obj, a2, first, frame);
          this.rec(frame, first.line);
          for (const init of cls.instInit) this.runInit(init, frame, obj, cls);
        }
      } else {
        if (sup && !cls.isEnum) this.runCtor(sup, obj, [], node, frame);
        for (const init of cls.instInit) this.runInit(init, frame, obj, cls);
      }
      for (let i = start; i < stmts.length; i++) {
        const r = this.exec(stmts[i], frame);
        if (r) { if (r.c === 'r') break; throw this.compileError('break outside switch or loop', stmts[i]); }
      }
    } finally { this.leaveFrame(frame); }
  }

  enterFrame(m, self, args, node, label) {
    const cls = m.cls;
    if (++this.depth > this.maxDepth) { this.depth--; this.throwOverflow(); }
    const frame = { cls, self, scope: Object.create(null), name: label, file: cls.unit.file, quiet: cls.builtin || this.quiet > 0, method: m };
    const ps = m.params;
    const n = ps.length;
    let a = args;
    if (n && ps[n - 1].varargs && !(args.length === n && (args[n - 1] instanceof JArray || args[n - 1] === null))) {
      const elemT = { ...ps[n - 1].type, dims: ps[n - 1].type.dims - 1 };
      a = args.slice(0, n - 1).concat([new JArray(elemT, args.slice(n - 1).map((x) => this.coerce(x, elemT)))]);
    }
    for (let i = 0; i < n; i++) {
      const t = this.isTypeVar(ps[i].type, m) ? null : ps[i].type;
      frame.scope[ps[i].name] = { v: t ? this.coerce(a[i], t) : a[i], t };
    }
    this.callStack.push({ name: (cls.anonymous ? cls.outer.name + '$' : cls.name + '.') + (m.k === 'ctor' ? '<init>' : m.name), line: node ? node.line : null, file: this.curFile });
    const prevFile = this.curFile;
    frame.prevFile = prevFile;
    this.curFile = frame.file;
    if (this.recorder && !frame.quiet) {
      this.recorder.call(m.k === 'ctor' ? 'new ' + cls.name : m.name, ps.map((p) => this.argText(frame.scope[p.name].v)).join(', '));
      this.rec(frame, m.line, label === undefined ? null : (m.k === 'ctor' ? 'new ' + cls.name : m.name) + '(' + ps.map((p) => this.argText(frame.scope[p.name].v)).join(', ') + ')');
      for (const p of ps) this.bind(this.frameKey(frame, p.name), p.name, frame.scope[p.name].v, p.type);
    }
    return frame;
  }
  leaveFrame(frame) {
    this.depth--;
    this.callStack.pop();
    this.curFile = frame.prevFile;
    if (this.recorder && !frame.quiet) this.recorder.ret();
  }
  argText(v) { const s = this.show(v); return typeof s === 'string' ? s : String(s); }
  frameKey(frame, name) { return frame.cls.name + '.' + (frame.method ? frame.method.name : frame.name) + '.' + name; }
  throwOverflow() {
    if (!this.overflowObj) this.overflowObj = this.makeException('StackOverflowError', null);
    this.overflowObj.$loc = this.cur ? { line: this.cur.line, col: this.cur.col, file: this.curFile } : null;
    throw new JavaThrow(this.overflowObj);
  }
  isTypeVar(t, m) {
    if (!t || t.dims || PRIMS.has(t.name)) return false;
    if (m && m.typeParamSet && m.typeParamSet.has(t.name)) return true;
    for (let c = m && m.cls; c; c = c.outer) if (c.typeParams.has(t.name)) return true;
    return false;
  }

  invoke(m, self, args, node) {
    if (!m.body) throw this.compileError('missing method body, or declare abstract: ' + m.name, node || m);
    const frame = this.enterFrame(m, self, args, node, null);
    try {
      const r = this.execBlock(m.body, frame, true);
      let v = r && r.c === 'r' ? r.v : undefined;
      if (r && r.c !== 'r') throw this.compileError('break outside switch or loop', m);
      if (m.ret.name === 'void' && !m.ret.dims) return undefined;
      if (v === undefined) throw this.compileError('missing return statement in ' + m.name, { line: m.endLine, col: 1 });
      if (!this.isTypeVar(m.ret, m)) v = this.coerce(v, m.ret);
      return v;
    } catch (e) {
      if (e instanceof RangeError) this.throwOverflow(); // the JS stack ran out first
      throw e;
    } finally { this.leaveFrame(frame); }
  }

  // methods named `name` visible from cls (own, superclasses, interface defaults), own first
  methodsNamed(cls, name) {
    let list = cls.mcache.get(name);
    if (list) return list;
    list = [];
    const seen = new Set();
    const add = (c) => {
      if (seen.has(c)) return;
      seen.add(c);
      const ms = c.methods.get(name);
      if (ms) list.push(...ms);
    };
    for (let c = cls; c; c = this.superOf(c)) add(c);
    const ifs = (c) => { for (const i of this.ifacesOf(c)) { add(i); ifs(i); } };
    for (let c = cls; c; c = this.superOf(c)) ifs(c);
    cls.mcache.set(name, list);
    return list;
  }
  findMethod(cls, name, args, includeAbstract) {
    const ms = this.methodsNamed(cls, name).filter((m) => includeAbstract || m.body);
    if (!ms.length) return null;
    return this.pickMethod(ms, args);
  }
  pickMethod(ms, args) {
    let best = null, bestScore = -1;
    for (const m of ms) {
      const s = this.matchScore(m, args);
      if (s > bestScore) { best = m; bestScore = s; }
    }
    return best;
  }
  matchScore(m, args) {
    const ps = m.params;
    const n = ps.length;
    const varargs = n && ps[n - 1].varargs;
    if (!varargs && args.length !== n) return -1;
    if (varargs && args.length < n - 1) return -1;
    let total = 0;
    for (let i = 0; i < args.length; i++) {
      let t;
      if (varargs && i >= n - 1) {
        t = ps[n - 1].type;
        if (!(args.length === n && (args[i] instanceof JArray || args[i] === null))) t = { ...t, dims: t.dims - 1 };
      } else t = ps[i].type;
      const s = this.typeScore(t, args[i], m);
      if (s < 0) return -1;
      total += s;
    }
    return total + (varargs ? 0 : 1);
  }
  typeScore(t, v, m) {
    if (t.dims) return v === null ? 1 : v instanceof JArray ? 3 : -1;
    const name = t.name;
    const k = nkind(v);
    if (PRIMS.has(name)) {
      if (v === null || v === undefined) return -1;
      if (INTLIKE.has(name)) return k === 'i' ? 3 : k === 'c' ? 1 : -1;
      if (name === 'long') return k === 'l' ? 3 : k === 'i' || k === 'c' ? 1 : -1;
      if (name === 'double' || name === 'float') return k === 'd' ? 3 : k ? 1 : -1;
      if (name === 'char') return k === 'c' ? 3 : -1;
      return typeof v === 'boolean' ? 3 : -1;
    }
    if (v === null || v === undefined) return 1;
    if (BOXES[name]) {
      const p = BOXES[name];
      if (INTLIKE.has(p)) return k === 'i' ? 3 : -1;
      if (p === 'long') return k === 'l' ? 3 : -1;
      if (p === 'double' || p === 'float') return k === 'd' ? 3 : -1;
      if (p === 'char') return k === 'c' ? 3 : -1;
      return typeof v === 'boolean' ? 3 : -1;
    }
    if (name === 'String' || name === 'CharSequence') return isStr(v) ? 3 : -1;
    if (name === 'Object' || this.isTypeVar(t, m)) return 1;
    if (name === 'Number') return k && k !== 'c' ? 2 : -1;
    if (name === 'Comparable') return 1;
    const r = this.resolveType(name, m.cls, t.qual);
    if (r && r.cls) {
      if (v instanceof JObject) return this.isSubclass(v.cls, r.cls) ? 2 : -1;
      if (v instanceof JLambda || v instanceof LibFn) return r.cls.isInterface ? 2 : -1;
      return r.cls.isInterface ? 0 : -1;
    }
    if (v instanceof LibObject) return v._types.includes(name) ? 2 : 0;
    if (k || typeof v === 'boolean' || isStr(v)) return -1;
    return 1;
  }

  // ── values: coercion and casts ──────────────────────────────────
  coerce(v, t) {
    if (!t || t.dims || t.name === 'var') return v;
    const name = t.name;
    const p = PRIMS.has(name) ? name : BOXES[name];
    if (!p) return v;
    if (v === null || v === undefined) {
      if (PRIMS.has(name)) this.throwJava('NullPointerException', 'Cannot unbox a null value');
      return null;
    }
    const k = nkind(v);
    switch (p) {
      case 'int': return k === 'i' ? v : k === 'c' ? v.c : k === 'l' ? Number(BigInt.asIntN(32, v)) : k === 'd' ? this.d2i(v.v) : v;
      case 'short': return k === 'c' ? (v.c << 16) >> 16 : k === 'i' ? (v << 16) >> 16 : v;
      case 'byte': return k === 'c' ? (v.c << 24) >> 24 : k === 'i' ? (v << 24) >> 24 : v;
      case 'long': return k === 'l' ? v : k === 'i' ? BigInt(v) : k === 'c' ? BigInt(v.c) : k === 'd' ? this.d2l(v.v) : v;
      case 'double': return k === 'd' && !v.f ? v : k ? dbl(toNumber(v)) : v;
      case 'float': return k ? flt(toNumber(v)) : v;
      case 'char': return k === 'c' ? v : k === 'i' ? jchar(v) : k ? jchar(Math.trunc(toNumber(v))) : v;
      default: return v;
    }
  }
  d2i(d) { if (Number.isNaN(d)) return 0; if (d >= 2147483647) return 2147483647; if (d <= -2147483648) return -2147483648; return Math.trunc(d); }
  d2l(d) { if (Number.isNaN(d)) return 0n; if (d >= 9.223372036854776e18) return 9223372036854775807n; if (d <= -9.223372036854776e18) return -9223372036854775808n; return BigInt(Math.trunc(d)); }
  cast(v, t, node, frame) {
    if (t.dims) { if (v !== null && !(v instanceof JArray)) this.throwJava('ClassCastException', 'class ' + this.className(v) + ' cannot be cast to an array'); return v; }
    const name = t.name;
    if (PRIMS.has(name)) {
      if (v === null) this.throwJava('NullPointerException', 'Cannot unbox a null value');
      if (name === 'boolean') return v;
      return this.coerce(v, t);
    }
    if (v === null) return null;
    if (BOXES[name]) {
      const p = BOXES[name];
      const k = nkind(v);
      const ok = (INTLIKE.has(p) && k === 'i') || (p === 'long' && k === 'l') || ((p === 'double' || p === 'float') && k === 'd') || (p === 'char' && k === 'c') || (p === 'boolean' && typeof v === 'boolean');
      if (!ok) this.throwJava('ClassCastException', 'class ' + this.className(v) + ' cannot be cast to class java.lang.' + name);
      return v;
    }
    if (name === 'String' && !isStr(v)) this.throwJava('ClassCastException', 'class ' + this.className(v) + ' cannot be cast to class java.lang.String');
    if (v instanceof JObject && frame) {
      const r = this.resolveType(name, frame.cls, t.qual);
      if (r && r.cls && !r.cls.isInterface && !this.isSubclass(v.cls, r.cls)) this.throwJava('ClassCastException', 'class ' + v.cls.fullName + ' cannot be cast to class ' + r.cls.fullName);
    }
    return v;
  }
  isInstance(v, t, frame) {
    if (v === null || v === undefined) return false;
    if (t.dims) return v instanceof JArray;
    const name = t.name;
    if (name === 'Object') return true;
    const k = nkind(v);
    switch (name) {
      case 'String': case 'CharSequence': return isStr(v);
      case 'Integer': return k === 'i';
      case 'Long': return k === 'l';
      case 'Double': return k === 'd';
      case 'Float': return k === 'd';
      case 'Character': return k === 'c';
      case 'Boolean': return typeof v === 'boolean';
      case 'Number': return !!k && k !== 'c';
      case 'Comparable': return isStr(v) || !!k || typeof v === 'boolean' || (v instanceof JObject && this.isSubclassName(v.cls, 'Comparable'));
      default: break;
    }
    if (v instanceof JObject) {
      const r = frame ? this.resolveType(name, frame.cls, t.qual) : null;
      if (r && r.cls) return this.isSubclass(v.cls, r.cls);
      return this.isSubclassName(v.cls, name);
    }
    if (v instanceof LibObject) return v._types.includes(name);
    return false;
  }

  // ── statements ──────────────────────────────────────────────────
  execBlock(block, frame, isBody) {
    const saved = frame.scope;
    if (!isBody) frame.scope = Object.create(saved);
    try {
      for (const s of block.stmts) {
        const r = this.exec(s, frame);
        if (r) return r;
      }
      return undefined;
    } finally { frame.scope = saved; }
  }

  exec(s, frame) {
    switch (s.k) {
      case 'expr': {
        this.tick(s);
        this.eval(s.e, frame);
        this.rec(frame, s.line);
        return undefined;
      }
      case 'local': return this.execLocal(s, frame);
      case 'block': return this.execBlock(s, frame);
      case 'if': {
        this.tick(s);
        const c = this.cond(s.cond, frame);
        this.rec(frame, s.line, this.condCaption(frame, s.cond, c));
        if (c) return this.exec(s.then, frame);
        if (s.else) return this.exec(s.else, frame);
        return undefined;
      }
      case 'while': return this.execLoop(s, frame, null);
      case 'do': return this.execLoop(s, frame, null);
      case 'for': return this.execLoop(s, frame, null);
      case 'foreach': return this.execLoop(s, frame, null);
      case 'labeled': {
        if (['while', 'do', 'for', 'foreach'].includes(s.body.k)) {
          const r = this.execLoop(s.body, frame, s.label);
          return r;
        }
        const r = this.exec(s.body, frame);
        if (r && r.c === 'b' && r.l === s.label) return undefined;
        return r;
      }
      case 'return': {
        this.tick(s);
        const v = s.e ? this.eval(s.e, frame) : undefined;
        if (s.e) this.rec(frame, s.line, 'return ' + this.argText(v));
        else this.rec(frame, s.line);
        return { c: 'r', v };
      }
      case 'break': this.tick(s); this.rec(frame, s.line); return { c: 'b', l: s.label };
      case 'continue': this.tick(s); this.rec(frame, s.line); return { c: 'c', l: s.label };
      case 'yield': {
        this.tick(s);
        const v = this.eval(s.e, frame);
        this.rec(frame, s.line);
        return { c: 'y', v };
      }
      case 'throw': return this.execThrow(s, frame);
      case 'try': return this.execTry(s, frame);
      case 'switch': return this.execSwitch(s, frame, false);
      case 'empty': return undefined;
      case 'ctorCall': throw this.compileError('call to ' + s.kind + ' must be first statement in constructor', s);
      case 'assert': {
        this.tick(s);
        if (this.opts.assertions && !this.cond(s.cond, frame)) this.throwJava('AssertionError', s.msg ? this.str(this.eval(s.msg, frame)) : null);
        return undefined;
      }
      default: throw this.compileError('unsupported statement: ' + s.k, s);
    }
  }
  execLocal(s, frame) {
        this.tick(s);
        for (const d of s.decls) {
          if (Object.prototype.hasOwnProperty.call(frame.scope, d.name)) throw this.compileError('variable ' + d.name + ' is already defined in method ' + (frame.method ? frame.method.name : frame.name), d);
          let v;
          let t = d.type;
          if (d.init) {
            v = d.init.k === 'arrayInit' ? this.evalArrayInit(d.init, frame) : this.eval(d.init, frame);
            if (t.name === 'var') t = this.inferType(v);
            else v = this.coerce(v, t);
          } else v = undefined; // definitely unassigned
          frame.scope[d.name] = { v, t };
          if (v !== undefined) this.bind(this.frameKey(frame, d.name), d.name, v, d.type);
        }
        this.rec(frame, s.line);
        return undefined;
      }
  execThrow(s, frame) {
        this.tick(s);
        const ex = this.eval(s.e, frame);
        if (ex === null) this.throwJava('NullPointerException', 'Cannot throw exception because the value is null');
        if (!(ex instanceof JObject) || !this.isThrowable(ex.cls)) throw this.compileError('incompatible types: the thrown value is not a Throwable', s);
        this.rec(frame, s.line, 'throw ' + this.str(ex));
        throw new JavaThrow(ex);
      }
  condCaption(frame, e, c) { return this.lineText(frame.file, e.line) + '  → ' + c; }
  cond(e, frame) {
    const v = this.eval(e, frame);
    if (typeof v !== 'boolean') {
      if (v === null) this.throwJava('NullPointerException', 'Cannot unbox a null value');
      throw this.compileError('incompatible types: ' + simpleOf(this.className(v)) + ' cannot be converted to boolean', e);
    }
    return v;
  }
  inferType(v) {
    const k = nkind(v);
    const name = k === 'i' ? 'int' : k === 'l' ? 'long' : k === 'd' ? 'double' : k === 'c' ? 'char' : typeof v === 'boolean' ? 'boolean' : null;
    return name ? { k: 'type', name, args: [], dims: 0 } : null;
  }

  execLoop(s, frame, label) {
    const saved = frame.scope;
    frame.scope = Object.create(saved);
    // after a body's completion: → 'break' | 'continue' | completion to propagate | undefined
    const after = (r) => {
      if (!r) return undefined;
      if (r.c === 'b' && (r.l === null || r.l === label)) return 'break';
      if (r.c === 'c' && (r.l === null || r.l === label)) return 'continue';
      return r;
    };
    try {
      switch (s.k) {
        case 'while':
          for (;;) {
            this.tick(s);
            const c = this.cond(s.cond, frame);
            this.rec(frame, s.line, this.condCaption(frame, s.cond, c));
            if (!c) return undefined;
            const r = after(this.exec(s.body, frame));
            if (r === 'break') return undefined;
            if (r && r !== 'continue') return r;
          }
        case 'do':
          for (;;) {
            const r = after(this.exec(s.body, frame));
            if (r === 'break') return undefined;
            if (r && r !== 'continue') return r;
            this.tick(s.cond);
            const c = this.cond(s.cond, frame);
            this.rec(frame, s.condLine || s.cond.line, this.condCaption(frame, s.cond, c));
            if (!c) return undefined;
          }
        case 'for': {
          for (const i of s.init) {
            if (i.k === 'local') this.exec(i, frame);
            else { this.tick(i); this.eval(i.e, frame); }
          }
          for (;;) {
            this.tick(s);
            const c = s.cond ? this.cond(s.cond, frame) : true;
            this.rec(frame, s.line, s.cond ? this.condCaption(frame, s.cond, c) : null);
            if (!c) return undefined;
            const r = after(this.exec(s.body, frame));
            if (r === 'break') return undefined;
            if (r && r !== 'continue') return r;
            for (const u of s.update) this.eval(u, frame);
          }
        }
        case 'foreach': {
          this.tick(s);
          const it = this.eval(s.iter, frame);
          const t = s.type.name === 'var' ? null : s.type;
          let result;
          this.forEachValue(it, (x) => {
            this.tick(s);
            const v = t ? this.coerce(x, t) : x;
            frame.scope[s.name] = { v, t };
            this.rec(frame, s.line, this.lineText(frame.file, s.line) + '  → ' + s.name + ' = ' + this.argText(v));
            const r = after(this.exec(s.body, frame));
            if (r === 'break') return false;
            if (r && r !== 'continue') { result = r; return false; }
            return true;
          }, s.iter);
          return result;
        }
        default: return undefined;
      }
    } finally { frame.scope = saved; }
  }

  // iterate a Java Iterable or array; fn returns false to stop
  forEachValue(it, fn, node) {
    if (it === null || it === undefined) this.throwJava('NullPointerException', 'Cannot iterate over a null value' + (node && node.k === 'name' ? ' ("' + node.name + '" is null)' : ''));
    if (it instanceof JArray) {
      for (let i = 0; i < it.a.length; i++) if (fn(it.a[i]) === false) return;
      return;
    }
    let iter;
    if (it instanceof LibObject) {
      if (typeof it.iterator !== 'function') {
        if (typeof it.hasNext === 'function') iter = it;
        else throw this.compileError('for-each not applicable to ' + it._jname, node || this.cur);
      } else iter = it.iterator();
    } else if (it instanceof JObject) {
      iter = this.invokeOn(it, 'iterator', [], node, null);
    } else throw this.compileError('for-each not applicable to expression type ' + simpleOf(this.className(it)), node || this.cur);
    for (;;) {
      const has = iter instanceof JObject ? this.invokeOn(iter, 'hasNext', [], node, null) : iter.hasNext();
      if (!has) return;
      const x = iter instanceof JObject ? this.invokeOn(iter, 'next', [], node, null) : iter.next();
      if (fn(x) === false) return;
    }
  }

  execTry(s, frame) {
    const saved = frame.scope;
    let result;
    let pending = null;
    const resources = [];
    try {
      frame.scope = Object.create(saved);
      for (const r of s.resources) {
        if (r.k === 'local') { this.exec(r, frame); resources.push(frame.scope[r.decls[0].name].v); } else resources.push(this.eval(r.e, frame));
      }
      result = this.execBlock(s.block, frame);
    } catch (e) {
      if (!(e instanceof JavaThrow)) throw e;
      pending = e;
    } finally { frame.scope = saved; }
    for (const r of resources.reverse()) if (r && typeof r.close === 'function') r.close();
    if (pending) {
      const c = s.catches.find((cc) => cc.types.some((t) => this.isInstance(pending.ex, t, frame)));
      if (c) {
        const ex = pending;
        pending = null;
        frame.scope = Object.create(saved);
        frame.scope[c.name] = { v: ex.ex, t: null };
        try {
          this.tick(c);
          this.rec(frame, c.line, 'catch (' + c.types.map((t) => t.name).join(' | ') + ' ' + c.name + ')  → ' + this.str(ex.ex));
          result = this.execBlock(c.body, frame);
        } catch (e2) {
          if (!(e2 instanceof JavaThrow)) throw e2;
          pending = e2;
        } finally { frame.scope = saved; }
      }
    }
    if (s.fin) {
      const r = this.execBlock(s.fin, frame);
      if (r) return r;
    }
    if (pending) throw pending;
    return result;
  }

  execSwitch(s, frame, isExpr) {
    this.tick(s);
    const sel = this.eval(s.sel, frame);
    if (sel === null) this.throwJava('NullPointerException', 'Cannot invoke switch on a null value');
    let start = -1;
    let def = -1;
    for (let i = 0; i < s.cases.length && start < 0; i++) {
      const c = s.cases[i];
      if (c.labels === null) { def = i; continue; }
      for (const l of c.labels) {
        if (l.k === 'default') { def = i; continue; }
        if (this.caseMatches(sel, l, frame)) { start = i; break; }
      }
    }
    if (start < 0) start = def;
    this.rec(frame, s.line, this.lineText(frame.file, s.line) + '  → ' + this.argText(sel));
    if (start < 0) {
      if (isExpr) this.throwJava('IncompatibleClassChangeError', 'no case matched');
      return undefined;
    }
    const saved = frame.scope;
    frame.scope = Object.create(saved);
    try {
      for (let i = start; i < s.cases.length; i++) {
        for (const st of s.cases[i].body) {
          const r = this.exec(st, frame);
          if (r) {
            if (r.c === 'b' && r.l === null && !isExpr) return undefined;
            return r;
          }
        }
        if (s.arrow) break;
      }
      return undefined;
    } finally { frame.scope = saved; }
  }
  caseMatches(sel, l, frame) {
    if (sel instanceof JObject && sel.cls.isEnum && l.k === 'name') return sel.f.$name === l.name;
    const v = l.cv !== undefined ? l.cv : (l.cv = this.eval(l, frame));
    if (isStr(sel)) return isStr(v) && sv(v) === sv(sel);
    const ks = nkind(sel), kv = nkind(v);
    if (ks && kv) return toNumber(sel) === toNumber(v);
    return sel === v;
  }

  // ── expressions ─────────────────────────────────────────────────
  eval(e, frame) {
    switch (e.k) {
      case 'lit': return e.val !== undefined ? e.val : (e.val = this.literal(e));
      case 'name': return this.evalName(e, frame);
      case 'paren': return this.eval(e.e, frame);
      case 'binary': return this.evalBinary(e, frame);
      case 'unary': return this.evalUnary(e, frame);
      case 'assign': return this.evalAssign(e, frame);
      case 'preinc': case 'postinc': return this.evalInc(e, frame);
      case 'call': return this.evalCall(e, frame);
      case 'field': return this.evalField(e, frame);
      case 'index': return this.evalIndex(e, frame);
      case 'new': return this.evalNew(e, frame);
      case 'newArray': return this.newArray(e.type, e.dims.map((d) => this.indexValue(this.eval(d, frame), d)), e);
      case 'arrayInit': return this.evalArrayInit(e, frame);
      case 'cond': return this.cond(e.c, frame) ? this.eval(e.a, frame) : this.eval(e.b, frame);
      case 'cast': return this.cast(this.eval(e.e, frame), e.type, e, frame);
      case 'instanceof': {
        const v = this.eval(e.e, frame);
        const r = this.isInstance(v, e.type, frame);
        if (r && e.bind) frame.scope[e.bind] = { v, t: e.type };
        return r;
      }
      case 'this': {
        if (!frame.self) throw this.compileError('non-static variable this cannot be referenced from a static context', e);
        if (e.qual) { let o = frame.self; while (o && o.cls.name !== e.qual && !(o.cls.anonymous)) o = o.outer; while (o && o.cls.name !== e.qual) o = o.outer; return o || frame.self; }
        return frame.self;
      }
      case 'lambda': return new JLambda(e.params, e.body, e.expr, frame.scope, frame, e.line);
      case 'mref': return this.evalMref(e, frame);
      case 'switchExpr': {
        const r = this.execSwitch(e, frame, true);
        if (!r || r.c !== 'y') throw this.compileError('switch expression does not yield a value', e);
        return r.v;
      }
      case 'classLit': return new ClassRef(null, e.type.name);
      default: throw this.compileError('unsupported expression: ' + e.k, e);
    }
  }
  evalIndex(e, frame) {
        const arr = this.eval(e.arr, frame);
        const i = this.indexValue(this.eval(e.idx, frame), e.idx);
        this.cur = e;
        if (arr === null) this.throwJava('NullPointerException', 'Cannot load from array because ' + this.exprName(e.arr) + ' is null');
        if (!(arr instanceof JArray)) throw this.compileError('array required, but ' + simpleOf(this.className(arr)) + ' found', e);
        if (i < 0 || i >= arr.a.length) this.throwJava('ArrayIndexOutOfBoundsException', 'Index ' + i + ' out of bounds for length ' + arr.a.length);
        if (this.recorder && (arr._sid || arr._owner)) {
          if (e.idx.k === 'name' && arr._sid) { if (!arr._ptr) arr._ptr = {}; if (arr._ptr[e.idx.name] !== i) { arr._ptr[e.idx.name] = i; this.dirty.add(arr); } }
          this.arrayTouched(arr, i, null);
        }
        return arr.a[i];
      }
  literal(e) {
    switch (e.lt) {
      case 'int': return e.v;
      case 'long': return e.v;
      case 'double': return e.isFloat ? flt(e.v) : dbl(e.v);
      case 'char': return jchar(e.v);
      case 'str': return e.v;
      case 'bool': return e.v;
      default: return null;
    }
  }
  exprName(e) {
    if (e.k === 'name') return '"' + e.name + '"';
    if (e.k === 'field') return '"' + (e.obj.k === 'this' ? 'this.' : e.obj.k === 'name' ? e.obj.name + '.' : '') + e.name + '"';
    if (e.k === 'call') return 'the return value of "' + e.name + '()"';
    if (e.k === 'index') return '"' + (e.arr.k === 'name' ? e.arr.name : '…') + '[…]"';
    return 'a value';
  }
  indexValue(v, node) {
    const k = nkind(v);
    if (k === 'i') return v;
    if (k === 'c') return v.c;
    if (v === null) this.throwJava('NullPointerException', 'Cannot unbox a null value');
    throw this.compileError('incompatible types: possible lossy conversion to int', node);
  }

  // name lookup: local → field of this → field of an enclosing instance/class → class
  evalName(e, frame) {
    const name = e.name;
    const box = frame.scope[name];
    if (box) {
      if (box.v === undefined) throw this.compileError('variable ' + name + ' might not have been initialized', e);
      return box.v;
    }
    const r = this.lookupField(name, frame);
    if (r) return r.get();
    const t = this.resolveType(name, frame.cls, null);
    if (t) return t.cls ? new ClassRef(t.cls, null) : new ClassRef(null, t.lib ? simpleOf(t.lib) : t.holder);
    // static imports
    const st = this.staticImport(name, frame);
    if (st && st.field !== undefined) return st.field;
    throw this.compileError('cannot find symbol: variable ' + name, e);
  }
  staticImport(name, frame) {
    for (const im of frame.cls.unit.staticImports) {
      const holder = im.star ? simpleOf(im.name) : simpleOf(packageOf(im.name));
      if (!im.star && simpleOf(im.name) !== name) continue;
      if (STATIC_FIELDS[holder] && name in STATIC_FIELDS[holder]) return { field: STATIC_FIELDS[holder][name] };
      if (STATICS[holder] && STATICS[holder][name]) return { method: STATICS[holder][name] };
      const r = this.resolveType(holder, frame.cls, null);
      if (r && r.cls) return { cls: r.cls };
    }
    return null;
  }
  // → { get(), set(v), type } or null
  lookupField(name, frame) {
    let self = frame.self;
    for (let c = frame.cls; c; c = c.outer) {
      if (self && self.cls && name in self.f && name[0] !== '$') {
        const o = self;
        return { get: () => o.f[name], set: (v) => { o.f[name] = v; }, type: this.fieldType(o.cls, name), key: o.cls.name + '.' + name };
      }
      if (self && self.cap && self.cap[name]) { const b = self.cap[name]; return { get: () => b.v, set: () => { throw this.compileError('local variables referenced from an inner class must be final or effectively final', this.cur); }, type: b.t }; }
      const sc = this.staticOwner(c, name);
      if (sc) {
        this.ensureInit(sc);
        return { get: () => sc.statics[name], set: (v) => { sc.statics[name] = v; }, type: sc.staticFields.get(name), key: sc.name + '.' + name };
      }
      self = c.isStatic ? null : self ? self.outer : null;
    }
    return null;
  }
  staticOwner(cls, name) {
    for (let c = cls; c; c = this.superOf(c)) {
      if (c.staticFields.has(name) || (c.isEnum && c.decl.enumConsts.some((x) => x.name === name))) return c;
      for (const i of this.ifacesOf(c)) { const r = this.staticOwner(i, name); if (r) return r; }
    }
    return null;
  }
  fieldType(cls, name) {
    for (let c = cls; c; c = this.superOf(c)) if (c.instFields.has(name)) return c.instFields.get(name);
    return null;
  }

  evalField(e, frame) {
    if (e.sup) {
      if (!frame.self) throw this.compileError('non-static variable super cannot be referenced from a static context', e);
      return frame.self.f[e.name];
    }
    const obj = this.evalTarget(e.obj, frame);
    return this.getMember(obj, e.name, e, frame);
  }
  // the target of a.b or a.b(): a value, or a ClassRef for class names (also qualified names)
  evalTarget(o, frame) {
    if (o.k === 'name' && !frame.scope[o.name]) {
      const f = this.lookupField(o.name, frame);
      if (f) return f.get();
      const t = this.resolveType(o.name, frame.cls, null);
      if (t) return t.cls ? new ClassRef(t.cls, null) : new ClassRef(null, t.lib ? simpleOf(t.lib) : t.holder);
      if (/^[a-z]/.test(o.name)) return { pkg: o.name };
      throw this.compileError('cannot find symbol: variable ' + o.name, o);
    }
    if (o.k === 'field' && !o.sup) {
      const base = this.evalTarget(o.obj, frame);
      if (base && base.pkg !== undefined) {
        const full = base.pkg + '.' + o.name;
        if (ALL_LIB_NAMES.has(full) || /^[A-Z]/.test(o.name)) {
          const t = this.resolveType(o.name, frame.cls, full);
          if (t) return t.cls ? new ClassRef(t.cls, null) : new ClassRef(null, t.lib ? simpleOf(t.lib) : t.holder || o.name);
          return new ClassRef(null, o.name);
        }
        return { pkg: full };
      }
      return this.getMember(base, o.name, o, frame);
    }
    return this.eval(o, frame);
  }
  getMember(obj, name, e, frame) {
    this.cur = e;
    if (obj === null || obj === undefined) this.throwJava('NullPointerException', 'Cannot read field "' + name + '" because ' + this.exprName(e.obj) + ' is null');
    if (obj instanceof ClassRef) {
      if (obj.cls) {
        const c = obj.cls;
        const n = c.nested.get(name);
        if (n) return new ClassRef(n, null);
        const sc = this.staticOwner(c, name);
        if (!sc) { if (name === 'length') throw this.compileError('cannot find symbol: variable length', e); throw this.compileError('cannot find symbol: variable ' + name + ' in class ' + c.name, e); }
        this.ensureInit(sc);
        return sc.statics[name];
      }
      const lib = obj.lib;
      if (lib === 'System') { if (name === 'out') return this.sysOut; if (name === 'err') return this.sysErr; if (name === 'in') return 'stdin'; }
      if (STATIC_FIELDS[lib] && name in STATIC_FIELDS[lib]) return STATIC_FIELDS[lib][name];
      if (lib === 'Map' && name === 'Entry') return new ClassRef(null, 'Map.Entry');
      throw this.compileError('cannot find symbol: variable ' + name + ' in ' + lib, e);
    }
    if (obj instanceof JArray) {
      if (name === 'length') return obj.a.length;
      throw this.compileError('cannot find symbol: variable ' + name, e);
    }
    if (obj instanceof JObject) {
      if (name in obj.f && name[0] !== '$') return obj.f[name];
      const sc = this.staticOwner(obj.cls, name);
      if (sc) { this.ensureInit(sc); return sc.statics[name]; }
      throw this.compileError('cannot find symbol: variable ' + name + ' in ' + obj.cls.name, e);
    }
    if (obj && obj.pkg !== undefined) throw this.compileError('package ' + obj.pkg + ' does not exist', e);
    if (obj instanceof LibObject && name[0] !== '_' && Object.prototype.hasOwnProperty.call(obj, name) && typeof obj[name] !== 'function' && name !== 'rt') return obj[name];
    throw this.compileError('cannot find symbol: variable ' + name, e);
  }

  // ── assignment ──────────────────────────────────────────────────
  evalAssign(e, frame) {
    const t = e.target;
    if (t.k === 'name') {
      const box = frame.scope[t.name];
      if (box) {
        const v = this.assignValue(e, () => box.v, box.t, frame);
        box.v = v;
        this.bind(this.frameKey(frame, t.name), t.name, v, box.t);
        return v;
      }
      const f = this.lookupField(t.name, frame);
      if (!f) throw this.compileError('cannot find symbol: variable ' + t.name, t);
      const v = this.assignValue(e, f.get, f.type, frame);
      f.set(v);
      if (f.key) this.bind(f.key, t.name, v, f.type);
      return v;
    }
    if (t.k === 'field') {
      let obj;
      if (t.sup) obj = frame.self;
      else obj = this.evalTarget(t.obj, frame);
      this.cur = t;
      if (obj === null) this.throwJava('NullPointerException', 'Cannot assign field "' + t.name + '" because ' + this.exprName(t.obj) + ' is null');
      if (obj instanceof JObject) {
        if (!(t.name in obj.f)) {
          const sc = this.staticOwner(obj.cls, t.name);
          if (!sc) throw this.compileError('cannot find symbol: variable ' + t.name, t);
          this.ensureInit(sc);
          const v = this.assignValue(e, () => sc.statics[t.name], sc.staticFields.get(t.name), frame);
          sc.statics[t.name] = v;
          this.bind(sc.name + '.' + t.name, t.name, v, sc.staticFields.get(t.name));
          return v;
        }
        const ft = this.fieldType(obj.cls, t.name);
        const v = this.assignValue(e, () => obj.f[t.name], ft, frame);
        obj.f[t.name] = v;
        this.bind(obj.cls.name + '.' + t.name, t.name, v, ft);
        return v;
      }
      if (obj instanceof ClassRef && obj.cls) {
        const sc = this.staticOwner(obj.cls, t.name);
        if (!sc) throw this.compileError('cannot find symbol: variable ' + t.name, t);
        this.ensureInit(sc);
        const v = this.assignValue(e, () => sc.statics[t.name], sc.staticFields.get(t.name), frame);
        sc.statics[t.name] = v;
        this.bind(sc.name + '.' + t.name, t.name, v, sc.staticFields.get(t.name));
        return v;
      }
      if (obj instanceof JArray && t.name === 'length') throw this.compileError('cannot assign a value to final variable length', t);
      throw this.compileError('cannot assign to ' + t.name, t);
    }
    if (t.k === 'index') {
      const arr = this.eval(t.arr, frame);
      const i = this.indexValue(this.eval(t.idx, frame), t.idx);
      this.cur = t;
      if (e.op === '=') {
        const raw = e.value.k === 'arrayInit' ? this.evalArrayInit(e.value, frame) : this.eval(e.value, frame);
        this.checkIndex(arr, i, t);
        const v = this.coerce(raw, arr.t);
        this.arraySet(arr, i, v);
        return v;
      }
      this.checkIndex(arr, i, t);
      const v = this.assignValue(e, () => arr.a[i], arr.t, frame);
      this.arraySet(arr, i, v);
      return v;
    }
    throw this.compileError('unexpected assignment target', t);
  }
  checkIndex(arr, i, t) {
    if (arr === null) this.throwJava('NullPointerException', 'Cannot store to array because ' + this.exprName(t.arr) + ' is null');
    if (!(arr instanceof JArray)) throw this.compileError('array required', t);
    if (i < 0 || i >= arr.a.length) this.throwJava('ArrayIndexOutOfBoundsException', 'Index ' + i + ' out of bounds for length ' + arr.a.length);
  }
  arraySet(arr, i, v) {
    const old = arr.a[i];
    arr.a[i] = v;
    if (this.recorder && (arr._sid || arr._owner)) this.arrayTouched(arr, i, 'set', this.item(old), this.item(v));
  }
  assignValue(e, get, type, frame) {
    if (e.op === '=') {
      const v = e.value.k === 'arrayInit' ? this.evalArrayInit(e.value, frame) : this.eval(e.value, frame);
      return this.coerce(v, type);
    }
    const old = get();
    const rhs = this.eval(e.value, frame);
    const op = e.op.slice(0, -1);
    const nv = this.binop(op, old, rhs, e);
    if (type && (PRIMS.has(type.name) || BOXES[type.name]) && !type.dims) return this.cast(nv, type, e, frame);
    if (!type) {
      // keep the variable's kind (var, lambda parameters)
      const k = nkind(old);
      if (k === 'c') return this.coerce(nv, { name: 'char', dims: 0 });
      if (k === 'i') return this.coerce(nv, { name: 'int', dims: 0 });
    }
    return nv;
  }
  evalInc(e, frame) {
    const delta = e.op === '++' ? 1 : -1;
    const bump = (old) => {
      if (old === null) this.throwJava('NullPointerException', 'Cannot unbox a null value');
      const k = nkind(old);
      if (k === 'i') return (old + delta) | 0;
      if (k === 'l') return BigInt.asIntN(64, old + BigInt(delta));
      if (k === 'd') return dbl(old.v + delta);
      if (k === 'c') return jchar(old.c + delta);
      throw this.compileError('bad operand type for ' + e.op, e);
    };
    const t = e.e;
    let old, nv;
    if (t.k === 'name') {
      const box = frame.scope[t.name];
      if (box) { old = box.v; nv = this.coerce(bump(old), box.t); box.v = nv; }
      else {
        const f = this.lookupField(t.name, frame);
        if (!f) throw this.compileError('cannot find symbol: variable ' + t.name, t);
        old = f.get(); nv = this.coerce(bump(old), f.type); f.set(nv);
      }
    } else if (t.k === 'field') {
      const obj = t.sup ? frame.self : this.evalTarget(t.obj, frame);
      this.cur = t;
      if (obj === null) this.throwJava('NullPointerException', 'Cannot read field "' + t.name + '" because ' + this.exprName(t.obj) + ' is null');
      if (obj instanceof JObject && t.name in obj.f) { old = obj.f[t.name]; nv = bump(old); obj.f[t.name] = nv; }
      else {
        const sc = this.staticOwner(obj instanceof ClassRef ? obj.cls : obj.cls, t.name);
        if (!sc) throw this.compileError('cannot find symbol: variable ' + t.name, t);
        this.ensureInit(sc);
        old = sc.statics[t.name]; nv = bump(old); sc.statics[t.name] = nv;
      }
    } else if (t.k === 'index') {
      const arr = this.eval(t.arr, frame);
      const i = this.indexValue(this.eval(t.idx, frame), t.idx);
      this.checkIndex(arr, i, t);
      old = arr.a[i]; nv = this.coerce(bump(old), arr.t);
      this.arraySet(arr, i, nv);
    } else throw this.compileError('unexpected type: required variable, found value', t);
    return e.k === 'preinc' ? nv : old;
  }

  // ── operators ───────────────────────────────────────────────────
  evalBinary(e, frame) {
    const op = e.op;
    if (op === '&&') { const a = this.cond(e.l, frame); return a ? this.cond(e.r, frame) : false; }
    if (op === '||') { const a = this.cond(e.l, frame); return a ? true : this.cond(e.r, frame); }
    // string literal + string literal is a compile-time constant (interned)
    if (op === '+' && e.l.k === 'lit' && e.r.k === 'lit' && e.l.lt === 'str' && e.r.lt === 'str') return e.l.v + e.r.v;
    const a = this.eval(e.l, frame);
    const b = this.eval(e.r, frame);
    this.cur = e;
    return this.binop(op, a, b, e);
  }
  binop(op, a, b, e) {
    if (op === '==' || op === '!=') {
      const eq = this.refEquals(a, b, e);
      return op === '==' ? eq : !eq;
    }
    if (op === '+' && (isStr(a) || isStr(b))) return new String(this.str(a) + this.str(b));
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      if (op === '&') return a && b;
      if (op === '|') return a || b;
      if (op === '^') return a !== b;
    }
    if (a === null || b === null || a === undefined || b === undefined) {
      if ((a === null || a === undefined) && (b === null || b === undefined) && op === '+') throw this.compileError('bad operand types for binary operator +', e);
      this.throwJava('NullPointerException', 'Cannot unbox a null value (operator ' + op + ')');
    }
    const ka = nkind(a), kb = nkind(b);
    if (!ka || !kb) throw this.compileError("bad operand types for binary operator '" + op + "'", e);
    if (op === '<<' || op === '>>' || op === '>>>') {
      if (ka === 'd' || kb === 'd') throw this.compileError("bad operand types for binary operator '" + op + "'", e);
      const n = Number(typeof b === 'bigint' ? BigInt.asIntN(32, b) : toNumber(b));
      if (ka === 'l') {
        const s = BigInt(n & 63);
        if (op === '<<') return BigInt.asIntN(64, a << s);
        if (op === '>>') return a >> s;
        return BigInt.asIntN(64, BigInt.asUintN(64, a) >> s);
      }
      const x = ka === 'c' ? a.c : a;
      if (op === '<<') return x << n;
      if (op === '>>') return x >> n;
      return (x >>> n) | 0;
    }
    if (ka === 'd' || kb === 'd') {
      const x = toNumber(a), y = toNumber(b);
      // float op float (or an integer) stays float; anything with a double is double
      const mkd = (ka !== 'd' || a.f) && (kb !== 'd' || b.f) && ka !== 'l' && kb !== 'l' ? flt : dbl;
      switch (op) {
        case '+': return mkd(x + y);
        case '-': return mkd(x - y);
        case '*': return mkd(x * y);
        case '/': return mkd(x / y);
        case '%': return mkd(x % y);
        case '<': return x < y;
        case '>': return x > y;
        case '<=': return x <= y;
        case '>=': return x >= y;
        default: throw this.compileError("bad operand types for binary operator '" + op + "'", e);
      }
    }
    if (ka === 'l' || kb === 'l') {
      const x = ka === 'l' ? a : BigInt(toNumber(a)), y = kb === 'l' ? b : BigInt(toNumber(b));
      switch (op) {
        case '+': return BigInt.asIntN(64, x + y);
        case '-': return BigInt.asIntN(64, x - y);
        case '*': return BigInt.asIntN(64, x * y);
        case '/': if (y === 0n) this.throwJava('ArithmeticException', '/ by zero'); return BigInt.asIntN(64, x / y);
        case '%': if (y === 0n) this.throwJava('ArithmeticException', '/ by zero'); return x % y;
        case '<': return x < y;
        case '>': return x > y;
        case '<=': return x <= y;
        case '>=': return x >= y;
        case '&': return x & y;
        case '|': return x | y;
        case '^': return x ^ y;
        default: throw this.compileError("bad operand types for binary operator '" + op + "'", e);
      }
    }
    const x = ka === 'c' ? a.c : a, y = kb === 'c' ? b.c : b;
    switch (op) {
      case '+': return (x + y) | 0;
      case '-': return (x - y) | 0;
      case '*': return Math.imul(x, y);
      case '/': if (y === 0) this.throwJava('ArithmeticException', '/ by zero'); return (x / y) | 0;
      case '%': if (y === 0) this.throwJava('ArithmeticException', '/ by zero'); return (x % y) | 0;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      case '>=': return x >= y;
      case '&': return x & y;
      case '|': return x | y;
      case '^': return x ^ y;
      default: throw this.compileError("bad operand types for binary operator '" + op + "'", e);
    }
  }
  refEquals(a, b) {
    const ka = nkind(a), kb = nkind(b);
    if (ka && kb) {
      if (ka === 'l' || kb === 'l') return BigInt(typeof a === 'bigint' ? a : Math.trunc(toNumber(a))) === BigInt(typeof b === 'bigint' ? b : Math.trunc(toNumber(b))) && (ka !== 'd' || Number.isInteger(toNumber(a))) && (kb !== 'd' || Number.isInteger(toNumber(b)));
      return toNumber(a) === toNumber(b);
    }
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    return a === b;
  }
  evalUnary(e, frame) {
    const v = this.eval(e.e, frame);
    if (e.op === '!') { if (typeof v !== 'boolean') throw this.compileError("bad operand type for unary operator '!'", e); return !v; }
    if (v === null) this.throwJava('NullPointerException', 'Cannot unbox a null value');
    const k = nkind(v);
    if (!k) throw this.compileError("bad operand type for unary operator '" + e.op + "'", e);
    switch (e.op) {
      case '-': return k === 'i' ? (-v) | 0 : k === 'c' ? -v.c : k === 'l' ? BigInt.asIntN(64, -v) : dbl(-v.v);
      case '+': return k === 'c' ? v.c : v;
      case '~':
        if (k === 'd') throw this.compileError("bad operand type double for unary operator '~'", e);
        return k === 'l' ? ~v : ~(k === 'c' ? v.c : v);
      default: throw this.compileError('unknown operator ' + e.op, e);
    }
  }

  // ── object creation ─────────────────────────────────────────────
  evalNew(e, frame) {
    if (e.body) {
      const cls = e.cls || (e.cls = null);
      void cls;
      const anon = this.anonClass(e.body, frame.cls, frame, e.type);
      const args = e.args.map((a) => this.eval(a, frame));
      this.cur = e;
      const obj = this.allocate(anon, frame.self);
      obj.cap = frame.scope;
      this.runCtor(anon, obj, args, e, frame);
      return obj;
    }
    const outerSelf = e.outerExpr ? this.eval(e.outerExpr, frame) : undefined;
    if (e.outerExpr && outerSelf === null) this.throwJava('NullPointerException', null);
    const args = e.args.map((a) => this.eval(a, frame));
    this.cur = e;
    return this.construct(e.type.name, frame.cls, args, e, frame, e.type.qual, outerSelf);
  }
  construct(name, ctxCls, args, node, frame, qual, explicitOuter) {
    const r = this.resolveType(name, ctxCls, qual);
    if (!r) throw this.compileError('cannot find symbol: class ' + name, node);
    if (r.cls) {
      const c = r.cls;
      // an inner (non-static) class gets the enclosing instance
      let outerSelf = null;
      if (explicitOuter) outerSelf = explicitOuter;
      else if (!c.isStatic && c.outer && frame) { outerSelf = frame.self; while (outerSelf && outerSelf.cls !== c.outer && !this.isSubclass(outerSelf.cls, c.outer)) outerSelf = outerSelf.outer; }
      return this.newObject(c, args, node, frame, outerSelf);
    }
    if (r.lib && LIB_CLASSES[r.lib]) return LIB_CLASSES[r.lib].make(this, args);
    if (r.holder === 'String') {
      const a = args[0];
      if (a instanceof JArray) return new String(a.a.map((c) => String.fromCharCode(c.c)).join(''));
      return new String(a === undefined ? '' : this.str(a));
    }
    if (r.holder === 'Object') return this.newObject(this.objectClass(), [], node, frame);
    if (r.holder && BOXES[r.holder] && args.length === 1) {
      return isStr(args[0]) ? STATICS[r.holder].valueOf(this, args) : this.coerce(args[0], { name: BOXES[r.holder], dims: 0 });
    }
    throw this.compileError((r.lib || r.holder) + ' is abstract or an interface; cannot be instantiated', node);
  }
  anonClass(body, outer, frame, baseType) {
    if (!body.$cls) {
      body.$cls = this.declareClass(body, outer.unit, outer, outer.builtin);
      body.$cls.isStatic = !frame.self;
    }
    void baseType;
    return body.$cls;
  }
  newArray(type, dims, node) {
    const make = (level) => {
      const n = dims[level];
      if (n < 0) this.throwJava('NegativeArraySizeException', String(n));
      const elemT = { k: 'type', name: type.name, args: [], dims: type.dims - level - 1, qual: type.qual };
      const a = new Array(n);
      if (level + 1 < dims.length) for (let i = 0; i < n; i++) a[i] = make(level + 1);
      else { const d = defaultFor(elemT); for (let i = 0; i < n; i++) a[i] = d; }
      return new JArray(elemT, a);
    };
    void node;
    return make(0);
  }
  evalArrayInit(e, frame) {
    const elemT = { k: 'type', name: e.type.name, args: [], dims: e.type.dims - 1, qual: e.type.qual };
    const a = e.elems.map((x) => (x.k === 'arrayInit' ? this.evalArrayInit(x, frame) : this.coerce(this.eval(x, frame), elemT)));
    return new JArray(elemT, a);
  }
  evalMref(e, frame) {
    const t = e.target;
    const l = new JLambda(null, null, null, frame.scope, frame, e.line);
    const mref = { name: e.name, frame, node: e, target: {} };
    if (t.k === 'typeRef') mref.target.arrayType = t.type;
    else if (e.name === 'new') { mref.target.typeName = t.name; mref.target.ctx = frame.cls; }
    else if (t.k === 'super') mref.target.value = frame.self;
    else {
      const v = t.k === 'name' && !frame.scope[t.name] && !this.lookupField(t.name, frame) ? this.evalTarget(t, frame) : this.eval(t, frame);
      if (v instanceof ClassRef) mref.target.classRef = v; else mref.target.value = v;
    }
    l.mref = mref;
    return l;
  }

  // ── calls ───────────────────────────────────────────────────────
  evalCall(e, frame) {
    if (e.obj === null) return this.callUnqualified(e, frame);
    if (e.sup) {
      if (!frame.self) throw this.compileError('non-static variable super cannot be referenced from a static context', e);
      const args = e.args.map((a) => this.eval(a, frame));
      this.cur = e;
      const sup = this.superOf(frame.cls);
      const m = sup ? this.findMethod(sup, e.name, args) : null;
      if (m) return this.invoke(m, frame.self, args, e);
      return this.objectMethod(frame.self, e.name, args, e);
    }
    const target = this.evalTarget(e.obj, frame);
    const args = e.args.map((a) => this.eval(a, frame));
    this.cur = e;
    if (target instanceof ClassRef && !(e.name === 'getName' || e.name === 'getSimpleName')) return this.callStatic(target, e.name, args, e, frame);
    return this.invokeOn(target, e.name, args, e, frame);
  }
  callUnqualified(e, frame) {
    const args = e.args.map((a) => this.eval(a, frame));
    this.cur = e;
    let self = frame.self;
    for (let c = frame.cls; c; c = c.outer) {
      const ms = this.methodsNamed(c, e.name);
      if (ms.length) {
        let m = this.pickMethod(ms, args);
        if (!m) throw this.compileError('method ' + e.name + ' in class ' + c.name + ' cannot be applied to given types (' + args.map((a) => simpleOf(this.className(a))).join(', ') + ')', e);
        if (m.isStatic) return this.invoke(m, null, args, e);
        if (!self) throw this.compileError('non-static method ' + e.name + '(…) cannot be referenced from a static context', e);
        // virtual dispatch on the receiver's class
        if (self.cls !== c) { const m2 = this.findMethod(self.cls, e.name, args); if (m2) m = m2; }
        return this.invoke(m, self, args, e);
      }
      if (c.isEnum && (e.name === 'values' || e.name === 'valueOf')) return this.callStatic(new ClassRef(c, null), e.name, args, e, frame);
      if (self && (frame.cls.anonymous || !c.isStatic)) self = self.outer; else if (c.isStatic) self = null;
    }
    const st = this.staticImport(e.name, frame);
    if (st && st.method) return st.method(this, args);
    if (st && st.cls) { const m = this.findMethod(st.cls, e.name, args); if (m) return this.invoke(m, null, args, e); }
    if (frame.self && ['equals', 'hashCode', 'toString', 'getClass', 'name', 'ordinal', 'compareTo'].includes(e.name)) return this.objectMethod(frame.self, e.name, args, e);
    throw this.compileError('cannot find symbol: method ' + e.name + '(' + args.map((a) => simpleOf(this.className(a))).join(', ') + ')', e);
  }
  callStatic(ref, name, args, e, frame) {
    if (ref.cls) {
      const c = ref.cls;
      if (c.isEnum && name === 'values') { this.ensureInit(c); return new JArray({ k: 'type', name: c.name, args: [], dims: 0 }, c.enumValues.slice()); }
      if (c.isEnum && name === 'valueOf') {
        this.ensureInit(c);
        const v = c.enumValues.find((x) => x.f.$name === sv(args[0]));
        if (!v) this.throwJava('IllegalArgumentException', 'No enum constant ' + c.fullName.replace(/\$/g, '.') + '.' + sv(args[0]));
        return v;
      }
      const ms = this.methodsNamed(c, name);
      const m = this.pickMethod(ms, args);
      if (!m) throw this.compileError('cannot find symbol: method ' + name + '(' + args.map((a) => simpleOf(this.className(a))).join(', ') + ') in class ' + c.name, e);
      if (!m.isStatic) {
        // Outer.method() from an inner class, or a call through the class of `this`
        if (frame && frame.self && this.isSubclass(frame.self.cls, c)) return this.invoke(this.findMethod(frame.self.cls, name, args) || m, frame.self, args, e);
        throw this.compileError('non-static method ' + name + '(…) cannot be referenced from a static context', e);
      }
      this.ensureInit(c);
      return this.invoke(m, null, args, e);
    }
    const holder = STATICS[ref.lib];
    if (holder && holder[name]) return holder[name](this, args);
    throw this.compileError('cannot find symbol: method ' + name + ' in ' + (ref.lib || '?'), e);
  }
  invokeOn(v, name, args, e, frame) {
    if (v === null || v === undefined) {
      this.throwJava('NullPointerException', 'Cannot invoke "' + name + '()" because ' + (e && e.obj ? this.exprName(e.obj) : 'the value') + ' is null');
    }
    if (typeof v === 'string' || v instanceof String) {
      if (name === 'equals' && args.length === 1) return isStr(args[0]) && sv(args[0]) === sv(v);
      return stringMethod(this, v, name, args);
    }
    if (v instanceof JObject) {
      const m = this.findMethod(v.cls, name, args);
      if (m) {
        if (m.isStatic) return this.invoke(m, null, args, e);
        return this.invoke(m, v, args, e);
      }
      return this.objectMethod(v, name, args, e);
    }
    if (v instanceof LibObject) {
      const f = v[name];
      if (typeof f !== 'function' || name[0] === '_' || name === 'constructor') {
        if (v instanceof LibFn && ['compare', 'apply', 'accept', 'test', 'get', 'run'].includes(name)) return v.fn(...args);
        throw this.compileError('cannot find symbol: method ' + name + '(' + args.map((a) => simpleOf(this.className(a))).join(', ') + ') in ' + v._jname, e || this.cur);
      }
      return f.apply(v, args);
    }
    if (v instanceof JLambda) {
      switch (name) {
        case 'reversed': return this.makeComparator((a, b) => this.intOf(this.callFn(v, 'compare', [b, a])));
        case 'thenComparing': return this.makeComparator((a, b) => { const c = this.intOf(this.callFn(v, 'compare', [a, b])); return c !== 0 ? c : this.thenCompare(args[0], a, b); });
        case 'negate': return new LibFn(this, (x) => !this.callFn(v, 'test', [x]));
        case 'andThen': return new LibFn(this, (...xs) => { const r = this.callFn(v, 'apply', xs); return v.params && args[0] ? this.callFn(args[0], 'apply', [r]) : r; });
        case 'equals': return v === args[0];
        case 'hashCode': return v.hash;
        case 'toString': return jstr(v);
        default: return this.invokeLambda(v, args);
      }
    }
    if (v instanceof JArray) {
      if (name === 'clone') return new JArray(v.t, v.a.slice());
      if (name === 'equals') return v === args[0];
      if (name === 'hashCode') return v.hash;
      if (name === 'getClass') return new ClassRef(null, 'Array');
      if (name === 'toString') return jstr(v);
      throw this.compileError('cannot find symbol: method ' + name + '() on an array', e);
    }
    if (v instanceof ClassRef) {
      const n = v.cls ? v.cls.fullName : v.lib;
      if (name === 'getName') return v.cls || n.includes('.') ? n : (PRELUDE_PACKAGES[n] || 'java.lang') + '.' + n;
      if (name === 'getSimpleName') return v.cls ? (v.cls.anonymous ? '' : v.cls.name) : simpleOf(n);
      if (name === 'equals') return args[0] instanceof ClassRef && (args[0].cls === v.cls && args[0].lib === v.lib);
      if (name === 'hashCode') return 0;
      if (name === 'toString') return jstr(v);
      return this.callStatic(v, name, args, e, frame);
    }
    if (v && v.pkg !== undefined) throw this.compileError('package ' + v.pkg + ' does not exist', e);
    return boxedMethod(this, v, name, args);
  }
  // java.lang.Object's methods (and Enum's, Record's) when the class does not define them
  objectMethod(o, name, args, e) {
    switch (name) {
      case 'equals': return this.userEquals(o, args[0]);
      case 'hashCode': return this.userHash(o);
      case 'toString': return new String(this.userToString(o));
      case 'getClass': return new ClassRef(o.cls, null);
      default: break;
    }
    if (o.cls.isEnum || (this.superOf(o.cls) && this.superOf(o.cls).isEnum)) {
      if (name === 'name') return o.f.$name;
      if (name === 'ordinal') return o.f.$ordinal;
      if (name === 'compareTo') return o.f.$ordinal - args[0].f.$ordinal;
    }
    if (o.cls.isRecord && !args.length && o.cls.decl.recordComps.some((c) => c.name === name)) return o.f[name];
    throw this.compileError('cannot find symbol: method ' + name + '(' + args.map((a) => simpleOf(this.className(a))).join(', ') + ') in class ' + o.cls.name, e || this.cur);
  }

  // ── conversion of run inputs and results ────────────────────────
  javaExpression(src, ctxCls) {
    const ast = parseExpression(src, '<argument>');
    return this.eval(ast, this.staticFrame(ctxCls));
  }
}

export { OBJECT_TYPE, JList, JSet, JMap };
