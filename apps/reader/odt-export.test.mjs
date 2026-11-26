import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOdtBytes, xmlEscape } from './odt-export.js';

test('buildOdtBytes generates a valid ODT zip with positioned editable text frames and backgrounds', () => {
  const fakeJpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const bytes = buildOdtBytes({
    title: 'ESTI Tema 1',
    pages: [
      {
        widthPt: 595.28,
        heightPt: 841.89,
        backgroundBytes: fakeJpg,
        blocks: [
          {
            xPt: 72,
            yPt: 96,
            wPt: 400,
            hPt: 36,
            fontSizePt: 16,
            bold: true,
            italic: false,
            fontFamily: 'Liberation Sans',
            color: '#112233',
            align: 'left',
            text: 'Tema 1 & Requisitos <Software>',
          },
        ],
      },
      {
        widthPt: 595.28,
        heightPt: 841.89,
        blocks: [
          { xPt: 72, yPt: 100, wPt: 300, hPt: 24, fontSizePt: 11, text: 'Página 2 bloque editable' },
        ],
      },
    ],
  });

  // Valid PK zip header
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('application/vnd.oasis.opendocument.text'));
  assert.ok(text.includes('META-INF/manifest.xml'));
  assert.ok(text.includes('Pictures/page-1.jpg'));
  assert.ok(text.includes('text:anchor-page-number="1"'));
  assert.ok(text.includes('text:anchor-page-number="2"'));
  assert.ok(text.includes('svg:x="72.00pt" svg:y="96.00pt"'));
  assert.ok(text.includes(xmlEscape('Tema 1 & Requisitos <Software>')));
  assert.ok(text.includes('PPageBreak'));
});
