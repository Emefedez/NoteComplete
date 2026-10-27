// Previews for listed Drive files, never by downloading a whole note:
//   1. a cover already kept in the library for this file version;
//   2. Google's thumbnail for PDFs and images;
//   3. the note's own first-page JPEG, read with byte ranges (note-cover.js).
// A few files load in parallel; cancel() drops queued and late results.
import { FOLDER_MIME, supportedDriveFile } from './drive-client.js';
import { noteCover } from './note-cover.js';

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
  const queue = [], urls = [];
  function pump() {
    while (active < parallel && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  }
  async function produce(file, signal) {
    const key = library?.coverKey(file);
    const kept = key && await library.cover(key);
    if (kept) return kept;
    let url = '';
    if (typeof client.thumbnail === 'function' && file.thumbnailLink) url = await client.thumbnail(file, signal);
    else if (/\.noteful$/i.test(file.name || '') && typeof client.range === 'function' && Number(file.size) > 0) {
      const cover = await noteCover((start, end) => client.range(file, start, end, signal), Number(file.size));
      if (cover) url = await resize(new Blob([cover.bytes], { type: cover.mime }));
    }
    if (url.startsWith('blob:')) urls.push(url);
    else if (url && key) library.saveCover(key, url);
    return url;
  }
  return {
    // Resolves to a preview URL for a listed file, or '' when there is none.
    get(file) {
      if (file?.mimeType === FOLDER_MIME || !supportedDriveFile(file) || file.capabilities?.canDownload === false) return Promise.resolve('');
      const token = generation, signal = controller.signal;
      return new Promise(resolve => {
        queue.push(async () => {
          if (token !== generation) return resolve('');
          try { const url = await produce(file, signal); resolve(token === generation ? url : ''); }
          catch { resolve(''); }
        });
        pump();
      });
    },
    cancel() {
      generation++;
      controller.abort();
      controller = new AbortController();
      for (const job of queue.splice(0)) job();
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    },
  };
}
