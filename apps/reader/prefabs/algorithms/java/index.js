// Java subset simulator: the public API.
//
//   runJava(source, { entry, args, input, recorder, maxSteps, maxMs, maxDepth, maxFrames,
//                     record, shouldCancel, cancelFlag }) → trace
//
// source   a string, an array of { name, text } (several files) or { name: text }
// entry    "Class.method" or "method" (default: the class with main(String[]))
// args     JS values converted to the entry's parameter types: numbers, strings, booleans,
//          arrays (→ Java arrays or lists), objects (→ maps), { vertices, edges } or
//          "A-B 4, B-C 2" (→ the course's Graph), or { $java: "any Java expression" }
// input    text read by new Scanner(System.in)
// recorder a recorder (../trace/recorder.js: structure, set, mark, call, ret, step, finish);
//          by default a new one that stops at the step cap and marks one step at a time
// record   false: run without recording steps (faster; the trace has no steps)
//
// The trace follows docs/ALGORITHM-ANIMATIONS.md ({ structures, steps }) plus:
//   result      the entry's return value as plain JS (arrays, objects, numbers, strings)
//   resultText  the same as Java prints it (String.valueOf)
//   output      what System.out printed;  errOutput: System.err
//   error       { kind: 'compile'|'runtime'|'limit'|'cancelled'|'internal', message, line,
//                 column, file, exception?, stack? } when the run did not complete
//   stepsRun    statements executed;  truncated: the recorder's step cap was reached
//
// Pure module (no DOM); runs synchronously, so run it in a Worker (worker.js) to keep the UI
// responsive: the step limit, the time limit, shouldCancel() and an Int32Array cancelFlag on a
// SharedArrayBuffer stop it, and terminating the worker always does.

import { CompileError } from './lexer.js';
import { Interpreter, JavaThrow, RunLimit } from './interpreter.js';
import { createRecorder as newRecorder } from '../trace/recorder.js';

// The one recorder of the module, as the interpreter uses it: step() returns false at the
// cap (the trace is then `truncated`) and mark() marks the next step only.
export const createRecorder = (options = {}) => newRecorder({ stopAtCap: true, stepMarks: true, ...options });
import { JArray, JObject, JDouble, JChar, jchar, dbl, isStr, sv, resetIdentities } from './values.js';
import { LibObject } from './lib/base.js';
import { JList, JSet, JMap, JPriorityQueue, JStack, JArrayDeque } from './lib/util.js';
import { AedList, LinkedQueue, LinkedStack, Vertex, Edge, AdjacencyList, MapOfMap, CourseHashMap, CoursePair } from './lib/aed.js';
import { simpleOf } from './library.js';

export { CompileError };

function normalizeSources(source) {
  if (typeof source === 'string') return [{ name: 'Main.java', text: source }];
  if (Array.isArray(source)) return source.map((s, i) => (typeof s === 'string' ? { name: 'File' + (i + 1) + '.java', text: s } : s));
  return Object.entries(source).map(([name, text]) => ({ name, text }));
}

export function runJava(source, opts = {}) {
  resetIdentities();
  const record = opts.record !== false;
  const recorder = record ? opts.recorder || createRecorder({ maxSteps: opts.maxFrames ?? 5000 }) : null;
  const finish = (extra) => (recorder ? recorder.finish(extra) : { structures: {}, steps: [], truncated: false, ...extra });
  let rt;
  try {
    rt = new Interpreter(normalizeSources(source), { ...opts, recorder });
  } catch (e) {
    if (e instanceof CompileError) return finish({ error: { kind: 'compile', message: e.message, line: e.line, column: e.column, file: e.file }, output: '', stepsRun: 0 });
    throw e;
  }
  let result;
  let error = null;
  try {
    const { cls, method } = findEntry(rt, opts.entry);
    const ctx = { cls, method };
    const args = method.params.map((p, i) => toJava(rt, (opts.args || [])[i], p.type, ctx));
    if (method.name === 'main' && (!opts.args || !opts.args.length) && method.params.length === 1) args[0] = new JArray({ name: 'String', dims: 0 }, []);
    rt.curFile = cls.unit.file;
    rt.ensureInit(cls);
    result = rt.invoke(method, null, args, null);
  } catch (e) {
    error = describeError(rt, e);
  }
  if (recorder && error && !rt.quiet) {
    rt.flushStructures();
    recorder.step(errorCaption(error), { line: error.line || null, vars: {} });
  } else if (recorder) rt.flushStructures();
  const out = {
    output: rt.out,
    errOutput: rt.err,
    stepsRun: rt.steps,
  };
  if (error) out.error = error;
  else {
    out.result = toJS(rt, result);
    try { out.resultText = result === undefined ? null : rt.str(result); } catch { out.resultText = null; }
  }
  return finish(out);
}

function errorCaption(error) {
  if (error.kind === 'runtime') return 'Exception in thread "main" ' + error.fullName + (error.message !== null && error.message !== undefined ? ': ' + error.message : '');
  return error.message;
}

function describeError(rt, e) {
  const at = rt.cur ? { line: rt.cur.line, column: rt.cur.col, file: rt.curFile } : {};
  if (e instanceof JavaThrow) {
    const ex = e.ex;
    let message = null;
    try { const m = ex.f.message; message = m === null || m === undefined ? null : sv(m); } catch { message = null; }
    const loc = ex.$loc || at;
    return {
      kind: 'runtime',
      exception: ex.cls.name,
      fullName: ex.cls.fullName,
      message,
      line: loc.line,
      column: loc.col !== undefined ? loc.col : loc.column,
      file: loc.file || at.file,
      stack: (ex.$stack || []).slice().reverse().map((f) => f.name),
    };
  }
  if (e instanceof CompileError) return { kind: 'compile', message: e.message, line: e.line, column: e.column, file: e.file || at.file };
  if (e instanceof RunLimit) return { kind: e.kind, message: e.message, ...at };
  if (e && e.message === 'exit') return null;
  if (e instanceof RangeError) return { kind: 'runtime', exception: 'StackOverflowError', fullName: 'java.lang.StackOverflowError', message: null, ...at };
  return { kind: 'internal', message: String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), ...at };
}

function findEntry(rt, entry) {
  const all = [...rt.classes.values()].flat();
  let clsName = null, mName = entry || 'main';
  if (entry && entry.includes('.')) { clsName = entry.slice(0, entry.lastIndexOf('.')); mName = entry.slice(entry.lastIndexOf('.') + 1); }
  const candidates = all.filter((c) => !clsName || c.name === clsName || c.fullName === clsName);
  if (clsName && !candidates.length) throw new CompileError('class ' + clsName + ' not found', 1, 1, null);
  for (const c of candidates) {
    const ms = (c.methods.get(mName) || []).filter((m) => m.isStatic && m.body);
    if (ms.length) {
      const m = mName === 'main' ? ms.find((x) => x.params.length === 1) || ms[0] : ms[0];
      return { cls: c, method: m };
    }
  }
  throw new CompileError(entry ? 'static method ' + entry + ' not found' : 'no static main method found (give an entry)', 1, 1, null);
}

// ── JS → Java ─────────────────────────────────────────────────────
function toJava(rt, x, t, ctx) {
  const cls = ctx.cls;
  if (x === undefined) x = null;
  if (x !== null && typeof x === 'object' && !Array.isArray(x) && '$java' in x) return rt.javaExpression(x.$java, cls);
  if (x instanceof JArray || x instanceof JObject || x instanceof LibObject || x instanceof JDouble || x instanceof JChar) return x;
  if (x === null) return null;
  if (!t || t.name === 'var' || t.name === 'Object') return inferJava(rt, x);
  if (t.dims) {
    if (!Array.isArray(x)) {
      if (typeof x === 'string' && t.name === 'char' && t.dims === 1) return new JArray({ name: 'char', dims: 0 }, Array.from(x, (c) => jchar(c.charCodeAt(0))));
      throw new CompileError('argument for ' + t.name + '[] must be an array', 1, 1, null);
    }
    const elemT = { ...t, dims: t.dims - 1 };
    return new JArray(elemT, x.map((y) => toJava(rt, y, elemT, ctx)));
  }
  const name = t.name;
  const arg = (k) => (t.args && t.args[k]) || null;
  switch (name) {
    case 'int': case 'short': case 'byte': case 'Integer': case 'Short': case 'Byte': return typeof x === 'string' ? x.charCodeAt(0) : Math.trunc(x) | 0;
    case 'long': case 'Long': return BigInt(Math.trunc(x));
    case 'double': case 'float': case 'Double': case 'Float': return dbl(Number(x));
    case 'char': case 'Character': return jchar(typeof x === 'string' ? x.charCodeAt(0) : x);
    case 'boolean': case 'Boolean': return !!x;
    case 'String': case 'CharSequence': return String(x);
    default: break;
  }
  if (rt.isTypeVar(t, ctx.method) || cls.typeParams.has(name)) return inferJava(rt, x);
  const r = rt.resolveType(name, cls, t.qual);
  const full = r && r.lib ? r.lib : '';
  const simple = simpleOf(full || name);
  const items = () => (Array.isArray(x) ? x : [x]).map((y) => toJava(rt, y, arg(0), ctx));
  if (/^es\.uvigo\.esei\.aed2\.graph\.|MapOfMap$/.test(full) && simple !== 'Vertex' && simple !== 'Edge') return toGraph(rt, x, arg(0), arg(1), ctx, simple === 'MapOfMap' ? MapOfMap : AdjacencyList);
  switch (simple) {
    case 'Vertex': return new Vertex(rt, toJava(rt, x, arg(0), ctx));
    case 'List': case 'ArrayList': case 'Collection': case 'Iterable': case 'LinkedList': case 'Vector':
      if (full.startsWith('es.uvigo')) { const l = new AedList(rt); for (const y of items()) l.addLast(y); return l; }
      return new JList(rt, simple === 'LinkedList' ? 'LinkedList' : 'ArrayList', items());
    case 'Set': case 'HashSet': return JSet.fromItems(rt, items(), 'hash');
    case 'LinkedHashSet': return JSet.fromItems(rt, items(), 'linked');
    case 'TreeSet': case 'SortedSet': { const s = new JSet(rt, 'tree'); for (const y of items()) s.add(y); return s; }
    case 'Queue':
      if (full.startsWith('es.uvigo')) { const q = new LinkedQueue(rt); for (const y of items()) q.add(y); return q; }
      return new JList(rt, 'LinkedList', items());
    case 'LinkedQueue': { const q = new LinkedQueue(rt); for (const y of items()) q.add(y); return q; }
    case 'LinkedStack': { const s = new LinkedStack(rt); for (const y of items()) s.push(y); return s; }
    case 'Stack':
      if (full.startsWith('es.uvigo')) { const s = new LinkedStack(rt); for (const y of items()) s.push(y); return s; }
      return new JStack(rt, items());
    case 'Deque': case 'ArrayDeque': return new JArrayDeque(rt, items());
    case 'PriorityQueue': return new JPriorityQueue(rt, null, items());
    case 'Map': case 'HashMap': case 'TreeMap': case 'LinkedHashMap': {
      const entries = Array.isArray(x) ? x : Object.entries(x);
      const course = full.startsWith('es.uvigo');
      const m = course ? new CourseHashMap(rt) : new JMap(rt, simple === 'TreeMap' ? 'tree' : simple === 'LinkedHashMap' ? 'linked' : 'hash');
      for (const [k, v] of entries) {
        const kt = arg(0);
        const key = kt && /^(Integer|Long|Double|int)$/.test(kt.name) && typeof k === 'string' ? toJava(rt, Number(k), kt, ctx) : toJava(rt, k, kt, ctx);
        const val = toJava(rt, v, arg(1), ctx);
        if (course) m.add(key, val); else m.put(key, val);
      }
      return m;
    }
    default: break;
  }
  throw new CompileError('cannot convert the argument ' + JSON.stringify(x).slice(0, 40) + ' to ' + name + ': pass { $java: "…" }', 1, 1, null);
}

function inferJava(rt, x) {
  if (typeof x === 'number') return Number.isInteger(x) && x >= -2147483648 && x <= 2147483647 ? x : dbl(x);
  if (typeof x === 'bigint') return x;
  if (typeof x === 'string' || typeof x === 'boolean') return x;
  if (Array.isArray(x)) return new JList(rt, 'ArrayList', x.map((y) => inferJava(rt, y)));
  const m = new JMap(rt, 'linked');
  for (const [k, v] of Object.entries(x)) m.put(k, inferJava(rt, v));
  return m;
}

// { vertices: [...], edges: [[from, to, label], ...] } or "A-B 4, B-C" (edges; "A" alone is a vertex)
function toGraph(rt, x, vt, et, ctx, Klass) {
  const g = new Klass(rt);
  const vtx = (v) => new Vertex(rt, toJava(rt, v, vt, ctx));
  let vertices = [], edges = [];
  if (typeof x === 'string') {
    for (const part of x.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\S+?)\s*(->|-)\s*(\S+)(?:\s+(\S+))?$/.exec(part);
      if (!m) { vertices.push(part); continue; }
      vertices.push(m[1], m[3]);
      const w = m[4] === undefined ? null : /^-?\d+(\.\d+)?$/.test(m[4]) ? Number(m[4]) : m[4];
      edges.push([m[1], m[3], w]);
      if (m[2] === '-' && !x.includes('->')) edges.push([m[3], m[1], w]);
    }
  } else {
    vertices = x.vertices || [];
    edges = (x.edges || []).map((e) => (Array.isArray(e) ? e : [e.from, e.to, e.value ?? e.w ?? e.label ?? null]));
  }
  for (const v of vertices) g.addVertex(vtx(v));
  for (const [a, b] of edges) { g.addVertex(vtx(a)); g.addVertex(vtx(b)); }
  for (const [a, b, w] of edges) g.addEdge(vtx(a), vtx(b), w === null || w === undefined ? null : toJava(rt, w, et, ctx));
  return g;
}

// ── Java → JS ─────────────────────────────────────────────────────
export function toJS(rt, v, depth = 0) {
  if (v === undefined || v === null) return v === undefined ? undefined : null;
  if (depth > 20) return '…';
  switch (typeof v) {
    case 'number': case 'boolean': return v;
    case 'bigint': return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    case 'string': return v;
    default: break;
  }
  if (v instanceof String) return v.valueOf();
  if (v instanceof JDouble) return v.v;
  if (v instanceof JChar) return String.fromCharCode(v.c);
  if (v instanceof JArray) return v.a.map((x) => toJS(rt, x, depth + 1));
  if (v instanceof Vertex) return toJS(rt, v.value, depth + 1);
  if (v instanceof Edge) return [toJS(rt, v.source, depth + 1), toJS(rt, v.target, depth + 1), toJS(rt, v.label, depth + 1)];
  if (v instanceof AdjacencyList) {
    return { vertices: v.list.map((s) => toJS(rt, s.v, depth + 1)), edges: v.list.flatMap((s) => s.adj.map((a) => [toJS(rt, s.v, depth + 1), toJS(rt, a.t, depth + 1), toJS(rt, a.l, depth + 1)])) };
  }
  if (v instanceof JMap || v instanceof CourseHashMap) {
    const entries = v instanceof JMap ? v._entries().map((e) => [e.k, e.v]) : v._entries().map((p) => [p.k, p.v]);
    const o = {};
    for (const [k, val] of entries) {
      const jk = toJS(rt, k, depth + 1);
      o[jk !== null && typeof jk === 'object' ? rt.withQuiet(() => rt.displayStr(k)) : String(jk)] = toJS(rt, val, depth + 1);
    }
    return o;
  }
  if (v instanceof CoursePair) return [toJS(rt, v.k, depth + 1), toJS(rt, v.v, depth + 1)];
  if (v instanceof LibObject && typeof v._items === 'function') return v._items().map((x) => toJS(rt, x, depth + 1));
  if (v instanceof LibObject && v.s !== undefined) return v.s; // StringBuilder
  if (v instanceof LibObject) return rt.withQuiet(() => rt.displayStr(v));
  if (v instanceof JObject) {
    if (v.cls.isEnum) return v.f.$name;
    const o = { $class: v.cls.name };
    for (const k of Object.keys(v.f)) if (k[0] !== '$') o[k] = v.f[k] === v ? '(this)' : toJS(rt, v.f[k], depth + 1);
    return o;
  }
  return String(v);
}

export { isStr };
