const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export async function mobileDriveToken(sdk, config = {}) {
  sdk.configure({ webClientId: config.webClientId || undefined, scopes: [SCOPE], offlineAccess: false });
  await sdk.hasPlayServices({ showPlayServicesUpdateDialog: !config.silent });
  if (config.clearToken && typeof sdk.clearCachedAccessToken === 'function') {
    await sdk.clearCachedAccessToken(config.clearToken).catch(() => {});
  }
  let result = null;
  const shouldTrySilent = Boolean(config.silent) || Boolean(await sdk.hasPreviousSignIn?.());
  if (shouldTrySilent && typeof sdk.signInSilently === 'function') {
    try {
      const silent = await sdk.signInSilently();
      if (silent?.type === 'success' && silent.data?.scopes?.includes(SCOPE)) result = silent;
    } catch { /* Fall back to interactive sign-in unless silent-only. */ }
  }
  if (!result) {
    if (config.silent) throw Error('Google sign-in needs attention. Reconnect Google Drive.');
    result = await sdk.signIn();
  }
  if (result.type !== 'success') throw Error('Google sign-in cancelled.');
  if (!result.data.scopes?.includes(SCOPE)) throw Error('Read-only Drive permission was not granted.');
  const { accessToken } = await sdk.getTokens();
  if (!accessToken) throw Error('Google did not return a Drive access token.');
  // The SDK does not expose expiry. Reconnect silently before expiry; API 401 also clears and refreshes.
  return { access_token: accessToken, scope: SCOPE, expires_in: 3000 };
}
