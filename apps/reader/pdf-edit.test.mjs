import test from "node:test";
import assert from "node:assert/strict";
import { toPage, rectOnPage, assignText, nearestFamily, textBoxFor } from "./pdf-edit.js";
import { fontName, pdfFontName, pdfFontHash, genericFor, fontStack, familyInFont, CJK_SANS, CJK_SERIF } from "./fonts.js";

// An A4 page at scale 1 (pdf.js: y flipped), drawn on a page twice its size at 100, 50.
const viewport = { width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] };
const place = { x: 100, y: 50, width: 1190, height: 1684 };

test("PDF user space maps onto the page through the viewport and the PDF's rect", () => {
  assert.deepEqual(toPage([0, 842], viewport.transform, viewport, place), [100, 50]);
  assert.deepEqual(toPage([595, 0], viewport.transform, viewport, place), [1290, 1734]);
  // A box with y up becomes a page rect with y down.
  assert.deepEqual(rectOnPage([72, 686, 172, 700], viewport.transform, viewport, place), [244, 334, 200, 28]);
});

test("pdf.js text replaces the engine's per line, with spaces only where there were gaps", () => {
  const blocks = [{ size: 11, lines: [{ x0: 72, x1: 300, base: 700, text: "?? engine" }, { x0: 72, x1: 200, base: 686, text: "kept" }] }];
  const items = [
    { str: "dos", transform: [11, 0, 0, 11, 120, 700.2], width: 18 },
    { str: "Línea", transform: [11, 0, 0, 11, 72, 700], width: 28 },
    { str: "uno,", transform: [11, 0, 0, 11, 103.5, 700], width: 13 },
    // Glued to the word before it (a kerned run split in two): no space.
    { str: "s", transform: [11, 0, 0, 11, 138.2, 700], width: 5 },
    { str: "otra página", transform: [11, 0, 0, 11, 72, 400], width: 50 },
  ];
  assignText(blocks, items);
  assert.equal(blocks[0].lines[0].text, "Línea uno, doss");
  assert.equal(blocks[0].lines[1].text, "kept", "nothing from pdf.js: the engine's text");
});

test("a block becomes a text box with its size, spacing, colour and first baseline", () => {
  const block = { size: 12, leading: 13.5, bold: true, italic: false, rgba: [0.2, 0.4, 0.6, 1], align: 0, lines: [{ text: "Uno" }, { text: "dos" }] };
  const box = textBoxFor(block, { origin: [244, 400], scale: 2, font: "Helvetica" });
  assert.equal(box.text, "Uno\ndos");
  assert.deepEqual(box.style, { font: "Helvetica", size: 24, bold: true, italic: false, rgba: [0.2, 0.4, 0.6, 1], lineHeight: 27 });
  // The core draws the first baseline 8 + size below the top and 5 units in.
  assert.deepEqual(box.at, [239, 368]);
  // One line: no line height of its own.
  assert.equal(textBoxFor({ ...block, lines: [{ text: "Uno" }] }, { origin: [0, 100], scale: 1, font: "Helvetica" }).style.lineHeight, undefined);
  assert.equal(nearestFamily({ serif: true }), "Times New Roman");
  assert.equal(nearestFamily({ mono: true, serif: true }), "Courier New");
  assert.equal(nearestFamily({}), "Helvetica");
});

test("font names fit the core's rules and PDF fonts carry their program's hash", () => {
  assert.equal(fontName("Arial,Bold+X"), "Arial-Bold-X");
  assert.equal(fontName(""), "Font");
  assert.equal(fontName("x".repeat(80)).length, 64);
  const name = pdfFontName("ABCDEF+Weird/Name", "1a2b3c4d");
  assert.equal(name, "ABCDEF-Weird-Name pdf1a2b3c4d");
  assert.equal(pdfFontHash(name), "1a2b3c4d");
  assert.equal(pdfFontHash("Helvetica"), null);
  assert.equal(genericFor("LiberationSerif"), `'Times New Roman', serif, ${CJK_SERIF}`);
  assert.equal(genericFor("LiberationSans"), `Arial, sans-serif, ${CJK_SANS}`);
  assert.equal(genericFor("JetBrainsMonoNF-Regular"), `'Courier New', monospace, ${CJK_SANS}`);
  assert.equal(fontStack("O'Neil"), `'O\\'Neil', Arial, sans-serif, ${CJK_SANS}`);
});

test("a font file's family comes from its name table", () => {
  // A minimal sfnt: one table, 'name', with a Windows (3,1) family name record (id 1).
  const family = "Mi Fuente";
  const utf16 = [...family].flatMap((c) => [0, c.charCodeAt(0)]);
  const nameTable = [0, 0, 0, 1, 0, 18, 0, 3, 0, 1, 0x04, 0x09, 0, 1, 0, utf16.length, 0, 0, ...utf16];
  const header = [0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0];
  const offset = header.length + 16;
  const record = [..."name"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [0, 0, 0, offset], [0, 0, 0, nameTable.length]);
  const bytes = new Uint8Array([...header, ...record, ...nameTable]);
  assert.equal(familyInFont(bytes), family);
  assert.equal(familyInFont(new Uint8Array([1, 2, 3])), null);
});

test("a line keeps its parts' styles: a bold word becomes a span in its own font", () => {
  const plain = { font: "Barlow", bold: false, italic: false, program: "aaaaaaaa", rgba: [0, 0, 0, 1] };
  const strong = { font: "Barlow-Bold", bold: true, italic: false, program: "bbbbbbbb", rgba: [0, 0, 0, 1] };
  const block = {
    size: 11, leading: 0, bold: false, italic: false, rgba: [0, 0, 0, 1], align: 0,
    lines: [{ x0: 72, x1: 300, base: 700, text: "", parts: [{ ...plain, x0: 72, x1: 120, text: "Libro de" }, { ...strong, x0: 123, x1: 200, text: "Arquitectura" }, { ...plain, x0: 200, x1: 240, text: ", del" }] }],
  };
  const items = [
    { str: "Libro de ", transform: [11, 0, 0, 11, 72, 700], width: 48 },
    { str: "Arquitectura", transform: [11, 0, 0, 11, 123, 700], width: 77 },
    { str: ", del", transform: [11, 0, 0, 11, 200, 700], width: 40 },
  ];
  assignText([block], items);
  assert.equal(block.lines[0].text, "Libro de Arquitectura, del");
  const fontOf = (part) => (part.bold ? "Barlow-Bold pdfbbbbbbbb" : "Barlow pdfaaaaaaaa");
  const box = textBoxFor(block, { origin: [0, 100], scale: 1, font: "Barlow pdfaaaaaaaa", fontOf });
  assert.deepEqual(box.spans, [{ len: 9 }, { len: 12, bold: true, font: "Barlow-Bold pdfbbbbbbbb" }, { len: 5 }]);
});

test("letter-spaced text keeps the engine's real spaces, not pdf.js's one per letter", () => {
  const part = { font: "Barlow Condensed", bold: false, italic: false, rgba: [0, 0, 0, 1] };
  const block = { size: 8, lines: [{ x0: 425, x1: 512, base: 765, text: "", parts: [{ ...part, x0: 425, x1: 509, text: "VOLUMEN 1 ALUMNADO" }] }] };
  assignText([block], [{ str: "V O L U M E N 1 A L U M N A D O", transform: [8, 0, 0, 8, 425.2, 765], width: 83.6 }]);
  assert.equal(block.lines[0].text, "VOLUMEN 1 ALUMNADO");
  // An engine that could not decode the font: pdf.js's text.
  const garbled = { size: 8, lines: [{ x0: 425, x1: 512, base: 765, text: "", parts: [{ ...part, x0: 425, x1: 509, text: "\u0001\u0002" }] }] };
  assignText([garbled], [{ str: "Hola", transform: [8, 0, 0, 8, 425.2, 765], width: 20 }]);
  assert.equal(garbled.lines[0].text, "Hola");
});
