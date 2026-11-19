// The container of the Chinese data packs (vendor/chinese/*.bin), written by
// tools/build_chinese_data.mjs and read by engine.js / convert.js. Little-endian:
//   0  "NCZH"   4  u8 version (1)   5  u8 0   6  u16 section count n
//   8  n × (u32 offset, u32 byte length), then the sections, each starting on a 4-byte boundary.
// Section 0 is UTF-8 JSON (meta: kind, id, counts, the field names); the others are columns:
// u8/u16/u32 arrays with one value per row, or a string column = a lengths array (u8 or u16,
// UTF-16 code units, one per row) + a UTF-8 blob of the strings one after another.
// The layout of each kind is documented in docs/CHINESE-INPUT.md §4.3.

export const MAGIC = 0x485a434e; // "NCZH" read as a little-endian u32

export function readContainer(bytes) {
  let u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (u8.byteOffset % 4) u8 = u8.slice();
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a Chinese data pack');
  if (view.getUint8(4) !== 1) throw new Error(`Chinese data pack version ${view.getUint8(4)} is not supported`);
  const count = view.getUint16(6, true), sections = [];
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(8 + i * 8, true), length = view.getUint32(12 + i * 8, true);
    if (offset + length > u8.byteLength) throw new Error('Chinese data pack is truncated');
    sections.push(u8.subarray(offset, offset + length));
  }
  const decoder = new TextDecoder();
  const meta = JSON.parse(decoder.decode(sections[0]));
  const typed = (i, Type) => { const s = sections[i]; return new Type(s.buffer, s.byteOffset, s.byteLength / Type.BYTES_PER_ELEMENT); };
  return {
    meta, sections,
    u8: i => sections[i], u16: i => typed(i, Uint16Array), u32: i => typed(i, Uint32Array),
    // A string column: lengths in section i (u8 or u16 by its byte size per row), blob in i+1.
    strings: (i, rows) => stringColumn(sections[i].byteLength === rows ? sections[i] : typed(i, Uint16Array), decoder.decode(sections[i + 1])),
  };
}

// Row r of a string column is text.slice(start[r], start[r + 1]).
export function stringColumn(lengths, text) {
  const start = new Uint32Array(lengths.length + 1);
  for (let i = 0; i < lengths.length; i++) start[i + 1] = start[i] + lengths[i];
  if (start[lengths.length] !== text.length) throw new Error('Chinese data pack: string column does not match its lengths');
  return { get: r => text.slice(start[r], start[r + 1]), length: r => lengths[r], text, start };
}

// Writer (build script and test fixtures). sections: Uint8Array | typed array | string | object (meta).
export function writeContainer(meta, columns) {
  const encoder = new TextEncoder();
  const parts = [encoder.encode(JSON.stringify(meta)), ...columns.map(c => typeof c === 'string' ? encoder.encode(c) : new Uint8Array(c.buffer, c.byteOffset, c.byteLength))];
  let at = 8 + parts.length * 8;
  const offsets = parts.map(p => { at = (at + 3) & ~3; const o = at; at += p.byteLength; return o; });
  const out = new Uint8Array(at), view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true); view.setUint8(4, 1); view.setUint16(6, parts.length, true);
  parts.forEach((p, i) => { view.setUint32(8 + i * 8, offsets[i], true); view.setUint32(12 + i * 8, p.byteLength, true); out.set(p, offsets[i]); });
  return out;
}

// A string column for writeContainer: [lengths, blob]; u8 lengths when every string fits.
export function encodeStrings(list, wide = list.some(s => s.length > 255)) {
  const lengths = wide ? new Uint16Array(list.length) : new Uint8Array(list.length);
  list.forEach((s, i) => { if (s.length > (wide ? 65535 : 255)) throw new Error(`string too long: ${s.slice(0, 20)}…`); lengths[i] = s.length; });
  return [lengths, list.join('')];
}
