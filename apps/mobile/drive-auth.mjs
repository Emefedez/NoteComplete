const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export async function mobileDriveToken(sdk, config) {
  sdk.configure({ webClientId: config.webClientId || undefined, scopes: [SCOPE], offlineAccess: false });
  await sdk.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await sdk.signIn();
  if (result.type !== 'success') throw Error('Google sign-in cancelled.');
  if (!result.data.scopes?.includes(SCOPE)) throw Error('Read-only Drive permission was not granted.');
  const { accessToken } = await sdk.getTokens();
  if (!accessToken) throw Error('Google did not return a Drive access token.');
  // The SDK does not expose expiry. Reconnect conservatively; API 401 also clears it.
  return { access_token: accessToken, scope: SCOPE, expires_in: 3000 };
}
