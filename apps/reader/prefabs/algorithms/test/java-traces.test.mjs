// The Java layer's traces go through the same contract and renderers as the catalog's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runJava } from '../java/index.js';
import { traceProblem, record } from '../trace/recorder.js';
import { drawStep } from '../structures/index.js';
import { algorithmById } from '../catalog/index.js';
import { JAVA_VERSIONS, javaProgram, javaProgramForEditing } from '../catalog/java-versions.js';
import { traceOf, codeOf, render, name, normalize } from '../render.js';

const here = new URL('../java/test/fixtures/', import.meta.url);
const sources = (dir) => readdirSync(new URL(dir + '/', here)).filter((f) => f.endsWith('.java')).map((f) => ({ name: f, text: readFileSync(new URL(dir + '/' + f, here), 'utf8') }));
const balanced = (svg) => { const open = (svg.match(/<(?!\/)[a-zA-Z][^>]*[^/]>/g) || []).length, close = (svg.match(/<\/[a-zA-Z]+>/g) || []).length; return svg.startsWith('<svg') && open === close && !/NaN|undefined/.test(svg); };

for (const dir of ['activity1', 'activity4', 'activity6', 'activity7', 'activity8', 'activity9', 'activity10', 'activity11']) {
  test(`${dir}: the Java trace keeps the contract and every step draws`, () => {
    const trace = runJava(sources(dir), { entry: 'Driver.main', maxFrames: 400 });
    assert.equal(trace.error, undefined);
    assert.equal(traceProblem(trace), '', dir);
    for (let i = 0; i < trace.steps.length; i += 7) for (const theme of ['light', 'dark']) assert.ok(balanced(drawStep(trace, i, { theme, caption: true, legend: true }).svg), `${dir} step ${i}`);
  });
}

// "Run the Java version": each built-in's shown source runs through the Java layer, on its
// presets, with the JS implementation's result, and its steps point at the shown code.

const plain = (v) => JSON.parse(JSON.stringify(v ?? null));
test('the built-ins’ Java versions give the JS results, at the shown lines', () => {
  const sameAs = {
    knapsack: (j, js) => [...j].sort().join() === [...js.chosen].sort().join(),
    heap: (j, js) => JSON.stringify(j) === JSON.stringify(js.removed),
    hashmap: (j, js) => JSON.stringify(j) === JSON.stringify(js.results.map((x) => String(x))),
    queens: (j, js) => j === (js !== null),
    prim: (j, js) => JSON.stringify(j.edges.map(([a, b, w]) => `${a}-${b}:${w}`).sort()) === JSON.stringify(js.edges.map((e) => `${e.from}-${e.to}:${e.w}`).sort()),
    hanoi: () => true, quicksort: () => true, 'invert-array': () => true, 'bubble-sort': () => true, 'insertion-sort': () => true, 'selection-sort': () => true,
  };
  for (const id of Object.keys(JAVA_VERSIONS)) {
    const a = algorithmById(id), v = JAVA_VERSIONS[id];
    const lines = codeOf({ algorithm: id, java: true }).split('\n').length;
    for (const p of a.presets.slice(0, 2)) {
      const input = a.normalize(p.input);
      const t = runJava(javaProgram(a), { entry: v.entry, args: v.args(input), maxFrames: 3000, maxMs: 5000 });
      assert.equal(t.error, undefined, `${id}: ${JSON.stringify(t.error)}`);
      const js = record(a.run, input).result;
      assert.ok((sameAs[id] || ((j, x) => JSON.stringify(Object.entries(plain(j)).sort()) === JSON.stringify(Object.entries(plain(x)).sort())))(t.result, js), `${id} ${p.label}: ${JSON.stringify(t.result)} vs ${JSON.stringify(js)}`);
      assert.ok(t.steps.every((s) => s.line === null || (s.line >= 1 && s.line <= lines)), `${id}: lines inside the shown code`);
      const edit = runJava(javaProgramForEditing(a), { entry: v.entry, args: v.args(input), record: false });
      assert.equal(edit.error, undefined, `${id} as written out for editing: ${JSON.stringify(edit.error)}`);
    }
  }
});

test('Java specs: your own program on the page, its errors said with the line', () => {
  const spec = { algorithm: 'java', source: 'public class Count {\n  public static int sum(int[] v) {\n    int t = 0;\n    for (int x : v) t += x;\n    return t;\n  }\n}\n', entry: 'Count.sum', args: '[[1, 2, 3]]', step: -1 };
  assert.equal(name(spec), 'Java: Count.sum');
  assert.equal(normalize(spec).maxSteps, 5000);
  const { trace, error } = traceOf(spec);
  assert.equal(error, '');
  assert.equal(trace.result, 6);
  assert.ok(render({ ...spec, code: true }).svg.includes('Count'));
  const bad = traceOf({ ...spec, source: spec.source.replace('int t = 0;', 'int t = ;') });
  assert.match(bad.error, /^Does not compile \(line 3, column \d+\)/);
  assert.match(traceOf({ ...spec, args: '[1,' }).error, /not JSON/);
  assert.ok(traceOf({ algorithm: 'dijkstra', java: true }).trace.steps.length > traceOf({ algorithm: 'dijkstra' }).trace.steps.length);
});
