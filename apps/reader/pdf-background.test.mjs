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
test("page rasters: one render per page and size, only the last few kept, released when dropped", async () => {
  const made = [];
  const own = !globalThis.document;
  globalThis.document ??= {};
  const saved = globalThis.document.createElement;
  globalThis.document.createElement = () => {
    const canvas = { width: 0, height: 0, isConnected: false, getContext: (type) => (type === "2d" ? {} : null) };
    made.push(canvas);
    return canvas;
  };
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
    const [a, b] = await Promise.all([backgrounds.raster(page(0), [100, 150], 100), backgrounds.raster(page(0), [100, 150], 100)]);
    assert.equal(a, b);
    assert.equal(renders, 1);
    assert.ok(a.width > 0);
    // Shown on screen, it survives being pushed out of the cache; the others are wiped.
    a.isConnected = true;
    const others = [];
    for (let i = 1; i <= RASTERS_KEPT + 1; i++) others.push(await backgrounds.raster(page(i), [100, 150], 100));
    assert.equal(backgrounds.rasters.size, RASTERS_KEPT);
    assert.ok(a.width > 0, "a raster on screen is not wiped");
    assert.equal(others[0].width, 0, "the oldest off-screen raster is freed");
    assert.equal(await backgrounds.raster(page(RASTERS_KEPT + 1), [100, 150], 100), others.at(-1), "a kept raster is reused");
    assert.equal(renders, RASTERS_KEPT + 2);
    // Leaving the screen: released only when no longer kept.
    a.isConnected = false;
    backgrounds.release(a);
    assert.equal(a.width, 0);
    backgrounds.release(others.at(-1));
    assert.ok(others.at(-1).width > 0, "kept for scrolling back");
    backgrounds.clear();
    assert.equal(others.at(-1).width, 0);
    assert.equal(backgrounds.rasters.size, 0);
  } finally {
    if (own) delete globalThis.document;
    else globalThis.document.createElement = saved;
  }
});
