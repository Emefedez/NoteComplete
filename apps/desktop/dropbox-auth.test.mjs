import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DROPBOX_CALLBACK_PATH,
  DROPBOX_SCOPES,
  dropboxDesktopSignIn,
  refreshDropboxDesktopToken,
  validDropboxAppKey,
} from './dropbox-auth.js';

test('validDropboxAppKey accepts standard keys and rejects invalid ones', () => {
  assert.equal(validDropboxAppKey('abc12345'), true);
  assert.equal(validDropboxAppKey('  '), false);
  assert.equal(validDropboxAppKey('short'), false);
});

test('desktop Dropbox OAuth binds loopback callback to state and exchanges PKCE proof', async () => {
  let challenge;
  let savedRefresh = '';
  const token = await dropboxDesktopSignIn({
    appKey: 'dbxapp1234',
    port: 0,
    onRefreshToken: rt => { savedRefresh = rt; },
    openExternal: async address => {
      const url = new URL(address);
      challenge = url.searchParams.get('code_challenge');
      assert.equal(url.origin, 'https://www.dropbox.com');
      assert.equal(url.searchParams.get('scope'), DROPBOX_SCOPES.join(' '));
      assert.equal(url.searchParams.get('token_access_type'), 'offline');
      const callback = new URL(url.searchParams.get('redirect_uri'));
      assert.equal(callback.hostname, '127.0.0.1');
      assert.equal(callback.pathname, DROPBOX_CALLBACK_PATH);
      callback.search = new URLSearchParams({ state: 'wrong', code: 'bad' }).toString();
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', 'dbx-code');
      assert.equal((await fetch(callback)).status, 200);
    },
    fetcher: async (url, request) => {
      assert.equal(url, 'https://api.dropboxapi.com/oauth2/token');
      assert.equal(request.method, 'POST');
      assert.equal(request.body.get('code'), 'dbx-code');
      assert.equal(createHash('sha256').update(request.body.get('code_verifier')).digest('base64url'), challenge);
      return Response.json({
        access_token: 'dbx-access',
        scope: 'files.metadata.read files.content.read',
        expires_in: 14400,
        refresh_token: 'dbx-refresh',
      });
    },
  });
  assert.deepEqual(token, {
    access_token: 'dbx-access',
    scope: 'files.metadata.read files.content.read',
    expires_in: 14400,
  });
  assert.equal(savedRefresh, 'dbx-refresh');

  const refreshed = await refreshDropboxDesktopToken({
    appKey: 'dbxapp1234',
    refreshToken: savedRefresh,
    fetcher: async (url, req) => {
      assert.equal(url, 'https://api.dropboxapi.com/oauth2/token');
      assert.equal(req.body.get('grant_type'), 'refresh_token');
      assert.equal(req.body.get('refresh_token'), 'dbx-refresh');
      return Response.json({ access_token: 'dbx-fresh', expires_in: 14400 });
    },
  });
  assert.equal(refreshed.access_token, 'dbx-fresh');

  await assert.rejects(
    refreshDropboxDesktopToken({
      appKey: 'dbxapp1234',
      refreshToken: savedRefresh,
      fetcher: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
    }),
    err => err.code === 'invalid_grant',
  );
});

test('desktop Dropbox cancellation aborts without token exchange', async () => {
  const controller = new AbortController();
  let callback;
  await assert.rejects(
    dropboxDesktopSignIn({
      appKey: 'dbxapp1234',
      port: 0,
      signal: controller.signal,
      openExternal: async address => {
        callback = new URL(address).searchParams.get('redirect_uri');
        controller.abort();
      },
      fetcher: () => { throw Error('must not exchange'); },
    }),
    /cancelled/,
  );
  await assert.rejects(fetch(callback));
});
