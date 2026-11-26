// Archive files (.zip, .tar, .tar.gz/.tgz, .gz) read in memory and never extracted to disk:
// their contents listed as a tree, every entry checked (CRC-32 for zip and gzip, header
// checksums for tar), and one entry's bytes when it is opened or saved. (Not the Internet
// Archive, which is archive-client.js.) No page or app state here: archive.test.mjs runs it.
//
// Guards: decompression is streamed (DecompressionStream) and stopped as soon as an entry
// gives more than it says it holds, or the whole archive more than `maxTotal`; entries that
// would expand past `maxEntry`, or that expand suspiciously far (`maxRatio`), are not unpacked.
// Names that point outside the archive (../, /abs, C:\) are listed as unsafe and never opened.
import { crc32 } from './zip.js';
import { isTextName, isOfficeName, isImageName, isAudioName, isVideoName } from './text-types.js';

const MB = 1048576;
export const LIMITS = Object.freeze({
  maxTotal: 2048 * MB, // all entries checked, together
  maxEntry: 512 * MB, // one entry unpacked into memory
  maxRatio: 1000, // expansion beyond which a large entry is suspected to be a bomb…
  ratioFloor: 64 * MB, // …when it would also be at least this big
  maxEntries: 100000,
});

const ARCHIVE_NAME = /\.(zip|tar|tgz|tar\.gz|gz|7z|rar)$/i;
// Formats that are zips or tars inside but are documents the app opens as such.
const DOCUMENT_NAME = /\.(noteful|nfedit|notepart|notecomp|notecomplete|goodnotes|ntb|rnote|docx|docm|dotx|xlsx|xlsm|xlsb|pptx|pptm|odt|ods|odp|epub)$/i;
const NOTE_NAME = /\.(noteful|nfedit|notepart|notecomp|notecomplete|goodnotes|ntb|rnote)$/i;

export const formatLabel = { zip: 'ZIP', tar: 'Tar', tgz: 'Tar + gzip', gz: 'gzip', '7z': '7-Zip', rar: 'RAR' };

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to));
// A NoteComplete package (.notecomplete is a tar; old ones were saved as .tar too): its first
// member is manifest.json or note.noteful. Those still open as notes.
export function isNotePackageTar(bytes) {
  if (!bytes || bytes.length < 512 || ascii(bytes, 257, 262) !== 'ustar') return false;
  const end = bytes.subarray(0, 100).indexOf(0);
  const first = ascii(bytes, 0, end < 0 ? 100 : end);
  return first === 'manifest.json' || first === 'note.noteful' || first === './note.noteful';
}

// The archive format of a file, from its name (and its first bytes, `head`, when given):
// 'zip', 'tar', 'tgz', 'gz', '7z', 'rar', or '' for anything else (notes, Office files…).
export function archiveFormat(name, head = null) {
  const n = String(name || '');
  if (DOCUMENT_NAME.test(n)) return '';
  const b = head || new Uint8Array(0);
  if (/\.(tgz|tar\.gz)$/i.test(n)) return 'tgz';
  if (/\.gz$/i.test(n)) return 'gz';
  if (/\.tar$/i.test(n)) return head && isNotePackageTar(b) ? '' : 'tar';
  if (/\.zip$/i.test(n)) return 'zip';
  if (/\.7z$/i.test(n)) return '7z';
  if (/\.rar$/i.test(n)) return 'rar';
  // By content alone (a download without its extension): only the unmistakable ones.
  if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
  if (ascii(b, 0, 4) === 'Rar!') return 'rar';
  return '';
}
export const isArchiveName = (name) => ARCHIVE_NAME.test(String(name || '')) && !DOCUMENT_NAME.test(String(name || ''));

export function unsupportedMessage(format) {
  if (format === '7z') return '7-Zip archives (.7z) cannot be opened here: NoteComplete has no 7-Zip decoder built in. Extract it with 7-Zip or your system’s archive tool, or repack it as .zip.';
  if (format === 'rar') return 'RAR archives cannot be opened here: RAR is a closed format with no decoder built into NoteComplete. Extract it with your system’s archive tool, or repack it as .zip.';
  return '';
}

// What NoteComplete can open from inside an archive: 'note', 'pdf', 'image', 'html', 'office',
// 'text', 'archive', or '' (listed greyed, with its type).
export function entryKind(name) {
  const n = String(name || '').split('/').pop();
  if (!n) return '';
  if (NOTE_NAME.test(n)) return 'note';
  if (/\.pdf$/i.test(n)) return 'pdf';
  if (isImageName(n)) return 'image';
  if (/\.html?$/i.test(n)) return 'html';
  if (isAudioName(n)) return 'audio';
  if (isVideoName(n)) return 'video';
  if (isOfficeName(n)) return 'office';
  if (isArchiveName(n)) return /\.(7z|rar)$/i.test(n) ? '' : 'archive';
  if (isTextName(n)) return 'text';
  return '';
}
export function typeLabel(name) {
  const n = String(name || '').split('/').pop(), ext = /\.([^.]+)$/.exec(n)?.[1];
  if (/\.(tgz|tar\.gz)$/i.test(n)) return 'Tar + gzip archive';
  const known = {
    pdf: 'PDF', png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', webp: 'WebP image', gif: 'GIF image', bmp: 'BMP image', svg: 'SVG image', avif: 'AVIF image', ico: 'ICO image',
    mp3: 'MP3 audio', m4a: 'M4A audio', wav: 'WAV audio', ogg: 'OGG audio', oga: 'OGG audio', opus: 'Opus audio', flac: 'FLAC audio', aac: 'AAC audio', weba: 'WebM audio',
    mp4: 'MP4 video', m4v: 'M4V video', webm: 'WebM video', mkv: 'MKV video', mov: 'MOV video', avi: 'AVI video', ogv: 'OGV video',
    noteful: 'Noteful note', nfedit: 'NoteComplete project', goodnotes: 'Goodnotes notebook', ntb: 'Notability notebook', rnote: 'Rnote note',
    zip: 'ZIP archive', tar: 'Tar archive', gz: 'gzip file', '7z': '7-Zip archive', rar: 'RAR archive',
    html: 'HTML page', htm: 'HTML page',
    docx: 'Word document', docm: 'Word document', dotx: 'Word template', doc: 'Word document', rtf: 'Rich Text document',
    odt: 'OpenDocument text', fodt: 'OpenDocument text',
    xlsx: 'Excel workbook', xlsm: 'Excel workbook', xlsb: 'Excel workbook', xls: 'Excel workbook',
    ods: 'OpenDocument spreadsheet', fods: 'OpenDocument spreadsheet',
    pptx: 'PowerPoint presentation', pptm: 'PowerPoint presentation', ppt: 'PowerPoint presentation', odp: 'OpenDocument presentation',
    epub: 'EPUB e-book', ipynb: 'Jupyter notebook',
  };
  if (ext && known[ext.toLowerCase()]) return known[ext.toLowerCase()];
  return ext ? `${ext.toUpperCase().slice(0, 8)} file` : 'File';
}

// A stored name made safe to show: / separators, no empty or "." parts. `unsafe` when it
// would point outside the archive if it were extracted (../, an absolute path, a drive).
export function safeEntryPath(raw) {
  const text = String(raw ?? '').replace(/\\/g, '/');
  const parts = text.split('/');
  const unsafe = text.startsWith('/') || /^[a-zA-Z]:/.test(text) || parts.includes('..') || text.includes('\0');
  const clean = parts.filter((p) => p && p !== '.' && p !== '..').join('/').replace(/\0/g, '');
  return { path: clean.replace(/^[a-zA-Z]:\/?/, '') || '(unnamed)', unsafe };
}

class LimitError extends Error {}
// Inflates `bytes` (format: 'deflate-raw' or 'gzip') piece by piece, giving each piece to
// `onChunk`; stops with a LimitError past `limit` bytes. Resolves to the size made.
async function inflate(bytes, format, limit, onChunk, signal) {
  if (typeof DecompressionStream !== 'function') throw Error('This browser cannot decompress archives (no DecompressionStream).');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason || Error('Cancelled.');
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.length;
      if (total > limit) throw new LimitError(String(total));
      onChunk(value);
    }
  } finally {
    reader.cancel().catch(() => { /* Already finished or failed. */ });
  }
}
const join = (chunks, size) => {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
};
export const formatSize = (n) => {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
  return `${(n / 1024 / MB).toFixed(1)} GB`;
};

// ---- zip ----
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function zipName(bytes, utf8) {
  if (!utf8) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Old DOS names. */ }
    return Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : CP437[b - 128])).join('');
  }
  return new TextDecoder().decode(bytes);
}
const dosDate = (date, time) => {
  if (!date) return null;
  const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) ? null : d;
};
const u64 = (view, at) => Number(view.getBigUint64(at, true));

function findEnd(bytes, view) {
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}
// The zip's central directory: every entry with what it says about itself.
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), problems = [];
  const end = bytes.length >= 22 ? findEnd(bytes, view) : -1;
  if (end < 0) return scanLocal(bytes, view, problems);
  let count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  let zip64 = false;
  if ((count === 0xffff || size === 0xffffffff || offset === 0xffffffff) && end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) {
    const at = u64(view, end - 12);
    if (at + 56 <= bytes.length && view.getUint32(at, true) === 0x06064b50) {
      count = u64(view, at + 32); size = u64(view, at + 40); offset = u64(view, at + 48); zip64 = true;
    } else problems.push('Its zip64 end record is missing or damaged.');
  }
  // Bytes before the archive (a self-extracting stub): offsets are off by that much.
  const shift = Math.max(0, end - (zip64 ? 76 : 0) - size - offset);
  if (offset + shift + size > bytes.length) {
    problems.push('Its index (central directory) is past the end of the file: the file is cut short or damaged.');
    return scanLocal(bytes, view, problems);
  }
  const entries = [];
  let at = offset + shift;
  for (let i = 0; i < count && entries.length < LIMITS.maxEntries; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) { problems.push(`Its index is damaged after ${i} of ${count} entries.`); break; }
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    let packed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), local = view.getUint32(at + 42, true);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLen);
    let date = dosDate(view.getUint16(at + 14, true), view.getUint16(at + 12, true));
    // Extra fields: zip64 sizes and offset, and the exact Unix modification time.
    for (let e = at + 46 + nameLen, stop = Math.min(bytes.length, e + extraLen); e + 4 <= stop;) {
      const id = view.getUint16(e, true), len = view.getUint16(e + 2, true), data = e + 4;
      if (id === 0x0001) {
        let p = data;
        if (size === 0xffffffff && p + 8 <= data + len) { size = u64(view, p); p += 8; }
        if (packed === 0xffffffff && p + 8 <= data + len) { packed = u64(view, p); p += 8; }
        if (local === 0xffffffff && p + 8 <= data + len) { local = u64(view, p); p += 8; }
      } else if (id === 0x5455 && len >= 5 && (bytes[data] & 1)) {
        date = new Date(view.getUint32(data + 1, true) * 1000);
      }
      e = data + len;
    }
    const made = view.getUint16(at + 4, true) >> 8, attrs = view.getUint32(at + 38, true) >>> 16;
    entries.push({
      rawName: zipName(nameBytes, flags & 0x800), flags, method, packed, size, local: local + shift, date,
      crc: view.getUint32(at + 16, true),
      link: made === 3 && (attrs & 0o170000) === 0o120000,
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (count > LIMITS.maxEntries) problems.push(`Only the first ${LIMITS.maxEntries} of ${count} entries are listed.`);
  return { entries, problems, zip64 };
}
// No index (a download cut short): the entries are found from their own headers instead.
function scanLocal(bytes, view, problems) {
  problems.push('Its index (central directory) is missing: the file is cut short or damaged. Entries were found by scanning.');
  const entries = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50 && entries.length < LIMITS.maxEntries) {
    const flags = view.getUint16(at + 6, true), method = view.getUint16(at + 8, true);
    const nameLen = view.getUint16(at + 26, true), extraLen = view.getUint16(at + 28, true);
    const packed = view.getUint32(at + 18, true), size = view.getUint32(at + 22, true);
    entries.push({ rawName: zipName(bytes.subarray(at + 30, at + 30 + nameLen), flags & 0x800), flags, method, packed, size, local: at, crc: view.getUint32(at + 14, true), date: dosDate(view.getUint16(at + 12, true), view.getUint16(at + 10, true)), scanned: true });
    // Sizes written after the data (flag 8) are unknown here: nothing after it can be found.
    if (flags & 8) break;
    at += 30 + nameLen + extraLen + packed;
  }
  return { entries, problems, zip64: false };
}
// Where an entry's data starts, from its local header (whose extra field may differ).
function zipDataStart(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.local + 30 > bytes.length || view.getUint32(entry.local, true) !== 0x04034b50) return -1;
  return entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
}

// ---- tar ----
const octal = (bytes, from, len) => {
  if (bytes[from] & 0x80) { // base-256 (GNU, for sizes of 8 GB and more)
    let n = 0;
    for (let i = from + 1; i < from + len; i++) n = n * 256 + bytes[i];
    return n;
  }
  const text = ascii(bytes, from, from + len).replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
};
const cstring = (bytes, from, len) => {
  const slice = bytes.subarray(from, from + len), end = slice.indexOf(0);
  return new TextDecoder().decode(end < 0 ? slice : slice.subarray(0, end));
};
function tarChecksumOk(header) {
  const stored = octal(header, 148, 8);
  let unsigned = 0, signed = 0;
  for (let i = 0; i < 512; i++) {
    const b = i >= 148 && i < 156 ? 32 : header[i];
    unsigned += b; signed += b > 127 ? b - 256 : b;
  }
  return stored === unsigned || stored === signed;
}
function paxRecords(text) {
  const out = {};
  for (let i = 0; i < text.length;) {
    const space = text.indexOf(' ', i), len = parseInt(text.slice(i, space), 10);
    if (!(len > 0) || space < 0) break;
    const record = text.slice(space + 1, i + len - 1), eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}
// Tar members; `truncated`: the bytes end early (a tar.gz whose stream broke).
function tarEntries(bytes, { truncated = false } = {}) {
  const entries = [], problems = [];
  let at = 0, longName = '', pax = {}, ended = false;
  while (at + 512 <= bytes.length && entries.length < LIMITS.maxEntries) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) { ended = true; break; }
    if (!tarChecksumOk(header)) {
      entries.push({ rawName: cstring(header, 0, 100) || `(entry at byte ${at})`, kind: 'file', size: 0, status: 'damaged', problem: 'Its header checksum is wrong: this entry and everything after it cannot be trusted.' });
      problems.push(`The tar header at byte ${at} is damaged; nothing after it can be read.`);
      return { entries, problems };
    }
    const type = String.fromCharCode(header[156] || 48), size = octal(header, 124, 12);
    const dataAt = at + 512, next = dataAt + Math.ceil(size / 512) * 512;
    const complete = dataAt + size <= bytes.length;
    if (type === 'L' || type === 'x' || type === 'g' || type === 'K') {
      if (!complete) { problems.push('The archive ends inside a long-name record: it is cut short.'); break; }
      const text = new TextDecoder().decode(bytes.subarray(dataAt, dataAt + size));
      if (type === 'L') longName = text.replace(/\0+$/, '');
      if (type === 'x') pax = paxRecords(text);
      at = next;
      continue;
    }
    const prefix = ascii(header, 257, 262) === 'ustar' ? cstring(header, 345, 155) : '';
    const name = pax.path || longName || (prefix ? `${prefix}/` : '') + cstring(header, 0, 100);
    const realSize = pax.size ? Number(pax.size) : size;
    const kind = type === '5' ? 'dir' : type === '1' || type === '2' ? 'link' : /[0\x00 7]/.test(type) ? 'file' : 'other';
    const mtime = pax.mtime ? Number(pax.mtime) : octal(header, 136, 12);
    entries.push({
      rawName: name, kind, size: kind === 'file' ? realSize : 0, packed: kind === 'file' ? realSize : 0,
      date: mtime ? new Date(mtime * 1000) : null, dataAt,
      ...(kind === 'file' && !complete ? { status: 'damaged', problem: `Cut short: ${formatSize(Math.max(0, bytes.length - dataAt))} of ${formatSize(realSize)} are there.` } : {}),
    });
    longName = ''; pax = {};
    if (!complete) { problems.push('The archive ends in the middle of an entry: it is cut short.'); return { entries, problems }; }
    at = next;
  }
  if (!ended && !truncated && at + 512 > bytes.length && at < bytes.length) problems.push('The archive ends in the middle of a header: it is cut short.');
  if (!ended && !entries.length && !problems.length) problems.push('No tar entries found: this is not a tar archive.');
  return { entries, problems };
}

// ---- gzip ----
function gzipHeader(bytes) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) return null;
  const flags = bytes[3], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mtime = view.getUint32(4, true);
  let at = 10, name = '';
  if (flags & 4) at += 2 + view.getUint16(at, true);
  if (flags & 8) { const end = bytes.indexOf(0, at); name = String.fromCharCode(...bytes.subarray(at, end < 0 ? at : end)); at = end + 1; }
  return { name, date: mtime ? new Date(mtime * 1000) : null, crc: view.getUint32(bytes.length - 8, true), size: view.getUint32(bytes.length - 4, true) };
}
// The whole gzip stream, checked (CRC-32 and length from its trailer), up to `limit` bytes.
async function gunzip(bytes, limit, signal) {
  const header = gzipHeader(bytes);
  if (!header) return { header: null, problem: 'Not a gzip file (its first bytes are wrong).' };
  const chunks = [];
  let crc = 0, size = 0, problem = '';
  try {
    size = await inflate(bytes, 'gzip', limit, (c) => { chunks.push(c); crc = crc32(c, crc); }, signal);
    if (crc !== header.crc || (size >>> 0) !== header.size) problem = 'Its CRC-32 does not match: the contents are damaged.';
  } catch (error) {
    if (error instanceof LimitError) return { header, refused: `It expands past ${formatSize(limit)}: not unpacked (it may be a decompression bomb).` };
    if (signal?.aborted) throw error;
    size = chunks.reduce((n, c) => n + c.length, 0);
    problem = 'Its compressed data is damaged or cut short.';
  }
  return { header, data: join(chunks, size), problem };
}

// Reads and checks an archive. `name` gives its format (see archiveFormat). Resolves to
// { name, format, entries, problems, summary } where each entry is
// { path, name, kind: 'file'|'dir'|'link'|'other', size, packed, date, status, problem, opens }
// with status 'ok', 'damaged', 'encrypted', 'unsupported', 'unsafe', 'refused' or 'unchecked'.
// `verify: false` lists only (no entry is unpacked; zip entries stay 'unchecked').
export async function readArchive(bytes, { name = '', format = '', limits = {}, signal = null, onProgress = () => {}, verify: check = true } = {}) {
  const lim = { ...LIMITS, ...limits };
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  format = format || archiveFormat(name, bytes) || (bytes[0] === 0x50 && bytes[1] === 0x4b ? 'zip' : '');
  if (format === '7z' || format === 'rar') { const e = Error(unsupportedMessage(format)); e.unsupported = format; throw e; }
  if (!format) throw Error(`${name || 'This file'} is not an archive NoteComplete can open (.zip, .tar, .tar.gz, .tgz, .gz).`);
  const archive = { name, format, entries: [], problems: [], bytes, data: null };
  let raw = [];
  if (format === 'zip') {
    if (bytes.length < 22 || (bytes[0] !== 0x50 && findEnd(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)) < 0))
      throw Error(`${name || 'This file'} is not a zip archive.`);
    const read = zipEntries(bytes);
    raw = read.entries; archive.problems.push(...read.problems); archive.zip64 = read.zip64;
  } else if (format === 'tar') {
    const read = tarEntries(bytes);
    raw = read.entries; archive.problems.push(...read.problems);
  } else {
    // gzip: one file (.gz) or a tar inside (.tgz).
    const out = await gunzip(bytes, format === 'gz' ? lim.maxEntry : lim.maxTotal, signal);
    if (!out.header) throw Error(`${name || 'This file'} is not a gzip file.`);
    if (format === 'gz') {
      const inner = out.header.name || String(name).split('/').pop().replace(/\.gz$/i, '') || 'file';
      archive.data = out.data || null;
      raw = [{ rawName: inner, kind: 'file', size: out.data?.length ?? out.header.size, packed: bytes.length, date: out.header.date,
        status: out.refused ? 'refused' : out.problem ? 'damaged' : 'ok', problem: out.refused || out.problem || '', gz: true }];
    } else {
      if (out.refused) { archive.problems.push(out.refused); raw = []; }
      else {
        if (out.problem) archive.problems.push(`The gzip stream: ${out.problem}`);
        archive.data = out.data;
        const read = tarEntries(out.data, { truncated: !!out.problem });
        raw = read.entries; archive.problems.push(...read.problems);
        // A broken stream leaves the tar's last entries unreliable even when they are complete.
        if (out.problem) for (const e of raw) if (e.kind === 'file' && !e.status) { e.status = 'damaged'; e.problem = 'The compressed stream around it is damaged.'; }
      }
    }
  }
  for (const r of raw) {
    const { path, unsafe } = safeEntryPath(r.rawName);
    const dir = r.kind === 'dir' || (format === 'zip' && /\/$/.test(String(r.rawName).replace(/\\/g, '/')));
    const kind = dir ? 'dir' : r.link ? 'link' : r.kind || 'file';
    const entry = {
      path, name: path.split('/').pop(), rawName: r.rawName, kind,
      size: r.size || 0, packed: r.packed ?? r.size ?? 0, date: r.date || null,
      status: r.status || (kind === 'file' ? 'unchecked' : 'ok'), problem: r.problem || '',
      opens: '', _: r,
    };
    if (unsafe) { entry.status = 'unsafe'; entry.problem = 'Its name points outside the archive (../ or an absolute path): it is not opened.'; }
    else if (format === 'zip' && kind === 'file') {
      if (r.flags & 1 || r.method === 99) { entry.status = 'encrypted'; entry.problem = 'Encrypted: it needs a password, which NoteComplete does not ask for.'; }
      else if (r.method !== 0 && r.method !== 8) { entry.status = 'unsupported'; entry.problem = `Compressed with a method NoteComplete cannot unpack (${zipMethod(r.method)}).`; }
    }
    if (kind === 'link') entry.problem ||= 'A link to another file.';
    entry.opens = kind === 'file' && ['ok', 'unchecked'].includes(entry.status) ? entryKind(path) : '';
    archive.entries.push(entry);
  }
  if (check) await verify(archive, lim, signal, onProgress);
  for (const e of archive.entries) if (e.kind === 'file' && !['ok', 'unchecked', 'refused'].includes(e.status)) e.opens = '';
  archive.summary = archiveSummary(archive);
  return archive;
}
const zipMethod = (m) => ({ 1: 'Shrink', 6: 'Implode', 9: 'Deflate64', 12: 'bzip2', 14: 'LZMA', 19: 'LZ77', 93: 'Zstandard', 95: 'XZ', 96: 'JPEG', 97: 'WavPack', 98: 'PPMd' })[m] || `method ${m}`;

// Each zip entry unpacked (streamed, never kept) and its CRC-32 compared; tar entries were
// checked by their headers (tar keeps no checksum of the contents).
async function verify(archive, lim, signal, onProgress) {
  const files = archive.entries.filter((e) => e.kind === 'file' && e.status === 'unchecked');
  const total = files.reduce((n, e) => n + e.size, 0);
  let done = 0, made = 0;
  for (const entry of files) {
    if (signal?.aborted) throw signal.reason || Error('Cancelled.');
    if (archive.format !== 'zip') { entry.status = 'ok'; continue; }
    const r = entry._;
    if (entry.size > lim.maxEntry) { refuse(entry, `It would expand to ${formatSize(entry.size)}, more than NoteComplete unpacks at once (${formatSize(lim.maxEntry)}).`); continue; }
    if (r.packed > 0 && entry.size / r.packed > lim.maxRatio && entry.size >= lim.ratioFloor) { refuse(entry, `It would expand ${Math.round(entry.size / r.packed)} times to ${formatSize(entry.size)}: this looks like a decompression bomb, so it is not unpacked.`); continue; }
    if (made + entry.size > lim.maxTotal) { entry.problem = `Not checked: the archive holds more than ${formatSize(lim.maxTotal)}.`; continue; }
    const result = await checkZipEntry(archive.bytes, r, Math.min(lim.maxEntry, lim.maxTotal - made), signal);
    made += result.size;
    entry.status = result.status; entry.problem = result.problem || '';
    done += entry.size;
    onProgress(done, total);
  }
}
function refuse(entry, why) { entry.status = 'refused'; entry.problem = why; }
// Unpacks one zip entry (into `sink` when given) and checks it: { status, problem, size }.
async function checkZipEntry(bytes, r, limit, signal, sink = null) {
  const start = zipDataStart(bytes, r);
  if (start < 0) return { status: 'damaged', problem: 'Its local header is missing: the archive is damaged here.', size: 0 };
  if (start + r.packed > bytes.length) return { status: 'damaged', problem: `Cut short: ${formatSize(Math.max(0, bytes.length - start))} of ${formatSize(r.packed)} are there.`, size: 0 };
  const data = bytes.subarray(start, start + r.packed);
  if (r.method === 0) {
    if (r.packed !== r.size) return { status: 'damaged', problem: 'Its stored size and length disagree.', size: 0 };
    sink?.(data);
    return crc32(data) === r.crc ? { status: 'ok', size: data.length } : { status: 'damaged', problem: 'Its CRC-32 does not match: the contents are damaged.', size: data.length };
  }
  let crc = 0, size = 0;
  try {
    // Never more than it says it holds (+1 to notice that it lies).
    size = await inflate(data, 'deflate-raw', Math.min(limit, r.size), (c) => { crc = crc32(c, crc); sink?.(c); }, signal);
  } catch (error) {
    if (error instanceof LimitError) {
      return Number(error.message) > r.size
        ? { status: 'damaged', problem: `It expands past its stated size (${formatSize(r.size)}): damaged, or built to fool unpackers.`, size: r.size }
        : { status: 'refused', problem: `It expands past ${formatSize(limit)}: not unpacked.`, size: limit };
    }
    if (signal?.aborted) throw error;
    return { status: 'damaged', problem: 'Its compressed data is damaged or cut short.', size };
  }
  if (size !== r.size) return { status: 'damaged', problem: `It unpacks to ${formatSize(size)} instead of ${formatSize(r.size)}.`, size };
  return crc === r.crc ? { status: 'ok', size } : { status: 'damaged', problem: 'Its CRC-32 does not match: the contents are damaged.', size };
}

// One entry's bytes, checked again; throws when it cannot be given (damaged, encrypted…).
export async function extractEntry(archive, entry, { limits = {}, signal = null } = {}) {
  const lim = { ...LIMITS, ...limits };
  if (entry.kind !== 'file') throw Error(`${entry.name} is not a file.`);
  if (['unsafe', 'encrypted', 'unsupported', 'damaged'].includes(entry.status)) throw Error(`${entry.name}: ${entry.problem || entry.status}`);
  if (entry.size > lim.maxEntry) throw Error(`${entry.name} is ${formatSize(entry.size)}: more than NoteComplete unpacks at once (${formatSize(lim.maxEntry)}).`);
  const r = entry._;
  if (archive.format === 'gz') {
    if (!archive.data) throw Error(`${entry.name}: ${entry.problem || 'not unpacked.'}`);
    return archive.data.slice();
  }
  if (archive.format === 'tar' || archive.format === 'tgz') {
    const source = archive.format === 'tar' ? archive.bytes : archive.data;
    return source.slice(r.dataAt, r.dataAt + entry.size);
  }
  if (entry.status === 'refused') {
    // Asked for on purpose: still never past its stated size or the per-entry cap.
    if (r.packed > 0 && entry.size / r.packed > lim.maxRatio && entry.size >= lim.ratioFloor) throw Error(`${entry.name}: ${entry.problem}`);
  }
  // Stored entries are copied once; deflated ones are joined from their pieces.
  const chunks = [];
  let stored = null;
  const result = await checkZipEntry(archive.bytes, r, lim.maxEntry, signal, (c) => (r.method === 0 ? (stored = c) : chunks.push(c)));
  if (result.status !== 'ok') throw Error(`${entry.name}: ${result.problem}`);
  return stored ? stored.slice() : join(chunks, result.size);
}

// "12 files, all intact" or what is wrong, for the window's summary line.
export function archiveSummary(archive) {
  const files = archive.entries.filter((e) => e.kind === 'file');
  const by = (s) => files.filter((e) => e.status === s);
  const damaged = by('damaged'), encrypted = by('encrypted'), unsafe = archive.entries.filter((e) => e.status === 'unsafe');
  const refused = by('refused'), unsupported = by('unsupported'), unchecked = by('unchecked');
  const n = files.length, plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const names = (list) => list.slice(0, 3).map((e) => e.name).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  const parts = [];
  if (damaged.length) parts.push(`${damaged.length} damaged: ${names(damaged)}`);
  if (unsafe.length) parts.push(`${unsafe.length} with unsafe names: ${names(unsafe)}`);
  if (refused.length) parts.push(`${refused.length} not unpacked (too large or suspicious): ${names(refused)}`);
  if (encrypted.length) parts.push(`${encrypted.length} encrypted`);
  if (unsupported.length) parts.push(`${unsupported.length} in a compression NoteComplete cannot check`);
  if (unchecked.length) parts.push(`${unchecked.length} not checked`);
  const broken = damaged.length + unsafe.length > 0 || archive.problems.length > 0;
  const head = plural(n, 'file');
  let text;
  if (!parts.length && !archive.problems.length) {
    text = n ? `${head}, all intact` : 'Empty archive';
    if (n && (archive.format === 'tar')) text += ' (tar keeps no checksums of contents: headers checked)';
  } else text = `${head}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
  return { ok: !broken && !refused.length, broken, text, problems: [...archive.problems], damaged: damaged.map((e) => e.path) };
}

// The entries as a tree of folders: { name, path, dir: true, children: [...], entry? } with
// folders first, then files, by name (numbers in order). Folders named only by their files
// are made up; a folder entry's date is kept.
export function archiveTree(entries) {
  const root = { name: '', path: '', dir: true, children: [], index: new Map() };
  const folder = (path) => {
    let node = root;
    for (const part of path ? path.split('/') : []) {
      let next = node.index.get(`d:${part}`);
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, dir: true, children: [], index: new Map() };
        node.index.set(`d:${part}`, next);
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const entry of entries) {
    if (entry.kind === 'dir') { folder(entry.path).entry = entry; continue; }
    const at = entry.path.lastIndexOf('/');
    folder(at < 0 ? '' : entry.path.slice(0, at)).children.push({ name: entry.name, path: entry.path, dir: false, entry });
  }
  const sort = (a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1);
  const finish = (node) => {
    delete node.index;
    node.children.sort(sort);
    for (const c of node.children) if (c.dir) finish(c);
    // What a folder holds (files and problems), for its row.
    node.files = node.children.reduce((n, c) => n + (c.dir ? c.files : 1), 0);
    node.size = node.children.reduce((n, c) => n + (c.dir ? c.size : c.entry.size), 0);
    node.bad = node.children.reduce((n, c) => n + (c.dir ? c.bad : ['damaged', 'unsafe'].includes(c.entry.status) ? 1 : 0), 0);
    return node;
  };
  return finish(root);
}

// ---- Goodnotes ----
// A Goodnotes notebook is itself a zip whose root holds index.notes.pb, schema.pb, notes/…
// `prefix`: the folder inside an archive to look at ('' for its root).
export function looksLikeGoodnotes(entries, prefix = '') {
  const base = prefix ? `${prefix}/` : '';
  const has = (p) => entries.some((e) => e.path === base + p);
  return has('index.notes.pb') && (has('schema.pb') || entries.some((e) => e.path.startsWith(`${base}notes/`)));
}
// The notebook's name without ".goodnotes.zip" / ".zip".
export const notebookTitle = (name) => String(name || 'Notebook').split('/').pop().replace(/\.zip$/i, '').replace(/\.goodnotes$/i, '') || 'Notebook';
const NOTEBOOK_FILE = /\.(goodnotes|ntb)(\.zip)?$/i;
// The notebooks an archive holds, keeping their folders: { path, name, kind: 'file' | 'folder' |
// 'archive', entry? } where 'folder' is a notebook stored unzipped (its own folder) and
// 'archive' a nested .zip that may hold more (looked into by the caller).
export function notebooksIn(archive) {
  const out = [], folders = new Set();
  const dirs = new Set();
  for (const e of archive.entries) {
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    if (e.kind === 'dir') dirs.add(e.path);
  }
  for (const d of [...dirs].sort()) {
    if ([...folders].some((f) => d.startsWith(`${f}/`))) continue;
    if (looksLikeGoodnotes(archive.entries, d)) { folders.add(d); out.push({ path: d, name: d.split('/').pop(), kind: 'folder' }); }
  }
  for (const e of archive.entries) {
    if (e.kind !== 'file' || e.status === 'unsafe' || [...folders].some((f) => e.path.startsWith(`${f}/`))) continue;
    if (NOTEBOOK_FILE.test(e.name)) out.push({ path: e.path, name: e.name, kind: 'file', entry: e });
    else if (/\.zip$/i.test(e.name)) out.push({ path: e.path, name: e.name, kind: 'archive', entry: e });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}
// A notebook stored as a folder inside the archive, zipped again (stored) so it opens as a
// .goodnotes file: its entries are unpacked one at a time.
export async function packFolder(archive, folder, { zipFiles, limits = {}, signal = null, onProgress = () => {} } = {}) {
  const base = `${folder}/`, members = archive.entries.filter((e) => e.kind === 'file' && e.path.startsWith(base));
  const total = members.reduce((n, e) => n + e.size, 0), files = [];
  let done = 0;
  for (const e of members) {
    files.push({ name: e.path.slice(base.length), bytes: await extractEntry(archive, e, { limits, signal }) });
    done += e.size; onProgress(done, total);
  }
  return zipFiles(files);
}
