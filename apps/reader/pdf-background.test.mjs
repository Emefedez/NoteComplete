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
  } finally {
    if (own) delete globalThis.document;
    else Object.assign(globalThis.document, { createElement: saved.create, querySelector: saved.query });
    URL.createObjectURL = saved.url;
    URL.revokeObjectURL = saved.revoke;
  }
});
