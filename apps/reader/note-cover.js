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

// The archive's index, from a head and a tail read: `index` (its fields), `keys` (block
// names), `extent(id)` ([offset, length] of a block, or null) and `slice(start, length)`
// (bytes from what was already read when possible, otherwise another ranged read).
// `read(start, end)` returns bytes [start, end) and may be called concurrently.
export async function noteIndex(read, size) {
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
  const extent = id => { const i = keys.indexOf(id); return i < 0 ? null : [offsets[i], lengths[i]]; };
  return { index, keys, extent, slice };
}

export async function noteCover(read, size) {
  const { keys, extent: block, slice } = await noteIndex(read, size);
  const meta = keys.find(k => typeof k === 'string' && k.startsWith('n:'));
  if (!meta) return null;
  const cover = fields(await slice(...block(meta))).get(7)?.get?.(1);
  const extent = cover && block(cover);
  if (!extent) return null;
  const bytes = await slice(...extent);
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : '';
  return mime ? { bytes: bytes.slice(), mime } : null;
}

// A .notecomp/.notepart file is a tar holding note.noteful: walk the 512-byte headers with
// ranged reads to find that member, then read its cover in place. Null if not a tar or no note.
export async function archiveCover(read, size) {
  const text = bytes => new TextDecoder().decode(bytes).replace(/\0.*$/s, '');
  for (let at = 0, members = 0; at + 512 <= size && members < 256; members++) {
    const header = await read(at, at + 512);
    if (header.length < 512 || header.every(b => b === 0)) return null;
    if (text(header.subarray(257, 262)) !== 'ustar') return null;
    const length = parseInt(text(header.subarray(124, 136)).trim() || '0', 8);
    if (!Number.isFinite(length) || length < 0) return null;
    const prefix = text(header.subarray(345, 500)), name = text(header.subarray(0, 100));
    const path = prefix ? `${prefix}/${name}` : name, type = header[156];
    const start = at + 512;
    if ((type === 0 || type === 0x30) && /\.noteful$/i.test(path) && start + length <= size)
      return noteCover((a, b) => read(start + a, start + b), length);
    at = start + Math.ceil(length / 512) * 512;
  }
  return null;
}

// Local files read the same way through Blob.slice, without loading the archive.
export function blobReader(blob) {
  return async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// A Goodnotes or Notability notebook's own picture (thumbnail.jpg / thumbnail.png at its root,
// or in its one folder when the notebook was zipped as a folder), read from the zip with ranged
// reads: the end record, the central directory, then that one member. Null when the zip has no
// notebook (index.notes.pb or noteBundle beside the picture) or no picture.
const THUMBNAILS = ['thumbnail.jpg', 'thumbnail.jpeg', 'thumbnail.png'];
const NOTEBOOK_MARKS = ['index.notes.pb', 'noteBundle'];
export async function notebookCover(read, size) {
  if (!(size >= 22)) return null;
  const tailStart = Math.max(0, size - 22 - 65535);
  const tail = await read(tailStart, size);
  const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = view(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (t.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  let count = t.getUint16(end + 10, true), dirSize = t.getUint32(end + 12, true), dirAt = t.getUint32(end + 16, true);
  if ((count === 0xffff || dirSize === 0xffffffff || dirAt === 0xffffffff) && end >= 20 && t.getUint32(end - 20, true) === 0x07064b50) {
    // Zip64: the locator before the end record points at the zip64 end record.
    const at = Number(t.getBigUint64(end - 12, true));
    const z = view(await read(at, at + 56));
    if (z.getUint32(0, true) !== 0x06064b50) return null;
    count = Number(z.getBigUint64(32, true)); dirSize = Number(z.getBigUint64(40, true)); dirAt = Number(z.getBigUint64(48, true));
  }
  if (!(dirSize > 0) || dirAt + dirSize > size || dirSize > 32 * 1048576) return null;
  const dir = await read(dirAt, dirAt + dirSize), d = view(dir), entries = new Map();
  const decoder = new TextDecoder();
  for (let at = 0, n = 0; at + 46 <= dir.length && n < count; n++) {
    if (d.getUint32(at, true) !== 0x02014b50) return null;
    const method = d.getUint16(at + 10, true), nameLength = d.getUint16(at + 28, true);
    const extraLength = d.getUint16(at + 30, true), commentLength = d.getUint16(at + 32, true);
    let compressed = d.getUint32(at + 20, true), plain = d.getUint32(at + 24, true), local = d.getUint32(at + 42, true);
    const name = decoder.decode(dir.subarray(at + 46, at + 46 + nameLength));
    // Zip64 sizes and offset, in that order, for the fields that are 0xffffffff.
    for (let e = at + 46 + nameLength, stop = e + extraLength; e + 4 <= stop;) {
      const id = d.getUint16(e, true), length = d.getUint16(e + 2, true);
      if (id === 1) {
        let p = e + 4;
        if (plain === 0xffffffff) { plain = Number(d.getBigUint64(p, true)); p += 8; }
        if (compressed === 0xffffffff) { compressed = Number(d.getBigUint64(p, true)); p += 8; }
        if (local === 0xffffffff) local = Number(d.getBigUint64(p, true));
      }
      e += 4 + length;
    }
    entries.set(name, { method, compressed, plain, local });
    at += 46 + nameLength + extraLength + commentLength;
  }
  const folders = new Set([...entries.keys()].map((n) => (n.includes('/') ? n.slice(0, n.indexOf('/') + 1) : '')));
  const prefix = ['', ...(folders.size === 1 ? folders : [])].find((p) => NOTEBOOK_MARKS.some((m) => entries.has(p + m)));
  if (prefix === undefined) return null;
  const found = THUMBNAILS.map((n) => entries.get(prefix + n)).find(Boolean);
  if (!found || found.compressed > 8 * 1048576 || found.plain > 32 * 1048576 || ![0, 8].includes(found.method)) return null;
  const head = view(await read(found.local, found.local + 30));
  if (head.getUint32(0, true) !== 0x04034b50) return null;
  const start = found.local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  let bytes = await read(start, start + found.compressed);
  if (found.method === 8) {
    if (typeof DecompressionStream !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : '';
  return mime ? { bytes, mime } : null;
}

// A notebook's own picture kept as its cover until its first page is drawn (it is often the
// notebook's coloured cover, not a page): marked in the data URL, which still loads as is.
const NOTEBOOK_MARK = ';cover=notebook';
export const markNotebookCover = (url) => String(url || '').replace(/^data:([^;,]+)/, `data:$1${NOTEBOOK_MARK}`);
export const isNotebookCover = (url) => typeof url === 'string' && url.startsWith('data:') && url.slice(0, 64).includes(NOTEBOOK_MARK);
