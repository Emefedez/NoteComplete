import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorKind, canBeExercise, gridOf, rowsData, withGrid, spansOf, resample, cellFor, labelsOf, emptyAnswer, answerGrid, displaySpec, checkAnswer, withAnswer } from './chart-model.js';

const STATES = {
  type: 'states', title: 'FIFO', tStart: 0, tEnd: 12, tStep: 2, unit: 'u.t.',
  processes: [
    { label: 'A', arrival: 0, segments: [{ state: 'run', start: 0, end: 4 }, { state: 'blocked', start: 4, end: 8 }] },
    { label: 'B', arrival: 2, segments: [{ state: 'ready', start: 2, end: 4 }, { state: 'run', start: 4, end: 9 }] },
  ],
};
const TIMELINE = { type: 'timeline', tStart: 0, tEnd: 10, tStep: 1, unit: 'ms', rows: [{ label: 'CPU', intervals: [{ label: 'P1', start: 0, end: 2 }, { label: 'P2', start: 2, end: 4 }, { label: 'P1', start: 4, end: 6 }] }] };
const BARS = { type: 'bar', bins: [{ label: 'A', value: 4 }, { label: 'B', value: 6 }] };

test('each figure opens in its editor', () => {
  assert.equal(editorKind(STATES), 'states');
  assert.equal(editorKind(TIMELINE), 'timeline');
  assert.equal(editorKind({ type: 'gantt' }), 'timeline');
  assert.equal(editorKind(BARS), 'bars');
  assert.equal(editorKind({ type: 'histogram' }), 'bars');
  assert.equal(editorKind({ type: 'plot' }), 'plot');
  assert.equal(editorKind({ type: 'tree', nodes: ['A', 'B'] }), 'nodes');
  assert.equal(editorKind({ type: 'graph_nodes', nodes: ['A', 'B'] }), 'nodes');
  assert.equal(editorKind({ type: 'custom_svg', svg: '<svg/>' }), 'svg');
  assert.equal(editorKind({ type: 'uml' }), null);
  assert.ok(canBeExercise(STATES) && canBeExercise(BARS) && !canBeExercise({ type: 'plot' }));
});

test('a states diagram is a grid of cells and back, the same', () => {
  const g = gridOf(STATES);
  assert.equal(g.cell, 1);
  assert.equal(g.rows[0].cells.length, 12);
  assert.deepEqual(g.rows[0].cells.slice(0, 9), ['run', 'run', 'run', 'run', 'blocked', 'blocked', 'blocked', 'blocked', '']);
  assert.equal(g.rows[1].arrival, 2);
  const back = withGrid(STATES, g);
  assert.deepEqual(back.processes, STATES.processes);
  assert.equal(back.title, 'FIFO');
  assert.equal(back.tStep, 2);
});

test('a timeline keeps its labels; cells fit halves', () => {
  const g = gridOf(TIMELINE);
  assert.deepEqual(labelsOf(g), ['P1', 'P2']);
  assert.deepEqual(rowsData(g).rows[0].intervals, TIMELINE.rows[0].intervals);
  assert.equal(cellFor([0, 1.5, 3], 0, 10), 0.5);
  assert.deepEqual(spansOf(['a', 'a', '', 'b'], 0, 0.5), [{ value: 'a', start: 0, end: 1 }, { value: 'b', start: 1.5, end: 2 }]);
});

test('a longer time range keeps what is drawn', () => {
  const g = resample(gridOf(TIMELINE), { tEnd: 20 });
  assert.equal(g.rows[0].cells.length, 20);
  assert.deepEqual(rowsData(g).rows[0].intervals, TIMELINE.rows[0].intervals);
});

test('an exercise shows the answer on the page, empty at first, and the solution when revealed', () => {
  const ex = { ...STATES, exercise: true };
  const empty = displaySpec(ex);
  assert.equal(empty.blank, true);
  assert.deepEqual(empty.processes.map((p) => p.label), ['A', 'B']);
  assert.ok(empty.processes.every((p) => p.segments.length === 0));
  assert.equal(empty.tEnd, 12, 'the axis is the solution\'s');
  assert.equal(displaySpec({ ...ex, reveal: true }).processes[0].segments.length, 2);
  // Half an answer: drawn, not the solution.
  const a = answerGrid(ex);
  a.rows[0].cells.fill('run', 0, 4);
  const shown = displaySpec(withAnswer(ex, rowsData(a)));
  assert.notEqual(shown.blank, true);
  assert.deepEqual(shown.processes[0].segments, [{ state: 'run', start: 0, end: 4 }]);
  assert.equal(shown.processes[1].arrival, 2, 'arrivals are given');
  assert.equal(shown.answer, undefined);
  assert.equal(shown.exercise, undefined);
});

test('checking marks each wrong cell', () => {
  const ex = { ...STATES, exercise: true };
  assert.equal(checkAnswer(ex).done, false);
  const a = answerGrid(ex);
  const sol = gridOf(ex);
  a.rows.forEach((r, i) => { r.cells = [...sol.rows[i].cells]; });
  assert.deepEqual(checkAnswer(withAnswer(ex, rowsData(a))), { right: 24, total: 24, wrong: new Set(), done: true });
  a.rows[1].cells[5] = 'ready';
  const r = checkAnswer(withAnswer(ex, rowsData(a)));
  assert.equal(r.right, 23);
  assert.deepEqual([...r.wrong], ['1:5']);
});

test('a bar chart exercise: empty bars on the solution\'s axis, checked bar by bar', () => {
  const ex = { ...BARS, exercise: true };
  assert.deepEqual(emptyAnswer(ex), { bins: [{ label: 'A', value: null }, { label: 'B', value: null }] });
  const shown = displaySpec(ex);
  assert.equal(shown.blank, true);
  assert.equal(shown.yMax, 10);
  const half = withAnswer(ex, { bins: [{ label: 'A', value: 4 }, { label: 'B', value: 5 }] });
  assert.deepEqual(displaySpec(half).bins.map((b) => b.value), [4, 5]);
  const r = checkAnswer(half);
  assert.equal(r.right, 1);
  assert.deepEqual([...r.wrong], ['1']);
});

test('a timeline exercise ignores the case of labels', () => {
  const ex = { ...TIMELINE, exercise: true, answer: { rows: [{ label: 'CPU', intervals: [{ label: 'p1', start: 0, end: 2 }, { label: 'P2', start: 2, end: 4 }, { label: 'P1', start: 4, end: 6 }] }] } };
  assert.equal(checkAnswer(ex).done, true);
});

test('service time: CPU burst time plus blocked time', async () => {
  const { serviceOf } = await import('./chart-model.js');
  assert.equal(serviceOf({ cells: ['', 'ready', 'run', 'run', 'blocked', 'ready', 'run'] }, { tStart: 0, cell: 1 }), 4);
  assert.equal(serviceOf({ cells: ['run', 'blocked', ''] }, { tStart: 0, cell: 2.5 }), 5);
});
