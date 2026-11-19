import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL,
  authorizeUrl,
  exchangeCode,
  pkcePair,
  redirectUri,
  refreshAccess,
  validAppKey,
  waitForCode,
  webSignIn,
} from './dropbox-auth.js';

test('validAppKey and redirectUri validate Dropbox keys and callback paths', () => {
  assert.equal(validAppKey('abc12345'), true);
  assert.equal(validAppKey(''), false);
  assert.equal(validAppKey('bad key!'), false);
  assert.equal(redirectUri('https://example.github.io/NoteComplete/index.html?x=1#y'), 'https://example.github.io/NoteComplete/dropbox-callback.html');
});

test('pkcePair and authorizeUrl build S256 offline OAuth requests', async () => {
  const { verifier, challenge, state } = await pkcePair();
  assert.ok(verifier.length >= 43);
  assert.ok(challenge.length >= 43);
  assert.ok(state.length >= 16);
  const url = new URL(authorizeUrl({ appKey: 'appkey1234', redirect: 'https://app.example/dropbox-callback.html', challenge, state, reauthenticate: true }));
  assert.equal(url.origin, 'https://www.dropbox.com');
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'appkey1234');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('token_access_type'), 'offline');
  assert.equal(url.searchParams.get('force_reauthentication'), 'true');
});

test('waitForCode matches state and rejects errors or cancellations', async () => {
  const fakeChannel = { onmessage: null, closed: false, close() { this.closed = true; } };
  const promise = waitForCode('state-ok', { channel: fakeChannel, timeout: 5000 });
  fakeChannel.onmessage({ data: { type: CHANNEL, search: '?state=wrong&code=bad' } });
  fakeChannel.onmessage({ data: { type: CHANNEL, search: '?state=state-ok&code=auth-code' } });
  assert.equal(await promise, 'auth-code');
  assert.equal(fakeChannel.closed, true);

  const deniedChannel = { onmessage: null, close() {} };
  const denied = waitForCode('st2', { channel: deniedChannel, timeout: 5000 });
  deniedChannel.onmessage({ data: { type: CHANNEL, search: '?state=st2&error=access_denied' } });
  await assert.rejects(denied, /not allowed/);
});

test('exchangeCode, refreshAccess and webSignIn handle tokens and invalid_grant', async () => {
  const token = await exchangeCode({
    appKey: 'appkey1234',
    code: 'code1',
    verifier: 'ver1',
    redirect: 'https://app.example/dropbox-callback.html',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.dropboxapi.com/oauth2/token');
      assert.equal(init.body.get('grant_type'), 'authorization_code');
      return Response.json({ access_token: 'tok1', refresh_token: 'ref1', expires_in: 14400 });
    },
  });
  assert.equal(token.access_token, 'tok1');

  const refreshed = await refreshAccess({
    appKey: 'appkey1234',
    refreshToken: 'ref1',
    fetcher: async (_url, init) => {
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      return Response.json({ access_token: 'tok2', expires_in: 14400 });
    },
  });
  assert.equal(refreshed.access_token, 'tok2');

  await assert.rejects(
    refreshAccess({ appKey: 'appkey1234', refreshToken: 'bad', fetcher: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) }),
    err => err.code === 'invalid_grant',
  );

  await assert.rejects(webSignIn({ appKey: 'bad', popup: {} }), /app key/);
  await assert.rejects(webSignIn({ appKey: 'appkey1234', popup: null }), /pop-ups/i);
});
