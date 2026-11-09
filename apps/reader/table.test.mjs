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
