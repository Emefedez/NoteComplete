// Read-only Dropbox transport (API v2). Listing, search, covers and downloads only: no uploads,
// moves or deletes. Entries come back in the same shape as Drive files (drive-client.js) so the
// covers (drive-thumbs.js), the library (library.js) and the download queue treat them alike.
import { FOLDER_MIME, supportedDriveFile } from './drive-client.js';

export const DROPBOX_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read'];
const API = 'https://api.dropboxapi.com/2/';
const CONTENT = 'https://content.dropboxapi.com/2/';
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', html: 'text/html', htm: 'text/html', txt: 'text/plain', md: 'text/markdown' };
// Dropbox reads JSON arguments from a header, which may only hold ASCII: escape everything else.
export const headerArg = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const parentOf = path => { const at = String(path || '').lastIndexOf('/'); return at > 0 ? path.slice(0, at) : ''; };
// Dropbox metadata → a Drive-shaped file: folders get Drive's folder type, files a type guessed
// from the extension; `path` (lower case) is what Dropbox calls take, `id` stays stable across renames.
export function dropboxFile(entry) {
  const folder = entry['.tag'] === 'folder';
  const ext = String(entry.name || '').split('.').pop().toLowerCase();
  return {
    source: 'dropbox',
    id: entry.id,
    name: entry.name,
    path: entry.path_lower ?? '',
    pathDisplay: entry.path_display ?? entry.name,
    mimeType: folder ? FOLDER_MIME : MIME[ext] || 'application/octet-stream',
    modifiedTime: folder ? undefined : entry.server_modified,
    size: folder ? undefined : String(entry.size ?? ''),
    rev: entry.rev,
    contentHash: entry.content_hash,
    parents: [parentOf(entry.path_lower)],
    capabilities: { canDownload: folder || entry.is_downloadable !== false },
  };
}
export const supportedDropboxFile = file => file.mimeType !== FOLDER_MIME && supportedDriveFile(file);
// The top of the user's Dropbox (or of the app folder, for an app-folder app).
export const DROPBOX_ROOT = Object.freeze({ source: 'dropbox', id: '', name: 'Dropbox', path: '', pathDisplay: '/', mimeType: FOLDER_MIME });
// "/Noteful/Backups", "Noteful", or a dropbox.com/home/… address → a Dropbox path.
export function dropboxPath(value) {
  let input = String(value || '').trim();
  if (/^https?:\/\//i.test(input)) {
    let url;
    try { url = new URL(input); } catch { throw Error('Paste a Dropbox folder path such as /Noteful.'); }
    if (!/(^|\.)dropbox\.com$/i.test(url.hostname) || !url.pathname.startsWith('/home')) throw Error('Shared links cannot be opened here yet. Paste the folder path, such as /Noteful.');
    input = decodeURIComponent(url.pathname.slice('/home'.length));
  }
  input = input.replace(/\/+$/, '');
  if (!input || input === '/') return '';
  return input.startsWith('/') || input.startsWith('id:') ? input : '/' + input;
}
export class DropboxClient {
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; this.onRefresh = null; this.onClear = null; this.clear(); }
  // Never public: Dropbox's API needs a signed-in user even for shared links.
  get publicAccess() { return false; }
  get connected() { return !!this.token && this.expires > Date.now() + 10000; }
  get ready() { return this.connected; }
  authorize(response) {
    if (!response?.access_token) throw Error('Dropbox did not grant access.');
    const granted = String(response.scope || '').split(/\s+/).filter(Boolean);
    // Older apps (no scopes) get no `scope` back; when one is listed, reading must be in it.
    if (granted.length && !granted.includes('files.content.read')) throw Error('Dropbox did not grant permission to read files.');
    const seconds = Number(response.expires_in);
    if (!Number.isFinite(seconds) || seconds <= 0) throw Error('Dropbox returned an invalid session. Connect again.');
    this.token = response.access_token;
    this.expires = Date.now() + seconds * 1000;
  }
  clear() { this.token = ''; this.expires = 0; this.onClear?.(); }
  async call(base, route, { arg, json, headers = {}, signal } = {}, retry = true) {
    if (!this.connected && retry && typeof this.onRefresh === 'function') await this.onRefresh({ force: false }).catch(() => false);
    if (!this.connected) { this.clear(); throw Error('Connect to Dropbox to continue. Your previous session may have expired.'); }
    const init = { method: 'POST', headers: { ...headers, Authorization: `Bearer ${this.token}` }, signal, cache: 'no-store', credentials: 'omit', redirect: 'error' };
    if (arg !== undefined) init.headers['Dropbox-API-Arg'] = headerArg(arg);
    if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
    const response = await this.fetcher(base + route, init);
    if (response.ok) return response;
    let detail = '';
    try { detail = JSON.stringify(await response.json()); } catch { /* Not JSON. */ }
    if (response.status === 401) {
      const stale = this.token;
      this.clear();
      if (retry && typeof this.onRefresh === 'function') {
        const ok = await this.onRefresh({ force: true, clearToken: stale }).catch(() => false);
        if (ok && this.connected) return this.call(base, route, { arg, json, headers, signal }, false);
      }
      throw Error('Your Dropbox session expired. Connect again.');
    }
    if (response.status === 409 && /not_found/.test(detail)) throw Error('This Dropbox file or folder is no longer available. Refresh the list.');
    if (response.status === 409 && /restricted_content|unsupported_file|non_downloadable/.test(detail)) throw Error('Dropbox does not allow downloading this file.');
    if (response.status === 400 && /scope/.test(detail)) throw Error('The Dropbox app is missing a permission (files.metadata.read, files.content.read). Check it in the Dropbox App Console.');
    if (response.status === 403) throw Error('Dropbox denied access. Check the app’s permissions, then reconnect.');
    if (response.status === 429 || response.status === 503) throw Error('Dropbox is busy. Wait a moment and retry.');
    throw Error(`Dropbox request failed (${response.status}). Retry when online.`);
  }
  async rpc(route, json, signal) { return (await this.call(API, route, { json, signal })).json(); }
  async userEmail(signal) {
    if (!this.connected) return '';
    return (await (await this.call(API, 'users/get_current_account', { signal })).json())?.email || '';
  }
  // A Drive-like page: files plus a continuation cursor as the page token.
  page(result, entries) {
    const files = entries.filter(e => e && (e['.tag'] === 'file' || e['.tag'] === 'folder')).map(dropboxFile);
    const sort = (a, b) => (b.mimeType === FOLDER_MIME) - (a.mimeType === FOLDER_MIME) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return { files: files.sort(sort), nextPageToken: result.has_more ? result.cursor : '' };
  }
  async list(path, pageToken, signal) {
    const result = pageToken
      ? await this.rpc('files/list_folder/continue', { cursor: pageToken }, signal)
      : await this.rpc('files/list_folder', { path, limit: 200, include_non_downloadable_files: true }, signal);
    return this.page(result, result.entries || []);
  }
  async find(query, path, pageToken, signal) {
    const result = pageToken
      ? await this.rpc('files/search/continue_v2', { cursor: pageToken }, signal)
      : await this.rpc('files/search_v2', { query, options: { ...(path ? { path } : {}), max_results: 100, file_status: 'active', filename_only: true } }, signal);
    return this.page(result, (result.matches || []).map(m => m.metadata?.metadata));
  }
  // Folders and notes anywhere whose names match.
  search(name, pageToken, signal) { return this.find(name, '', pageToken, signal); }
  // The top level of Dropbox.
  roots(pageToken, signal) { return this.list('', pageToken, signal); }
  // A folder's children; a filter searches names inside it (and its subfolders).
  children(folder, pageToken, signal, filter = '') {
    return filter ? this.find(filter, folder.path, pageToken, signal) : this.list(folder.path, pageToken, signal);
  }
  async folder(reference, signal) {
    const path = reference?.path ?? reference?.id ?? '';
    if (!path) return { ...DROPBOX_ROOT };
    const entry = await this.rpc('files/get_metadata', { path }, signal);
    if (entry['.tag'] !== 'folder') throw Error('That path is not a Dropbox folder.');
    return dropboxFile(entry);
  }
  async parentOf(id, signal) {
    const entry = await this.rpc('files/get_metadata', { path: id }, signal);
    return parentOf(entry.path_lower);
  }
  // A Dropbox folder holds one file per name; newest first, like Drive's.
  async sameName(name, parent, signal) {
    const { files } = await this.find(name, parent || '', '', signal);
    return files.filter(f => f.mimeType !== FOLDER_MIME && f.name === name && (parent == null || f.parents[0] === parent))
      .sort((a, b) => Date.parse(b.modifiedTime || 0) - Date.parse(a.modifiedTime || 0));
  }
  downloadable(file) {
    if (!supportedDropboxFile(file) || file.capabilities?.canDownload === false) throw Error('This file cannot be downloaded into NoteComplete.');
  }
  // `progress(received, total)` follows the download; total is 0 when unknown.
  async download(file, signal, progress = () => {}) {
    this.downloadable(file);
    const response = await this.call(CONTENT, 'files/download', { arg: { path: file.id || file.path }, signal });
    const total = Number(response.headers?.get?.('Content-Length')) || Number(file.size) || 0;
    if (!response.body?.getReader) return new File([await response.blob()], file.name, { type: file.mimeType });
    const reader = response.body.getReader(), chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      progress(received, total);
    }
    return new File(chunks, file.name, { type: file.mimeType });
  }
  // Bytes [start, end): Dropbox downloads honour Range, so covers are read without the whole note.
  async range(file, start, end, signal) {
    this.downloadable(file);
    const response = await this.call(CONTENT, 'files/download', { arg: { path: file.id || file.path }, headers: { Range: `bytes=${start}-${end - 1}` }, signal });
    const length = Number(response.headers?.get?.('Content-Length'));
    if (response.status !== 206 && !(length <= end - start)) {
      await response.body?.cancel?.();
      throw Error('Dropbox did not return a partial file.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return response.status === 206 ? bytes : bytes.subarray(start, end);
  }
  // Dropbox renders thumbnails for pictures and PDFs; anything else (or a refusal) has none.
  async thumbnail(file, signal) {
    if (!/\.(pdf|png|jpe?g|webp|gif|tiff?|bmp)$/i.test(file.name || '')) return '';
    try {
      const response = await this.call(CONTENT, 'files/get_thumbnail_v2', { arg: { resource: { '.tag': 'path', path: file.id || file.path }, format: 'jpeg', size: 'w256h256', mode: 'bestfit' }, signal });
      return URL.createObjectURL(await response.blob());
    } catch (error) { if (error.name === 'AbortError') throw error; return ''; }
  }
  // Ends the session at Dropbox too (Disconnect), so the token cannot be used again.
  async revoke() {
    if (!this.connected) return;
    const token = this.token;
    await this.fetcher(API + 'auth/token/revoke', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' }).catch(() => {});
  }
}
