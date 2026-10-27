import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { noteCover, fields } from './note-cover.js';

const folder = new URL('../../samples/', import.meta.url);
const samples = readdirSync(folder).filter(n => n.endsWith('.noteful'));

function ranged(bytes) {
  const calls = [];
  return { calls, read: async (start, end) => { calls.push([start, end]); return bytes.slice(start, end); } };
}

test('covers come from the head and tail ranges, never the whole archive', async () => {
  let found = 0;
  for (const name of samples) {
    const bytes = new Uint8Array(readFileSync(new URL(encodeURIComponent(name), folder)));
    const { calls, read } = ranged(bytes);
    const cover = await noteCover(read, bytes.length);
    if (!cover) continue;
    found++;
    assert.equal(cover.mime, 'image/jpeg', name);
    assert.deepEqual(cover.bytes.slice(0, 3), new Uint8Array([0xff, 0xd8, 0xff]), name);
    // Two reads in parallel for every sample; the large ones are never read in full.
    assert.equal(calls.length, 2, name);
    assert.ok(calls.reduce((n, [a, b]) => n + b - a, 0) <= 320 * 1024, name);
  }
  assert.ok(found >= 5);
});

test('a cover outside the head is fetched by its own range', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('Practice%20book%20(vol.%201).noteful', folder)));
  const { calls, read } = ranged(bytes);
  // Force a tiny head by wrapping the reader: the first request is truncated to 8 bytes.
  let first = true;
  const cover = await noteCover(async (a, b) => { if (first && a === 0) { first = false; return read(0, 8); } return read(a, b); }, bytes.length);
  assert.equal(cover.mime, 'image/jpeg');
  assert.ok(calls.length >= 3);
});

test('non-notes and damaged trailers are rejected without throwing on the reader', async () => {
  const junk = new Uint8Array(4096).fill(7);
  await assert.rejects(noteCover(ranged(junk).read, junk.length), /Not a Noteful archive/);
  await assert.rejects(noteCover(ranged(junk).read, 3), /Not a Noteful archive/);
});

test('field walker reads strings, arrays, nested records and clocks', () => {
  const enc = new TextEncoder().encode('n:x');
  const record = new Uint8Array([0, 10, 0x04, 0x05, 0, 0, 0, 1, 0, 0, 0, 3, ...enc, 0, 3, 0x08, 0x01, 9, 1, 2, 3, 4, 5, 6, 7, 8]);
  const parsed = fields(record);
  assert.deepEqual(parsed.get(10), ['n:x']);
  assert.equal(parsed.get(3), 9);
});
