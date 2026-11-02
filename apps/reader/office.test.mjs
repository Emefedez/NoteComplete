import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, guessSeparator, delimitedMarkdown, gridMarkdown, tableMarkdown, escapeText, parseXml, odfToMarkdown, zipEntry, odtMarkdown,
  htmlToMarkdown, docxToMarkdown, workbookMarkdown, readWorkbook, officeMarkdown, MAX_ROWS, MAX_COLUMNS } from './office.js';
import { fileKind, prepareDocument } from './media-import.js';
import { isOfficeName } from './text-types.js';
import { zip, docx, odt, workbook, ODT_CONTENT, CSV, XLSX, mammoth } from '../../tests/fixtures/office-files.mjs';

test('CSV fields keep quoted commas, newlines and doubled quotes', () => {
  assert.deepEqual(parseDelimited(CSV), [
    ['name', 'quote', 'notes'],
    ['Ada', 'Hello, world', 'line one\nline two'],
    ['Bob', 'She said "hi"', ''],
  ]);
  assert.deepEqual(parseDelimited('a,,c\n\n"",x'), [['a', '', 'c'], [''], ['', 'x']]);
  assert.deepEqual(parseDelimited('﻿a;b\rc;d', ';'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseDelimited('a\t"b\tc"\n', '\t'), [['a', 'b\tc']]);
  // An unterminated quote keeps the rest of the file in its field.
  assert.deepEqual(parseDelimited('a,"b\nc'), [['a', 'b\nc']]);
});

test('the separator is guessed from the first line, outside quotes', () => {
  assert.equal(guessSeparator('a,b,c\n1,2,3'), ',');
  assert.equal(guessSeparator('nombre;precio\n"1,5";2'), ';');
  assert.equal(guessSeparator('"x;y;z",b\n'), ',');
  assert.equal(guessSeparator('a\tb\tc'), '\t');
  assert.equal(guessSeparator(''), ',');
});

test('CSV becomes a Markdown table, the first row as header', () => {
  assert.equal(delimitedMarkdown(CSV), [
    '| name | quote | notes |',
    '| --- | --- | --- |',
    '| Ada | Hello, world | line one line two |',
    '| Bob | She said "hi" |  |',
  ].join('\n'));
  assert.equal(delimitedMarkdown('precio;moneda\n5;$|€'), '| precio | moneda |\n| --- | --- |\n| 5 | \\$\\|€ |');
  assert.equal(delimitedMarkdown(''), '*Empty sheet.*');
});

test('grids drop empty edges, escape Markdown and say where they were cut', () => {
  assert.equal(gridMarkdown([['a', '', ''], ['*b*', '', ''], ['', '', '']]), '| a |\n| --- |\n| \\*b\\* |');
  assert.equal(gridMarkdown([['', ''], ['', '']]), '*Empty sheet.*');
  const big = Array.from({ length: MAX_ROWS + 200 }, (_, r) => Array.from({ length: MAX_COLUMNS + 10 }, (_, c) => `${r}:${c}`));
  const text = gridMarkdown(big);
  const lines = text.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('|')).length, MAX_ROWS + 1);
  assert.equal(lines[0].split(' | ').length, MAX_COLUMNS);
  assert.match(text, /\*Showing the first 1000 of 1200 rows and the first 50 of 60 columns\.\*$/);
  assert.match(gridMarkdown(Array.from({ length: 300000 }, () => ['x'])), /of 300000 rows\.\*$/);
  // A stated size larger than the cells that hold anything is not a cut.
  assert.doesNotMatch(gridMarkdown([['a']], { totalRows: 1048576, totalColumns: 16384 }), /Showing/);
});

test('table cells keep to one line and their pipes are escaped', () => {
  assert.equal(tableMarkdown([['A', 'B'], ['x | y', 'two\nlines'], ['short']]), '| A | B |\n| --- | --- |\n| x \\| y | two lines |\n| short |  |');
  assert.equal(tableMarkdown([]), '');
  assert.equal(escapeText('a*b_c[d]`e`<f>$g~h\\'), 'a\\*b\\_c\\[d\\]\\`e\\`\\<f>\\$g\\~h\\\\');
});

test('the XML reader keeps text, attributes and entities', () => {
  const root = parseXml('<?xml version="1.0"?><!-- note --><a x="1 &amp; 2" y=\'q\'>t&lt;u&#233;&#x41;<b/><c>d</c></a>');
  const a = root.children[0];
  assert.equal(a.name, 'a');
  assert.deepEqual(a.attrs, { x: '1 & 2', y: 'q' });
  assert.deepEqual(a.children.slice(0, 1), ['t<uéA']);
  assert.equal(a.children[1].name, 'b');
  assert.deepEqual(a.children[2].children, ['d']);
});

test('ODT content.xml becomes Markdown: headings, styles, links, lists, tables, notes', () => {
  assert.equal(odfToMarkdown(ODT_CONTENT), [
    '# Apuntes de física',
    '',
    'La **energía** se *conserva*. Ver [la web](https://example.org/x).[^1]',
    '',
    '## Fórmulas',
    '',
    'E = m·c² cuesta \\$5\\',
    'segunda línea',
    '',
    '1. Primero',
    '   - Detalle',
    '2. Segundo',
    '',
    '- Viñeta',
    '',
    '| Magnitud | Unidad |',
    '| --- | --- |',
    '| Fuerza | N \\| newton |',
    '',
    '1\\. No es una lista',
    '',
    '[^1]: Salvo rozamiento.',
    '',
  ].join('\n'));
  // Deleted text from tracked changes is left out.
  assert.doesNotMatch(odfToMarkdown(ODT_CONTENT), /borrado/);
});

test('ODT styles: named ones from styles.xml, and "normal" undoes a bold parent', () => {
  const ns = 'xmlns:office="o" xmlns:style="s" xmlns:text="t" xmlns:fo="f"';
  const styles = `<office:document-styles ${ns}><office:styles><style:style style:name="Strong" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:styles></office:document-styles>`;
  const content = `<office:document-content ${ns}><office:automatic-styles><style:style style:name="T9" style:family="text" style:parent-style-name="Strong"><style:text-properties fo:font-weight="normal" fo:font-style="italic"/></style:style></office:automatic-styles>
    <office:body><office:text><text:p><text:span text:style-name="Strong">fuerte</text:span> y <text:span text:style-name="T9">cursiva</text:span></text:p></office:text></office:body></office:document-content>`;
  assert.equal(odfToMarkdown(content, styles), '**fuerte** y *cursiva*\n');
  assert.equal(odfToMarkdown(`<office:document-content ${ns}><office:body><office:text/></office:body></office:document-content>`), '*This document has no text.*\n');
  assert.throws(() => odfToMarkdown('<x/>'), /no text/);
});

test('zip entries are read stored or deflated; .odt files open from their zip', async () => {
  for (const deflate of [false, true]) {
    const bytes = zip({ 'a.txt': 'hola', 'dir/b.xml': '<b/>'.repeat(100) }, { deflate });
    assert.equal(new TextDecoder().decode(await zipEntry(bytes, 'dir/b.xml')), '<b/>'.repeat(100));
    assert.equal(await zipEntry(bytes, 'missing'), null);
  }
  await assert.rejects(zipEntry(new Uint8Array(40), 'a'), /zip/);
  assert.match(await odtMarkdown(odt()), /^# Apuntes de física\n/);
});

test('HTML (as mammoth writes it) becomes Markdown', () => {
  const html = '<h2>Título</h2><p>Uno <strong>dos</strong> <em>tres</em><br />cuatro</p>'
    + '<ul><li>a<ul><li>a.1</li></ul></li><li>b</li></ul><ol><li><p>primero</p></li></ol>'
    + '<table><thead><tr><th colspan="2">Cabecera</th></tr></thead><tbody><tr><td><p>x</p></td><td><p>y</p><p>z</p></td></tr></tbody></table>'
    + '<p><img src="" alt="Gráfico" /> <a href="#footnote-1" id="footnote-ref-1">[1]</a> <a href="http://e.com/a b">link</a> <s>old</s></p>';
  assert.equal(htmlToMarkdown(html), [
    '## Título',
    '',
    'Uno **dos** *tres*\\',
    'cuatro',
    '',
    '- a',
    '  - a.1',
    '- b',
    '',
    '1. primero',
    '',
    '| Cabecera |  |',
    '| --- | --- |',
    '| x | y z |',
    '',
    '\\[Image: Gráfico\\] \\[1\\] [link](http://e.com/a%20b) ~~old~~',
    '',
  ].join('\n'));
  // mammoth's footnotes and endnotes, listed at the end, become Markdown footnotes.
  const notes = '<p>Ouch<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup>.<sup><a href="#endnote-2" id="endnote-ref-2">[2]</a></sup></p>'
    + '<ol><li id="footnote-1"><p> A tachyon. <a href="#footnote-ref-1">↑</a></p></li></ol><ol><li id="endnote-2"><p> Fin. <a href="#endnote-ref-2">↑</a></p></li></ol>';
  assert.equal(htmlToMarkdown(notes), 'Ouch[^1].[^2]\n\n[^1]: A tachyon.\n[^2]: Fin.\n');
});

test('a .docx goes through mammoth to Markdown', async () => {
  assert.equal(await docxToMarkdown(mammoth, { buffer: Buffer.from(docx()) }), [
    '# Informe trimestral',
    '',
    'Ventas de **marzo** y *abril* (\\*no\\* final).',
    '',
    '1. Primer punto',
    '2. Segundo punto',
    '',
    '| Mes | Total |',
    '| --- | --- |',
    '| Marzo | 1\\|200 |',
    '',
    '[Sitio](https://example.com/a)',
    '',
  ].join('\n'));
});

test('.xlsx and .ods: a heading per sheet, cells as formatted', () => {
  const expected = [
    '## Ventas',
    '',
    '| Producto | Precio | Fecha |',
    '| --- | --- | --- |',
    '| Lápiz | 1.5 | 3/14/26 |',
    '| Goma \\| blanda | 0.75 |  |',
    '',
    '## Notas',
    '',
    '| Nota |',
    '| --- |',
    '| Revisar el stock |',
    '',
  ].join('\n');
  assert.equal(workbookMarkdown(XLSX, readWorkbook(XLSX, workbook('xlsx'))), expected);
  assert.equal(workbookMarkdown(XLSX, readWorkbook(XLSX, workbook('ods'))), expected);
});

test('big sheets are read only up to the rows shown', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 1500 }, (_, r) => Array.from({ length: 60 }, (_, c) => r * 100 + c))), 'Datos');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Vacía');
  const text = workbookMarkdown(XLSX, readWorkbook(XLSX, new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))));
  assert.match(text, /\*Showing the first 1000 of 1500 rows and the first 50 of 60 columns\.\*/);
  assert.match(text, /\| 99900 \| 99901 \|/);
  assert.doesNotMatch(text, /\| 100000 \|/);
  assert.match(text, /## Vacía\n\n\*Empty sheet\.\*\n$/);
});

test('office files open as converted Markdown text documents', async () => {
  for (const name of ['a.docx', 'B.ODT', 'c.xlsx', 'd.ods']) {
    assert.equal(isOfficeName(name), true);
    assert.equal(fileKind(name, new Uint8Array([0x50, 0x4b, 3, 4])), 'office');
  }
  assert.equal(fileKind('t.csv', new TextEncoder().encode('a,b')), 'text');
  const csv = await prepareDocument(new File([CSV], 'Lista.csv'));
  assert.equal(csv.kind, 'text');
  assert.equal(csv.title, 'Lista');
  assert.equal(csv.markdown, true);
  assert.equal(csv.converted, true);
  assert.match(csv.text, /^\| name \| quote \| notes \|/);
  const tsv = await prepareDocument(new File(['a\tb\n1\t2'], 'x.tsv'));
  assert.equal(tsv.text, '| a | b |\n| --- | --- |\n| 1 | 2 |');
  const doc = await prepareDocument(new File([odt()], 'Apuntes.odt'));
  assert.equal(doc.kind, 'text');
  assert.equal(doc.converted, true);
  assert.match(doc.text, /\*\*energía\*\*/);
  // Plain text files are untouched.
  const txt = await prepareDocument(new File(['a,b'], 'x.txt'));
  assert.equal(txt.converted, undefined);
  assert.equal(txt.text, 'a,b');
});

test('a damaged file gives a plain message', async () => {
  await assert.rejects(officeMarkdown('roto.odt', new Uint8Array([1, 2, 3])), { message: 'This OpenDocument text could not be read. It may be damaged or protected with a password.' });
  await assert.rejects(officeMarkdown('x.pages', new Uint8Array()), /cannot be converted/);
  await assert.rejects(prepareDocument(new File([new Uint8Array(30)], 'roto.odt')), /could not be read/);
});
