import test from 'node:test';
import assert from 'node:assert/strict';
import { tableItems, tableSpec, resized, mergeCells, splitCell, mergeAt, anchorOf, mergeArea, shiftMerges, normalMerges } from './table.js';

test('a spec is a rectangular grid of strings, kept within bounds', () => {
  const s = tableSpec({ cells: [['a', 'b', 'c'], ['d']], header: false });
  assert.deepEqual(s.cells, [['a', 'b', 'c'], ['d', '', '']]);
  assert.equal(s.header, false);
  assert.equal(tableSpec({ cells: Array.from({ length: 60 }, () => ['x']) }).cells.length, 50);
  assert.equal(tableSpec({ cells: [Array(30).fill('x')] }).cells[0].length, 20);
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

// Sprint 1b (docs/TABLES-AND-OFFICE.md): row heights, cell looks, header column, borders, text size.
import { readFileSync } from 'node:fs';
import { insertLines, deleteLines, rowWeights, tableNaturalSize, formatCells, formatOf, areaAnchors, sortRows, canSort, compareCells, pasteBlock, shiftFormat, textBlock, CAP_HEIGHT, TINTS, MAX_ROWS, MAX_COLUMNS } from './table.js';

test('tables of versions 1 and 2 draw exactly as they did before', () => {
  // table.golden.json: what the table.js of commit 6fa98cc drew for these specs.
  const golden = JSON.parse(readFileSync(new URL('./table.golden.json', import.meta.url)));
  for (const { box, spec, items } of golden) {
    const { lines, images, spec: kept } = tableItems(box, spec, { id: 'g1', layer: 2 });
    assert.deepEqual({ lines, images }, items, JSON.stringify(spec));
    assert.ok(kept.v <= 2, 'still version 1 or 2');
    for (const key of ['heights', 'fit', 'format', 'headerColumn', 'borders', 'size']) assert.equal(key in kept, false, key);
  }
});

test('version 3 only when a new field is used, with unknown values dropped', () => {
  const cells = [['a', 'b'], ['c', 'd']];
  assert.equal(tableSpec({ cells, borders: 'all', size: 'auto', headerColumn: false, format: {}, fit: false }).v, 1);
  assert.equal(tableSpec({ cells, borders: 'x', size: 'huge', heights: [1], format: { '9,9': { bold: true }, '0,0': { colour: 'red' } } }).v, 1);
  for (const extra of [{ fit: true }, { heights: [1, 2] }, { headerColumn: true }, { borders: 'none' }, { size: 'large' }, { format: { '1,1': { italic: true } } }]) {
    assert.equal(tableSpec({ cells, ...extra }).v, 3, JSON.stringify(extra));
  }
  // A merged table with a new field is version 3 and keeps its merges.
  const s = tableSpec({ cells, merges: [[0, 0, 1, 2]], borders: 'outer' });
  assert.deepEqual([s.v, s.merges, s.borders], [3, [[0, 0, 1, 2]], 'outer']);
  // Explicit heights win over fit; looks of cells hidden by a merge are dropped.
  assert.equal('fit' in tableSpec({ cells, fit: true, heights: [1, 3] }), false);
  assert.deepEqual(tableSpec({ cells, merges: [[0, 0, 1, 2]], format: { '0,1': { bold: true }, '0,0': { align: 'right', fill: 'green', valign: 'up' } } }).format, { '0,0': { align: 'right', fill: 'green' } });
});

test('rows and columns inserted or deleted keep the widths, heights and cell looks', () => {
  const s = tableSpec({ cells: [['a', 'b', 'c'], ['d', 'e', 'f']], widths: [1, 2, 3], heights: [1, 2], format: { '1,2': { bold: true } } });
  const wider = insertLines(s, 1, 1);
  assert.deepEqual(wider.widths, [1, 2, 2, 3], 'the new column as wide as the one it was put before');
  assert.deepEqual(wider.cells[0], ['a', '', 'b', 'c']);
  assert.deepEqual(wider.format, { '1,3': { bold: true } });
  assert.deepEqual(insertLines(s, 1, 3).widths, [1, 2, 3, 3], 'at the end: as wide as the last');
  assert.deepEqual(deleteLines(s, 1, 0).widths, [2, 3]);
  assert.deepEqual(deleteLines(s, 1, 2).format, undefined, 'the cell with the look went with its column');
  const taller = insertLines(s, 0, 1, 2);
  assert.deepEqual([taller.cells.length, taller.heights], [4, [1, 2, 2, 2]]);
  assert.deepEqual(taller.format, { '3,2': { bold: true } });
  assert.deepEqual(deleteLines(s, 0, 0).heights, [2]);
  assert.equal(deleteLines(tableSpec({ cells: [['x']] }), 0, 0).cells.length, 1, 'one row is always left');
  // Never past the limits.
  const full = tableSpec({ cells: Array.from({ length: MAX_ROWS }, () => Array(MAX_COLUMNS).fill('')) });
  assert.equal(insertLines(full, 0, 0).cells.length, MAX_ROWS);
  assert.equal(insertLines(full, 1, 0).cells[0].length, MAX_COLUMNS);
  assert.deepEqual(shiftFormat({ '0,0': 1, '2,1': 2, '3,1': 3 }, 0, 1, -2), { '0,0': 1, '1,1': 3 });
});

test('rows fit their text: a row of three lines is taller, explicit heights are kept', () => {
  const cells = [['Head', 'B'], ['one', 'x'], ['a\nb\nc', 'y'], ['z', '']];
  const fitted = tableItems([0, 0, 200, 300], { cells, fit: true });
  const border = fitted.lines.find((l) => l.part.spec);
  const rows = fitted.lines.filter((l) => l.shape?.kind === 'line' && l.points[0][1] === l.points[1][1]).map((l) => l.points[0][1]);
  const heights = [rows[0], rows[1] - rows[0], rows[2] - rows[1], 300 - rows[2]];
  assert.ok(Math.abs(heights[0] - heights[1]) < 1e-9 && Math.abs(heights[0] - heights[3]) < 1e-9, 'one-line rows alike');
  assert.ok(heights[2] > 2 * heights[0], `the three-line row is taller: ${heights}`);
  assert.deepEqual([border.shape.start, border.shape.end], [[0, 0], [200, 300]], 'the table keeps its box');
  const text = fitted.images.find((i) => i.text.text === 'a\nb\nc');
  assert.ok(text.bounds[1] >= rows[1] && text.bounds[1] + text.bounds[3] <= rows[2], 'its text inside it');
  // Explicit heights: row 2 twice as tall as the others.
  const set = tableItems([0, 0, 100, 100], { cells: [['a'], ['b'], ['c']], header: false, heights: [1, 2, 1] });
  assert.deepEqual(set.lines.filter((l) => l.shape?.kind === 'line').map((l) => l.points[0][1]), [25, 75]);
  assert.deepEqual(rowWeights(tableSpec({ cells: [['a'], ['b']] })), [1, 1]);
  // The natural size: 120 per column, 44 per one-line row; fit adds room for lines.
  assert.deepEqual(tableNaturalSize({}), [360, 132]);
  assert.ok(tableNaturalSize({ cells, fit: true })[1] > tableNaturalSize({ cells })[1]);
  assert.ok(tableNaturalSize({ cells, size: 'small' })[1] < tableNaturalSize({ cells })[1]);
});

test('cell looks: bold, italic, alignment both ways and a fill under the text', () => {
  const box = [0, 0, 300, 120];
  const cells = [['H', 'I'], ['left', 'right'], ['top', 'bottom'], ['plain', 'fill']];
  const format = { '0,1': { bold: false, italic: true }, '1,0': { align: 'left' }, '1,1': { align: 'right', bold: true }, '2,0': { valign: 'top', align: 'center' }, '2,1': { valign: 'bottom' }, '3,1': { fill: 'yellow' } };
  const { lines, images, spec } = tableItems(box, { cells, format, background: 'all', tint: 'blue' });
  assert.equal(spec.v, 3);
  const at = (t) => images.find((i) => i.text.text === t);
  assert.deepEqual([at('H').text.bold, at('I').text.bold, at('I').text.italic], [true, false, true], 'a header cell can be plain');
  assert.equal(at('left').text.align, undefined, 'left: the text box as always');
  assert.equal(at('right').text.align, 2);
  assert.equal(at('top').text.align, 1);
  assert.ok(at('right').text.bold);
  const [rx, , rw] = at('right').bounds;
  assert.ok(Math.abs(rx + rw - 297) < 1e-9, 'right: against the cell\'s right edge');
  const [tx, , tw] = at('top').bounds;
  assert.ok(Math.abs(tx + tw / 2 - 75) < 1e-9, 'centred across its cell');
  // Top and bottom: the glyphs (textBlock: where the core puts them) a pad from the rules.
  const glyphs = (i) => { const b = textBlock(i.text.font_size, 1); return [i.bounds[1] + b.top, i.bounds[1] + b.bottom]; };
  assert.ok(Math.abs(glyphs(at('top'))[0] - 60 - Math.max(2, 0.3 * at('top').text.font_size)) < 1e-9, 'top: caps a pad under the row\'s top');
  assert.ok(glyphs(at('bottom'))[1] < 90 && glyphs(at('bottom'))[1] > 90 - at('bottom').text.font_size, 'bottom: baseline near the row\'s bottom');
  assert.ok(glyphs(at('bottom'))[0] > glyphs(at('top'))[0] + 5, 'bottom is lower than top');
  // The fill: a band in the cell only; the row's own band leaves that cell out (no band over a band).
  const bands = lines.filter((l) => l.tool === 1 && l.under && l.square);
  const fill = bands.find((b) => b.rgba === TINTS.yellow.head);
  assert.deepEqual([fill.points, fill.width], [[[150, 105], [300, 105]], 30]);
  const row3 = bands.filter((b) => b.points[0][1] === 105 && b !== fill);
  assert.deepEqual(row3.map((b) => [b.points[0][0], b.points[1][0]]), [[0, 150]]);
  assert.equal(bands.filter((b) => b.points[0][1] !== 105).length, 3, 'the other rows whole');
  // Bands come before the border and the text after everything: under the ink.
  assert.ok(lines.indexOf(fill) < lines.findIndex((l) => l.part.spec));
});

test('a merged cell takes its first cell\'s look and stays centred by default', () => {
  const cells = [['Title', '', ''], ['a', 'b', 'c']];
  const merged = tableItems([0, 0, 300, 60], { cells, header: false, merges: [[0, 0, 1, 3]] });
  const t = merged.images.find((i) => i.text.text === 'Title');
  assert.ok(Math.abs(t.bounds[0] + t.bounds[2] / 2 - 150) < 1e-9);
  assert.equal(t.text.align, undefined, 'centred as before, without a look of its own');
  const left = tableItems([0, 0, 300, 60], { cells, header: false, merges: [[0, 0, 1, 3]], format: { '0,0': { align: 'left', fill: 'pink' } } });
  assert.equal(left.images.find((i) => i.text.text === 'Title').bounds[0], 3);
  const fill = left.lines.find((l) => l.rgba === TINTS.pink.head);
  assert.deepEqual(fill.points, [[0, 15], [300, 15]], 'the fill covers the whole merged area');
  // Looks given to cells go to their merge's first cell.
  const s = formatCells({ cells, merges: [[0, 0, 1, 3]] }, areaAnchors(tableSpec({ cells, merges: [[0, 0, 1, 3]] }), [0, 0, 2, 2]), { bold: true });
  assert.deepEqual(Object.keys(s.format), ['0,0', '1,0', '1,1']);
  assert.deepEqual(formatOf(s, 0, 2), { bold: true });
  assert.equal(formatCells(s, [[0, 1]], { bold: null }).format['0,0'], undefined, 'null takes a look away');
});

test('a header column: bold and tinted, with its own thicker rule', () => {
  const cells = [['', 'Mon', 'Tue'], ['9:00', 'a', 'b'], ['10:00', 'c', 'd']];
  const { lines, images } = tableItems([0, 0, 300, 90], { cells, headerColumn: true });
  assert.deepEqual(images.filter((i) => i.text.bold).map((i) => i.text.text), ['Mon', 'Tue', '9:00', '10:00']);
  const tinted = lines.filter((l) => l.tool === 1);
  assert.deepEqual(tinted.map((b) => [b.points[0][0], b.points[1][0], b.points[0][1]]), [[0, 300, 15], [0, 100, 45], [0, 100, 75]], 'header row, then the first column below it');
  const vertical = lines.filter((l) => l.shape?.kind === 'line' && l.points[0][0] === l.points[1][0]);
  assert.deepEqual(vertical.map((l) => [l.points[0][0], l.width]), [[100, 1.4], [200, 0.8]]);
  assert.equal(tableItems([0, 0, 300, 90], { cells, headerColumn: true, background: 'none' }).lines.filter((l) => l.tool === 1).length, 0, 'no background: no tint');
});

test('borders: all, the outline, rows only or none; the header rule stays', () => {
  const cells = [['A', 'B', 'C'], ['1', '2', '3'], ['4', '5', '6']];
  const look = (borders) => {
    const { lines } = tableItems([0, 0, 300, 90], { cells, borders });
    const frame = lines.find((l) => l.part.spec), rules = lines.filter((l) => l.shape?.kind === 'line');
    return { outline: frame.rgba[3], rows: rules.filter((l) => l.points[0][1] === l.points[1][1]).map((l) => [l.points[0][1], l.width]), cols: rules.filter((l) => l.points[0][0] === l.points[1][0]).length };
  };
  assert.deepEqual(look('all'), { outline: 1, rows: [[30, 1.4], [60, 0.8]], cols: 2 });
  assert.deepEqual(look('outer'), { outline: 1, rows: [[30, 1.4]], cols: 0 });
  assert.deepEqual(look('horizontal'), { outline: 0, rows: [[0, 1.4], [90, 1.4], [30, 1.4], [60, 0.8]], cols: 0 });
  assert.deepEqual(look('none'), { outline: 0, rows: [[30, 1.4]], cols: 0 });
  // The frame is still there (clear) with the spec, so the table can be selected and edited.
  const frame = tableItems([0, 0, 300, 90], { cells, borders: 'none' }).lines.find((l) => l.part.spec);
  assert.equal(frame.shape.kind, 'rectangle');
});

test('text size: auto follows the rows, the others are fixed', () => {
  const size = (spec, h = 90) => tableItems([0, 0, 300, h], { cells: [['a'], ['b'], ['c']], ...spec }).images[0].text.font_size;
  assert.equal(size({}), 13.5);
  assert.equal(size({}, 300), 16);
  assert.deepEqual([size({ size: 'small' }), size({ size: 'medium' }), size({ size: 'large' })], [10, 13, 17]);
  assert.equal(size({ size: 'large' }, 30), 17, 'fixed even when the rows are small');
});

test('sorting rows by a column: numbers by value, words in order, empty last, the header stays', () => {
  const s = tableSpec({ cells: [['Name', 'n'], ['b', '10'], ['a', '9'], ['', '2,5'], ['C', '']], format: { '1,0': { bold: true } }, heights: [1, 2, 3, 4, 5] });
  const up = sortRows(s, 1, 1);
  assert.deepEqual(up.cells.map((r) => r[1]), ['n', '2,5', '9', '10', '']);
  assert.deepEqual(up.heights, [1, 4, 3, 2, 5], 'heights go with their rows');
  assert.deepEqual(up.format, { '3,0': { bold: true } }, 'and looks');
  assert.deepEqual(sortRows(s, 0, 1).cells.map((r) => r[0]), ['Name', 'a', 'b', 'C', '']);
  assert.deepEqual(sortRows(s, 0, -1).cells.map((r) => r[0]), ['Name', 'C', 'b', 'a', '']);
  assert.deepEqual(sortRows({ ...s, header: false }, 0, 1).cells[0][0], 'a', 'no header: every row');
  // Rows joined by a merge cannot be sorted; merges along one row move with it.
  assert.equal(canSort(tableSpec({ cells: [['h', ''], ['a', ''], ['b', '']], merges: [[1, 0, 2, 1]] })), false);
  assert.equal(canSort(tableSpec({ cells: [['h', ''], ['a', ''], ['b', '']], merges: [[0, 0, 1, 2]] })), true, 'a merged header is fine');
  const wide = sortRows({ cells: [['h', 'x'], ['b', ''], ['a', 'z']], merges: [[1, 0, 1, 2]] }, 0, 1);
  assert.deepEqual(wide.merges, [[2, 0, 1, 2]]);
  assert.ok(compareCells('item 2', 'item 10') < 0);
});

test('a pasted block fills cells from the cursor, grows the table and keeps its merges', () => {
  const s = tableSpec({ cells: [['a', 'b'], ['c', 'd']], merges: [[0, 0, 1, 2]], widths: [1, 3] });
  const pasted = pasteBlock(s, [1, 1], { cells: [['1', '2', '3'], ['4', '', '6']], merges: [[1, 0, 1, 2]] });
  assert.deepEqual(pasted.cells, [['a', 'b', '', ''], ['c', '1', '2', '3'], ['', '4', '', '6']]);
  assert.deepEqual(pasted.merges, [[0, 0, 1, 2], [2, 1, 1, 2]]);
  assert.deepEqual(pasted.widths, [1, 3, 3, 3]);
  // On a merge: it is split. Past the limits: cut.
  assert.equal(pasteBlock(s, [0, 1], { cells: [['x']] }).merges, undefined);
  const big = pasteBlock(s, [0, 0], { cells: Array.from({ length: 70 }, () => Array(30).fill('v')) });
  assert.deepEqual([big.cells.length, big.cells[0].length], [MAX_ROWS, MAX_COLUMNS]);
});

test('a 50 × 20 table draws quickly and the core takes every item', async () => {
  const cells = Array.from({ length: MAX_ROWS }, (_, r) => Array.from({ length: MAX_COLUMNS }, (_, c) => `r${r}c${c}`));
  const format = { '3,3': { fill: 'green', align: 'right', valign: 'top', bold: true, italic: true } };
  const started = performance.now();
  const { lines, images } = tableItems([20, 20, 760, 1000], { cells, fit: true, format, headerColumn: true, merges: [[5, 5, 2, 3]] }, { id: 'big' });
  const took = performance.now() - started;
  assert.ok(took < 500, `drawn in ${took.toFixed(0)} ms`);
  assert.equal(images.length, MAX_ROWS * MAX_COLUMNS - 5);
  // The Rust core (WASM) accepts the lines and text boxes as drawn, and Noteful export keeps them.
  const { default: init, EditorSession } = await import('./pkg/noteful_wasm.js');
  await init({ module_or_path: readFileSync(new URL('./pkg/noteful_wasm_bg.wasm', import.meta.url)) });
  const session = new EditorSession(readFileSync(new URL('../../samples/Examen%20wuolah.noteful', import.meta.url)));
  for (const line of lines) session.draw(0, JSON.stringify(line));
  for (const image of images.slice(0, 60)) session.add_image(0, JSON.stringify(image));
  const clear = tableItems([0, 0, 100, 60], { cells: [['a', 'b'], ['c', 'd']], borders: 'none', format: { '1,1': { align: 'center' } } });
  for (const line of clear.lines) session.draw(0, JSON.stringify(line));
  for (const image of clear.images) session.add_image(0, JSON.stringify(image));
  assert.ok(session.export_noteful().length > 0);
  session.free();
});

test('text sits where it is told in its cell as the core draws it: every size, one to three lines', async () => {
  // The core's own page SVG (WASM): each text box's baselines, read back; the glyphs reach a cap
  // height above the first. Their middle must be the cell's middle (or a pad from its top or
  // bottom rule) within 1.5 units.
  const { default: init, EditorSession } = await import('./pkg/noteful_wasm.js');
  await init({ module_or_path: readFileSync(new URL('./pkg/noteful_wasm_bg.wasm', import.meta.url)) });
  const session = new EditorSession(readFileSync(new URL('../../samples/Examen%20wuolah.noteful', import.meta.url)));
  session.insert_pages(0, JSON.stringify([{ size: [800, 3000] }]));
  const cases = [];
  let top = 10;
  for (const size of ['auto', 'small', 'medium', 'large']) for (const lines of [1, 2, 3]) for (const valign of ['top', 'middle', 'bottom']) {
    const text = Array.from({ length: lines }, (_, k) => `L${k}`).join('\n');
    // fit: a v3 table; the row asked for is as tall as three lines need, so every case fits.
    const cells = [['a', text], ['b\nb\nb', 'x']];
    const box = [20, top, 300, 200];
    const { images } = tableItems(box, { cells, fit: true, header: false, size, format: { '0,1': { valign } } });
    const item = images.find((i) => i.text.text === text);
    session.add_image(0, JSON.stringify(item));
    const rule = tableItems(box, { cells, fit: true, header: false, size }).lines.find((l) => l.shape?.kind === 'line' && l.points[0][1] === l.points[1][1]).points[0][1];
    cases.push({ size, lines, valign, item, cell: [top, rule] });
    top += 230;
  }
  const svg = JSON.parse(session.view(0)).svg;
  // Each added text box: <g transform="translate(cx cy) … translate(-w/2 -h/2)"> then its <text y=…>.
  const groups = [...svg.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(0\) translate\(([-\d.]+) ([-\d.]+)\)">([\s\S]*?)<\/g>/g)];
  for (const { size, lines, valign, item, cell: [y0, y1] } of cases) {
    const g = groups.find((m) => Math.abs(+m[2] + +m[4] - item.bounds[1]) < 1e-6 && m[5].includes('>L0<'));
    assert.ok(g, `drawn: ${size} ${lines} ${valign}`);
    const baselines = [...g[5].matchAll(/<text [^>]*y="([-\d.]+)"/g)].map((m) => item.bounds[1] + +m[1]);
    assert.equal(baselines.length, lines);
    const s = item.text.font_size, capTop = baselines[0] - CAP_HEIGHT * s, base = baselines.at(-1), pad = Math.max(2, 0.3 * s);
    const where = `${size} (${s}) ${lines} line(s) ${valign}: glyphs ${capTop.toFixed(1)}–${base.toFixed(1)} in ${y0.toFixed(1)}–${y1.toFixed(1)}`;
    if (valign === 'middle') assert.ok(Math.abs((capTop + base) / 2 - (y0 + y1) / 2) <= 1.5, where);
    if (valign === 'top') assert.ok(Math.abs(capTop - (y0 + pad)) <= 1.5, where);
    if (valign === 'bottom') assert.ok(Math.abs(base - (y1 - pad - 0.2 * s)) <= 1.5, where);
    assert.ok(capTop >= y0 - 1e-9 && base <= y1, `inside: ${where}`);
  }
  session.free();
});
