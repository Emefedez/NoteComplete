// Copied items as a picture that keeps them: the PNG of a copy carries the copy itself (lines,
// pictures, prefabs with their spec) in an iTXt chunk with the keyword "NoteComplete". Other
// apps show the picture and ignore the chunk; pasting, dropping or importing the PNG back into
// NoteComplete finds it and puts the items back, editable.
//
// The chunk's text is JSON, deflated (zlib, as PNG wants): { format, version, clip }.

export const CLIP_KEYWORD = "NoteComplete";
export const CLIP_FORMAT = "notecomplete-clip";
export const CLIP_VERSION = 1;
// Above this much JSON the picture goes without the items (it still pastes as a picture).
export const CLIP_MAX_BYTES = 16 * 1024 * 1024;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const encoder = new TextEncoder(), decoder = new TextDecoder();

let table = null;
export function crc32(bytes, crc = 0xffffffff) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}
const finishCrc = (crc) => (crc ^ 0xffffffff) >>> 0;

export function isPng(bytes) {
  return bytes?.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

// The chunks of a PNG: { type, start (of the length field), end, data, crcOk }.
function chunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at), end = at + 12 + length;
    if (end > bytes.length) break;
    const typeAndData = bytes.subarray(at + 4, at + 8 + length);
    const type = decoder.decode(typeAndData.subarray(0, 4));
    out.push({ type, start: at, end, data: typeAndData.subarray(4), crcOk: finishCrc(crc32(typeAndData)) === view.getUint32(at + 8 + length) });
    if (type === "IEND") break;
    at = end;
  }
  return out;
}

async function pipe(bytes, stream, max = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); throw Error("Too large."); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(encoder.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, finishCrc(crc32(out.subarray(4, 8 + data.length))));
  return out;
}

const isClipChunk = (c) => c.type === "iTXt" && decoder.decode(c.data.subarray(0, CLIP_KEYWORD.length + 1)) === CLIP_KEYWORD + "\0";

// `png` with `clip` in a NoteComplete chunk just before IEND (any earlier one taken out).
// Returns the PNG unchanged when it is not one or when the copy is too large to carry.
export async function addClipChunk(png, clip, { max = CLIP_MAX_BYTES } = {}) {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  if (!isPng(bytes)) return bytes;
  const list = chunks(bytes), iend = list.find((c) => c.type === "IEND");
  if (!iend) return bytes;
  const json = encoder.encode(JSON.stringify({ format: CLIP_FORMAT, version: CLIP_VERSION, clip }));
  if (json.length > max) return bytes;
  const text = await pipe(json, new CompressionStream("deflate"));
  // keyword \0, compressed 1, method 0 (zlib), language tag "" \0, translated keyword "" \0, text.
  const head = encoder.encode(CLIP_KEYWORD + "\0\x01\x00\0\0");
  const data = new Uint8Array(head.length + text.length);
  data.set(head);
  data.set(text, head.length);
  const parts = [bytes.subarray(0, 8)];
  for (const c of list) if (c !== iend && !isClipChunk(c)) parts.push(bytes.subarray(c.start, c.end));
  parts.push(chunk("iTXt", data), bytes.subarray(iend.start, iend.end));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The copy carried by a PNG, or null (not a PNG, no chunk, a damaged one, a newer format).
export async function readClipChunk(png, { max = CLIP_MAX_BYTES } = {}) {
  try {
    const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
    if (!isPng(bytes)) return null;
    for (const c of chunks(bytes)) {
      if (!c.crcOk || !isClipChunk(c)) continue;
      const d = c.data, k = CLIP_KEYWORD.length + 1, compressed = d[k] === 1;
      if (compressed && d[k + 1] !== 0) continue;
      let at = k + 2;
      at = d.indexOf(0, at) + 1; // language tag
      if (!at) continue;
      at = d.indexOf(0, at) + 1; // translated keyword
      if (!at) continue;
      const text = compressed ? await pipe(d.subarray(at), new DecompressionStream("deflate"), max) : d.subarray(at);
      if (text.length > max) continue;
      const value = JSON.parse(decoder.decode(text));
      if (value?.format !== CLIP_FORMAT || !(value.version <= CLIP_VERSION) || !value.clip) continue;
      return value.clip;
    }
  } catch { /* Not ours, or damaged: a plain picture. */ }
  return null;
}

// A clip read from a picture, checked for what pasting it needs.
export function validClip(clip) {
  return !!clip && Array.isArray(clip.lines) && Array.isArray(clip.images) && (clip.lines.length + clip.images.length) > 0
    && clip.lines.every((l) => Array.isArray(l?.points)) && clip.images.every((i) => Array.isArray(i?.bounds) && i.bounds.length === 4);
}
