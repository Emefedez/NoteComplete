import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

export const DROPBOX_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read'];
export const DROPBOX_CALLBACK_PORT = 53691;
export const DROPBOX_CALLBACK_PATH = '/dropbox-callback';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

export const validDropboxAppKey = key => /^[a-z0-9]{8,32}$/i.test(String(key || '').trim());

export async function dropboxDesktopSignIn({
  appKey,
  openExternal,
  signal,
  fetcher = fetch,
  onRefreshToken = null,
  port = DROPBOX_CALLBACK_PORT,
}) {
  if (!validDropboxAppKey(appKey)) throw Error('Enter the Dropbox app key in Connection setup.');
  const state = randomBytes(24).toString('base64url');
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
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method !== 'GET' || url.pathname !== DROPBOX_CALLBACK_PATH || url.searchParams.get('state') !== state) {
      res.writeHead(400); res.end('Invalid authorization callback.'); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" });
    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (err || !code) {
      res.end('Dropbox sign-in was cancelled. You can return to NoteComplete and close this tab.');
      finish.reject(Error(err === 'access_denied' ? 'Dropbox access was not allowed.' : url.searchParams.get('error_description') || 'Dropbox sign-in was cancelled or declined.'));
    } else {
      res.end('Signed in. You can return to NoteComplete and close this tab.');
      finish.resolve(code);
    }
  });
  const interrupted = () => {
    finish.reject(Object.assign(Error('Dropbox sign-in was cancelled or timed out.'), { name: 'AbortError' }));
    server.close();
    server.closeAllConnections();
  };
  abort.signal.addEventListener('abort', interrupted, { once: true });
  try {
    if (signal?.aborted) cancel();
    abort.signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      server.once('error', err => reject(err.code === 'EADDRINUSE' ? Error(`Port ${port} is busy; finish or close the other Dropbox sign-in and try again.`) : err));
      server.listen(port, '127.0.0.1', resolve);
    });
    const actualPort = server.address().port;
    const redirect = `http://127.0.0.1:${actualPort}${DROPBOX_CALLBACK_PATH}`;
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: appKey.trim(),
      response_type: 'code',
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      scope: DROPBOX_SCOPES.join(' '),
    }).toString();
    await openExternal(url.href);
    const code = await callback;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: appKey.trim(),
      redirect_uri: redirect,
    });
    const response = await fetcher(TOKEN_URL, { method: 'POST', body, signal: abort.signal });
    let token = {};
    try { token = await response.json(); } catch { /* Not JSON. */ }
    if (!response.ok || !token.access_token) {
      throw Error(token.error_description || 'Dropbox could not complete sign-in. Check the app key and redirect URI in the Dropbox App Console.');
    }
    const granted = String(token.scope || '').split(/\s+/).filter(Boolean);
    if (granted.length && !granted.includes('files.content.read')) throw Error('Dropbox did not grant permission to read files.');
    if (token.refresh_token) onRefreshToken?.(token.refresh_token);
    return { access_token: token.access_token, scope: token.scope || DROPBOX_SCOPES.join(' '), expires_in: token.expires_in };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
    abort.signal.removeEventListener('abort', interrupted);
    server.close(); server.closeAllConnections();
  }
}

export async function refreshDropboxDesktopToken({ appKey, refreshToken, signal, fetcher = fetch, onRefreshToken = null }) {
  if (!refreshToken) throw Error('No saved Dropbox refresh token.');
  if (!validDropboxAppKey(appKey)) throw Error('Dropbox app key is missing.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey.trim(),
  });
  const response = await fetcher(TOKEN_URL, { method: 'POST', body, signal });
  let data = {};
  try { data = await response.json(); } catch { /* Ignore non-JSON body. */ }
  if (!response.ok || !data.access_token) {
    const err = Error(data.error === 'invalid_grant' ? 'Your Dropbox session ended. Connect again.' : data.error_description || 'Could not refresh the Dropbox session.');
    err.code = data.error || '';
    throw err;
  }
  if (data.refresh_token) onRefreshToken?.(data.refresh_token);
  return { access_token: data.access_token, scope: data.scope || DROPBOX_SCOPES.join(' '), expires_in: data.expires_in };
}
