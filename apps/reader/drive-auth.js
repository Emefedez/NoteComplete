import { DRIVE_SCOPE } from './drive-client.js';
import { nativeDriveIdentity } from './drive-native.js';
let loading, native;
export function googleAuthError(code) {
  if (code === 'invalid_client' || code === 'deleted_client') return 'Google rejected this client ID. Use an existing Web application OAuth client from Google Cloud (not an API key or Desktop/Android client).';
  if (code === 'origin_mismatch' || code === 'redirect_uri_mismatch') return `Register this exact Authorized JavaScript origin in Google Cloud: ${location.origin}`;
  if (code === 'access_denied') return 'Google access was declined. If the app is in testing, add this account as an OAuth test user.';
  return 'Google sign-in failed. Check the client type, registered origin and OAuth test users in Connection setup.';
}
export function loadGoogleIdentity() {
  native ||= nativeDriveIdentity();
  if (native) return Promise.resolve(native);
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google.accounts.oauth2);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => finish(Error('Google sign-in did not load. Check your connection and try again.')), 15000);
    function finish(error) {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (error) { script.remove(); loading = null; reject(error); }
      else resolve(globalThis.google.accounts.oauth2);
    }
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => finish(globalThis.google?.accounts?.oauth2 ? null : Error('Google sign-in is unavailable.'));
    script.onerror = () => finish(Error('Could not load Google sign-in. Check your connection or content blocker.'));
    document.head.append(script);
  });
  return loading;
}
export function requestDriveAccess(identity, clientId, callback, error, scope = DRIVE_SCOPE) {
  const write = scope !== DRIVE_SCOPE;
  if (identity.native) { identity.signIn({ write }).then(callback, error); return; }
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw Error('Enter a Google OAuth web client ID in Connection setup.');
  identity.initTokenClient({
    client_id: clientId, scope, include_granted_scopes: false,
    callback: response => response.error ? error(Error(googleAuthError(response.error))) : callback(response),
    error_callback: () => error(Error('Google sign-in was closed or blocked. Allow the sign-in popup and try again.')),
  }).requestAccessToken({ prompt: 'select_account' });
}
