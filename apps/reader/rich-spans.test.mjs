import test from "node:test";
import assert from "node:assert/strict";
import { overrides, spansOf, remapSpans, withoutKeys, fromRuns, spansFor } from "./rich-spans.js";

const base = { font: "Barlow", bold: false, italic: false, rgba: [0, 0, 0, 1] };
// "Libro de " plain, "Arquitectura" bold, ", del" plain.
const spans = [{ len: 9 }, { len: 12, bold: true }, { len: 5 }];
const text = "Libro de Arquitectura, del";

test("spans say only what differs, join alike neighbours, and vanish when nothing does", () => {
  assert.deepEqual(overrides({ ...base, bold: true, font: "Barlow-Bold" }, base), { bold: true, font: "Barlow-Bold" });
  assert.deepEqual(spansOf([{ text: "ab", style: {} }, { text: "c", style: {} }]), []);
  assert.deepEqual(spansOf([{ text: "ab", style: {} }, { text: "cd", style: { bold: true } }, { text: "e", style: { bold: true } }]), [{ len: 2 }, { len: 3, bold: true }]);
  assert.deepEqual(spansOf([{ text: "ñé", style: { italic: true } }, { text: "😀", style: {} }]), [{ len: 2, italic: true }, { len: 1 }], "code points, not UTF-16 units");
  assert.deepEqual(spansFor(text, spans), spans);
  assert.deepEqual(spansFor(text + "!", spans), [], "never sent when the lengths do not add up");
});

test("typing keeps every part's style; new letters take the style before them", () => {
  // Typed inside the bold word.
  assert.deepEqual(remapSpans(text, "Libro de Arquitecturas, del", spans), [{ len: 9 }, { len: 13, bold: true }, { len: 5 }]);
  // Typed after the bold word (the comma is plain): plain.
  assert.deepEqual(remapSpans(text, "Libro de Arquitectura, del Grado", spans), [{ len: 9 }, { len: 12, bold: true }, { len: 11 }]);
  // The bold word deleted: no spans left.
  assert.deepEqual(remapSpans(text, "Libro de , del", spans), []);
  // Typed at the very start: the style of the first character.
  assert.deepEqual(remapSpans(text, "El Libro de Arquitectura, del", spans), [{ len: 12 }, { len: 12, bold: true }, { len: 5 }]);
  // A replacement across the boundary.
  assert.deepEqual(remapSpans(text, "Libro sobre Arquitectura, del", spans), [{ len: 12 }, { len: 12, bold: true }, { len: 5 }]);
  assert.deepEqual(remapSpans(text, text, spans), spans);
});

test("a style set from the bar is the whole box's: spans give it up", () => {
  assert.deepEqual(withoutKeys(spans, ["bold"]), []);
  assert.deepEqual(withoutKeys([{ len: 2, bold: true, font: "X" }, { len: 1 }], ["bold"]), [{ len: 2, font: "X" }, { len: 1 }]);
  assert.deepEqual(withoutKeys(spans, ["size"]), spans);
});

test("a box from the core: the style of most characters is the box's, the rest are spans", () => {
  const styleOf = (r) => ({ font: r.font_family, bold: r.bold, italic: r.italic, rgba: r.rgba, size: r.font_size });
  const run = (t, bold) => ({ text: t, font_family: "Barlow", bold, italic: false, rgba: [0, 0, 0, 1], font_size: 20 });
  const { base: b, spans: s } = fromRuns([run("Libro de ", false), run("Arquitectura", true), run(", del", false), run("​", false)], styleOf);
  assert.equal(b.bold, false);
  assert.deepEqual(s, spans);
  assert.deepEqual(fromRuns([run("Solo", false), run("​", false)], styleOf).spans, []);
});
