import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtmlTable, htmlTablesToPipes, mergedTableHtml, cleanMerges, headerRows } from './html-table.js';
import init, { markdown_html } from './pkg/noteful_wasm.js';

await init({ module_or_path: readFileSync(new URL('./pkg/noteful_wasm_bg.wasm', import.meta.url)) });

const HTML = [
  '<table>',
  '<thead>',
  '<tr><th colspan="2">Tema</th><th>Nota</th></tr>',
  '</thead>',
  '<tbody>',
  '<tr><td rowspan="2">Q1</td><td>a \\&lt;b&gt; | c</td><td>**7**</td></tr>',
  '<tr><td>c</td><td>8</td></tr>',
  '</tbody>',
  '</table>',
].join('\n');

test('an HTML table is read as a grid of Markdown cells with its merges', () => {
  assert.deepEqual(parseHtmlTable(HTML), {
    rows: [['Tema', '', 'Nota'], ['Q1', 'a \\<b> | c', '**7**'], ['', 'c', '8']],
    merges: [[0, 0, 1, 2], [1, 0, 2, 1]],
    head: 1,
  });
  // The writer and the reader agree.
  const rows = [['Tema', '', 'Nota'], ['Q1', 'a \\<b> | c', '**7**'], ['', 'c', '8']];
  assert.equal(mergedTableHtml(rows, [[0, 0, 1, 2], [1, 0, 2, 1]]), HTML);
  assert.deepEqual(parseHtmlTable(mergedTableHtml(rows, [[0, 0, 1, 2], [1, 0, 2, 1]])).rows, rows);
  // Only structure and spans are read: other tags and attributes go, their text stays.
  assert.deepEqual(parseHtmlTable('<table onclick="x()"><tr><td style="color:red" colspan=2><script>alert(1)</script><b>x</b><br>y</td></tr><tr><td>1</td><td>2</td></tr></table>'), {
    rows: [['alert(1)x y', ''], ['1', '2']], merges: [[0, 0, 1, 2]], head: 1,
  });
  // Spans past the table's edge are cut; no rows, no table.
  assert.deepEqual(parseHtmlTable('<table><tr><td rowspan="9">a</td><td>b</td></tr></table>').merges, []);
  assert.equal(parseHtmlTable('<table></table>'), null);
});

test('merges are checked and the header grows with header cells that reach down', () => {
  assert.deepEqual(cleanMerges([[0, 0, 2, 2], [1, 1, 2, 2], [3, 3, 2, 2], [0, 2, 1, 1], [2, 0, 9, 9]], 3, 3), [[0, 0, 2, 2], [2, 0, 1, 3]]);
  assert.equal(headerRows([]), 1);
  assert.equal(headerRows([[0, 0, 2, 1], [1, 1, 2, 1]]), 3);
  assert.equal(headerRows([[1, 0, 3, 1]]), 1);
});

test('HTML tables become marked pipe tables the core renders; code and unfinished tables stay', () => {
  const doc = `# T\n\n${HTML}\n\nAfter.\n\n\`\`\`\n<table><tr><td>code</td></tr></table>\n\`\`\`\n\n<table>\n<tr><td>never closed</td></tr>\n\nEnd`;
  const { text, tables } = htmlTablesToPipes(doc, 'NCTABLEx');
  assert.deepEqual(tables, [{ merges: [[0, 0, 1, 2], [1, 0, 2, 1]], head: 1 }]);
  assert.ok(text.includes('NCTABLEx-0\n\n| Tema |  | Nota |\n| --- | --- | --- |\n| Q1 | a \\<b> \\| c | **7** |\n|  | c | 8 |\n'), text);
  assert.ok(text.includes('```\n<table><tr><td>code</td></tr></table>\n```'));
  assert.ok(text.includes('<table>\n<tr><td>never closed</td></tr>\n\nEnd'));
  const html = markdown_html(text);
  // The cells are rendered by the core as any table's: Markdown read, raw HTML still text.
  assert.match(html, /<p>NCTABLEx-0<\/p>\n<table><thead><tr><th>Tema<\/th><th><\/th><th>Nota<\/th><\/tr><\/thead><tbody>\n<tr><td>Q1<\/td><td>a &lt;b&gt; \| c<\/td><td><strong>7<\/strong><\/td><\/tr>/);
  assert.match(html, /&lt;table&gt;&lt;tr&gt;&lt;td&gt;code/);
  assert.match(html, /&lt;table&gt;\n&lt;tr&gt;&lt;td&gt;never closed/);
  assert.doesNotMatch(html, /<td>never closed/);
});
