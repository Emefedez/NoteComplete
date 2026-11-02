// Small Word, OpenDocument, Excel and CSV files built in code, for the reader's office
// import tests (apps/reader/office.test.mjs, tools/office_import_e2e.mjs).
import { createRequire } from 'node:module';
import { crc32, deflateRawSync } from 'node:zlib';

const require = createRequire(new URL('../../apps/reader/package.json', import.meta.url));
export const XLSX = require('xlsx');
export const mammoth = require('mammoth');

// A zip archive: stored entries, or deflated ones (as office files usually are).
export function zip(files, { deflate = true } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const packed = deflate && name !== 'mimetype' ? deflateRawSync(data) : data;
    const nameBytes = new TextEncoder().encode(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(packed === data ? 0 : 8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(packed === data ? 0 : 8, 10);
    entry.writeUInt32LE(crc32(data), 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (text, extra = '') => `<w:p>${extra}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
export function docx() {
  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Informe trimestral</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t xml:space="preserve">Ventas de </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>marzo</w:t></w:r><w:r><w:t xml:space="preserve"> y </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>abril</w:t></w:r><w:r><w:t xml:space="preserve"> (*no* final).</w:t></w:r></w:p>`,
    p('Primer punto', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'),
    p('Segundo punto', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'),
    `<w:tbl><w:tr><w:tc>${p('Mes')}</w:tc><w:tc>${p('Total')}</w:tc></w:tr><w:tr><w:tc>${p('Marzo')}</w:tc><w:tc>${p('1|200')}</w:tc></w:tr></w:tbl>`,
    `<w:p><w:hyperlink r:id="rLink"><w:r><w:t>Sitio</w:t></w:r></w:hyperlink></w:p>`,
  ].join('');
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a" TargetMode="External"/></Relationships>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    'word/numbering.xml': `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  });
}

// content.xml of a small OpenDocument text, written by hand.
export const ODT_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3">
 <office:automatic-styles>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
  <text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/><text:list-level-style-bullet text:level="2" text:bullet-char="•"/></text:list-style>
  <text:list-style style:name="L2"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style>
 </office:automatic-styles>
 <office:body>
  <office:text>
   <text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Table"/></text:sequence-decls>
   <text:tracked-changes><text:changed-region text:id="c1"><text:deletion><text:p>Texto borrado</text:p></text:deletion></text:changed-region></text:tracked-changes>
   <text:h text:style-name="Heading_20_1" text:outline-level="1">Apuntes de física</text:h>
   <text:p text:style-name="Standard">La <text:span text:style-name="T1">energía</text:span> se <text:span text:style-name="T2">conserva</text:span>.<text:s text:c="3"/>Ver <text:a xlink:href="https://example.org/x" xlink:type="simple">la web</text:a>.<text:note text:id="n1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Salvo rozamiento.</text:p></text:note-body></text:note></text:p>
   <text:h text:outline-level="2">Fórmulas</text:h>
   <text:p>E = m·c² cuesta $5<text:line-break/>segunda línea</text:p>
   <text:list text:style-name="L1">
    <text:list-item><text:p>Primero</text:p>
     <text:list><text:list-item><text:p>Detalle</text:p></text:list-item></text:list>
    </text:list-item>
    <text:list-item><text:p>Segundo</text:p></text:list-item>
   </text:list>
   <text:list text:style-name="L2"><text:list-item><text:p>Viñeta</text:p></text:list-item></text:list>
   <table:table table:name="Tabla1">
    <table:table-column table:number-columns-repeated="3"/>
    <table:table-header-rows><table:table-row><table:table-cell><text:p>Magnitud</text:p></table:table-cell><table:table-cell><text:p>Unidad</text:p></table:table-cell><table:table-cell/></table:table-row></table:table-header-rows>
    <table:table-row><table:table-cell><text:p>Fuerza</text:p></table:table-cell><table:table-cell><text:p>N | newton</text:p></table:table-cell><table:table-cell/></table:table-row>
   </table:table>
   <text:p/>
   <text:p>1. No es una lista</text:p>
  </office:text>
 </office:body>
</office:document-content>`;
export function odt() {
  return zip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': ODT_CONTENT,
    'META-INF/manifest.xml': '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"/>',
  });
}

// A workbook with two sheets, as .xlsx or .ods.
export function workbook(bookType = 'xlsx') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Producto', 'Precio', 'Fecha'], ['Lápiz', 1.5, new Date(Date.UTC(2026, 2, 14))], ['Goma | blanda', 0.75, '']]), 'Ventas');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Nota'], ['Revisar el stock']]), 'Notas');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType }));
}

export const CSV = 'name,quote,notes\r\nAda,"Hello, world","line one\nline two"\r\nBob,"She said ""hi""",\r\n';
