import test from 'node:test';
import assert from 'node:assert/strict';
import { tableItems, tableSpec, resized, mergeCells, splitCell, mergeAt, anchorOf, mergeArea, shiftMerges, normalMerges } from './table.js';

test('a spec is a rectangular grid of strings, kept within bounds', () => {
  const s = tableSpec({ cells: [['a', 'b', 'c'], ['d']], header: false });
  assert.deepEqual(s.cells, [['a', 'b', 'c'], ['d', '', '']]);
  assert.equal(s.header, false);
  assert.equal(tableSpec({ cells: Array.from({ length: 50 }, () => ['x']) }).cells.length, 30);
});

test('adding and removing rows and columns keeps what is typed', () => {
  const s = resized({ cells: [['a', 'b'], ['c', 'd']] }, 3, 3);
  assert.deepEqual(s.cells, [['a', 'b', ''], ['c', 'd', ''], ['', '', '']]);
  assert.deepEqual(resized(s, 1, 1).cells, [['a']]);
});

test('a table: border and rules as line shapes, a tinted header, a text box per filled cell', () => {
  const { lines, images } = tableItems([100, 100, 300, 120], { cells: [['Name', 'Value'], ['x', '$x^2$'], ['', '3']] }, { id: 't1' });
  const rules = lines.filter((l) => l.shape?.kind === 'line');
  assert.equal(rules.length, 2 + 1, 'two rules between rows, one between columns');
  assert.equal(lines.filter((l) => l.tool === 1 && l.under && l.square).length, 1, 'header tint: highlighter under the ink');
  const border = lines.find((l) => l.part.spec);
  assert.deepEqual([border.shape.start, border.shape.end], [[100, 100], [400, 220]], 'the border is the box and keeps the spec');
  assert.deepEqual(images.map((i) => i.text.text), ['Name', 'Value', 'x', '$x^2$', '3']);
  assert.ok(images[0].text.bold && !images[2].text.bold, 'the header is bold');
  assert.equal(images[3].text.math, true, 'math in a cell');
  // Every text box inside its cell.
  for (const { bounds: [x, y, w, h] } of images) assert.ok(x >= 100 && y >= 100 && x + w <= 400 && y + h <= 220, `${[x, y, w, h]}`);
  const all = [...lines, ...images];
  assert.ok(all.every((i) => i.part.id === 't1' && i.part.kind === 'table'));
  assert.equal(all.filter((i) => i.part.spec).length, 1);
});

test('backgrounds: none, the header, striped rows or the whole table, in a chosen colour', async () => {
  const { TINTS } = await import('./table.js');
  const cells = [['A', 'B'], ['1', '2'], ['3', '4'], ['5', '6'], ['7', '8']];
  const bands = (spec) => tableItems([0, 0, 200, 100], { cells, ...spec }).lines.filter((l) => l.tool === 1 && l.under);
  // Old tables (no background in their spec) keep their blue header.
  assert.deepEqual(bands({}).map((b) => b.rgba), [TINTS.blue.head]);
  assert.equal(bands({ background: 'none' }).length, 0);
  assert.equal(bands({ header: false }).length, 0, 'no header row: nothing to tint');
  // Striped: the header and the 2nd and 4th body rows (rows 3 and 5 of the table).
  const striped = bands({ background: 'striped', tint: 'green' });
  assert.deepEqual(striped.map((b) => b.rgba), [TINTS.green.head, TINTS.green.body, TINTS.green.body]);
  assert.deepEqual(striped.map((b) => b.points[0][1]), [10, 50, 90], 'each band centred in its row');
  const all = bands({ background: 'all', tint: 'yellow' });
  assert.equal(all.length, 5);
  assert.deepEqual(all[0].rgba, TINTS.yellow.head);
  assert.ok(all.every((b) => b.width === 20), 'each band as tall as its row');
  // Unknown values fall back, and the spec the table keeps has them.
  assert.deepEqual([tableSpec({ background: 'x', tint: 'y' }).background, tableSpec({ background: 'x', tint: 'y' }).tint], ['header', 'blue']);
  assert.equal(JSON.parse(tableItems([0, 0, 10, 10], { cells, background: 'all', tint: 'pink' }).lines.find((l) => l.part.spec).part.spec).tint, 'pink');
});

test('merges are kept inside the grid, at least two cells, never overlapping', () => {
  // [1,1,2,1] overlaps the first; [2,2,5,5] is cut to one cell; [0,2,1,1] is one cell.
  assert.deepEqual(normalMerges([[0, 0, 2, 2], [1, 1, 2, 1], [2, 2, 5, 5], [0, 2, 1, 1], ['x'], [1, 2, 9, 1]], 3, 3), [[0, 0, 2, 2], [1, 2, 2, 1]]);
  const s = tableSpec({ cells: [['a', 'b'], ['c', 'd']], merges: [[0, 0, 1, 2]] });
  assert.equal(s.v, 2);
  assert.deepEqual(s.merges, [[0, 0, 1, 2]]);
  assert.equal(tableSpec({ cells: [['a']] }).v, 1, 'a table without merges stays version 1');
  assert.equal('merges' in tableSpec({ cells: [['a']] }), false);
});

test('merging joins the text of the cells, splitting keeps it in the first cell', () => {
  const s = mergeCells({ cells: [['a', 'b', 'c'], ['d', '', 'f']] }, [0, 0], [1, 1]);
  assert.deepEqual(s.merges, [[0, 0, 2, 2]]);
  assert.equal(s.cells[0][0], 'a\nb\nd');
  assert.deepEqual([s.cells[0][1], s.cells[1][0], s.cells[1][1]], ['', '', '']);
  assert.deepEqual(mergeAt(s, 1, 1), [0, 0, 2, 2]);
  assert.deepEqual(anchorOf(s, 1, 0), [0, 0]);
  assert.deepEqual(anchorOf(s, 1, 2), [1, 2]);
  const back = splitCell(s, 1, 1);
  assert.equal(back.merges, undefined);
  assert.equal(back.cells[0][0], 'a\nb\nd');
  assert.deepEqual(mergeCells({ cells: [['a', 'b']] }, [0, 1], [0, 1]).merges, undefined, 'one cell: nothing to merge');
});

test('a selection that cuts a merge grows to take all of it', () => {
  const s = tableSpec({ cells: Array.from({ length: 4 }, () => ['', '', '', '']), merges: [[1, 1, 2, 2]] });
  assert.deepEqual(mergeArea(s, [0, 0], [1, 1]), [0, 0, 3, 3]);
  const joined = mergeCells(s, [0, 1], [1, 3]);
  assert.deepEqual(joined.merges, [[0, 1, 3, 3]], 'the old merge becomes part of the new one');
});

test('rows and columns inserted or removed move, grow or shrink the merges', () => {
  const m = [[1, 1, 2, 2]];
  assert.deepEqual(shiftMerges(m, 0, 0, 1), [[2, 1, 2, 2]], 'row above: moved down');
  assert.deepEqual(shiftMerges(m, 0, 2, 1), [[1, 1, 3, 2]], 'row inside: grown');
  assert.deepEqual(shiftMerges(m, 0, 3, 1), m, 'row below: unchanged');
  assert.deepEqual(shiftMerges(m, 1, 1, -1), [[1, 1, 2, 1]], 'first column removed: shrunk');
  assert.deepEqual(shiftMerges(m, 1, 0, -1), [[1, 0, 2, 2]], 'column before removed: moved left');
  assert.deepEqual(shiftMerges([[0, 0, 1, 2]], 1, 0, -2), [], 'all of it removed: gone');
  // Cutting the table smaller cuts its merges; a merge left with one cell is dropped.
  const s = tableSpec({ cells: [['a', 'b', 'c'], ['d', 'e', 'f']], merges: [[0, 1, 2, 2]] });
  assert.deepEqual(resized(s, 2, 2).merges, [[0, 1, 2, 1]]);
  assert.equal(resized(s, 1, 2).merges, undefined);
});

test('a merged area has no rules inside it and one text box in its middle', () => {
  // 3 × 3, 300 × 90; the top row merged across all columns, and a 2 × 2 block at the bottom left.
  const spec = { cells: [['Title', '', ''], ['a', 'b', 'c'], ['', 'e', 'f']], header: false, merges: [[0, 0, 1, 3], [1, 0, 2, 2]] };
  const { lines, images } = tableItems([0, 0, 300, 90], spec, { id: 't' });
  const rules = lines.filter((l) => l.shape?.kind === 'line').map((l) => l.points.flat());
  // Row rule at y = 30 (under the title): whole width. At y = 60: only under column 3.
  assert.deepEqual(rules.filter((p) => p[1] === 30 && p[3] === 30), [[0, 30, 300, 30]]);
  assert.deepEqual(rules.filter((p) => p[1] === 60 && p[3] === 60), [[200, 60, 300, 60]]);
  // Column rule at x = 100: none (title above, block below). At x = 200: under the title only.
  assert.deepEqual(rules.filter((p) => p[0] === 100 && p[2] === 100), []);
  assert.deepEqual(rules.filter((p) => p[0] === 200 && p[2] === 200), [[200, 30, 200, 90]]);
  const title = images.find((i) => i.text.text === 'Title');
  const [x, , w] = title.bounds;
  assert.ok(Math.abs(x + w / 2 - 150) < 1, 'the merged title is centred across the table');
  const a = images.find((i) => i.text.text === 'a');
  assert.ok(a.bounds[1] > 30 && a.bounds[1] + a.bounds[3] < 90 && Math.abs(a.bounds[1] + a.bounds[3] / 2 - 60) < 1, 'centred in its two rows');
  assert.equal(JSON.parse(lines.find((l) => l.part.spec).part.spec).merges.length, 2, 'the spec kept has the merges');
});
