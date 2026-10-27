// Read-only Google Drive transport. Tokens stay in memory; note bytes are never uploaded.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const supportedDriveFile = file => /\.(noteful|nfedit|pdf|png|jpe?g|webp)$/i.test(file.name || '') || ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType);
const fields = 'id,name,mimeType,modifiedTime,size,resourceKey,thumbnailLink,capabilities(canDownload)';
const quote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export function folderReference(value) {
  const input = value.trim();
  if (/^[\w-]+$/.test(input)) return { id: input };
  let url;
  try { url = new URL(input); } catch { throw Error('Paste a Google Drive folder link or folder ID.'); }
  const id = url.pathname.match(/\/folders\/([\w-]+)/)?.[1];
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || !id) throw Error('Paste a Google Drive folder link or folder ID.');
  return { id, resourceKey: url.searchParams.get('resourcekey') || undefined };
}
export class DriveClient {
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; this.apiKey = ''; this.clear(); }
  authorize(response) {
    if (!response.access_token || !String(response.scope || '').split(/\s+/).includes(DRIVE_SCOPE)) throw Error('Read-only Drive permission was not granted.');
    const seconds = Number(response.expires_in);
    if (!Number.isFinite(seconds) || seconds <= 0) throw Error('Google returned an invalid session. Connect again.');
    this.token = response.access_token;
    this.expires = Date.now() + seconds * 1000;
  }
  clear() { this.token = ''; this.expires = 0; }
  get connected() { return !!this.token && this.expires > Date.now() + 10000; }
  // Without sign-in, an API key can read folders shared as "Anyone with the link".
  get publicAccess() { return !this.connected && !!this.apiKey; }
  get ready() { return this.connected || this.publicAccess; }
  async request(route, params, signal, resource, extra = {}) {
    if (!this.ready) { this.clear(); throw Error('Connect to Google Drive to continue. Your previous session may have expired.'); }
    const publicAccess = this.publicAccess;
    const url = new URL('https://www.googleapis.com/drive/v3/' + route);
    url.search = new URLSearchParams(publicAccess ? { ...params, key: this.apiKey } : params).toString();
    const headers = publicAccess ? { ...extra } : { ...extra, Authorization: `Bearer ${this.token}` };
    if (resource?.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${resource.id}/${resource.resourceKey}`;
    const response = await this.fetcher(url.href, { method: 'GET', headers, signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) {
      if (response.status === 401) { this.clear(); throw Error('Your Google session expired. Connect again.'); }
      if (publicAccess && response.status === 400) throw Error('Google rejected the Drive API key. Check it in Connection setup.');
      if (publicAccess && (response.status === 403 || response.status === 404)) throw Error('Google denied access without sign-in. Share the folder as "Anyone with the link", or connect Google Drive.');
      if (response.status === 403) throw Error('Google denied access. Check Drive permissions, API setup, download restrictions or quota, then retry.');
      if (response.status === 404) throw Error('This Drive file or folder is no longer available. Refresh the list.');
      if (response.status === 429) throw Error('Google Drive is busy. Wait a moment and retry.');
      throw Error(`Google Drive request failed (${response.status}). Retry when online.`);
    }
    return response;
  }
  async list(query, pageToken, signal, resource) {
    const params = { q: query, fields: `nextPageToken,incompleteSearch,files(${fields})`, pageSize: '100', orderBy: 'folder,name_natural', spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };
    if (pageToken) params.pageToken = pageToken;
    return (await this.request('files', params, signal, resource)).json();
  }
  // Folders and files together, so a note can be found by name without browsing into a folder.
  search(name, pageToken, signal) {
    return this.list(`trashed = false and name contains '${quote(name)}'`, pageToken, signal);
  }
  // The top level of My Drive: everything that does not live inside a folder.
  roots(pageToken, signal) {
    return this.list(`trashed = false and 'root' in parents`, pageToken, signal);
  }
  children(folder, pageToken, signal, filter = '') {
    const within = filter ? ` and name contains '${quote(filter)}'` : '';
    return this.list(`trashed = false and '${quote(folder.id)}' in parents${within}`, pageToken, signal, folder);
  }
  async folder(reference, signal) {
    const file = await (await this.request('files/' + encodeURIComponent(reference.id), { fields, supportsAllDrives: 'true' }, signal, reference)).json();
    if (file.mimeType !== FOLDER_MIME) throw Error('That link does not point to a folder.');
    return { ...file, resourceKey: file.resourceKey || reference.resourceKey };
  }
  async download(file, signal) {
    if (!supportedDriveFile(file) || file.capabilities?.canDownload === false) throw Error('This file cannot be downloaded into NoteComplete.');
    const response = await this.request('files/' + encodeURIComponent(file.id), { alt: 'media', supportsAllDrives: 'true' }, signal, file);
    return new File([await response.blob()], file.name, { type: file.mimeType });
  }
  // Bytes [start, end) of a file. Drive's alt=media honours Range, so note covers
  // are read without downloading the note; a server ignoring it is cut off.
  async range(file, start, end, signal) {
    if (!supportedDriveFile(file) || file.capabilities?.canDownload === false) throw Error('This file cannot be downloaded into NoteComplete.');
    const response = await this.request('files/' + encodeURIComponent(file.id), { alt: 'media', supportsAllDrives: 'true' }, signal, file, { Range: `bytes=${start}-${end - 1}` });
    const length = Number(response.headers?.get?.('Content-Length'));
    if (response.status !== 206 && !(length <= end - start)) {
      await response.body?.cancel?.();
      throw Error('Google Drive did not return a partial file.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return response.status === 206 ? bytes : bytes.subarray(start, end);
  }
  // Google renders previews for PDFs and images; note bytes are previewed locally instead.
  async thumbnail(file, signal) {
    if (!file.thumbnailLink) return '';
    const headers = this.publicAccess ? {} : { Authorization: `Bearer ${this.token}` };
    const response = await this.fetcher(file.thumbnailLink, { headers, signal, cache: 'force-cache', credentials: 'omit', redirect: 'follow' });
    if (!response.ok) return '';
    return URL.createObjectURL(await response.blob());
  }
}
