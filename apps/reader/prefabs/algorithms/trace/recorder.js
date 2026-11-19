// The trace recorder (docs/ALGORITHM-ANIMATIONS.md, "The trace contract"): what an algorithm
// of the catalog (and, later, a Java run) writes while it runs. Pure: no DOM.
//
//   trace = { version, structures: { id: { kind, label } }, steps: [step], result?, error? }
//   step  = { caption, line, vars, state: { id: snapshot }, changes: [{ id, op, path, from, to }],
//             marks: { id: { key: mark } }, calls: [{ fn, args }] }
//
// Every step is a whole snapshot of every structure (so a single step can be drawn on a page
// and the player can scrub), plus what changed since the step before. Tracked structures
// (t.array, t.graph, t.queue, t.hashTable …) record their changes as they are used; t.step()
// closes a step with a caption and the line of the shown source. A cap stops runaway runs.

export const STEP_CAP = 5000;
export const MARKS = ['current', 'visited', 'done', 'compare', 'path', 'new', 'removed', 'error', 'queued'];
export const OPS = ['set', 'add', 'remove', 'move', 'swap', 'mark', 'visit', 'clear', 'sort'];

export class StepLimit extends Error {
  constructor(cap) {
    super(`Stopped after ${cap} steps: the input is too large to show step by step (or the algorithm does not end).`);
    this.name = 'StepLimit';
  }
}

const copy = (v) => (v === undefined ? undefined : structuredClone(v));
const keyOf = (k) => String(k);

// Options: `cap` (or `maxSteps`), the most steps; `stopAtCap`: at the cap step() returns false
// and the trace is `truncated` (the Java layer), instead of throwing StepLimit (the catalog);
// `stepMarks`: mark() marks only the next step (the Java layer) instead of lasting.
export function createRecorder({ cap = STEP_CAP, maxSteps = undefined, stopAtCap = false, stepMarks = false } = {}) {
  if (maxSteps !== undefined) cap = maxSteps;
  const structures = {};
  const live = new Map();
  const steps = [];
  const marks = {};
  const calls = [];
  let pending = [];
  let lastVars = {};
  let nextMarks = {};
  let truncated = false;
  const raw = {};
  let serial = 0;
  const uid = () => `u${++serial}`;

  const t = {
    cap,
    steps,
    // A structure of the trace: `snap()` gives its snapshot (a plain object of its kind).
    add(id, kind, label, snap) {
      if (structures[id]) throw Error(`Structure "${id}" twice`);
      structures[id] = { kind, label: label ?? id };
      live.set(id, snap);
      return id;
    },
    // A change for the next step (the tracked structures call this themselves).
    change(id, op, path = null, from = undefined, to = undefined) {
      const c = { id, op, path: copy(path) };
      if (from !== undefined) c.from = copy(from);
      if (to !== undefined) c.to = copy(to);
      pending.push(c);
    },
    // A structure whose snapshot is given whole (the Java layer): declared (again) with its
    // kind and label, then set(id, snapshot, changes) as it changes.
    structure(id, kind, label) {
      if (structures[id]) { structures[id] = { kind, label: label ?? id }; return id; }
      return t.add(id, kind, label, () => raw[id] ?? null);
    },
    set(id, snapshot, changes = null) {
      raw[id] = snapshot;
      for (const c of changes || []) t.change(id, c.op, c.path ?? null, c.from, c.to);
    },
    get truncated() { return truncated; },
    get count() { return steps.length; },
    // A mark that stays until it is changed (null clears it): "visited", "done", "path"…
    // (with stepMarks, for the next step only).
    mark(id, key, mark) {
      if (stepMarks) { (nextMarks[id] ||= {})[keyOf(key)] = mark; return; }
      marks[id] ||= {};
      if (mark == null) delete marks[id][keyOf(key)];
      else marks[id][keyOf(key)] = mark;
    },
    clearMarks(id = null, which = null) {
      for (const sid of id ? [id] : Object.keys(marks)) {
        if (!marks[sid]) continue;
        for (const k of Object.keys(marks[sid])) if (!which || marks[sid][k] === which) delete marks[sid][k];
      }
    },
    call(fn, args = '') { calls.push({ fn: String(fn), args: typeof args === 'string' ? args : JSON.stringify(args) }); },
    ret() { calls.pop(); },
    // Closes a step. `line`: 1-based line of the shown source (or null). `vars`: the locals
    // shown under the code (kept from the step before when left out). `marks`: marks for this
    // step only, over the lasting ones: { id: { key: mark } }.
    step(caption, { line = null, vars = undefined, marks: only = null, force = false, file = undefined } = {}) {
      if (steps.length >= cap && !force) {
        if (!stopAtCap) throw new StepLimit(cap);
        truncated = true; pending = []; nextMarks = {};
        return false;
      }
      if (vars !== undefined) lastVars = copy(vars);
      const state = {};
      for (const [id, snap] of live) state[id] = copy(snap());
      const m = copy(marks);
      for (const [id, keys] of Object.entries(nextMarks)) m[id] = { ...(m[id] || {}), ...keys };
      nextMarks = {};
      if (only) for (const [id, keys] of Object.entries(only)) { m[id] = { ...(m[id] || {}) }; for (const [k, v] of Object.entries(keys || {})) if (v) m[id][keyOf(k)] = v; }
      const s = { caption: String(caption ?? ''), line: Number.isInteger(line) ? line : null, vars: copy(lastVars), state, changes: pending, marks: m, calls: copy(calls) };
      if (file) s.file = file;
      steps.push(s);
      pending = [];
      return true;
    },
    // The trace: { version, structures, steps, truncated? } and what `extra` adds (result,
    // error, output…).
    finish(extra = {}) {
      const out = { version: 1, structures: copy(structures), steps };
      if (truncated) out.truncated = true;
      for (const [k, v] of Object.entries(extra || {})) if (v !== undefined) out[k] = copy(v);
      return out;
    },

    // ── Tracked structures ──
    // An array: items with hidden ids (so a swap is drawn as a move), named pointers (i, j…).
    array(id, items = [], { label, base = 0 } = {}) {
      const vals = [...items], ids = vals.map(uid), pointers = {};
      t.add(id, 'array', label, () => ({ items: vals, ids, pointers, base }));
      const a = {
        get length() { return vals.length; },
        get: (i) => vals[i],
        set(i, v) { const from = vals[i]; vals[i] = v; if (i >= ids.length) ids[i] = uid(); t.change(id, 'set', i, from, v); },
        swap(i, j) { [vals[i], vals[j]] = [vals[j], vals[i]]; [ids[i], ids[j]] = [ids[j], ids[i]]; t.change(id, 'swap', [i, j], vals[j], vals[i]); },
        push(v) { vals.push(v); ids.push(uid()); t.change(id, 'add', vals.length - 1, undefined, v); return vals.length; },
        pop() { const v = vals.pop(); ids.pop(); t.change(id, 'remove', vals.length, v); return v; },
        shift() { const v = vals.shift(); ids.shift(); t.change(id, 'remove', 0, v); return v; },
        addFirst(v) { vals.unshift(v); ids.unshift(uid()); t.change(id, 'add', 0, undefined, v); },
        clear() { vals.length = 0; ids.length = 0; },
        pointer(name, i) { if (i == null) delete pointers[name]; else pointers[name] = i; },
        toArray: () => [...vals],
      };
      return a;
    },
    // A binary heap stored from position 1 (as the course's arrayHeap, position 0 unused);
    // marks are keyed by position.
    heap(id, { label, kind = 'max' } = {}) {
      const vals = [], ids = [];
      t.add(id, 'heap', label, () => ({ items: vals, ids, kind }));
      return {
        size: () => vals.length,
        get: (p) => vals[p - 1],
        set(p, v) { const from = vals[p - 1]; vals[p - 1] = v; t.change(id, 'set', p, from, v); },
        swap(p, q) { [vals[p - 1], vals[q - 1]] = [vals[q - 1], vals[p - 1]]; [ids[p - 1], ids[q - 1]] = [ids[q - 1], ids[p - 1]]; t.change(id, 'swap', [p, q], vals[q - 1], vals[p - 1]); },
        add(v) { vals.push(v); ids.push(uid()); t.change(id, 'add', vals.length, undefined, v); return vals.length; },
        removeLast() { const v = vals.pop(); ids.pop(); t.change(id, 'remove', vals.length + 1, v); return v; },
        toArray: () => [...vals],
      };
    },
    // A FIFO queue (add at the back, remove from the front).
    queue(id, items = [], { label } = {}) { return linear(id, 'queue', items, label, 'fifo'); },
    // A LIFO stack (push and pop at the top, the end of `items`). `sized`: drawn as discs.
    stack(id, items = [], { label, sized = false } = {}) { return linear(id, 'stack', items, label, 'lifo', { sized }); },
    deque(id, items = [], { label } = {}) { return linear(id, 'deque', items, label, 'fifo'); },
    // A priority queue of { key, prio }: the smallest prio first (ties: first in, first out).
    pq(id, { label, min = true } = {}) {
      const items = [], ids = [];
      let order = 0;
      t.add(id, 'pq', label, () => ({ items: items.map(({ key, prio }) => ({ key, prio })), ids, min }));
      const before = (a, b) => (min ? a.prio < b.prio : a.prio > b.prio) || (a.prio === b.prio && a.n < b.n);
      return {
        size: () => items.length,
        isEmpty: () => items.length === 0,
        peek: () => (items[0] ? { key: items[0].key, prio: items[0].prio } : null),
        add(key, prio) {
          const e = { key, prio, n: order++ };
          let at = items.findIndex((o) => before(e, o));
          if (at < 0) at = items.length;
          items.splice(at, 0, e);
          ids.splice(at, 0, uid());
          t.change(id, 'add', at, undefined, { key, prio });
        },
        remove() {
          const e = items.shift();
          ids.shift();
          if (e) t.change(id, 'remove', 0, { key: e.key, prio: e.prio });
          return e ? { key: e.key, prio: e.prio } : null;
        },
        toArray: () => items.map(({ key, prio }) => ({ key, prio })),
      };
    },
    // A map (insertion order kept): set/get/remove; its entries are drawn as a two-column table.
    map(id, entries = [], { label } = {}) {
      const m = new Map(entries);
      t.add(id, 'map', label, () => ({ entries: [...m.entries()] }));
      return {
        size: () => m.size,
        has: (k) => m.has(k),
        get: (k) => (m.has(k) ? m.get(k) : null),
        set(k, v) { const had = m.has(k), from = m.get(k); m.set(k, v); t.change(id, had ? 'set' : 'add', k, had ? from : undefined, v); },
        remove(k) { if (!m.has(k)) return null; const v = m.get(k); m.delete(k); t.change(id, 'remove', k, v); return v; },
        keys: () => [...m.keys()],
        entries: () => [...m.entries()],
      };
    },
    // A set (a tracked HashSet; set(id, snapshot) is the whole-snapshot call above).
    hashSet(id, items = [], { label } = {}) {
      const s = new Set(items);
      t.add(id, 'set', label, () => ({ items: [...s] }));
      return {
        size: () => s.size,
        has: (v) => s.has(v),
        add(v) { if (s.has(v)) return false; s.add(v); t.change(id, 'add', v, undefined, v); return true; },
        remove(v) { if (!s.delete(v)) return false; t.change(id, 'remove', v, v); return true; },
        toArray: () => [...s],
      };
    },
    // A hash table with separate chaining: an array of buckets, each a list of { k, v }.
    // Its operations are the low-level ones, so the algorithm shows each of its own steps.
    hashTable(id, { label, capacity = 5, maxLoad = 0.75 } = {}) {
      let buckets = Array.from({ length: capacity }, () => []);
      let size = 0;
      t.add(id, 'hashtable', label, () => ({ buckets, size, capacity: buckets.length, loadFactor: buckets.length ? size / buckets.length : 0, maxLoad }));
      return {
        get capacity() { return buckets.length; },
        get size() { return size; },
        bucket: (i) => buckets[i].map((e) => ({ ...e })),
        append(i, k, v) { buckets[i].push({ k, v }); t.change(id, 'add', [i, buckets[i].length - 1], undefined, { k, v }); },
        setValue(i, j, v) { const from = buckets[i][j].v; buckets[i][j].v = v; t.change(id, 'set', [i, j], from, v); },
        removeAt(i, j) { const [e] = buckets[i].splice(j, 1); t.change(id, 'remove', [i, j], e); return e; },
        setSize(n) { const from = size; size = n; if (from !== n) t.change(id, 'set', 'size', from, n); },
        // New empty buckets (a rehash); gives back the old ones.
        resize(n) { const old = buckets; buckets = Array.from({ length: n }, () => []); t.change(id, 'set', 'capacity', old.length, n); return old.map((b) => b.map((e) => ({ ...e }))); },
      };
    },
    // A graph: { nodes: [{ id, label?, x?, y?, value? }], edges: [{ from, to, w?, directed? }] }.
    // Positions are computed once (layout) when the nodes have none, and kept for every step.
    graph(id, { nodes = [], edges = [], directed = false } = {}, { label, layout = null } = {}) {
      const ns = nodes.map((n) => ({ ...n, id: String(n.id) }));
      const es = edges.map((e) => ({ from: String(e.from), to: String(e.to), ...(e.w != null ? { w: e.w } : {}), directed: e.directed ?? directed }));
      if (layout && ns.some((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y))) layout(ns, es);
      t.add(id, 'graph', label, () => ({ nodes: ns, edges: es, directed }));
      return {
        nodes: () => ns.map((n) => n.id),
        edges: () => es.map((e) => ({ ...e })),
        setValue(n, value) { const node = ns.find((q) => q.id === String(n)); if (!node) return; const from = node.value; node.value = value; t.change(id, 'set', String(n), from, value); },
        // A graph that grows or shrinks while it runs (a graph built by the algorithm).
        addNode(node) { const n = { ...node, id: String(node.id) }; ns.push(n); t.change(id, 'add', n.id, undefined, n.id); },
        removeNode(n) {
          const at = ns.findIndex((q) => q.id === String(n));
          if (at < 0) return;
          ns.splice(at, 1);
          for (let i = es.length - 1; i >= 0; i--) if (es[i].from === String(n) || es[i].to === String(n)) es.splice(i, 1);
          t.change(id, 'remove', String(n), String(n));
        },
        addEdge(from, to, w = undefined, isDirected = directed) { const e = { from: String(from), to: String(to), ...(w != null ? { w } : {}), directed: isDirected }; es.push(e); t.change(id, 'add', `${e.from}-${e.to}`, undefined, w ?? null); },
        removeEdge(from, to) { const at = es.findIndex((e) => e.from === String(from) && e.to === String(to)); if (at >= 0) { es.splice(at, 1); t.change(id, 'remove', `${from}-${to}`, null); } },
        moveNode(n, x, y) { const node = ns.find((q) => q.id === String(n)); if (node) { node.x = x; node.y = y; } },
      };
    },
    // A table of cells (DP tables): rows × cols, with optional row and column labels.
    matrix(id, rows, cols, fill = '', { label, rowLabels = null, colLabels = null, rowTitle = '', colTitle = '' } = {}) {
      const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
      t.add(id, 'matrix', label, () => ({ rows, cols, cells, rowLabels, colLabels, rowTitle, colTitle }));
      return {
        get: (r, c) => cells[r][c],
        set(r, c, v) { const from = cells[r][c]; cells[r][c] = v; t.change(id, 'set', `${r},${c}`, from, v); },
      };
    },
    // A square board (N queens, sudoku…): cells hold '' or what stands on them.
    board(id, n, { label, box = 0 } = {}) {
      const cells = Array.from({ length: n }, () => Array.from({ length: n }, () => ''));
      t.add(id, 'board', label, () => ({ n, cells, ...(box ? { box } : {}) }));
      return {
        get: (r, c) => cells[r][c],
        set(r, c, v) { const from = cells[r][c]; cells[r][c] = v; t.change(id, from && !v ? 'remove' : !from && v ? 'add' : 'set', `${r},${c}`, from, v); },
      };
    },
    // A single value (a counter, a result) or a line of text.
    value(id, value = null, { label } = {}) {
      let v = value;
      t.add(id, 'value', label, () => ({ value: v }));
      return { get: () => v, set(next) { const from = v; v = next; if (from !== next) t.change(id, 'set', null, from, next); } };
    },
    text(id, text = '', { label } = {}) {
      let s = text;
      t.add(id, 'text', label, () => ({ text: s }));
      return { get: () => s, set(next) { s = String(next); } };
    },
    // A tree or binary tree whose whole shape is given at each change: { root }.
    tree(id, root = null, { label, binary = true } = {}) {
      let r = root;
      t.add(id, binary ? 'binarytree' : 'tree', label, () => ({ root: r }));
      return { set(next) { r = next; } };
    },
  };

  function linear(id, kind, items, label, discipline, extra = {}) {
    const vals = [...items], ids = vals.map(uid);
    t.add(id, kind, label, () => ({ items: vals, ids, ...extra }));
    const back = () => vals.length - 1;
    return {
      size: () => vals.length,
      isEmpty: () => vals.length === 0,
      peek: () => (discipline === 'fifo' ? vals[0] : vals[back()]),
      add(v) { vals.push(v); ids.push(uid()); t.change(id, 'add', back(), undefined, v); },
      push(v) { this.add(v); },
      addFirst(v) { vals.unshift(v); ids.unshift(uid()); t.change(id, 'add', 0, undefined, v); },
      remove() {
        if (!vals.length) return null;
        const at = discipline === 'fifo' ? 0 : back();
        const [v] = vals.splice(at, 1);
        ids.splice(at, 1);
        t.change(id, 'remove', at, v);
        return v;
      },
      pop() { return this.remove(); },
      removeLast() { if (!vals.length) return null; const v = vals.pop(); ids.pop(); t.change(id, 'remove', vals.length, v); return v; },
      toArray: () => [...vals],
    };
  }
  return t;
}

// Runs `run(input, t)` with a fresh recorder and gives its trace. A run that throws (the
// cap, or a problem with the input) ends with a step that says so; `trace.error` keeps it.
export function record(run, input, { cap = STEP_CAP } = {}) {
  const t = createRecorder({ cap });
  try {
    const result = run(input, t);
    if (!t.steps.length) t.step('Nothing to show');
    return t.finish({ result });
  } catch (e) {
    const message = e?.message || String(e);
    // The last step says why it stopped (past the cap too: one more, to say so).
    t.step(message, { line: null, force: true });
    return t.finish({ error: message });
  }
}

// Whether a trace keeps the contract: the checks the tests (and the Java layer) rely on.
export function traceProblem(trace, { lines = Infinity } = {}) {
  if (!trace || typeof trace !== 'object') return 'no trace';
  if (!trace.structures || typeof trace.structures !== 'object') return 'no structures';
  if (!Array.isArray(trace.steps) || !trace.steps.length) return 'no steps';
  const ids = Object.keys(trace.structures);
  for (const [i, s] of trace.steps.entries()) {
    if (typeof s.caption !== 'string') return `step ${i}: no caption`;
    if (s.line !== null && !(Number.isInteger(s.line) && s.line >= 1 && s.line <= lines)) return `step ${i}: line ${s.line} outside the source`;
    // A structure may appear later in the run (the Java layer declares one when a variable
    // first holds it): before then its steps have no snapshot of it, and it is not drawn.
    if (!s.state || typeof s.state !== 'object' || Object.keys(s.state).some((id) => !ids.includes(id))) return `step ${i}: a snapshot of an unknown structure`;
    if (!Array.isArray(s.changes) || s.changes.some((c) => !ids.includes(c.id) || !OPS.includes(c.op))) return `step ${i}: a change is not well formed`;
    if (!s.marks || Object.values(s.marks).some((m) => Object.values(m).some((v) => !MARKS.includes(v)))) return `step ${i}: an unknown mark`;
    if (!Array.isArray(s.calls)) return `step ${i}: no call stack`;
  }
  return '';
}
