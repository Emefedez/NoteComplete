import assert from "node:assert/strict";
import test from "node:test";
import { rasterTarget } from "./pdf-background.js";

test("PDF raster target follows displayed width and keeps a bounded pixel budget", () => {
  const target = rasterTarget({ width: 612, height: 792 }, 960, 1);
  assert.equal(target.width, 1920);
  assert.equal(target.height, 2485);

  const capped = rasterTarget({ width: 5000, height: 7000 }, 6000, 3);
  assert.ok(capped.width <= 8192);
  assert.ok(capped.height <= 8192);
  assert.ok(capped.width * capped.height < 12_010_000);
  assert.ok(capped.width > 2000);
});

test("PDF raster quality: the setting is for a 2× screen, and a 1× screen gets what it shows", () => {
  const page = { width: 600, height: 800 };
  const balanced = { scale: 2, megapixels: 12 }, sharp = { scale: 3, megapixels: 20 }, fast = { scale: 1, megapixels: 4 };
  assert.equal(rasterTarget(page, 600, 2, balanced).width, 1200, "2× screen: as before");
  assert.equal(rasterTarget(page, 600, 3, balanced).width, 1200, "3× screen: never more than the setting");
  assert.equal(rasterTarget(page, 600, 1, balanced).width, 600, "1× screen: its own pixels");
  assert.equal(rasterTarget(page, 600, 1, sharp).width, 900);
  assert.equal(rasterTarget(page, 600, 1, fast).width, 600, "never below the screen");
  assert.equal(rasterTarget(page, 600, 1.5, balanced).width, 900);
});
import { rasterKind, CANVAS_MAX_SIDE } from "./pdf-background.js";
test("PDF raster kind: a canvas larger than some tablets can show becomes a picture", () => {
  const a4 = { width: 595, height: 842 }, balanced = { scale: 2, megapixels: 12 };
  // Fit width on a 2× tablet: a canvas.
  assert.equal(rasterKind("canvas", rasterTarget(a4, 1230, 2, balanced)), "canvas");
  // Zoomed in, the 12 MP budget still gives an A4 page 4120 px of height: a picture.
  const zoomed = rasterTarget(a4, 4800, 2, balanced);
  assert.ok(zoomed.height > CANVAS_MAX_SIDE);
  assert.equal(rasterKind("canvas", zoomed), "url");
  assert.equal(rasterKind("canvas", { width: 4096, height: 4096 }), "url", "16.8 MP: past the pixel limit");
  assert.equal(rasterKind("canvas", { width: 4096, height: 3800 }), "canvas");
  assert.equal(rasterKind("url", { width: 100, height: 100 }), "url", "a page with much ink stays a picture");
});
import { textWords } from "./pdf-background.js";
test("PDF text words land in the page's PDF rect, including rotated pages", () => {
  // 720x540 pt slide drawn at [0,0,1320,990] on a 2242.6-wide page (Temas1+2).
  const viewport = { width: 720, height: 540, scale: 1, transform: [1, 0, 0, -1, 0, 540] };
  const place = { x: 0, y: 0, width: 1320, height: 990 };
  const [tema, uno] = textWords([{ str: "Tema 1", transform: [20, 0, 0, 20, 100, 440], width: 60 }], viewport, place);
  assert.equal(tema.text, "Tema");
  const k = 1320 / 720;
  assert.ok(Math.abs(tema.box[0] - 100 * k) < 1e-9);
  assert.ok(Math.abs(tema.box[1] - 80 * k) < 1e-9, "top = baseline - font size, y flipped");
  assert.ok(Math.abs(tema.box[2] - 40 * k) < 1e-9, "4 of 6 characters");
  assert.ok(Math.abs(tema.box[3] - 20 * k) < 1e-9);
  assert.ok(uno.box[0] > tema.box[0] + tema.box[2]);
  // /Rotate 90 viewport: text runs downwards on screen, so the box is tall.
  const rotated = { width: 540, height: 720, scale: 1, transform: [0, 1, 1, 0, 0, 0] };
  const [word] = textWords([{ str: "SRAM", transform: [10, 0, 0, 10, 50, 60], width: 40 }], rotated, { x: 0, y: 0, width: 540, height: 720 });
  assert.ok(word.box[3] > word.box[2]);
  assert.deepEqual(textWords([{ str: "  ", transform: [1, 0, 0, 1, 0, 0], width: 1 }], viewport, place), []);
});

test("PDF words are placed by the font's widths, not by character count", () => {
  // "iii MMM": with widths by count, MMM would start at 4/7 of the item. Narrow i (1) and wide
  // M and space (3) put it at (3 + 3) / 15.
  const viewport = { width: 100, height: 100, scale: 1, transform: [1, 0, 0, -1, 0, 100] };
  const place = { x: 0, y: 0, width: 100, height: 100 };
  const widths = { i: 1, M: 3, " ": 3 };
  let fonts = [];
  const measure = (text, font) => { fonts.push(font); return [...text].reduce((sum, c) => sum + widths[c], 0); };
  const item = { str: "iii MMM", transform: [10, 0, 0, 10, 0, 50], width: 75, fontName: "g_d0_f1" };
  const [narrow, wide] = textWords([item], viewport, place, measure, { g_d0_f1: { fontFamily: "serif" } });
  assert.ok(Math.abs(narrow.box[2] - 15) < 1e-9, "iii is 3 of 15 units of 75");
  assert.ok(Math.abs(wide.box[0] - 30) < 1e-9);
  assert.ok(Math.abs(wide.box[2] - 45) < 1e-9);
  assert.equal(fonts[0], '"g_d0_f1", serif', "the loaded PDF font first, then pdf.js's family");
  // A measure that fails leaves the count.
  const [byCount] = textWords([item], viewport, place, () => { throw Error("no font"); });
  assert.ok(Math.abs(byCount.box[2] - 75 * 3 / 7) < 1e-9);
});

import { textGlyphs, letterSpaced } from "./pdf-background.js";
// Operator numbers for the tests (pdf.js's own OPS in the app).
const OPS = { save: 10, restore: 11, transform: 12, beginText: 31, setCharSpacing: 33, setWordSpacing: 34, setHScale: 35, setFont: 37, moveText: 40, setTextMatrix: 42, showText: 44 };
const glyph = (unicode, width) => ({ unicode, width, isSpace: unicode === " " });
test("glyph places follow the PDF's text state: cm, Tm, Td, Tc, TJ numbers, Tz", () => {
  const ops = { fnArray: [], argsArray: [] };
  const op = (fn, ...args) => { ops.fnArray.push(OPS[fn]); ops.argsArray.push(args); };
  op("save"); op("transform", 2, 0, 0, 2, 10, 20);
  op("beginText"); op("setFont", "f1", 10); op("setTextMatrix", new Float32Array([1, 0, 0, 1, 5, 0]));
  op("setCharSpacing", 1);
  // A (5 wide + 1 spacing), a TJ kern of -500 (+5), B; then Td and C at half width.
  op("showText", [glyph("A", 500), -500, glyph("B", 500)]);
  op("moveText", 0, -12); op("setHScale", 50); op("showText", [glyph("C", 400)]);
  op("restore");
  const [a, b, c] = textGlyphs(ops, OPS);
  assert.deepEqual([a.text, a.x, a.y, a.ex, a.size], ["A", 20, 20, 30, 20]);
  assert.deepEqual([b.x, b.ex], [20 + 2 * (5 + 1 + 5), 20 + 2 * (5 + 1 + 5 + 5)]);
  assert.deepEqual([c.text, c.x, c.y, c.ex], ["C", 20, -4, 24]);
});

// A spaced-out line as a PDF draws it (one glyph per Tj, letters 0.14 em apart; a space glyph,
// or only a wider gap, between words) and as pdf.js gives it: one item, a space between every
// two letters.
function spacedOut(text, { size = 8, letter = 0.14, spaceGlyphs = true, space = 0.25 } = {}) {
  const ops = { fnArray: [], argsArray: [] };
  const op = (fn, ...args) => { ops.fnArray.push(OPS[fn]); ops.argsArray.push(args); };
  op("beginText"); op("setFont", "f1", size); op("setTextMatrix", [1, 0, 0, 1, 50, 700]);
  let x = 0;
  for (const ch of text) {
    if (ch === " ") {
      if (spaceGlyphs) op("showText", [glyph(" ", space * 1000)]);
      else { op("moveText", (space + letter) * size, 0); x += (space + letter) * size; }
      if (!spaceGlyphs) continue;
    } else op("showText", [glyph(ch, 600)]);
    const step = ((ch === " " ? space : 0.6) + letter) * size;
    op("moveText", step, 0); x += step;
  }
  const item = { str: [...text.replace(/ /g, "")].join(" "), transform: [size, 0, 0, size, 50, 700], width: x - letter * size, fontName: "f1" };
  return { item, glyphs: textGlyphs(ops, OPS) };
}
test("a spaced-out title's letters join into words, its spaces stay", () => {
  const viewport = { width: 600, height: 800, scale: 1, transform: [1, 0, 0, -1, 0, 800] };
  const place = { x: 0, y: 0, width: 600, height: 800 };
  const { item, glyphs } = spacedOut("ARQUI DE COMPU II");
  assert.equal(item.str, "A R Q U I D E C O M P U I I", "pdf.js: no telling letters from words");
  assert.equal(letterSpaced(item.str), true);
  assert.deepEqual(textWords([item], viewport, place).map((w) => w.text).join("|"), "A|R|Q|U|I|D|E|C|O|M|P|U|I|I", "without glyphs, as before");
  const words = textWords([{ str: "AC", transform: [5, 0, 0, 5, 10, 700], width: 8 }, { str: " ", transform: [5, 0, 0, 5, 18, 700], width: 30 }, item], viewport, place, null, {}, glyphs);
  assert.deepEqual(words.map((w) => w.text), ["AC", "ARQUI", "DE", "COMPU", "II"]);
  assert.deepEqual(words.map((w) => w.space), [false, true, true, true, true]);
  // Boxes from the glyphs: ARQUI from A's start to I's end, DE after the space.
  const [, arqui, de] = words;
  assert.ok(Math.abs(arqui.box[0] - 50) < 1e-9);
  assert.ok(Math.abs(arqui.box[0] + arqui.box[2] - (50 + 4 * 0.74 * 8 + 0.6 * 8)) < 1e-9);
  assert.ok(Math.abs(de.box[0] - (50 + 5 * 0.74 * 8 + 0.39 * 8)) < 1e-9);
});

test("without space glyphs, a spaced-out title breaks at the wider gaps; plain spaced letters stay apart", () => {
  const viewport = { width: 600, height: 800, scale: 1, transform: [1, 0, 0, -1, 0, 800] };
  const place = { x: 0, y: 0, width: 600, height: 800 };
  const title = spacedOut("PRÁCTICA 3", { letter: 0.2, spaceGlyphs: false });
  assert.deepEqual(textWords([title.item], viewport, place, null, {}, title.glyphs).map((w) => w.text), ["PRÁCTICA", "3"]);
  // "x y z" with gaps a space wide and no space glyphs: spaces, not letter-spacing.
  const plain = spacedOut("xyz", { letter: 0.28, spaceGlyphs: false });
  assert.deepEqual(textWords([plain.item], viewport, place, null, {}, plain.glyphs).map((w) => w.text), ["x", "y", "z"]);
  // Glyphs that are not the item's text (another line): the item's pieces as they are.
  const other = spacedOut("OTRO");
  assert.deepEqual(textWords([title.item], viewport, place, null, {}, other.glyphs).map((w) => w.text), ["P", "R", "Á", "C", "T", "I", "C", "A", "3"]);
  // Normal text is not read by glyph.
  assert.equal(letterSpaced("Parcial I · Control de lavadora"), false);
});

import { PdfBackgrounds, RASTERS_KEPT } from "./pdf-background.js";
test("page rasters: one render per page and size, the last few kept, URLs revoked when dropped", async () => {
  const own = !globalThis.document;
  globalThis.document ??= {};
  const saved = { create: globalThis.document.createElement, query: globalThis.document.querySelector, url: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const shown = new Set(), revoked = new Set();
  let urls = 0;
  globalThis.document.createElement = () => ({ width: 0, height: 0, getContext: (type) => (type === "2d" ? {} : null), toBlob: (done) => done(new Blob(["png"])) });
  globalThis.document.querySelector = (selector) => ([...shown].some((u) => selector.includes(u)) ? {} : null);
  URL.createObjectURL = () => `blob:test/${++urls}`;
  URL.revokeObjectURL = (url) => revoked.add(url);
  try {
    let renders = 0;
    const pdf = {
      getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 150 * scale }),
        render: () => { renders++; return { promise: Promise.resolve() }; },
        cleanup() {},
      }),
    };
    const backgrounds = new PdfBackgrounds(async () => new Uint8Array());
    backgrounds.document = async () => pdf;
    const page = (i) => ({ resource_id: "r", page_index: i });
    // Two pages asking for the same raster at once share one render.
    const [a, b] = await Promise.all([backgrounds.raster(page(0), [100, 150], 100, undefined, "url"), backgrounds.raster(page(0), [100, 150], 100, undefined, "url")]);
    assert.equal(a, b);
    assert.equal(renders, 1);
    assert.match(a, /^blob:/);
    // On a page, it outlives the cache; the others are revoked as they are pushed out.
    shown.add(a);
    const others = [];
    for (let i = 1; i <= RASTERS_KEPT + 1; i++) others.push(await backgrounds.raster(page(i), [100, 150], 100, undefined, "url"));
    assert.equal(backgrounds.rasters.size, RASTERS_KEPT);
    assert.ok(!revoked.has(a), "a raster on a page is not revoked");
    assert.ok(revoked.has(others[0]), "the oldest raster no page shows is revoked");
    assert.equal(await backgrounds.raster(page(RASTERS_KEPT + 1), [100, 150], 100, undefined, "url"), others.at(-1), "a kept raster is reused");
    assert.equal(renders, RASTERS_KEPT + 2);
    // Leaving the page: revoked only when no longer kept.
    shown.delete(a);
    backgrounds.release(a);
    assert.ok(revoked.has(a));
    backgrounds.release(others.at(-1));
    assert.ok(!revoked.has(others.at(-1)), "kept for scrolling back");
    backgrounds.clear();
    assert.ok(revoked.has(others.at(-1)));
    assert.equal(backgrounds.rasters.size, 0);
    // As a canvas: its own entry; freed (shrunk to nothing) once off the page and out of the cache.
    const canvas = await backgrounds.raster(page(0), [100, 150], 100);
    assert.equal(typeof canvas, "object");
    assert.ok(canvas.width > 0);
    for (let i = 1; i <= RASTERS_KEPT; i++) await backgrounds.raster(page(i), [100, 150], 100);
    assert.equal(canvas.width, 0, "pushed out of the cache and on no page: freed");
    // A canvas asked for at a size some tablets cannot show comes as a picture's URL.
    assert.match(await backgrounds.raster(page(9), [100, 150], 3000), /^blob:/);
    assert.equal(typeof await backgrounds.raster(page(9), [100, 150], 1300), "object");
  } finally {
    if (own) delete globalThis.document;
    else Object.assign(globalThis.document, { createElement: saved.create, querySelector: saved.query });
    URL.createObjectURL = saved.url;
    URL.revokeObjectURL = saved.revoke;
  }
});
