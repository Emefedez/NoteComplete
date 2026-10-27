// A note's own cover image, read with byte ranges instead of the whole archive.
// Noteful stores the index at the end and names its first-page JPEG in n:/7/1,
// usually right after the n: block, so a head and a tail read are normally enough.
const HEAD = 256 * 1024, TAIL = 64 * 1024;
const MAGIC = [0xaa, 0xbb, 0xcc, 0xde];
const FIXED = { 1: 1, 2: 8, 3: 4, 4: 8, 0x11: 2, 0x12: 4, 0x13: 8, 0x14: 4, 0x20: 8, 0x21: 16, 0x23: 32 };

// Just enough of the typed-field grammar (spec/noteful-v0.1.md) to walk the index
// and note metadata; unknown types stop the walk instead of guessing.
export function fields(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map();
  let at = 0;
  const scalar = kind => {
    if (FIXED[kind]) {
      const start = at;
      at += FIXED[kind];
      if (at > bytes.length) throw Error('Truncated field');
      switch (kind) {
        case 1: return view.getUint8(start);
        case 0x11: return view.getUint16(start);
        case 0x12: case 0x14: return view.getUint32(start);
        case 2: case 0x13: return Number(view.getBigUint64(start));
        case 3: return view.getFloat32(start);
        case 4: case 0x20: return view.getFloat64(start);
        default: return null; // Pairs and rects are skipped; nothing here needs them.
      }
    }
    if (kind < 5 || kind > 7) throw Error(`Unknown type 0x${kind.toString(16)}`);
    const n = view.getUint32(at); at += 4;
    if (at + n > bytes.length) throw Error('Truncated field');
    const raw = bytes.subarray(at, at + n); at += n;
    return kind === 5 ? new TextDecoder().decode(raw) : kind === 7 ? fields(raw) : raw;
  };
  while (at + 4 <= bytes.length) {
    const tag = view.getUint16(at), type = view.getUint16(at + 2);
    at += 4;
    let value;
    if (type & 0x400) {
      const count = view.getUint32(at); at += 4;
      if (count > bytes.length) throw Error('Array exceeds buffer');
      value = Array.from({ length: count }, () => scalar(type & 0xff));
    } else value = scalar(type & 0xff);
    if (type & 0x800) at += 8;
    out.set(tag, value);
  }
  return out;
}

// `read(start, end)` returns bytes [start, end) and may be called concurrently.
export async function noteCover(read, size) {
  if (!(size >= 20)) throw Error('Not a Noteful archive');
  const tailStart = Math.max(0, size - TAIL);
  const [head, tail] = await Promise.all([read(0, Math.min(HEAD, size)), read(tailStart, size)]);
  const slice = async (start, length) => {
    if (start + length <= head.length) return head.subarray(start, start + length);
    if (start >= tailStart) return tail.subarray(start - tailStart, start - tailStart + length);
    return read(start, start + length);
  };
  const trailer = new DataView(tail.buffer, tail.byteOffset + tail.length - 16, 16);
  if (MAGIC.some((b, i) => trailer.getUint8(i) !== b) || MAGIC.some((b, i) => head[i] !== b)) throw Error('Not a Noteful archive');
  const indexAt = Number(trailer.getBigUint64(4)), indexSize = trailer.getUint32(12);
  if (indexAt + indexSize !== size - 16) throw Error('Invalid index extent');
  const index = fields(await slice(indexAt, indexSize));
  const keys = index.get(10) || [], offsets = index.get(11) || [], lengths = index.get(12) || [];
  const block = id => { const i = keys.indexOf(id); return i < 0 ? null : [offsets[i], lengths[i]]; };
  const meta = keys.find(k => typeof k === 'string' && k.startsWith('n:'));
  if (!meta) return null;
  const cover = fields(await slice(...block(meta))).get(7)?.get?.(1);
  const extent = cover && block(cover);
  if (!extent) return null;
  const bytes = await slice(...extent);
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : '';
  return mime ? { bytes: bytes.slice(), mime } : null;
}

// Local files read the same way through Blob.slice, without loading the archive.
export function blobReader(blob) {
  return async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
}
