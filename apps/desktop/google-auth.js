import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
const READ = 'https://www.googleapis.com/auth/drive.readonly';
// Write access is asked for only when the user chooses to upload changes.
const WRITE = 'https://www.googleapis.com/auth/drive';
export function desktopCredentials(value) {
  const config = value?.installed;
  if (!config || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(config.client_id)) throw Error('Choose the downloaded OAuth JSON for a Google Desktop app client.');
  return { clientId: config.client_id, clientSecret: config.client_secret || '' };
}
export async function desktopSignIn({ credentials, openExternal, signal, fetcher = fetch, write = false }) {
  const scope = write ? WRITE : READ;
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 180000);
  let finish;
  const callback = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  // Attach a rejection handler before launching the browser.
  callback.catch(() => {});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== state) {
      res.writeHead(400); res.end('Invalid authorization callback.'); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" });
    res.end('You can return to NoteComplete and close this tab.');
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) finish.reject(Error('Google sign-in was cancelled or declined.'));
    else finish.resolve(code);
  });
  const interrupted = () => { finish.reject(Error('Google sign-in was cancelled or timed out.')); server.close(); server.closeAllConnections(); };
  abort.signal.addEventListener('abort', interrupted, { once: true });
  try {
    if (signal?.aborted) cancel();
    abort.signal.throwIfAborted();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: credentials.clientId, redirect_uri: redirect, response_type: 'code', scope, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'online', prompt: 'select_account' }).toString();
    await openExternal(url.href);
    const code = await callback;
    const body = new URLSearchParams({ client_id: credentials.clientId, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' });
    if (credentials.clientSecret) body.set('client_secret', credentials.clientSecret);
    const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body, signal: abort.signal });
    if (!response.ok) throw Error('Google could not complete sign-in. Check the Desktop OAuth client configuration.');
    const token = await response.json();
    if (!token.access_token || !String(token.scope || '').split(/\s+/).includes(scope)) throw Error(write ? 'Permission to update Drive files was not granted.' : 'Read-only Drive permission was not granted.');
    return { access_token: token.access_token, scope: token.scope, expires_in: token.expires_in };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
    abort.signal.removeEventListener('abort', interrupted);
    server.close(); server.closeAllConnections();
  }
}
