import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, guessSeparator, delimitedMarkdown, gridMarkdown, tableMarkdown, escapeText, parseXml, odfToMarkdown, zipEntry, zipList, odtMarkdown,
  htmlToMarkdown, docxToMarkdown, docxDocument, docxXmlDocument, odtDocument, odpDocument, pptxDocument, docDocument, pptDocument, rtfToMarkdown, epubDocument, ipynbDocument, parseCfb, officeDocument, imageFolder, imageExtension, linkPath, workbookMarkdown, readWorkbook, officeMarkdown, tableBlock, spanGrid, MAX_ROWS, MAX_COLUMNS } from './office.js';
import { fileKind, prepareDocument } from './media-import.js';
import { isOfficeName, isAudioName, isVideoName, isImageName } from './text-types.js';
import { fileCoverSvg, hasStaticFileCover } from './file-covers.js';
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
    // A merged cell (colspan) keeps the table as HTML (html-table.js renders it).
    '<table>',
    '<thead>',
    '<tr><th colspan="2">Cabecera</th></tr>',
    '</thead>',
    '<tbody>',
    '<tr><td>x</td><td>y z</td></tr>',
    '</tbody>',
    '</table>',
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
test('picture folders are named after the document, and links to them are safe', () => {
  assert.equal(imageFolder('Tema 3 (v2).docx'), 'Tema 3 (v2)_files');
  assert.equal(imageFolder('a/b:c.odt'), 'a_b_c_files');
  assert.equal(imageFolder('.hidden.docx'), 'hidden_files');
  assert.equal(linkPath('Tema 3 (v2)_files/image1.png'), 'Tema%203%20%28v2%29_files/image1.png');
  assert.equal(imageExtension('image/jpeg'), 'jpg');
  assert.equal(imageExtension('Pictures/x.PNG'), 'png');
  assert.equal(imageExtension('image/x-emf'), null);
});

test('an .odt keeps its pictures as files linked from the Markdown', async () => {
  const folder = 'Apuntes_files';
  const { markdown, images } = await odtDocument(odt({ pictures: { 'Pictures/foto 1.png': PNG, 'Pictures/dibujo.emf': new Uint8Array([1, 2]) } }), folder);
  assert.deepEqual(images.map((i) => [i.path, i.type, i.bytes.length]), [[`${folder}/image1.png`, 'image/png', PNG.length]]);
  assert.match(markdown, /!\[Gráfica de Pictures\/foto 1\.png\]\(Apuntes_files\/image1\.png\)/);
  // A picture a browser cannot show stays a named placeholder.
  assert.match(markdown, /\\\[Image: Gráfica de Pictures\/dibujo\.emf\\\]/);
});

test('a .docx keeps its pictures as files, the same picture once', async () => {
  const { markdown, images } = await docxDocument(mammoth, { buffer: Buffer.from(docx({ image: PNG })) }, 'Informe_files');
  assert.equal(images.length, 1);
  assert.equal(images[0].path, 'Informe_files/image1.png');
  assert.deepEqual([...images[0].bytes], [...PNG]);
  assert.match(markdown, /!\[Esquema del circuito\]\(Informe_files\/image1\.png\)/);
});

test('an office file opened by name reports its picture folder', async () => {
  const done = await officeDocument('Mi apunte.odt', odt({ pictures: { 'Pictures/a.png': PNG } }));
  assert.equal(done.folder, 'Mi apunte_files');
  assert.match(done.markdown, /\(Mi%20apunte_files\/image1\.png\)/);
  assert.equal(done.images[0].path, 'Mi apunte_files/image1.png');
  assert.deepEqual((await officeDocument('x.csv', new TextEncoder().encode('a,b\n1,2'))).images, []);
});

// Minimal OLE2 Compound File Binary builder for testing legacy .doc and .ppt readers.
function buildCfb(streams) {
  const secSize = 512, ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff, FATSECT = 0xfffffffd;
  const sectors = [];
  const fat = [];
  const entries = [{ name: 'Root Entry', type: 5, start: ENDOFCHAIN, size: 0 }];
  for (const [name, data] of Object.entries(streams)) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    // Keep streams >= 4096 bytes so they live in regular FAT sectors (simpler fixture).
    const paddedLen = Math.max(4096, Math.ceil(buf.length / secSize) * secSize);
    const nSec = paddedLen / secSize;
    const start = sectors.length;
    for (let i = 0; i < nSec; i++) {
      const s = new Uint8Array(secSize);
      const off = i * secSize;
      if (off < buf.length) s.set(buf.subarray(off, Math.min(buf.length, off + secSize)));
      sectors.push(s);
      fat.push(i + 1 < nSec ? start + i + 1 : ENDOFCHAIN);
    }
    entries.push({ name, type: 2, start, size: buf.length });
  }
  const dirSec = sectors.length;
  const dir = new Uint8Array(secSize);
  const dv = new DataView(dir.buffer);
  entries.forEach((e, idx) => {
    const off = idx * 128;
    for (let i = 0; i < e.name.length; i++) dv.setUint16(off + i * 2, e.name.charCodeAt(i), true);
    dv.setUint16(off + 64, (e.name.length + 1) * 2, true);
    dir[off + 66] = e.type;
    dir[off + 67] = 1; // black
    dv.setUint32(off + 68, 0xffffffff, true);
    dv.setUint32(off + 72, 0xffffffff, true);
    dv.setUint32(off + 76, idx === 0 && entries.length > 1 ? 1 : 0xffffffff, true);
    dv.setUint32(off + 116, e.start, true);
    dv.setUint32(off + 120, e.size, true);
  });
  sectors.push(dir);
  fat.push(ENDOFCHAIN);

  const fatSec = sectors.length;
  fat.push(FATSECT);
  const fatBuf = new Uint8Array(secSize);
  const fv = new DataView(fatBuf.buffer);
  fv.fill?.(0);
  for (let i = 0; i < secSize / 4; i++) fv.setUint32(i * 4, i < fat.length ? fat[i] : FREESECT, true);
  sectors.push(fatBuf);

  const header = new Uint8Array(secSize);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const hv = new DataView(header.buffer);
  hv.setUint16(24, 0x003e, true); hv.setUint16(26, 0x0003, true); hv.setUint16(28, 0xfffe, true);
  hv.setUint16(30, 9, true); hv.setUint16(32, 6, true);
  hv.setUint32(44, 1, true); // FAT sectors
  hv.setUint32(48, dirSec, true);
  hv.setUint32(56, 4096, true);
  hv.setUint32(60, ENDOFCHAIN, true);
  hv.setUint32(68, ENDOFCHAIN, true);
  hv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) hv.setUint32(76 + i * 4, i === 0 ? fatSec : FREESECT, true);

  const out = new Uint8Array((1 + sectors.length) * secSize);
  out.set(header, 0);
  sectors.forEach((s, i) => out.set(s, (i + 1) * secSize));
  return out;
}

test('pure-JS .docx fallback parses OOXML headings, styles, lists, tables, links and images without mammoth', async () => {
  const res = await docxXmlDocument(docx({ image: PNG }), 'Informe_files');
  assert.match(res.markdown, /^# Informe trimestral\n/);
  assert.match(res.markdown, /Ventas de \*\*marzo\*\* y \*abril\*/);
  assert.match(res.markdown, /1\. Primer punto\n2\. Segundo punto/);
  assert.match(res.markdown, /\| Mes \| Total \|\n\| --- \| --- \|\n\| Marzo \| 1\\\|200 \|/);
  assert.match(res.markdown, /\[Sitio\]\(https:\/\/example\.com\/a\)/);
  assert.match(res.markdown, /!\[Esquema del circuito\]\(Informe_files\/image1\.png\)/);
  assert.equal(res.images.length, 1);
  // officeDocument works in Node even without window.mammoth by using docxXmlDocument!
  const direct = await officeDocument('Informe.docx', docx());
  assert.match(direct.markdown, /^# Informe trimestral\n/);
});

test('RTF documents convert formatting, Unicode, accents, hyperlinks and tables to Markdown', async () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}Hola {\b negrita} y {\i cursiva} con caf\'e9 y \u20013?\par {\field{\*\fldinst HYPERLINK "https://example.org"}{\fldrslt Enlace}}\par \trowd A\cell B\cell\row 1\cell 2\cell\row}`;
  const md = rtfToMarkdown(rtf);
  assert.match(md, /Hola \*\*negrita\*\* y \*cursiva\* con café y 中/);
  assert.match(md, /\[Enlace\]\(https:\/\/example\.org\)/);
  assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  const viaOffice = await officeDocument('carta.rtf', new TextEncoder().encode(rtf));
  assert.match(viaOffice.markdown, /café/);
});

test('legacy .doc converts OLE2 WordDocument piece table (UTF-16 & CP1252, fields, tables) and disguised RTF/HTML', async () => {
  // Build a real Word 97-2003 FIB + 0Table PlcPcd with UTF-16LE text including a field and a table.
  const text = 'Tema 1\rHola \x13 HYPERLINK "x" \x14mundo\x15 con ñ\rA\x07B\x07\x07\r1\x072\x07\x07\r';
  const textOffset = 0x400;
  const word = new Uint8Array(Math.max(4096, textOffset + text.length * 2 + 16));
  const wv = new DataView(word.buffer);
  wv.setUint16(0, 0xa5ec, true); // wIdent
  wv.setUint16(2, 0x00c1, true); // nFib (Word 97)
  wv.setUint16(10, 0x0000, true); // flags -> 0Table, not encrypted
  wv.setUint16(32, 14, true); // csw
  wv.setUint16(34 + 28, 22, true); // cslw at 0x3E
  wv.setUint32(0x4c, text.length, true); // ccpText
  wv.setUint16(0x98, 93, true); // cbRgFcLcb
  wv.setUint32(0x1a2, 0, true); // fcClx = 0 in 0Table
  const pcdtLen = 4 * 2 + 8; // 2 CPs + 1 PCD = 16 bytes
  wv.setUint32(0x1a6, 1 + 4 + pcdtLen, true); // lcbClx
  for (let i = 0; i < text.length; i++) wv.setUint16(textOffset + i * 2, text.charCodeAt(i), true);

  const tbl = new Uint8Array(4096);
  const tv = new DataView(tbl.buffer);
  tbl[0] = 0x02; // clxt = Pcdt
  tv.setUint32(1, pcdtLen, true);
  tv.setUint32(5, 0, true); // cp0
  tv.setUint32(9, text.length, true); // cp1
  tv.setUint32(13 + 2, textOffset, true); // fc (bit 30 = 0 -> UTF-16LE)

  const bytes = buildCfb({ WordDocument: word, '0Table': tbl });
  assert.ok(parseCfb(bytes).get('WordDocument'));
  const res = await officeDocument('apuntes.doc', bytes);
  assert.match(res.markdown, /Tema 1/);
  assert.match(res.markdown, /Hola mundo con ñ/);
  assert.match(res.markdown, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);

  // RTF disguised as .doc
  const rtfDoc = await docDocument(new TextEncoder().encode('{\\rtf1 Disguised {\\b RTF} doc}'));
  assert.match(rtfDoc.markdown, /Disguised \*\*RTF\*\* doc/);
});

test('PowerPoint .pptx and OpenDocument .odp extract ordered slides, lists, tables, images and speaker notes', async () => {
  const pptxBytes = zip({
    'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Redes TCP/IP</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:pPr lvl="0"/><a:r><a:rPr b="1"/><a:t>Capa de transporte</a:t></a:r></a:p></p:txBody></p:sp>
      <p:pic><p:nvPicPr><p:cNvPr id="2" name="diag" descr="Diagrama"/></p:nvPicPr><p:blipFill><a:blip r:embed="rImg"/></p:blipFill></p:pic>
    </p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/img1.png"/><Relationship Id="rNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/media/img1.png': PNG,
    'ppt/notesSlides/notesSlide1.xml': '<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Explicar handshake</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
  });
  const pptxRes = await officeDocument('Tema 2.pptx', pptxBytes);
  assert.match(pptxRes.markdown, /^## Slide 1: Redes TCP\/IP/);
  assert.match(pptxRes.markdown, /- \*\*Capa de transporte\*\*/);
  assert.match(pptxRes.markdown, /!\[Diagrama\]\(Tema%202_files\/image1\.png\)/);
  assert.match(pptxRes.markdown, /> \*\*Notes:\*\* Explicar handshake/);
  assert.equal(pptxRes.images.length, 1);

  const odpBytes = zip({
    'content.xml': `<office:document-content xmlns:office="o" xmlns:draw="d" xmlns:presentation="pr" xmlns:text="t" xmlns:xlink="x"><office:body><office:presentation>
      <draw:page draw:name="p1">
        <draw:frame presentation:class="title"><draw:text-box><text:p>Álgebra</text:p></draw:text-box></draw:frame>
        <draw:frame><draw:text-box><text:p>Matrices invertibles</text:p></draw:text-box></draw:frame>
        <presentation:notes><draw:frame presentation:class="notes"><draw:text-box><text:p>Repasar determinante</text:p></draw:text-box></draw:frame></presentation:notes>
      </draw:page>
    </office:presentation></office:body></office:document-content>`,
  });
  const odpRes = await odpDocument(odpBytes, 'Algebra_files');
  assert.match(odpRes.markdown, /## Slide 1: Álgebra/);
  assert.match(odpRes.markdown, /Matrices invertibles/);
  assert.match(odpRes.markdown, /> \*\*Notes:\*\* Repasar determinante/);
});

test('legacy .ppt extracts slides from OLE2 PowerPoint Document records', async () => {
  const encodeRec = (verInst, recType, payload) => {
    const out = new Uint8Array(8 + payload.length);
    const v = new DataView(out.buffer);
    v.setUint16(0, verInst, true); v.setUint16(2, recType, true); v.setUint32(4, payload.length, true);
    out.set(payload, 8);
    return out;
  };
  const titleStr = 'Arquitectura';
  const utf16 = new Uint8Array(titleStr.length * 2);
  const uv = new DataView(utf16.buffer);
  for (let i = 0; i < titleStr.length; i++) uv.setUint16(i * 2, titleStr.charCodeAt(i), true);
  const rec1 = encodeRec(0x0000, 0x0fa0, utf16);
  const rec2 = encodeRec(0x0000, 0x0fa8, new TextEncoder().encode('Pipeline de 5 etapas'));
  const slidePayload = new Uint8Array(rec1.length + rec2.length);
  slidePayload.set(rec1, 0); slidePayload.set(rec2, rec1.length);
  const pptStream = encodeRec(0x000f, 0x03ee, slidePayload);
  const pptRes = await pptDocument(buildCfb({ 'PowerPoint Document': pptStream }));
  assert.match(pptRes.markdown, /## Slide 1: Arquitectura/);
  assert.match(pptRes.markdown, /- Pipeline de 5 etapas/);
});

test('EPUB e-books and Jupyter .ipynb notebooks convert to Markdown with images', async () => {
  const epubBytes = zip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': `<package><metadata xmlns:dc="dc"><dc:title>Manual de R</dc:title><dc:creator>Ana López</dc:creator></metadata>
      <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="i1" href="img/plot.png" media-type="image/png"/></manifest>
      <spine><itemref idref="c1"/></spine></package>`,
    'OEBPS/ch1.xhtml': '<html><body><h2>Capítulo 1</h2><p>Vectores en <strong>R</strong>.</p><p><img src="img/plot.png" alt="Gráfico"/></p></body></html>',
    'OEBPS/img/plot.png': PNG,
  });
  const epubRes = await epubDocument(epubBytes, 'Manual_files');
  assert.match(epubRes.markdown, /^# Manual de R\n\n\*Ana López\*/);
  assert.match(epubRes.markdown, /## Capítulo 1/);
  assert.match(epubRes.markdown, /Vectores en \*\*R\*\*\./);
  assert.match(epubRes.markdown, /!\[Gráfico\]\(Manual_files\/image1\.png\)/);
  assert.equal(epubRes.images.length, 1);

  const nb = {
    metadata: { kernelspec: { language: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Práctica 1\n', 'Cálculo numérico.'] },
      { cell_type: 'code', source: ['print(2 + 2)'], outputs: [{ text: ['4\n'] }, { data: { 'image/png': Buffer.from(PNG).toString('base64') } }] },
    ],
  };
  const nbRes = ipynbDocument(new TextEncoder().encode(JSON.stringify(nb)), 'Practica_files');
  assert.match(nbRes.markdown, /# Práctica 1/);
  assert.match(nbRes.markdown, /```python\nprint\(2 \+ 2\)\n```/);
  assert.match(nbRes.markdown, /```\n4\n```/);
  assert.match(nbRes.markdown, /!\[Output\]\(Practica_files\/image1\.png\)/);
  assert.equal(nbRes.images.length, 1);
  assert.ok(zipList(epubBytes).includes('OEBPS/content.opf'));
});

test('legacy .xls (BIFF8), .xlsm, .xlsb and .fods work through SheetJS', () => {
  for (const bt of ['biff8', 'xlsm', 'xlsb', 'fods']) {
    const md = workbookMarkdown(XLSX, readWorkbook(XLSX, workbook(bt)));
    assert.match(md, /## Ventas/, bt);
    assert.match(md, /Lápiz/, bt);
  }
});

test('fileCoverSvg provides crisp icon covers for MP3, MP4, Office, EPUB and Jupyter files', () => {
  for (const name of ['track.mp3', 'lesson.m4a', 'clip.mp4', 'video.mkv', 'report.docx', 'old.doc', 'notes.odt', 'memo.rtf', 'data.xlsx', 'old.xls', 'slides.pptx', 'deck.ppt', 'talk.odp', 'book.epub', 'lab.ipynb', 'page.html', 'bundle.zip']) {
    const url = fileCoverSvg(name);
    assert.match(url || '', /^data:image\/svg\+xml;utf8,/, name);
  }
  assert.equal(hasStaticFileCover('song.mp3'), true);
  assert.equal(hasStaticFileCover('movie.mp4'), true);
  assert.equal(hasStaticFileCover('report.docx'), true);
  assert.equal(hasStaticFileCover('archive.zip'), false); // zip may be a Goodnotes notebook
  assert.equal(fileCoverSvg('notes.pdf'), null);
  assert.equal(isAudioName('a.mp3'), true);
  assert.equal(isAudioName('a.flac'), true);
  assert.equal(isVideoName('b.mp4'), true);
  assert.equal(isVideoName('b.mkv'), true);
  assert.equal(isImageName('c.gif'), true);
  assert.equal(isImageName('d.avif'), true);
  assert.equal(isImageName('e.svg'), false);
  assert.equal(isOfficeName('e.doc'), true);
  assert.equal(isOfficeName('f.pptx'), true);
  assert.equal(isOfficeName('g.epub'), true);
  assert.equal(isOfficeName('h.ipynb'), true);
});

// ---- Merged cells ------------------------------------------------------------------------

// A small .docx whose table merges "Tema" across two columns and "Q1" down two rows.
function mergedDocx() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const tc = (text, pr = '') => `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const table = '<w:tbl>'
    + `<w:tr>${tc('Tema', '<w:gridSpan w:val="2"/>')}${tc('Nota')}</w:tr>`
    + `<w:tr>${tc('Q1', '<w:vMerge w:val="restart"/>')}${tc('a &lt;b&gt;')}${tc('7')}</w:tr>`
    + `<w:tr>${tc('', '<w:vMerge/>')}${tc('c')}${tc('8')}</w:tr>`
    + '</w:tbl>';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${table}</w:body></w:document>`,
  });
}
const MERGED_DOCX_HTML = [
  '<table>',
  '<thead>',
  '<tr><th colspan="2">Tema</th><th>Nota</th></tr>',
  '</thead>',
  '<tbody>',
  '<tr><td rowspan="2">Q1</td><td>a \\&lt;b&gt;</td><td>7</td></tr>',
  '<tr><td>c</td><td>8</td></tr>',
  '</tbody>',
  '</table>',
].join('\n');

test('tables with merged cells become HTML tables; others stay pipe tables', () => {
  assert.equal(tableBlock([['a', 'b'], ['1', '2']]), '| a | b |\n| --- | --- |\n| 1 | 2 |');
  // Merges that do not fit, cover one cell or overlap are dropped.
  assert.equal(tableBlock([['a', 'b'], ['1', '2']], [[0, 0, 1, 1], [5, 0, 2, 2]]), '| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.equal(tableBlock([['A', '', 'B'], ['x', 'y', 'z'], ['"q" & <r>', 'w', 'v']], [[0, 0, 1, 2], [1, 2, 2, 1], [0, 1, 2, 1]]), [
    '<table>', '<thead>', '<tr><th colspan="2">A</th><th>B</th></tr>', '</thead>', '<tbody>',
    '<tr><td>x</td><td>y</td><td rowspan="2">z</td></tr>', '<tr><td>&quot;q&quot; &amp; &lt;r&gt;</td><td>w</td></tr>', '</tbody>', '</table>',
  ].join('\n'));
  // A header cell reaching down takes the rows it covers into the header.
  assert.match(tableBlock([['A', 'B'], ['', 'c'], ['d', 'e']], [[0, 0, 2, 1]]), /<thead>\n<tr><th rowspan="2">A<\/th><th>B<\/th><\/tr>\n<tr><th>c<\/th><\/tr>\n<\/thead>/);
  // HTML rows (as mammoth writes them) on a grid: covered spots null.
  const grid = spanGrid([[{ cell: 'a', rs: 2 }, { cell: 'b', cs: 2 }], [{ cell: 'c' }, { cell: 'd' }]]);
  assert.deepEqual([...grid], [['a', 'b', null], [null, 'c', 'd']]);
  assert.deepEqual(grid.merges, [[0, 0, 2, 1], [0, 1, 1, 2]]);
});

test('.docx merged cells: gridSpan and vMerge, through mammoth and the built-in reader', async () => {
  const bytes = mergedDocx();
  assert.equal((await docxXmlDocument(bytes)).markdown, `${MERGED_DOCX_HTML}\n`);
  assert.equal(await docxToMarkdown(mammoth, { buffer: Buffer.from(bytes) }), `${MERGED_DOCX_HTML}\n`);
});

test('.xlsx, .xls and .ods keep merged cells', () => {
  for (const bookType of ['xlsx', 'biff8', 'ods']) {
    const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['Grupo', '', 'Total'], ['A', 1, 3], ['', 2, '']]);
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }, { s: { r: 1, c: 2 }, e: { r: 2, c: 2 } }];
    XLSX.utils.book_append_sheet(book, sheet, 'Hoja');
    const md = workbookMarkdown(XLSX, readWorkbook(XLSX, new Uint8Array(XLSX.write(book, { type: 'array', bookType }))));
    assert.equal(md, [
      '## Hoja', '', '<table>', '<thead>', '<tr><th colspan="2">Grupo</th><th>Total</th></tr>', '</thead>', '<tbody>',
      '<tr><td rowspan="2">A</td><td>1</td><td rowspan="2">3</td></tr>', '<tr><td>2</td></tr>', '</tbody>', '</table>', '',
    ].join('\n'), bookType);
  }
  // Merges reaching past the rows shown are cut to them.
  assert.match(gridMarkdown([['a', 'b'], ['c', 'd']], { merges: [[1, 0, 5, 2]] }), /<td colspan="2">c<\/td>/);
});

test('OpenDocument merged cells (number-columns-spanned / number-rows-spanned)', () => {
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
  const cell = (t, a = '') => `<table:table-cell ${a}><text:p>${t}</text:p></table:table-cell>`, covered = '<table:covered-table-cell/>';
  const content = `<office:document-content ${ns}><office:body><office:text><table:table>`
    + `<table:table-row>${cell('Tema', 'table:number-columns-spanned="2"')}${covered}${cell('Nota')}</table:table-row>`
    + `<table:table-row>${cell('Q1', 'table:number-rows-spanned="2"')}${cell('a &lt;b&gt;')}${cell('7')}</table:table-row>`
    + `<table:table-row>${covered}${cell('c')}${cell('8')}</table:table-row>`
    + '</table:table></office:text></office:body></office:document-content>';
  assert.equal(odfToMarkdown(content), `${MERGED_DOCX_HTML}\n`);
});

test('.pptx table merged cells (gridSpan / rowSpan)', async () => {
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const tc = (t, a = '') => `<a:tc ${a}><a:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`;
  const tbl = `<a:tbl><a:tr>${tc('Tema', 'gridSpan="2"')}${tc('', 'hMerge="1"')}${tc('Nota')}</a:tr>`
    + `<a:tr>${tc('Q1', 'rowSpan="2"')}${tc('a &lt;b&gt;')}${tc('7')}</a:tr><a:tr>${tc('', 'vMerge="1"')}${tc('c')}${tc('8')}</a:tr></a:tbl>`;
  const bytes = zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': `<?xml version="1.0"?><p:sld ${A}><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData>${tbl}</a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  });
  const { markdown } = await pptxDocument(bytes);
  assert.ok(markdown.includes(MERGED_DOCX_HTML), markdown);
});
