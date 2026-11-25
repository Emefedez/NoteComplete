import test from 'node:test';
import assert from 'node:assert/strict';
import { numberOf, compareCells, folded, placeCells, visibleGroups, sortedGroups, distinctValues, pageTable } from './table-filter.js';

const cells = (rows) => rows.map((r) => r.map((c) => (typeof c === 'string' ? { text: c } : c)));

test('numbers in cells as people write them', () => {
  for (const [text, n] of [['7', 7], ['7,5', 7.5], ['-3.25', -3.25], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['1,234,567', 1234567], ['1.234.567', 1234567],
    ['80%', 80], ['80 %', 80], ['€12', 12], ['12 $', 12], ['−2', -2], ['.5', 0.5], ['1e3', 1000]]) assert.equal(numberOf(text), n, text);
  for (const text of ['', 'abc', '12a', '3/4', '2026-03-14', '-', '1,2,a']) assert.equal(numberOf(text), null, text);
});

test('cells compare as numbers, then words in the reader\'s language', () => {
  const sorted = ['b', '10', 'Tema 10', '2', 'á', 'Tema 2', '1,5'].sort((a, b) => compareCells(a, b));
  assert.deepEqual(sorted, ['1,5', '2', '10', 'á', 'b', 'Tema 2', 'Tema 10']);
  assert.equal(folded('Árbol ÑU'), 'arbol nu');
});

test('cells are placed on a grid; rows joined by a rowspan form one group', () => {
  const rows = cells([[{ text: 'Física', rs: 2 }, '6.5', '7'], ['5', '8'], ['Química', { text: '9', cs: 2 }], ['Bio', '1', '2']]);
  const filled = placeCells(rows, { fill: true });
  assert.deepEqual(filled.grid, [['Física', '6.5', '7'], ['Física', '5', '8'], ['Química', '9', '9'], ['Bio', '1', '2']]);
  assert.deepEqual(filled.groups, [[0, 1], [2, 2], [3, 3]]);
  assert.deepEqual(filled.merges, [[0, 0, 2, 1], [2, 1, 1, 2]]);
  assert.deepEqual(placeCells(rows).grid[1], ['', '5', '8']);
  // A rowspan past the last row is cut.
  assert.deepEqual(placeCells(cells([[{ text: 'a', rs: 5 }, 'b']])).merges, []);
});

test('filters: words anywhere in a group, values per column', () => {
  const { grid, groups } = placeCells(cells([[{ text: 'Física', rs: 2 }, 'A', '7'], ['B', '8'], ['Química', 'A', '9'], ['Biología', 'C', '']]), { fill: true });
  assert.deepEqual(visibleGroups(grid, groups, {}), [true, true, true]);
  assert.deepEqual(visibleGroups(grid, groups, { query: 'fisica 8' }), [true, false, false]);
  assert.deepEqual(visibleGroups(grid, groups, { query: 'QUÍM' }), [false, true, false]);
  assert.deepEqual(visibleGroups(grid, groups, { values: new Map([[1, new Set(['B'])]]) }), [true, false, false]);
  assert.deepEqual(visibleGroups(grid, groups, { values: new Map([[2, new Set([''])]]) }), [false, false, true]);
  assert.deepEqual(visibleGroups(grid, groups, { query: 'a', values: new Map([[1, new Set(['A', 'C'])]]) }), [true, true, true]);
});

test('sorting: up, down or as written; stable; empty cells last both ways', () => {
  const { grid, groups } = placeCells(cells([['x', '10'], ['y', ''], ['z', '9'], ['w', '10'], ['v', 'n/a']]));
  assert.deepEqual(sortedGroups(grid, groups, 1, 1), [2, 0, 3, 4, 1]);
  assert.deepEqual(sortedGroups(grid, groups, 1, -1), [4, 0, 3, 2, 1]);
  assert.deepEqual(sortedGroups(grid, groups, 1, 0), [0, 1, 2, 3, 4]);
  assert.deepEqual(sortedGroups(grid, groups, 0, 1), [4, 3, 0, 1, 2]);
});

test('distinct values of a column, counted, empty last', () => {
  const { grid } = placeCells(cells([['A'], ['b'], [''], ['A'], ['10'], ['9']]));
  assert.deepEqual(distinctValues(grid, 0), [{ value: '9', count: 1 }, { value: '10', count: 1 }, { value: 'A', count: 2 }, { value: 'b', count: 1 }, { value: '', count: 1 }]);
});

test('a page table from the rows shown, cut to what a page holds, merges kept', () => {
  const rows = cells([[{ text: 'Asignatura', rs: 2 }, { text: 'Parcial', cs: 2 }, { text: 'Final', rs: 2 }], ['P1', 'P2'], [{ text: 'Física', rs: 2 }, '6.5', '7', '7.2'], ['5', '8', '6.8']]);
  assert.deepEqual(pageTable(rows, 2), {
    value: { cells: [['Asignatura', 'Parcial', '', 'Final'], ['', 'P1', 'P2', ''], ['Física', '6.5', '7', '7.2'], ['', '5', '8', '6.8']], merges: [[0, 0, 2, 1], [0, 1, 1, 2], [0, 3, 2, 1], [2, 0, 2, 1]], header: true },
    total: { rows: 4, columns: 4 }, kept: { rows: 4, columns: 4 },
  });
  const cut = pageTable(rows, 2, { maxRows: 3, maxColumns: 2 });
  assert.deepEqual(cut.kept, { rows: 3, columns: 2 });
  assert.deepEqual(cut.value.cells, [['Asignatura', 'Parcial'], ['', 'P1'], ['Física', '6.5']]);
  // Merges cut at the edge; one that no longer joins two cells goes.
  assert.deepEqual(cut.value.merges, [[0, 0, 2, 1]]);
  const big = pageTable(Array.from({ length: 1001 }, (_, r) => Array.from({ length: 50 }, (_, c) => ({ text: `${r}:${c}` }))), 1);
  assert.deepEqual([big.total, big.kept, big.value.cells.length, big.value.cells[0].length], [{ rows: 1001, columns: 50 }, { rows: 30, columns: 12 }, 30, 12]);
});
