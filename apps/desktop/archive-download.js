// Internet Archive downloads for the reader (files:download-url in main.js). The address
// comes from the reader's page, so it is checked here: Electron's network stack also reads
// file:// and any host, and a page that could run script would otherwise read local files
// or reach the local network through it.

// What the reader can open in practice: notes of 250 MB are real, and the bytes are held
// in memory twice on the way to the page (here and in the reader).
export const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;
const MAX_REDIRECTS = 5;

function httpsUrl(address) {
  let url;
  try { url = new URL(String(address)); } catch { return null; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
}
// The address a download starts from: what archiveUrl (reader archive-client.js) builds.
export function downloadStartAllowed(address) {
  const url = httpsUrl(address);
  return !!url && url.hostname === 'archive.org' && url.pathname.startsWith('/download/');
}
// /download/ answers with a redirect to a file server such as ia800000.us.archive.org.
export function downloadRedirectAllowed(address) {
  const url = httpsUrl(address);
  return !!url && (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org'));
}
// The size a response announces, or 0 when it does not say (or says nonsense).
export function declaredLength(headers) {
  const raw = headers?.['content-length'] ?? headers?.['Content-Length'];
  const text = Array.isArray(raw) ? raw[0] : raw;
  return /^\d+$/.test(String(text ?? '').trim()) ? Number(text) : 0;
}
const tooLarge = limit => Error(`This file is larger than ${Math.round(limit / 1024 ** 2)} MB, the most NoteComplete downloads.`);
const aborted = () => Object.assign(Error('Download cancelled.'), { name: 'AbortError' });

// Downloads `url` and resolves with its bytes. `request` is Electron's net.request (or a
// stand-in with the same events): redirects are handled by hand so that every hop is
// checked before any byte from it is read.
export function archiveDownload({ request, url, signal, onProgress = () => {}, limit = MAX_DOWNLOAD_BYTES }) {
  return new Promise((resolve, reject) => {
    if (!downloadStartAllowed(url)) { reject(Error('Only Internet Archive downloads are allowed.')); return; }
    if (signal?.aborted) { reject(aborted()); return; }
    const req = request({ url: String(url), method: 'GET', redirect: 'manual' });
    const chunks = [];
    let received = 0, hops = 0, settled = false;
    const onAbort = () => fail(aborted());
    const finish = () => { settled = true; signal?.removeEventListener('abort', onAbort); };
    // Any failure also stops the transfer: nothing more is read or kept.
    function fail(error) {
      if (settled) return;
      finish();
      chunks.length = 0;
      try { req.abort(); } catch { /* Already closed. */ }
      reject(error);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('redirect', (_status, _method, redirectUrl) => {
      if (settled) return;
      if (++hops > MAX_REDIRECTS) fail(Error('Internet Archive redirected too many times.'));
      else if (!downloadRedirectAllowed(redirectUrl)) fail(Error('The download was redirected outside Internet Archive.'));
      else req.followRedirect();
    });
    req.on('response', response => {
      if (settled) return;
      const status = response.statusCode;
      if (status < 200 || status > 299) { fail(Error(`Download answered ${status}`)); return; }
      const total = declaredLength(response.headers);
      if (total > limit) { fail(tooLarge(limit)); return; }
      response.on('data', chunk => {
        if (settled) return;
        received += chunk.length;
        if (received > limit) { fail(tooLarge(limit)); return; }
        chunks.push(chunk);
        onProgress(received, total);
      });
      response.on('end', () => {
        if (settled) return;
        finish();
        const bytes = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        resolve(bytes);
      });
      response.on('error', error => fail(error instanceof Error ? error : Error('The download was interrupted.')));
      response.on('aborted', () => fail(Error('The download was interrupted.')));
    });
    req.on('error', error => fail(error instanceof Error ? error : Error('The download failed.')));
    req.on('abort', () => fail(aborted()));
    req.end();
  });
}

// Downloads in progress, by tab and by the stream id its page chose, so that a cancel
// message or the tab closing stops exactly its own transfers.
export function downloadRegistry() {
  const live = new Map();
  return {
    open(tab, id) {
      const mine = live.get(tab) ?? new Map();
      if (mine.has(id)) throw Error('This download is already running.');
      const controller = new AbortController();
      mine.set(id, controller);
      live.set(tab, mine);
      return controller;
    },
    close(tab, id) {
      const mine = live.get(tab);
      if (mine?.delete(id) && !mine.size) live.delete(tab);
    },
    cancel(tab, id) { live.get(tab)?.get(id)?.abort(); },
    cancelTab(tab) { for (const controller of live.get(tab)?.values() ?? []) controller.abort(); },
    get size() { let n = 0; for (const mine of live.values()) n += mine.size; return n; },
  };
}
