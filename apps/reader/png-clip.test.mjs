import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deflateSync } from "node:zlib";
import { addClipChunk, readClipChunk, validClip, crc32, isPng, CLIP_KEYWORD } from "./png-clip.js";

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE((crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
// A 2×2 RGBA picture.
function tinyPng(extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(2 * (1 + 8), 0x7f); raw[0] = 0; raw[9] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const types = (png) => { const out = []; for (let at = 8; at < png.length; ) { const n = Buffer.from(png).readUInt32BE(at); out.push(Buffer.from(png.subarray(at + 4, at + 8)).toString("latin1")); at += 12 + n; } return out; };

const sample = {
  at: 123,
  box: [10, 20, 100, 50],
  lines: [{ points: [[10, 20], [110, 70]], rgba: [0, 0, 0, 1], width: 2, part: { kind: "graph", id: "graph-1" } }],
  images: [{ base64: "AAAA", mime: "image/png", bounds: [10, 20, 100, 50], prefab: { kind: "prefab", spec: '{"type":"timeline","title":"Ñandú ✓"}' } }],
};

test("round trip: the copy comes back, the picture keeps its chunks and ends with IEND", async () => {
  const png = tinyPng();
  const out = await addClipChunk(png, sample);
  assert.ok(isPng(out));
  assert.deepEqual(types(out), ["IHDR", "IDAT", "iTXt", "IEND"]);
  assert.deepEqual(await readClipChunk(out), sample);
  // The keyword and the compression flag, as iTXt has them.
  const i = Buffer.from(out).indexOf("iTXt") + 4;
  assert.equal(Buffer.from(out.subarray(i, i + CLIP_KEYWORD.length + 2)).toString("latin1"), "NoteComplete\0\x01");
});

test("adding again replaces the earlier copy", async () => {
  const once = await addClipChunk(tinyPng(), sample);
  const twice = await addClipChunk(once, { ...sample, at: 456 });
  assert.equal(types(twice).filter((t) => t === "iTXt").length, 1);
  assert.equal((await readClipChunk(twice)).at, 456);
});

test("survives an unrelated chunk before and after it", async () => {
  const text = chunk("tEXt", Buffer.from("Software\0Other app"));
  const out = await addClipChunk(tinyPng([text]), sample);
  assert.deepEqual(types(out), ["IHDR", "tEXt", "IDAT", "iTXt", "IEND"]);
  // Another app adding its own chunk after ours.
  const b = Buffer.from(out), iend = b.length - 12;
  const edited = new Uint8Array(Buffer.concat([b.subarray(0, iend), chunk("tIME", Buffer.alloc(7)), b.subarray(iend)]));
  assert.deepEqual(await readClipChunk(edited), sample);
});

test("a damaged chunk (bad CRC) is ignored", async () => {
  const out = await addClipChunk(tinyPng(), sample);
  const i = Buffer.from(out).indexOf("iTXt") + 4 + CLIP_KEYWORD.length + 8;
  out[i] ^= 0xff;
  assert.equal(await readClipChunk(out), null);
});

test("no chunk, not a PNG, another keyword or a newer format: null", async () => {
  assert.equal(await readClipChunk(tinyPng()), null);
  assert.equal(await readClipChunk(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(await readClipChunk(new Uint8Array()), null);
  const other = chunk("iTXt", Buffer.from("Other\0\0\0\0\0{}"));
  assert.equal(await readClipChunk(tinyPng([other])), null);
  const newer = chunk("iTXt", Buffer.concat([Buffer.from("NoteComplete\0\0\0\0\0"), Buffer.from(JSON.stringify({ format: "notecomplete-clip", version: 99, clip: sample }))]));
  assert.equal(await readClipChunk(tinyPng([newer])), null);
  // Uncompressed text of the current version reads.
  const plain = chunk("iTXt", Buffer.concat([Buffer.from("NoteComplete\0\0\0\0\0"), Buffer.from(JSON.stringify({ format: "notecomplete-clip", version: 1, clip: sample }))]));
  assert.deepEqual(await readClipChunk(tinyPng([plain])), sample);
});

test("too large: the picture goes without the copy; reading stops at the cap", async () => {
  const png = tinyPng();
  assert.deepEqual(await addClipChunk(png, sample, { max: 10 }), png);
  const out = await addClipChunk(png, { ...sample, lines: Array.from({ length: 2000 }, () => sample.lines[0]) });
  assert.equal(await readClipChunk(out, { max: 1000 }), null);
  assert.equal((await readClipChunk(out)).lines.length, 2000);
});

test("validClip", () => {
  assert.ok(validClip(sample));
  assert.ok(!validClip(null));
  assert.ok(!validClip({ lines: [], images: [] }));
  assert.ok(!validClip({ lines: [{}], images: [] }));
  assert.ok(!validClip({ lines: [], images: [{ bounds: [1, 2] }] }));
});
