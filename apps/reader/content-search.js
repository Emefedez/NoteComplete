// Search inside the notes of Recent without opening them: the second magnifier beside
// "Search recent notes". It reads what each note already has in the library's `search`
// store (find.js keeps it when a note is opened; Batch OCR and Batch transcribe write it
// too): PDF text, recognized handwriting and scans (OCR), typed text, handwriting written
// from Markdown, and transcripts. Text and Markdown files are read as they are. Notes with
// nothing kept yet can be indexed from here (batch-ocr.js reads them in a worker of their own).
import { SearchIndex, SOURCES } from './search-index.js';
import { noteFingerprint, emptyStore, PDF_WORDS } from './find.js';
import { isTextName } from './text-types.js';

// Documents whose pages the engine reads: notes, notebooks, PDFs and pictures.
export const PAGED = /\.(noteful|nfedit|notecomp(lete)?|notepart|goodnotes|ntb|pdf|png|jpe?g|webp|gif|bmp)$/i;
const TEXT_LIMIT = 4 * 1024 * 1024;
export const contentSearchable = (entry) => Boolean(entry && entry.source !== 'web' && entry.source !== 'archive' && (PAGED.test(entry.name || '') || isTextName(entry.name || '')));

// The fingerprint of a Recent entry's file, remembered per version of the entry so a search
// does not read every file again. `file` saves a read when the caller has it already.
const version = (entry) => `${entry.size || ''}|${entry.modifiedTime || ''}|${entry.path || entry.filename || ''}`;
// `cachedOnly`: '' instead of reading a file not seen before (a big note on disk is read whole).
export async function entryFingerprint(library, entry, file = null, { cachedOnly = false } = {}) {
  const known = await library.store.get('settings', `content-fp:${entry.key}`).catch(() => null);
  if (!file && known?.version === version(entry)) return known.fingerprint;
  if (!file && cachedOnly) return '';
  file ||= await library.open(entry).catch(() => null);
  if (!file) return '';
  const fingerprint = await noteFingerprint(file).catch(() => '');
  if (fingerprint) await rememberFingerprint(library, entry, fingerprint);
  return fingerprint;
}
// The note was opened (app.js knows its fingerprint then): remembered for this entry.
export function rememberFingerprint(library, entry, fingerprint) {
  return library.store.set('settings', `content-fp:${entry.key}`, { version: version(entry), fingerprint }).catch(() => {});
}

// The search data kept for a fingerprint, with every field there (older data lacks some).
export function normalizeContent(kept) {
  const data = { ...emptyStore(), ...(kept || {}) };
  if (kept?.pdf && kept.pdfWords !== PDF_WORDS) { data.pdf = {}; data.pdfFrom = {}; }
  data.pdfWords = PDF_WORDS;
  for (const field of ['pdf', 'ocr', 'pdfFrom', 'text', 'audio', 'pages']) data[field] ||= {};
  return data;
}
// Change what is kept for a Recent entry's note: `change(data)` edits it in place. Returns
// the fingerprint and the data written.
export async function keepNoteContent(library, entry, change, file = null) {
  const fingerprint = await entryFingerprint(library, entry, file);
  if (!fingerprint) return null;
  const data = normalizeContent(await library.searchData(fingerprint));
  await change(data);
  await library.saveSearchData(fingerprint, data);
  return { fingerprint, data };
}

// True when the note was read for search (find.js or batch-ocr.js record its pages), or has
// words of any kind. PDF words kept for a page shown once do not count: the rest is not read.
const filled = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value && (value.text || value.typed || value.ink)));
export const hasContent = (data) => Boolean(data && (Object.keys(data.pages || {}).length || ['pdf', 'ocr', 'text', 'audio'].some((f) => Object.values(data[f] || {}).some(filled))));

// A search index over one note's kept data. Typed text is `text`, handwriting (written from
// Markdown or recognized) is `ocr`, as in Find.
export function contentIndex(data) {
  const index = new SearchIndex();
  const pageOf = (slot) => Number(data.pages?.[slot] ?? slot) || 0;
  const split = (text) => String(text || '').split(/\s+/).filter(Boolean).map((t) => ({ text: t }));
  for (const [slot, words] of Object.entries(data.pdf || {})) if (words?.length) index.add({ page: pageOf(slot), source: 'pdf', words });
  for (const [slot, words] of Object.entries(data.ocr || {})) if (words?.length) index.add({ page: pageOf(slot), source: 'ocr', words });
  for (const [slot, { typed, ink } = {}] of Object.entries(data.text || {})) {
    if (typed) index.add({ page: pageOf(slot), source: 'text', words: split(typed) });
    // Handwriting the note knows the words of; OCR results of the same page win.
    if (ink && !data.ocr?.[slot]?.length) index.add({ page: pageOf(slot), source: 'ocr', words: split(ink) });
  }
  for (const [id, { label, text } = {}] of Object.entries(data.audio || {})) {
    const words = split(text);
    for (let i = 0; i < words.length; i += 400) index.add({ page: 0, source: 'audio', label, recordingId: id, words: words.slice(i, i + 420) });
  }
  return index;
}

// Searches Recent: `entries` in their order. Returns { results: [{ entry, hits, counts }],
// unindexed: entries with nothing kept yet }. Indexes are cached per fingerprint.
export function contentSearcher(library) {
  const indexes = new Map();
  async function indexFor(entry) {
    if (isTextName(entry.name || '') && !PAGED.test(entry.name || '')) {
      const cached = indexes.get(`text:${entry.key}:${version(entry)}`);
      if (cached) return cached;
      const file = await library.open(entry).catch(() => null);
      if (!file || file.size > TEXT_LIMIT) return null;
      const index = new SearchIndex();
      const lines = (await file.text()).split(/\n/);
      // About 40 lines per "page", so a hit says roughly where it is.
      for (let i = 0; i < lines.length; i += 40) index.add({ page: i / 40, source: 'text', words: lines.slice(i, i + 40).join(' ').split(/\s+/).filter(Boolean).map((t) => ({ text: t })) });
      indexes.set(`text:${entry.key}:${version(entry)}`, index);
      return index;
    }
    const fingerprint = await entryFingerprint(library, entry);
    if (!fingerprint) return null;
    if (indexes.has(fingerprint)) return indexes.get(fingerprint);
    const data = await library.searchData(fingerprint);
    if (!hasContent(data)) return null;
    const index = contentIndex(normalizeContent(data));
    indexes.set(fingerprint, index);
    return index;
  }
  return {
    // Something was kept again for this fingerprint: its index is rebuilt on the next search.
    forget(fingerprint) { if (fingerprint) indexes.delete(fingerprint); else indexes.clear(); },
    async search(entries, query, { cancelled = () => false, progress = () => {} } = {}) {
      const results = [], unindexed = [];
      let done = 0;
      // A few files at a time: reading fingerprints is I/O-bound.
      const queue = entries.filter(contentSearchable);
      const lane = async () => {
        while (queue.length && !cancelled()) {
          const entry = queue.shift();
          const index = await indexFor(entry).catch(() => null);
          progress(++done, done + queue.length);
          if (!index) { unindexed.push(entry); continue; }
          const hits = index.search(query, 200);
          if (!hits.length) continue;
          const counts = {};
          for (const h of hits) counts[h.source] = (counts[h.source] || 0) + 1;
          results.push({ entry, hits, counts });
        }
      };
      await Promise.all([lane(), lane(), lane(), lane()]);
      const order = new Map(entries.map((e, i) => [e.key, i]));
      results.sort((a, b) => b.hits.length - a.hits.length || order.get(a.entry.key) - order.get(b.entry.key));
      unindexed.sort((a, b) => order.get(a.key) - order.get(b.key));
      return { results, unindexed };
    },
  };
}
export { SOURCES };
