// Dropbox sign-in. The web reader uses OAuth 2 with PKCE in a popup: no app secret and no
// server, only the app's public key. The popup comes back to dropbox-callback.html (same
// origin), which hands the result over a BroadcastChannel. The desktop app signs in through
// the system browser in its main process instead (window.notecompleteDropbox, apps/desktop).
import { DROPBOX_SCOPES } from './dropbox-client.js';

export const CHANNEL = 'notecomplete-dropbox-auth';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
export const validAppKey = key => /^[a-z0-9]{8,32}$/i.test(String(key || '').trim());
// The page Dropbox sends the user back to; it has to be registered in the App Console.
export function redirectUri(base = globalThis.location?.href) {
  const url = new URL('dropbox-callback.html', base);
  url.search = ''; url.hash = '';
  return url.href;
}
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function pkcePair(crypto = globalThis.crypto) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge, state: base64url(crypto.getRandomValues(new Uint8Array(24))) };
}
export function authorizeUrl({ appKey, redirect, challenge, state, reauthenticate = false }) {
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: appKey.trim(), response_type: 'code', redirect_uri: redirect, state,
    code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
    scope: DROPBOX_SCOPES.join(' '), ...(reauthenticate ? { force_reauthentication: 'true' } : {}),
  }).toString();
  return url.href;
}
async function tokenRequest(body, fetcher) {
  const response = await fetcher(TOKEN_URL, { method: 'POST', body: new URLSearchParams(body), credentials: 'omit' });
  let data = {};
  try { data = await response.json(); } catch { /* Not JSON. */ }
  if (!response.ok || !data.access_token) {
    const error = Error(data.error === 'invalid_grant' ? 'Your Dropbox session ended. Connect again.' : data.error_description || 'Dropbox could not complete sign-in. Check the app key and redirect URI in the Dropbox App Console.');
    error.code = data.error || '';
    throw error;
  }
  return data;
}
export const exchangeCode = ({ appKey, code, verifier, redirect, fetcher = globalThis.fetch.bind(globalThis) }) =>
  tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: appKey.trim(), redirect_uri: redirect }, fetcher);
export const refreshAccess = ({ appKey, refreshToken, fetcher = globalThis.fetch.bind(globalThis) }) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey.trim() }, fetcher);
// The code Dropbox hands back to the callback page, once its state matches this sign-in.
export function waitForCode(state, { signal, timeout = 180000, channel = new BroadcastChannel(CHANNEL) } = {}) {
  return new Promise((resolve, reject) => {
    const done = (fn, value) => { clearTimeout(timer); channel.close(); signal?.removeEventListener('abort', aborted); fn(value); };
    const aborted = () => done(reject, Object.assign(Error('Dropbox sign-in cancelled.'), { name: 'AbortError' }));
    const timer = setTimeout(() => done(reject, Error('Dropbox sign-in timed out. Try again.')), timeout);
    signal?.addEventListener('abort', aborted, { once: true });
    channel.onmessage = ({ data }) => {
      if (data?.type !== CHANNEL) return;
      const params = new URLSearchParams(data.search || '');
      if (params.get('state') !== state) return;
      if (params.get('error')) done(reject, Error(params.get('error') === 'access_denied' ? 'Dropbox access was not allowed.' : params.get('error_description') || 'Dropbox sign-in failed.'));
      else if (params.get('code')) done(resolve, params.get('code'));
    };
  });
}
// Web sign-in. `popup` must be opened by the click itself (popup blockers), on about:blank.
export async function webSignIn({ appKey, popup, signal, reauthenticate = false, fetcher }) {
  if (!validAppKey(appKey)) throw Error('Enter the Dropbox app key in Connection setup.');
  if (!popup) throw Error('Allow pop-ups for this site to sign in to Dropbox.');
  try {
    const { verifier, challenge, state } = await pkcePair();
    const redirect = redirectUri();
    const code = waitForCode(state, { signal });
    popup.location.href = authorizeUrl({ appKey, redirect, challenge, state, reauthenticate });
    return await exchangeCode({ appKey, code: await code, verifier, redirect, fetcher });
  } finally { try { popup.close(); } catch { /* Already closed. */ } }
}
// The desktop bridge when present (sign-in in the system browser, tokens kept by the app).
export function dropboxIdentity() {
  return globalThis.window?.notecompleteDropbox ? { ...globalThis.window.notecompleteDropbox, native: true } : { native: false };
}
