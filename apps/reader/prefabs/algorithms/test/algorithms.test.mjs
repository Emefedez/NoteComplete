import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, render, name, prefabs, traceOf, stepIndex } from '../render.js';
import { ALGORITHMS, algorithmById, ordered, fullName, TOPICS } from '../catalog/index.js';
import { createRecorder, record, traceProblem, StepLimit } from '../trace/recorder.js';
import { drawStep, KINDS } from '../structures/index.js';
import { parseEdges, normalizeGraph, edgesText } from '../catalog/common.js';
import { javaHash, parseOps } from '../catalog/hashmap.js';

// SVG that an XML parser would take: tags balanced and attributes quoted, no stray "<" or "&".
function wellFormed(svg) {
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'an svg root');
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|#\d+);)/g;
  let m;
  while ((m = re.exec(svg))) {
    if (!m[2]) assert.fail(`stray "${m[0]}" at ${m.index}: ${svg.slice(Math.max(0, m.index - 40), m.index + 40)}`);
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `closing ${m[2]} at ${m.index}`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], 'every tag closed');
}

const run = (id, input) => {
  const a = algorithmById(id);
  return record(a.run, a.normalize(input));
};
const graph = (text, directed = false) => { const p = parseEdges(text); return { nodes: p.nodes.map((id) => ({ id })), edges: p.edges, directed }; };

test('every algorithm on every preset and on random input: a trace that keeps the contract, lines inside its source, drawn as SVG', () => {
  for (const a of ALGORITHMS) {
    const lines = a.source.split('\n').length;
    const inputs = [...a.presets.map((p) => p.input), a.random(1), a.random(7), a.random(42)];
    for (const input of inputs) {
      const trace = record(a.run, a.normalize(input));
      assert.equal(traceProblem(trace, { lines }), '', `${a.id} ${JSON.stringify(input)}`);
      assert.equal(trace.error, undefined, `${a.id}: ${trace.error}`);
      assert.ok(trace.steps.some((s) => s.line), `${a.id}: steps point at the code`);
      for (const i of [0, Math.floor(trace.steps.length / 2), trace.steps.length - 1]) {
        for (const theme of ['light', 'dark']) wellFormed(drawStep(trace, i, { theme, heading: fullName(a), caption: true, code: a.source, legend: true }).svg);
      }
    }
  }
});

test('the results are right on the presets', () => {
  assert.deepEqual(run('dijkstra', algorithmById('dijkstra').presets[0].input).result, { A: 0, B: 3, C: 2, D: 8, E: 10, F: 12 });
  assert.deepEqual(run('dijkstra', algorithmById('dijkstra').presets[1].input).result, { S: 0, A: 7, B: 3, C: 9, D: 11 });
  const prim = run('prim', algorithmById('prim').presets[0].input).result;
  assert.equal(prim.weight, 13);
  assert.equal(prim.edges.length, 5);
  assert.deepEqual(run('bfs', algorithmById('bfs').presets[0].input).result, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.deepEqual(run('dfs', algorithmById('dfs').presets[0].input).result, ['A', 'B', 'E', 'F', 'C', 'D', 'G', 'H']);
  const topo = run('topological', algorithmById('topological').presets[0].input).result;
  const g = algorithmById('topological').presets[0].input.graph;
  for (const e of g.edges) assert.ok(topo.indexOf(e.from) < topo.indexOf(e.to), `${e.from} before ${e.to}`);
  assert.equal(run('topological', algorithmById('topological').presets[1].input).result, null, 'a cycle has no order');
  assert.deepEqual(run('heap', { values: [50, 30, 40, 10, 20, 60, 35], removes: 2 }).result, { heap: [40, 30, 35, 10, 20], removed: [60, 50] });
  assert.deepEqual(run('heapsort', { values: [5, 13, 2, 25, 7, 17, 20, 8] }).result, [2, 5, 7, 8, 13, 17, 20, 25]);
  assert.deepEqual(run('quicksort', { values: [5, 3, 5, 1, 3, 5, 2] }).result, [1, 2, 3, 3, 5, 5, 5]);
  const inv = (v) => { let n = 0; for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (v[i] > v[j]) n++; return n; };
  for (const values of [[7, 3, 8, 1, 6, 2, 5, 4], [1, 2, 3], [3, 3, 1], [9, 8, 7, 6, 5, 4, 3, 2, 1]]) {
    assert.deepEqual(run('inversions', { values }).result, { inversions: inv(values), sorted: [...values].sort((a, b) => a - b) });
  }
  const hanoi = run('hanoi', { n: 4 }).result;
  assert.equal(hanoi.moves, 15);
  assert.deepEqual(hanoi.pegs, { A: [], B: [], C: [4, 3, 2, 1] });
  const ok = (cols) => cols.every((c, q) => cols.every((d, p) => p === q || (c !== d && Math.abs(p - q) !== Math.abs(c - d))));
  for (const n of [4, 5, 6, 8]) assert.ok(ok(run('queens', { n }).result), `${n} queens`);
  assert.equal(run('queens', { n: 3 }).result, null, 'no solution for 3');
  assert.equal(run('fibonacci', { n: 20 }).result, 6765);
  assert.equal(run('fibonacci', { n: 1 }).result, 1);
  assert.deepEqual(run('knapsack', { items: 'Map 1 1\nTent 3 4\nStove 4 5\nCamera 5 7', capacity: 7 }).result, { best: 9, chosen: ['Tent', 'Stove'] });
  assert.deepEqual(run('knapsack', { items: 'A 5 10\nB 4 40\nC 6 30\nD 3 50\nE 2 15', capacity: 10 }).result.best, 105);
});

test('the HashMap behaves as the course’s: Java hash codes, chaining, replace on add, rehash past the load factor', () => {
  assert.equal(javaHash('Ana'), 65972);
  assert.equal(javaHash('hello'), 99162322);
  assert.equal(javaHash('polygenelubricants'), -2147483648, '32-bit overflow');
  const t = run('hashmap', { ops: 'add 3 a\nadd 8 b\nadd 13 c\nadd 4 d\nget 13\nremove 8\nget 13\nadd 3 z', capacity: 5, maxLoad: 0 });
  assert.deepEqual(t.result.results, ['c', 'b', 'c']);
  assert.deepEqual(t.result.buckets, [[], [], [], [[3, 'z'], [13, 'c']], [[4, 'd']]]);
  const r = run('hashmap', { ops: 'add a 1\nadd b 2\nadd c 3\nadd d 4', capacity: 4, maxLoad: 0.75 }).result;
  assert.equal(r.buckets.length, 8, '4/4 > 0.75: doubled');
  assert.deepEqual(r.buckets.flat().map(([k]) => k).sort(), ['a', 'b', 'c', 'd']);
  for (const [i, bucket] of r.buckets.entries()) for (const [k] of bucket) assert.equal(Math.abs(javaHash(k) % 8), i);
  assert.deepEqual(parseOps('put x 1; get x; frob').problems, ['frob']);
});

test('the recorder: snapshots, changes, lasting and per-step marks, calls, and the cap', () => {
  const t = createRecorder({ cap: 3 });
  const a = t.array('a', [3, 1]);
  const q = t.queue('q');
  t.mark('a', 0, 'done');
  a.swap(0, 1);
  q.add('x');
  t.call('f', 1);
  t.step('one', { line: 2, vars: { i: 0 }, marks: { a: { 1: 'current' } } });
  const s = t.steps[0];
  assert.deepEqual(s.state.a.items, [1, 3]);
  assert.deepEqual(s.state.q.items, ['x']);
  assert.deepEqual(s.changes.map((c) => c.op), ['swap', 'add']);
  assert.deepEqual(s.marks, { a: { 0: 'done', 1: 'current' } });
  assert.deepEqual(s.calls, [{ fn: 'f', args: '1' }]);
  t.step('two');
  assert.deepEqual(t.steps[1].marks, { a: { 0: 'done' } }, 'per-step marks go');
  assert.deepEqual(t.steps[1].vars, { i: 0 }, 'vars stay until changed');
  assert.deepEqual(t.steps[1].changes, []);
  t.step('three');
  assert.throws(() => t.step('four'), StepLimit);
  const loop = record((input, r) => { for (;;) r.step('again'); }, null, { cap: 50 });
  assert.equal(loop.steps.length, 51);
  assert.match(loop.error, /Stopped after 50 steps/);
  assert.match(loop.steps.at(-1).caption, /Stopped after 50 steps/);
});

test('specs: made whole, named "Topic: Algorithm", the step chosen, odd input said and drawn', () => {
  assert.deepEqual(normalize({}).algorithm, ALGORITHMS[0].id);
  assert.equal(normalize({ algorithm: 'nope' }).algorithm, ALGORITHMS[0].id);
  assert.equal(name({ algorithm: 'dijkstra' }), 'Greedy: Dijkstra');
  assert.equal(name({ algorithm: 'prim' }), 'Greedy: Prim');
  const spec = { algorithm: 'fibonacci', input: { n: 5 } };
  const { trace } = traceOf(spec);
  assert.equal(stepIndex({ ...spec, step: -1 }, trace), trace.steps.length - 1);
  assert.equal(stepIndex({ ...spec, step: null }, trace), Math.floor((trace.steps.length - 1) / 2));
  assert.equal(stepIndex({ ...spec, step: 999 }, trace), trace.steps.length - 1);
  assert.equal(traceOf(spec), traceOf({ ...spec, step: 3 }), 'runs are cached by input');
  const last = render({ ...spec, step: -1 });
  wellFormed(last.svg);
  assert.match(last.svg, /fib\(5\) = 5/);
  assert.match(render({ ...spec, step: 0, code: true }).svg, /fibonacciDynamic/);
  const bad = traceOf({ algorithm: 'knapsack', input: { items: 'what', capacity: 3 } });
  assert.match(bad.error, /Not an item/);
  wellFormed(render({ algorithm: 'knapsack', input: { items: 'what', capacity: 3 } }).svg);
  for (const odd of [null, 7, { algorithm: 'dijkstra', input: { graph: 'x', start: 5 } }, { algorithm: 'queens', input: { n: 'a' } }]) wellFormed(render(odd).svg);
});

test('the catalog: topics by heading in alphabetical order, names alphabetical inside, cards named and grouped', () => {
  const headings = TOPICS.map((t) => t.heading);
  assert.deepEqual(headings, [...headings].sort((a, b) => a.localeCompare(b)));
  const cards = prefabs();
  assert.equal(cards.length, ALGORITHMS.length);
  assert.ok(cards.every((c) => c.group === 'algorithms' && c.id.startsWith('algorithm-') && /^[A-Z][^:]+: /.test(c.label)));
  const labels = cards.map((c) => c.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), 'by topic then name is also by full name');
  assert.ok(labels.includes('Greedy: Dijkstra') && labels.includes('Greedy: Prim'));
  assert.deepEqual(ordered('recent', ['prim', 'gone']).slice(0, 2).map((a) => a.id), ['prim', ALGORITHMS[0].id]);
  for (const c of cards) wellFormed(render(c.spec).svg);
});

test('graph input: edge lists both ways, graphs made whole', () => {
  const p = parseEdges('A-B 4, B->C 2\nC D\nE');
  assert.deepEqual(p.nodes, ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(p.edges, [{ from: 'A', to: 'B', w: 4 }, { from: 'B', to: 'C', w: 2, arrow: true }, { from: 'C', to: 'D' }]);
  const g = normalizeGraph({ nodes: [{ id: 'A' }, { id: 'B' }, { id: 'A' }], edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }, { from: 'A', to: 'A' }, { from: 'A', to: 'Z' }] }, { weighted: true });
  assert.deepEqual(g.edges, [{ from: 'A', to: 'B', w: 1 }], 'no duplicates, loops or unknown ends');
  assert.equal(edgesText({ nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B', w: 3 }], directed: true }), 'A->B 3\nC');
  assert.deepEqual(run('bfs', { graph: graph('A-B, B-C, D'), start: 'A' }).result, ['A', 'B', 'C']);
});

test('every structure kind draws, empty or full', () => {
  const c = { id: 's', marks: {}, changes: [], c: undefined };
  const snaps = {
    graph: { nodes: [], edges: [] }, array: { items: [] }, heap: { items: [] }, queue: { items: [] }, stack: { items: [] }, deque: { items: [1] }, pq: { items: [] },
    hashtable: { buckets: [[], []], size: 0, capacity: 2, loadFactor: 0 }, map: { entries: [] }, set: { items: [] },
    binarytree: { root: { id: 'a', label: 1, left: { id: 'b', label: 2 }, right: null } }, tree: { root: { id: 'r', label: 'r', children: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }] } },
    matrix: { rows: 1, cols: 2, cells: [[1, '']] }, board: { n: 2, cells: [['Q', ''], ['', '']] }, value: { value: Infinity }, text: { text: 'a < b & c' },
  };
  for (const [kind, snap] of Object.entries(snaps)) {
    const trace = { structures: { s: { kind, label: kind } }, steps: [{ caption: '', line: null, vars: {}, state: { s: snap }, changes: [], marks: {}, calls: [] }] };
    wellFormed(drawStep(trace, 0).svg);
    assert.ok(KINDS[kind], kind);
  }
  void c;
});

// The activities' JUnit tests (aedii-activities src/test), on the same data.
test('phase 2: the results the activities’ tests expect', () => {
  const by = (id, label) => { const a = algorithmById(id); const p = a.presets.find((q) => q.label.includes(label)); assert.ok(p, `${id}: preset ${label}`); return record(a.run, a.normalize(p.input)).result; };
  // Activity 1
  assert.equal(by('factorial', '5'), 120);
  assert.equal(by('sum-digits', '1369'), 19);
  assert.equal(by('gcd', '84'), 12);
  assert.equal(by('invert-string', 'AEDII'), 'IIDEA');
  assert.deepEqual(by('invert-array', 'Seven'), [7, 6, 5, 4, 3, 2, 1]);
  assert.equal(by('minimum', 'Eight'), 1);
  assert.equal(by('binary-search', 'Found'), 5);
  assert.equal(by('binary-search', 'Not there'), -1);
  // Activity 2 (BinaryTreeRepository): tree A = A(B, C(D, E)), tree B = A(B, C(D, -))
  assert.equal(by('tree-height', 'Tree A'), 2);
  assert.equal(by('nodes-in-level', 'Tree A'), 2);
  assert.equal(by('is-complete', 'Complete'), true);
  assert.equal(by('is-complete', 'Not complete'), false);
  assert.equal(by('rebuild', 'Tree A'), 'A(B, C(D, E))');
  assert.equal(by('rebuild', 'Tree B'), 'A(B, C(D, -))');
  assert.equal(by('remove-leaves', 'Tree A'), 'A(-, C)');
  assert.equal(by('is-selection-binary', 'A selection'), true);
  assert.equal(by('is-selection-binary', 'Not one'), false);
  assert.equal(by('is-path', 'ACD'), true);
  assert.equal(by('is-path', 'ACEF'), false);
  assert.equal(by('is-path', 'CE'), false);
  assert.deepEqual(by('traversals', 'Inorder'), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  assert.deepEqual(by('traversals', 'By levels'), ['F', 'B', 'G', 'A', 'D', 'I', 'C', 'E', 'H']);
  assert.deepEqual(by('bst', 'Insert').found, [true, false]);
  const avl = by('avl', 'four');
  assert.deepEqual(avl.rotations.map((r) => r.slice(0, 2)), ['LL', 'RR', 'RL', 'RL']);
  assert.equal(by('avl', 'Sorted').tree, '4(2(1, 3), 6(5, 7))');
  // Activity 5 (TreeRepository / IntTreeRepository)
  assert.equal(by('tree-sum', '67'), 67);
  assert.equal(by('tree-grade', 'Tree A'), 3);
  assert.equal(by('tree-grade', 'Tree B'), 4);
  assert.equal(by('tree-level', 'G in'), 2);
  assert.equal(by('tree-level', 'D in'), 1);
  assert.equal(by('tree-level', 'X'), -1);
  assert.equal(by('is-23-tree', 'Tree A'), true);
  assert.equal(by('is-23-tree', 'Tree B'), false);
  assert.equal(by('is-selection-general', 'Tree A'), true);
  assert.equal(by('is-selection-general', 'Tree B'), false);
  // Activity 6
  assert.deepEqual(by('anagrams', 'rato').map((g) => g.sort().join(' ')).sort(), ['arto rato taro', 'bato tabo', 'par']);
  assert.deepEqual(by('related-words', 'fool foul foil').sort(), ['fool-cool', 'fool-foil', 'fool-foul', 'fool-pool', 'foul-foil', 'pool-cool']);
  assert.ok(!by('related-words', 'coil').includes('fool-foil'));
  // Activity 7
  assert.deepEqual(by('predecessors', 'of D').sort(), ['B', 'C']);
  assert.equal(by('regular', 'ring (yes)'), true);
  assert.equal(by('connected-from', 'Two parts'), false);
  assert.equal(by('path-between', 'F to A'), false);
  assert.equal(by('is-cycle', 'A B C A'), false);
  assert.equal(by('components', 'Three'), 3);
  // Activity 8 (GreedyRepository)
  assert.deepEqual(by('dijkstra', 'Activity 8'), { ONE: 0, TWO: 3, THREE: 10, FOUR: 7, FIVE: 11, SIX: 5 });
  assert.deepEqual(by('prim', 'Activity 8').edges.map((e) => [e.from, e.to].sort().join('-')).sort(), ['FIVE-THREE', 'FOUR-SIX', 'FOUR-THREE', 'ONE-SIX', 'ONE-TWO']);
  assert.deepEqual(by('traveller', 'ONE').route, ['ONE', 'TWO', 'THREE', 'FIVE', 'FOUR', 'SIX']);
  assert.deepEqual(by('colour-map', 'Activity'), { ONE: 'blue', TWO: 'green', THREE: 'yellow', FOUR: 'blue', FIVE: 'red', SIX: 'red' });
  assert.deepEqual(by('give-change', '1200'), { 500: 2, 200: 1 });
  assert.deepEqual(by('burn-cd', '21').sort(), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(by('fill-rucksack', '55'), { car: 1, doll: 2 });
  assert.deepEqual(by('exam-schedule', 'Activity'), { SO: 'wednesday', BD: 'monday', EST: 'monday', AEDII: 'tuesday', AL: 'monday' });
  assert.deepEqual(by('activity-planner', 'Activity').sort(), ['act1', 'act4', 'act5']);
  assert.equal(by('kruskal', 'Activity').weight, 16);
  // Activity 9 (BacktrackingRepository)
  assert.deepEqual(by('bt-give-change', '2100'), { 500: 3, 200: 3 });
  assert.deepEqual(by('flash-drive', '21').sort(), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(by('subset-sum', '21'), [1, 1, 1, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(by('queens', 'eight'), [0, 4, 7, 5, 2, 6, 1, 3]);
  assert.deepEqual(by('sudoku', 'Activity'), ['471592683', '259683471', '683147259', '916758342', '724316598', '835924167', '192865734', '368471925', '547239816']);
  assert.deepEqual(by('word-path', 'ADE'), [' OOXX', ' DXOX', '    X', 'ODO  ', 'OOOA ']);
  assert.deepEqual(by('word-path', 'ADEI'), ['AOOXX', 'DDXOX', 'EADEX', 'ODOAD', 'OOOAE']);
  assert.deepEqual(by('puzzle-cards', 'Activity'), ['0054 0135 0321 0043', '4210 2354 1523 0234', '5201 3542 3421 3205', '2400 4320 2410 1500']);
  // Activity 10
  assert.equal(by('quickselect', '5th'), 9);
  assert.equal(by('fixed-point', 'Activity'), 2);
  assert.equal(by('valley', 'curve'), 6);
  assert.equal(by('valley', 'line'), -1);
  assert.equal(by('inversions', 'Activity 10').inversions, 22);
  assert.deepEqual(by('hanoi', 'Three').list, ['1:AC', '2:AB', '1:CB', '3:AC', '1:BA', '2:BC', '1:AC']);
  // Activity 11
  assert.equal(by('fibonacci', '10'), 55);
  assert.deepEqual(by('dp-change', '1200'), { 500: 2, 200: 1 });
  assert.deepEqual(by('knapsack', 'Activity 11').chosen, ['doll', 'ball']);
  // Extras
  assert.deepEqual(by('bellman-ford', 'Negative'), { S: 0, A: 2, B: 7, C: 4, D: -2 });
  assert.equal(by('bellman-ford', 'cycle'), null);
  assert.deepEqual(by('floyd', 'Four').C, { A: 6, B: 2, C: 0, D: 3 });
  for (const id of ['bubble-sort', 'insertion-sort', 'selection-sort']) assert.deepEqual(by(id, 'Seven'), [5, 10, 13, 14, 22, 29, 37]);
});

test('the whole catalog: every topic of the plan, at least 60 algorithms, ids unique', () => {
  const ids = ALGORITHMS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 60, `${ids.length} algorithms`);
  for (const topic of TOPICS) assert.ok(ALGORITHMS.some((a) => a.topic === topic.id), topic.heading);
});
