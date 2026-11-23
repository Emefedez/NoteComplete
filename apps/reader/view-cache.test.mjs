import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { READS, ViewCache } from "./view-cache.js";

const view = (page, chars = 10) => ({ page, svg: "x".repeat(chars) });

test("the reads are the worker's", () => {
  const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const list = source.match(/const READS = new Set\((\[[^\]]*\])\)/);
  assert.ok(list, "worker.js lists its reads");
  assert.deepEqual([...READS].sort(), JSON.parse(list[1]).sort());
});

test("a view is kept until an operation that may change the note", () => {
  const cache = new ViewCache();
  const a = view(0);
  cache.put(0, a, cache.generation);
  assert.equal(cache.get(0), a);
  cache.sending("view");
  cache.sending("save");
  assert.equal(cache.get(0), a);
  cache.sending("draw");
  assert.equal(cache.get(0), null);
  assert.equal(cache.chars, 0);
});

test("an operation nobody listed counts as a change", () => {
  const cache = new ViewCache();
  cache.put(0, view(0), cache.generation);
  cache.sending("somethingNew");
  assert.equal(cache.get(0), null);
});

test("a view asked before a change is not kept when it arrives after it", () => {
  const cache = new ViewCache();
  const asked = cache.generation;
  cache.sending("erase");
  cache.put(3, view(3), asked);
  assert.equal(cache.get(3), null);
});

test("bounded by entries, least recently used first", () => {
  const cache = new ViewCache({ maxEntries: 2 });
  for (const page of [0, 1]) cache.put(page, view(page), cache.generation);
  cache.get(0);
  cache.put(2, view(2), cache.generation);
  assert.ok(cache.get(0));
  assert.equal(cache.get(1), null);
  assert.ok(cache.get(2));
  cache.setMaxEntries(1);
  assert.equal(cache.views.size, 1);
  assert.equal(cache.chars, 10);
});

test("bounded by the SVG text held", () => {
  const cache = new ViewCache({ maxChars: 25 });
  cache.put(0, view(0, 10), cache.generation);
  cache.put(1, view(1, 10), cache.generation);
  cache.put(2, view(2, 10), cache.generation);
  assert.equal(cache.get(0), null);
  assert.equal(cache.chars, 20);
  // A page larger than the whole budget is not kept, and takes nothing out.
  cache.put(3, view(3, 30), cache.generation);
  assert.equal(cache.get(3), null);
  assert.equal(cache.views.size, 2);
  // The same page again replaces its view.
  cache.put(1, view(1, 5), cache.generation);
  assert.equal(cache.chars, 15);
});
