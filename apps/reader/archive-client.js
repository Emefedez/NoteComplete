// Internet Archive as a notes source: an item (https://archive.org/details/ID) is a repo whose
// files, with their folder paths, are listed by the metadata API. No sign-in; reads only.
import { isTextName } from './text-types.js';

// Sources every install starts with; more can be added from an item link or identifier.
export const PRELOADED_ARCHIVE = [{ id: '1GREIUvigo', title: '1 GREI ESEI UVIGO - Personal' }];
const SUPPORTED = /\.(noteful|nfedit|notepart|notecomp|notecomplete|html?|pdf|png|jpe?g|webp)$/i;
export const supportedArchiveFile = name => SUPPORTED.test(name || '') || isTextName(name || '');

// "https://archive.org/details/ID", ".../download/ID/..." or a bare identifier; null otherwise.
export function archiveId(input) {
  const text = String(input || '').trim();
  const link = text.match(/^(?:https?:\/\/)?(?:www\.)?archive\.org\/(?:details|download|metadata)\/([^/?#\s]+)/i);
  const id = link ? decodeURIComponent(link[1]) : text;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(id) ? id : null;
}
export const archiveUrl = (id, path = '') => `https://archive.org/download/${encodeURIComponent(id)}/${String(path).split('/').map(encodeURIComponent).join('/')}`;
// One level of an item's folder tree: its sub-folders and the documents NoteComplete can open.
// Only uploaded originals are listed, not the files Internet Archive derives from them.
export function archiveListing(files, prefix = []) {
  const base = prefix.length ? `${prefix.join('/')}/` : '', folders = new Set(), documents = [];
  for (const file of files || []) {
    const name = String(file.name || '');
    if (!name.startsWith(base) || file.source === 'derivative' || file.source === 'metadata' || file.format === 'Metadata') continue;
    const rest = name.slice(base.length), slash = rest.indexOf('/');
    if (slash > 0) { if (rest.split('/').every(part => !part.startsWith('.'))) folders.add(rest.slice(0, slash)); continue; }
    if (!rest || rest.startsWith('.') || !supportedArchiveFile(rest) || file.private === 'true') continue;
    documents.push({ name: rest, path: name, size: Number(file.size) || 0, modifiedTime: Number(file.mtime) ? new Date(Number(file.mtime) * 1000).toISOString() : '' });
  }
  const sort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return { folders: [...folders].sort(sort), documents: documents.sort((a, b) => sort(a.name, b.name)) };
}
export class ArchiveClient {
  constructor(fetcher = (...args) => globalThis.fetch(...args)) { this.fetcher = fetcher; }
  async item(id, signal) {
    const response = await this.fetcher(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal });
    if (!response.ok) throw Error(`Internet Archive answered ${response.status}.`);
    const data = await response.json();
    if (!data?.files) throw Error(`No Internet Archive item called “${id}”.`);
    const title = data.metadata?.title;
    return { id, title: Array.isArray(title) ? title[0] : title || id, files: data.files };
  }
  async download(id, document, signal, onProgress = () => {}) {
    const response = await this.fetcher(archiveUrl(id, document.path), { signal });
    if (!response.ok) throw Error(`Internet Archive answered ${response.status}.`);
    const total = Number(response.headers?.get?.('Content-Length')) || document.size || 0;
    if (!response.body?.getReader) return new File([await response.blob()], document.name);
    const reader = response.body.getReader(), chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length; onProgress(received, total);
    }
    return new File(chunks, document.name);
  }
}
