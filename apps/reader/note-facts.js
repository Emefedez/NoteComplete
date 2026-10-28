// Filterable facts about a note, read with byte ranges like its cover:
// title and recordings from the n: and d: blocks (d:/7/0: recordings with a
// duration in tag 6), and Noteful tags from the editable sets (object kind 19,
// names in payload tag 14) when those sets are small enough to fetch.
import { fields } from './note-cover.js';

const HEAD = 256 * 1024, TAIL = 64 * 1024, SET_BUDGET = 3 * 1024 * 1024;
const MAGIC = [0xaa, 0xbb, 0xcc, 0xde];
const get = (map, ...path) => path.reduce((v, k) => (v instanceof Map ? v.get(k) : undefined), map);

export async function noteFacts(read, size) {
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
  const index = fields(await slice(Number(trailer.getBigUint64(4)), trailer.getUint32(12)));
  const keys = index.get(10) || [], offsets = index.get(11) || [], lengths = index.get(12) || [];
  const extent = id => { const i = keys.indexOf(id); return i < 0 ? null : [offsets[i], lengths[i]]; };
  const facts = { title: '', pages: 0, audio: { count: 0, seconds: 0 }, tags: [] };
  const meta = keys.find(k => typeof k === 'string' && k.startsWith('n:'));
  if (meta) facts.title = fields(await slice(...extent(meta))).get(3) || '';
  const drawing = keys.find(k => typeof k === 'string' && k.startsWith('d:'));
  if (drawing) {
    const d = fields(await slice(...extent(drawing)));
    facts.pages = (get(d, 2, 0) || []).length;
    for (const r of get(d, 7, 0) || []) {
      const seconds = r instanceof Map ? r.get(6) : undefined;
      if (Number.isFinite(seconds)) { facts.audio.count++; facts.audio.seconds += seconds; }
    }
  }
  // Tags live on pages; fetch the editable sets only when they are small in total.
  const sets = (index.get(4) || []).map(extent).filter(Boolean);
  const total = sets.reduce((n, [, length]) => n + length, 0);
  if (total > SET_BUDGET) { facts.tags = null; return facts; }
  const names = new Set();
  for (let i = 0; i < sets.length; i += 6) {
    const blocks = await Promise.all(sets.slice(i, i + 6).map(([start, length]) => slice(start, length)));
    for (const bytes of blocks) {
      let set;
      try { set = fields(bytes); } catch { continue; }
      for (const record of get(set, 5, 0) || []) {
        if (!(record instanceof Map) || get(record, 6, 1) !== 19) continue;
        for (const name of get(record, 6, 14) || []) if (typeof name === 'string' && name.trim()) names.add(name.trim());
      }
    }
  }
  facts.tags = [...names].sort((a, b) => a.localeCompare(b));
  return facts;
}

// Stackable filters: every active kind must match; selected tags must all be present.
// File types, any combination: .notecomp and .notecomplete are one format; NotePart is the
// note with its Markdown (today's tar), NoteComp the full NoteComplete file.
export const TYPES = {
  pdf: ['PDF', /\.pdf$/i],
  html: ['HTML', /\.html?$/i],
  text: ['Text', /\.(txt|md|markdown)$/i],
  image: ['Image', /\.(png|jpe?g|webp)$/i],
  noteful: ['Noteful', /\.noteful$/i],
  notepart: ['NotePart', /\.notepart$/i],
  notecomp: ['NoteComp', /\.notecomp(lete)?$/i],
};
export const typeOf = name => Object.keys(TYPES).find(k => TYPES[k][1].test(name || '')) || '';
export function matches(note, filters) {
  const { since = 0, tags = [], audio = false, sizes = [], types = [] } = filters;
  if (types.length && !types.includes(typeOf(note.name))) return false;
  if (since && !(note.modified >= since)) return false;
  if (audio && !(note.facts?.audio?.count > 0)) return false;
  if (tags.length && !tags.every(t => note.facts?.tags?.includes(t))) return false;
  if (sizes.length && !sizes.some(s => inSize(note.size, s))) return false;
  return true;
}
export const SIZES = { small: ['Under 10 MB', 0, 10e6], medium: ['10–100 MB', 10e6, 100e6], large: ['Over 100 MB', 100e6, Infinity] };
const inSize = (bytes, key) => Number.isFinite(Number(bytes)) && Number(bytes) >= SIZES[key][1] && Number(bytes) < SIZES[key][2];
// Sorting: natural A–Z by default ("Tema 2" before "Tema 10").
export const SORTS = { name: 'A–Z', newest: 'Newest', oldest: 'Oldest', largest: 'Largest', smallest: 'Smallest' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareNotes(sort = 'name') {
  return (a, b) => {
    if (sort === 'newest') return (b.modified || 0) - (a.modified || 0);
    if (sort === 'oldest') return (a.modified || 0) - (b.modified || 0);
    if (sort === 'largest') return (b.size || 0) - (a.size || 0);
    if (sort === 'smallest') return (a.size || 0) - (b.size || 0);
    return collator.compare(a.title || a.name || '', b.title || b.name || '');
  };
}
export const PERIODS = { day: ['Today', 864e5], week: ['This week', 7 * 864e5], month: ['This month', 31 * 864e5], year: ['This year', 366 * 864e5] };
