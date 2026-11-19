// The algorithms module (docs/ALGORITHM-ANIMATIONS.md): a figure is one step of an algorithm
// run on the person's input. spec = { type: "algorithm", module: "algorithms", algorithm,
// input, step, caption, code }: `step` is the step shown (from 0; negative counts from the
// end; null: the middle one, as the picker's cards); `caption` puts the algorithm's name and
// the step's caption over it; `code` the source beside it with the step's line. Pure: no DOM.
// Runs are cached by algorithm and input, drawings by step.
//
// Java: { algorithm: "java", source, entry, args (a JSON array as text), stdin, maxSteps }
// runs the person's own program through the Java layer (java/index.js); a built-in with
// `java: true` runs its shown source through it instead of its JS implementation.
import { record, STEP_CAP } from './trace/recorder.js';
import { drawStep } from './structures/index.js';
import { ALGORITHMS, algorithmById, fullName } from './catalog/index.js';
import { JAVA_VERSIONS, javaProgram } from './catalog/java-versions.js';
import { runJava } from './java/index.js';

export { ALGORITHMS, algorithmById, fullName, JAVA_VERSIONS };

// A new program's template ("New from Java…").
export const JAVA_TEMPLATE = `import java.util.*;

public class Main {
  // Run calls the entry (Main.run) with the arguments of the Input tab, as JSON: [[5, 3, 8, 1]].
  public static int[] run(int[] values) {
    Stack<Integer> stack = new Stack<>();
    for (int v : values) {
      stack.push(v);                       // a stack of the values…
    }
    int[] reversed = new int[values.length];
    for (int i = 0; i < reversed.length; i++) {
      reversed[i] = stack.pop();           // …taken out the other way round
    }
    return reversed;
  }
}
`;
const isJava = (s) => s?.algorithm === 'java';
const textOr = (v, d) => (typeof v === 'string' ? v : d);

// The spec made whole (its input is kept as written: the algorithm reads it when it runs).
export function normalize(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const step = s.step === null || s.step === undefined || s.step === '' ? null : Number.isInteger(Number(s.step)) ? Number(s.step) : null;
  const common = { step, caption: s.caption !== false, code: !!s.code, ...(s.title ? { title: String(s.title) } : {}) };
  if (isJava(s)) {
    const steps = Math.trunc(Number(s.maxSteps));
    return { type: 'algorithm', algorithm: 'java', source: textOr(s.source, JAVA_TEMPLATE).slice(0, 200000), entry: textOr(s.entry, 'Main.run').trim(), args: textOr(s.args, '[[5, 3, 8, 1]]'), stdin: textOr(s.stdin, ''), maxSteps: Number.isFinite(steps) ? Math.max(10, Math.min(20000, steps)) : STEP_CAP, ...common };
  }
  const algo = algorithmById(s.algorithm) || ALGORITHMS[0];
  const input = s.input && typeof s.input === 'object' ? s.input : structuredClone(algo.presets[0].input);
  return { type: 'algorithm', algorithm: algo.id, input, ...(s.java && JAVA_VERSIONS[algo.id] ? { java: true } : {}), ...common };
}
// The code shown beside a spec's run (its lines are the trace's `line`).
export function codeOf(spec) {
  const s = normalize(spec);
  if (isJava(s)) return s.source;
  const algo = algorithmById(s.algorithm);
  return s.java ? `${algo.source}${JAVA_VERSIONS[algo.id].suffix ?? ''}` : algo.source;
}
// A Java layer's error ({ kind, message, line, column }) or a catalog one (text), as text.
export function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const where = error.line ? ` (line ${error.line}${error.column ? `, column ${error.column}` : ''})` : '';
  const what = { compile: 'Does not compile', runtime: error.fullName ? `Exception ${error.fullName}` : 'Exception', limit: 'Stopped', cancelled: 'Cancelled' }[error.kind] || 'Error';
  return `${what}${where}: ${error.message ?? ''}`.replace(/: $/, '');
}
// The Java run of a spec (synchronous: the player runs it in a worker and hands the trace to
// rememberTrace; a page figure drawn again runs it here, with a time limit).
function javaTrace(s) {
  let args = [];
  if (isJava(s)) {
    try { args = JSON.parse(s.args || '[]'); } catch (e) { return { structures: {}, steps: [{ caption: `The arguments are not JSON: ${e.message}`, line: null, vars: {}, state: {}, changes: [], marks: {}, calls: [] }], error: { kind: 'compile', message: `The arguments are not JSON: ${e.message}` } }; }
    if (!Array.isArray(args)) args = [args];
    return runJava(s.source, { entry: s.entry || undefined, args, input: s.stdin, maxFrames: s.maxSteps, maxMs: 2500 });
  }
  const algo = algorithmById(s.algorithm), v = JAVA_VERSIONS[algo.id];
  return runJava(javaProgram(algo), { entry: v.entry, args: v.args(algo.normalize(s.input)), maxFrames: STEP_CAP, maxMs: 2500 });
}
const keyOf = (s) => (isJava(s) ? `java\n${s.entry}\n${s.args}\n${s.stdin}\n${s.maxSteps}\n${s.source}` : `${s.algorithm}\n${s.java ? 'java\n' : ''}${JSON.stringify(s.input)}`);

const traces = new Map();
const LIMIT = 40;
const remember = (map, key, value, limit) => { map.set(key, value); if (map.size > limit) map.delete(map.keys().next().value); return value; };

// The run of a spec's algorithm on its input: { trace, input, error } (error as text). An
// input it cannot read gives a trace of one step that says why.
export function traceOf(spec) {
  const s = normalize(spec);
  const key = keyOf(s);
  if (traces.has(key)) return traces.get(key);
  if (isJava(s) || s.java) {
    let trace;
    try { trace = javaTrace(s); } catch (e) { trace = record(() => { throw e; }, null); }
    if (!trace.steps?.length) trace.steps = [{ caption: errorText(trace.error) || 'Nothing to show', line: trace.error?.line ?? null, vars: {}, state: {}, changes: [], marks: {}, calls: [] }];
    return remember(traces, key, { trace, input: s.input ?? null, error: errorText(trace.error) }, LIMIT);
  }
  const algo = algorithmById(s.algorithm);
  let input = null, error = '';
  try { input = algo.normalize(s.input); } catch (e) { error = e.message || String(e); }
  const trace = input ? record(algo.run, input, { cap: STEP_CAP }) : record(() => { throw Error(error); }, null);
  return remember(traces, key, { trace, input, error: error || errorText(trace.error) }, LIMIT);
}
// A run made elsewhere (the player's worker) for this spec: traceOf and render use it.
export function rememberTrace(spec, trace) {
  const s = normalize(spec);
  if (!trace.steps?.length) trace.steps = [{ caption: errorText(trace.error) || 'Nothing to show', line: trace.error?.line ?? null, vars: {}, state: {}, changes: [], marks: {}, calls: [] }];
  return remember(traces, keyOf(s), { trace, input: s.input ?? null, error: errorText(trace.error) }, LIMIT);
}
// Which step a spec shows, from 0.
export function stepIndex(spec, trace) {
  const n = trace.steps.length, s = normalize(spec).step;
  if (s === null) return Math.max(0, Math.floor((n - 1) / 2));
  return Math.max(0, Math.min(n - 1, s < 0 ? n + s : s));
}

const drawings = new Map();
// spec → { svg, width, height }: the step on a white page. `options.theme`: "dark" for the
// player over a dark app; `options.bare`: only the structures (no name, caption or code).
export function render(spec, options = {}) {
  try {
    const s = normalize(spec);
    const { trace } = traceOf(s);
    const i = stepIndex(s, trace);
    const bare = !!options.bare;
    const key = `${keyOf(s)}\n${i}\n${s.caption}\n${s.code}\n${s.title || ''}\n${options.theme || 'light'}\n${bare}\n${trace.steps.length}`;
    if (drawings.has(key)) return drawings.get(key);
    const out = drawStep(trace, i, {
      theme: options.theme || 'light',
      heading: bare || !s.caption ? '' : s.title || name(s),
      caption: !bare && s.caption,
      code: !bare && s.code ? codeOf(s) : '',
      legend: !bare,
      background: options.background ?? true,
    });
    return remember(drawings, key, out, 200);
  } catch (e) {
    const text = String(e?.message || e).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 60" width="360" height="60"><rect width="360" height="60" fill="#fff"/><text x="12" y="34" font-family="sans-serif" font-size="13" fill="#b3261e">${text}</text></svg>`, width: 360, height: 60 };
  }
}

// "Greedy: Dijkstra" (the context menu says "Edit Greedy: Dijkstra…").
export const name = (spec) => {
  if (isJava(spec)) return `Java: ${textOr(spec.entry, 'Main.run') || 'main'}`;
  const a = algorithmById(spec?.algorithm);
  return a ? fullName(a) : 'Algorithm';
};

// The picker's cards: one per algorithm, by topic and then by name, each starting from its
// first preset; their pictures show the middle step.
export function prefabs() {
  return ALGORITHMS.map((a) => ({
    id: `algorithm-${a.id}`,
    group: 'algorithms',
    label: fullName(a),
    hint: a.hint,
    icon: 'animation',
    spec: { type: 'algorithm', algorithm: a.id, input: structuredClone(a.presets[0].input), step: null, caption: true, code: false },
  }));
}
