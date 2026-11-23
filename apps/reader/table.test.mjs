import test from 'node:test';
import assert from 'node:assert/strict';
import { tableItems, tableSpec, resized } from './table.js';

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
