// The AEDII activities (owner's code for 1, 4, 6, 7; the stubs of 8–11 filled in the course's
// style) run in the simulator. Each fixture folder has a Driver.java that runs the cases of the
// repo's JUnit tests and expected.txt, the JVM's output of that driver (javac + java with the
// course's tads jars): the simulator must print exactly the same. Then the JUnit expected values
// are checked through runJava's entry/args API.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runJava } from '../index.js';

const here = new URL('./fixtures/', import.meta.url);
const sources = (dir) => readdirSync(new URL(dir + '/', here)).filter((f) => f.endsWith('.java')).map((f) => ({ name: f, text: readFileSync(new URL(dir + '/' + f, here), 'utf8') }));
const expected = (dir) => readFileSync(new URL(dir + '/expected.txt', here), 'utf8');
const run = (dir, opts) => runJava(sources(dir), opts);

for (const a of ['activity1', 'activity4', 'activity6', 'activity7', 'activity8', 'activity9', 'activity10', 'activity11']) {
  test(a + ': the driver prints what the JVM prints', () => {
    const t = run(a, { entry: 'Driver.main', maxFrames: 200 });
    assert.equal(t.error, undefined, JSON.stringify(t.error));
    assert.equal(t.output, expected(a));
    assert.ok(t.steps.length > 0 && t.steps.length <= 200);
  });
}

test('activity 1 (recursion): the JUnit values', () => {
  const call = (entry, ...args) => run('activity1', { entry: 'Activity1.' + entry, args, record: false });
  assert.equal(call('factorial', 0).result, 1);
  assert.equal(call('factorial', 4).result, 24);
  assert.equal(call('factorial', 20).resultText, '2432902008176640000'); // long
  assert.equal(call('square', 5).result, 25);
  assert.equal(call('sumDigits', 1111).result, 4);
  assert.equal(call('mcd', 22, 12).result, 2);
  assert.equal(call('invert', 'example').result, 'elpmaxe');
  assert.equal(call('addValues', [2, 4, 6, 8]).result, 20);
  assert.equal(call('minimum', [4, 3, 6, 2, 8]).result, 2);
  assert.equal(call('binarySearch', [1.1, 2.2, 3.3, 4.4, 5.5], 3.3).result, 2);
  assert.deepEqual(call('copyStack', ['AEDII', 'Actividad', 'Uno']).result, ['AEDII', 'Actividad', 'Uno']);
});

test('activity 4 (heaps): the owner\'s BinaryMaxHeap fails where the JVM fails', () => {
  const out = run('activity4', { entry: 'Driver.main', record: false }).output;
  // MaxHeapTestCase.testRemove9Values expects 3 to remain: the owner's sink() leaves 12 (also on the JVM)
  assert.match(out, /after 9 removes max=12/);
  // HeapSortTestCase errors on the JVM with IndexOutOfBoundsException in sinkMateo
  assert.match(out, /heapSort threw IndexOutOfBoundsException: Index 12 out of bounds for length 12/);
  // uncaught, it is reported with its line in BinaryMaxHeap.java
  const t = run('activity4', { entry: 'HeapSort.heapSort', args: [[23, 45, 12]] });
  assert.equal(t.error.kind, 'runtime');
  assert.equal(t.error.exception, 'IndexOutOfBoundsException');
  assert.equal(t.error.file, 'BinaryMaxHeap.java');
  assert.equal(t.error.line, 93); // T childLeft = this.arrayHeap.get(childLeftPos);
  assert.deepEqual(t.error.stack.slice(0, 3), ['BinaryMaxHeap.sinkHelper', 'BinaryMaxHeap.sinkMateo', 'BinaryMaxHeap.orderHeap']);
});

test('activity 6 (the HashMap implementation): MapTestCase values', () => {
  const out = run('activity6', { entry: 'Driver.main', record: false }).output;
  assert.match(out, /size=6 get\(3\)=TRES get\(100\)=null get\(null\)=null/);
  assert.match(out, /add\(null\): NullPointerException/);
});

test('activity 7 (graphs): Activity7TestCase values', () => {
  const out = run('activity7', { entry: 'Driver.main', record: false }).output;
  for (const line of ['isRegular(empty)=true isRegular(cities)=false', 'connected(empty,CO)=false', 'connected(cities,CO)=true',
    'connected(topo2,B)=false', 'connected(topo2,C)=true', 'path(CO,OU)=true', 'path(OU,CO)=true', 'path(C,D)=true', 'path(D,C)=false']) {
    assert.ok(out.includes(line), line);
  }
  // graphs as arguments: "A-B 4" edge lists
  const t = run('activity7', { entry: 'Activity7.isConnectedFromVertex', args: ['C->A 10, C->B 10, C->D 115, B->D 115', 'B'] });
  assert.equal(t.result, false);
  assert.ok(t.structures.visited, 'the visited set is a tracked structure');
  assert.equal(t.structures.visited.kind, 'set');
});

test('activity 8 (greedy): Dijkstra and Prim give the JUnit results', () => {
  const graph = 'ONE-TWO 3, TWO-THREE 7, THREE-FOUR 5, TWO-SIX 10, ONE-SIX 5, THREE-FIVE 1, SIX-FOUR 2, SIX-THREE 8, FOUR-FIVE 6';
  const d = run('activity8', { entry: 'GreedyAlgorithm.dijkstra', args: [graph, 'ONE'] });
  assert.equal(d.error, undefined, JSON.stringify(d.error));
  assert.deepEqual(d.result, { ONE: 0, TWO: 3, THREE: 10, FOUR: 7, FIVE: 11, SIX: 5 }); // GreedyRepository KEYS/VALUES_DIJKSTRA
  assert.equal(d.structures.graph.kind, 'graph');
  assert.equal(d.structures.distances.kind, 'map');
  const p = run('activity8', { entry: 'GreedyAlgorithm.prim', args: [graph, 'SIX'], record: false });
  const edges = p.result.edges.map((e) => e.join(' ')).sort();
  assert.deepEqual(edges, ['FOUR THREE 5', 'ONE TWO 3', 'SIX FOUR 2', 'SIX ONE 5', 'THREE FIVE 1']); // GRAPH_PRIM
});

test('activity 9 (backtracking): placeQueens', () => {
  const t = run('activity9', { entry: 'Driver.main' });
  assert.match(t.output, /placeQueens=true \[0, 4, 7, 5, 2, 6, 1, 3\]/); // queensResult
  assert.equal(t.truncated, true, 'the 16 000 statements go past the 5000-step trace cap');
  const board = run('activity9', { entry: 'BacktrackingAlgorithm.placeQueens', args: [0, [0, 0, 0, 0]] });
  assert.equal(board.result, true);
  assert.equal(board.structures.board.kind, 'array');
  const last = board.steps[board.steps.length - 1];
  assert.deepEqual(last.state.board.items, [1, 3, 0, 2]);
  assert.ok(Math.max(...board.steps.map((s) => s.calls.length)) >= 5, 'the recursion shows in the call stack');
});

test('activity 10 (divide and conquer): quickSelection and moveHanoiDiscs', () => {
  assert.equal(run('activity10', { entry: 'DivideAndConquerAlgorithm.quickSelection', args: [[4, 2, 8, 12, 6, 9, 23, 43, 78, 14], 5, 0, 9] }).result, 9);
  const h = run('activity10', { entry: 'DivideAndConquerAlgorithm.moveHanoiDiscs', args: [3, 'A', 'B', 'C'] });
  assert.equal(h.result, 'Disc 1 from A to C\nDisc 2 from A to B\nDisc 1 from C to B\nDisc 3 from A to C\nDisc 1 from B to A\nDisc 2 from B to C\nDisc 1 from A to C\n');
  assert.equal(h.structures.movements.kind, 'text');
});

test('activity 11 (dynamic programming): fibonacciDynamic and fillRucksackDynamic', () => {
  const f = run('activity11', { entry: 'DynamicProgrammingAlgorithm.fibonacciDynamic', args: [10] });
  assert.equal(f.result, 55);
  assert.deepEqual(f.steps[f.steps.length - 1].state.table.items, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
  const r = run('activity11', {
    entry: 'DynamicProgrammingAlgorithm.fillRucksackDynamic',
    args: [9, { car: 4, doll: 5, ball: 10, bike: 3 }, { car: 3, doll: 4, ball: 5, bike: 2 }],
  });
  assert.deepEqual(r.result, ['doll', 'ball']); // getListRucksack
  assert.equal(r.structures.table.kind, 'matrix');
});
