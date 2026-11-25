import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, parseHtmlTable, clipboardBlock } from './table-paste.js';

test('tab and comma separated text, quoted fields with line breaks and quotes', () => {
  assert.deepEqual(parseDelimited('a\tb\tc\r\n1\t"two\nlines"\t3\n'), [['a', 'b', 'c'], ['1', 'two\nlines', '3']]);
  assert.deepEqual(parseDelimited('x,"say ""hi""",z\n1,2', ','), [['x', 'say "hi"', 'z'], ['1', '2', '']]);
  assert.deepEqual(parseDelimited('a\t\tc'), [['a', '', 'c']], 'empty cells kept');
});

test('an HTML table: cells as text, colspan and rowspan as merges', () => {
  const html = `<meta charset="utf-8"><style>td{}</style><table><tbody>
    <tr><th colspan="2">Week&nbsp;1</th><td rowspan=2>Notes<br>here</td></tr>
    <tr><td>Mon &amp; Tue</td><td><p>one</p><p>two</p></td></tr>
    <tr><td>&lt;3</td><td>&#8364;5</td><td></td></tr></tbody></table>`;
  assert.deepEqual(parseHtmlTable(html), {
    cells: [['Week 1', '', 'Notes\nhere'], ['Mon & Tue', 'one\ntwo', ''], ['<3', '€5', '']],
    merges: [[0, 0, 1, 2], [0, 2, 2, 1]],
  });
  assert.equal(parseHtmlTable('<p>no table</p>'), null);
  // A rowspan past the last row is cut to it.
  assert.deepEqual(parseHtmlTable('<table><tr><td rowspan="5">a</td><td>b</td></tr></table>').merges, []);
});

test('what the clipboard holds: HTML first, then tabs, then consistent commas; plain text is null', () => {
  const sheet = { html: '<google-sheets-html-origin><table><tr><td>1</td><td>2</td></tr></table>', text: '1\t2' };
  assert.deepEqual(clipboardBlock(sheet), { cells: [['1', '2']], merges: [] });
  assert.deepEqual(clipboardBlock({ text: 'a\tb\nc\td\n' }).cells, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(clipboardBlock({ text: 'name,age\nAna,30\nLuis,41' }).cells, [['name', 'age'], ['Ana', '30'], ['Luis', '41']]);
  assert.equal(clipboardBlock({ text: 'Hello, world' }), null, 'one line with a comma is text');
  assert.equal(clipboardBlock({ text: 'first line\nsecond, with a comma' }), null, 'lines of prose are text');
  assert.equal(clipboardBlock({ text: 'word' }), null);
  // One cell of HTML (a word copied from a page with a table around it) is text too.
  assert.equal(clipboardBlock({ html: '<table><tr><td>x</td></tr></table>', text: 'x' }).cells[0][0], 'x');
});
