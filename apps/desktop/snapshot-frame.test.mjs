// The snapshot frame is the wire format between the hub (collab-hub.js) and every reader
// (reader sync.js), written once in each package. These tests keep the two the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as hub from './collab-hub.js';
import * as reader from '../reader/sync.js';

const bytes = (text) => new TextEncoder().encode(text);
const CASES = [
  ['an empty payload', { req: 1, gen: 0, seq: 0 }, new Uint8Array(0)],
  ['a small payload', { gen: 3, seq: 41, title: 'Notes' }, bytes('{"history":[],"cursor":0}')],
  ['a header with non-ASCII text', { gen: 7, seq: 2, title: 'Álgebra — tema 3 · 数学 📓 “ñ”', enc: 'gzip' }, bytes('añadido ✓')],
  ['an empty header', {}, bytes('x')],
  ['binary bytes', { gen: 1, seq: 9 }, new Uint8Array(randomBytes(4096))],
];
const plain = (view) => [...view];

test('the hub and the reader write the same snapshot frame, byte for byte', () => {
  for (const [name, header, payload] of CASES) {
    const fromHub = hub.packSnapshot(header, payload), fromReader = reader.packSnapshot(header, payload);
    assert.deepEqual(plain(fromHub), plain(fromReader), name);
    // The frame: its kind, the header's length in bytes (big-endian), the header, the payload.
    const head = bytes(JSON.stringify(header));
    assert.equal(fromHub[0], reader.FRAME.snapshot, name);
    assert.equal(new DataView(fromReader.buffer, fromReader.byteOffset).getUint32(1), head.length, name);
    assert.equal(fromReader.length, 5 + head.length + payload.length, name);
  }
});

test('a snapshot packed by one is unpacked by the other, both ways', () => {
  for (const [name, header, payload] of CASES) {
    for (const [pack, unpack] of [[hub.packSnapshot, reader.unpackSnapshot], [reader.packSnapshot, hub.unpackSnapshot], [hub.packSnapshot, hub.unpackSnapshot], [reader.packSnapshot, reader.unpackSnapshot]]) {
      const out = unpack(pack(header, payload));
      assert.deepEqual(out.header, header, name);
      assert.deepEqual(plain(out.payload), plain(payload), name);
    }
  }
});

test('a frame inside a larger buffer (as a socket delivers it) is read from its own offset', () => {
  const [, header, payload] = CASES[2];
  for (const pack of [hub.packSnapshot, reader.packSnapshot]) {
    const frame = pack(header, payload), padded = new Uint8Array(frame.length + 16);
    padded.fill(0xff);
    padded.set(frame, 8);
    const view = padded.subarray(8, 8 + frame.length);
    for (const unpack of [hub.unpackSnapshot, reader.unpackSnapshot]) {
      const out = unpack(view);
      assert.deepEqual(out.header, header);
      assert.deepEqual(plain(out.payload), plain(payload));
    }
  }
});

test('the host’s reader packs its project text as the same bytes the hub would be given', () => {
  // Only the reader takes text (the host's snapshot); the hub always has bytes.
  const header = { req: 4, gen: 2, seq: 10 }, text = '{"title":"Química orgánica ⚗"}';
  assert.deepEqual(plain(reader.packSnapshot(header, text)), plain(hub.packSnapshot(header, bytes(text))));
  assert.equal(hub.unpackSnapshot(reader.packSnapshot(header, text)).payload.toString(), text);
});
