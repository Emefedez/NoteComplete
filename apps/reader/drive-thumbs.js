// Previews for listed Drive files, never by downloading a whole note:
//   1. a cover already kept in the library for this file version;
//   2. Google's thumbnail for PDFs and images;
//   3. the note's own first-page JPEG, read with byte ranges (note-cover.js).
// A few files load in parallel; cancel() drops queued and late results.
import { FOLDER_MIME, supportedDriveFile } from './drive-client.js';
import { noteCover } from './note-cover.js';
import { noteFacts } from './note-facts.js';

// Ranges already fetched serve later reads inside them (cover and facts share the head and tail).
export function cachingReader(read) {
  const chunks = [];
  return async (start, end) => {
    const hit = chunks.find(c => c.start <= start && c.end >= end);
    if (hit) return (await hit.bytes).subarray(start - hit.start, end - hit.start);
    const chunk = { start, end, bytes: read(start, end) };
    chunks.push(chunk);
    return chunk.bytes;
  };
}

// Small JPEG data URLs keep the library store compact and survive reloads.
export async function shrink(blob, width = 320) {
  if (typeof createImageBitmap !== 'function') return URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, width / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.8);
    canvas.width = canvas.height = 0;
    return url;
  } finally { bitmap.close?.(); }
}

export function driveThumbnails(client, { library = null, resize = shrink, parallel = 4 } = {}) {
  let generation = 0, controller = new AbortController(), active = 0;
  // Covers go first; recordings and tags (for filters) only when no cover is waiting.
  const queue = [], later = [], urls = [];
  function pump() {
    while (active < parallel && (queue.length || later.length)) {
      const job = queue.shift() || later.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  }
  const readers = new Map();
  const readerFor = (file, signal) => {
    const id = `${file.id}@${file.modifiedTime || ''}`;
    if (!readers.has(id)) readers.set(id, cachingReader((start, end) => client.range(file, start, end, signal)));
    return readers.get(id);
  };
  const isNote = file => /\.noteful$/i.test(file.name || '') && typeof client.range === 'function' && Number(file.size) > 0;
  async function produce(file, signal) {
    const key = library?.coverKey(file);
    const kept = key && await library.cover(key);
    if (kept) return kept;
    let url = '';
    if (typeof client.thumbnail === 'function' && file.thumbnailLink) url = await client.thumbnail(file, signal).catch(error => { if (error.name === 'AbortError') throw error; return ''; });
    // A note's own cover also stands in when Google has no usable thumbnail for it.
    if (!url && isNote(file)) {
      const cover = await noteCover(readerFor(file, signal), Number(file.size));
      if (cover) url = await resize(new Blob([cover.bytes], { type: cover.mime }));
    }
    if (url.startsWith('blob:')) urls.push(url);
    else if (url && key) library.saveCover(key, url);
    return url;
  }
  return {
    // Resolves to a preview URL for a listed file, '' when it has none, or null when
    // it was cancelled or failed (network, quota), so the caller can ask again later.
    get(file) {
      if (file?.mimeType === FOLDER_MIME || !supportedDriveFile(file) || file.capabilities?.canDownload === false) return Promise.resolve('');
      const token = generation, signal = controller.signal, key = library?.coverKey(file);
      // A cover kept from before shows at once, without waiting behind network reads.
      return Promise.resolve(key ? library.cover(key) : null).catch(() => null).then(kept => kept || new Promise(resolve => {
        queue.push(async () => {
          if (token !== generation) return resolve(null);
          try { const url = await produce(file, signal); resolve(token === generation ? url : null); }
          catch { resolve(null); }
        });
        pump();
      }));
    },
    // Recordings and tags for filtering, cached per file version.
    facts(file) {
      if (!isNote(file) || file.capabilities?.canDownload === false) return Promise.resolve(null);
      const token = generation, signal = controller.signal, key = library?.coverKey(file);
      return new Promise(resolve => {
        later.push(async () => {
          if (token !== generation) return resolve(null);
          try {
            const kept = key && await library.facts(key);
            const facts = kept || await noteFacts(readerFor(file, signal), Number(file.size));
            if (!kept && key) library.saveFacts(key, facts);
            resolve(token === generation ? facts : null);
          } catch { resolve(null); }
        });
        pump();
      });
    },
    cancel() {
      readers.clear();
      generation++;
      controller.abort();
      controller = new AbortController();
      for (const job of [...queue.splice(0), ...later.splice(0)]) job();
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    },
  };
}
