import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveClient, DRIVE_SCOPE, FOLDER_MIME, folderReference, supportedDriveFile } from './drive-client.js';
const authorized = fetcher => {
  const client = new DriveClient(fetcher);
  client.authorize({ access_token: 'test-token', expires_in: 3600, scope: DRIVE_SCOPE });
  return client;
};
test('Drive folder links retain resource keys and reject foreign URLs', () => {
  assert.deepEqual(folderReference('https://drive.google.com/drive/u/0/folders/abc-123?resourcekey=key'), { id: 'abc-123', resourceKey: 'key' });
  assert.deepEqual(folderReference(' abc_123 '), { id: 'abc_123' });
  for (const value of ['', 'https://example.com/folders/abc', 'http://drive.google.com/folders/abc', 'https://drive.google.com/file/d/abc']) assert.throws(() => folderReference(value));
});
test('Drive lists only requested folder metadata, escapes queries and follows explicit pagination', async () => {
  const calls = [];
  const client = authorized(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json({ files: [{ id: 'note1', name: 'My note.noteful' }], nextPageToken: 'page2' });
  });
  await client.search("Noteful's \\ notes", '', undefined);
  assert.equal(calls[0].url.searchParams.get('q'), "trashed = false and name contains 'Noteful\\'s \\\\ notes'");
  const folder = { id: 'folder1', resourceKey: 'secret-key' };
  const page = await client.children(folder, '', undefined);
  await client.children(folder, page.nextPageToken, undefined, 'Examen');
  assert.equal(calls[2].url.searchParams.get('pageToken'), 'page2');
  assert.equal(calls[2].url.searchParams.get('q'), "trashed = false and 'folder1' in parents and name contains 'Examen'");
  assert.equal(calls[1].url.searchParams.get('q'), "trashed = false and 'folder1' in parents");
  assert.equal(calls[1].options.headers['X-Goog-Drive-Resource-Keys'], 'folder1/secret-key');
  await client.roots('', undefined);
  assert.equal(calls[3].url.searchParams.get('q'), "trashed = false and 'root' in parents");
  for (const {url,options} of calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(options.body, undefined);
  }
});
test('chosen Drive file downloads exact bytes and cannot write to the source', async () => {
  let requests = 0;
  const client = authorized(async (url, options) => {
    requests++;
    assert.equal(options.method, 'GET');
    assert.equal(new URL(url).searchParams.get('alt'), 'media');
    assert.match(new URL(url).pathname, /\/files\/one$/);
    return new Response(new Uint8Array([170,187,204,222]));
  });
  const file = await client.download({id:'one', name:'A.noteful', mimeType:'application/octet-stream'});
  assert.equal(file.name, 'A.noteful');
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [170,187,204,222]);
  await assert.rejects(client.download({id:'two',name:'secret.noteful',capabilities:{canDownload:false}}));
  await assert.rejects(client.download({id:'three',name:'Google Doc',mimeType:'application/vnd.google-apps.document'}));
  assert.equal(requests,1);
  assert.ok(supportedDriveFile({name:'PHOTO.JPEG'}));
});
test('Drive authorization requires read-only scope and expiry; disconnect blocks new requests', async () => {
  let calls = 0;
  const client = new DriveClient(async () => { calls++; return Response.json({files:[]}); });
  assert.throws(() => client.authorize({access_token:'x',scope:'https://www.googleapis.com/auth/drive',expires_in:3600}));
  assert.throws(() => client.authorize({access_token:'x',scope:DRIVE_SCOPE,expires_in:0}));
  await assert.rejects(client.search('Noteful'), /Connect/);
  client.authorize({access_token:'x',scope:DRIVE_SCOPE,expires_in:3600});
  client.clear();
  await assert.rejects(client.search('Noteful'), /Connect/);
  assert.equal(calls,0);
});
test('Drive handles expired permission and missing files without treating errors as note bytes', async () => {
  for (const [status,pattern] of [[401,/expired/],[403,/denied/],[404,/no longer/],[429,/busy/],[500,/failed/]]) {
    const client = authorized(async () => new Response('failure',{status}));
    await assert.rejects(client.download({id:'one',name:'A.noteful'}),pattern);
    if(status===401) assert.equal(client.connected,false);
  }
});
test('folder validation and cancellation preserve failures for the caller', async () => {
  const client = authorized(async () => Response.json({id:'one',mimeType:'application/pdf'}));
  await assert.rejects(client.folder({id:'one'}), /not point to a folder/);
  client.fetcher = async () => Response.json({id:'folder',name:'Noteful',mimeType:FOLDER_MIME});
  assert.equal((await client.folder({id:'folder',resourceKey:'key'})).resourceKey,'key');
  const abort = new AbortController();abort.abort();
  client.fetcher = async (_url, options) => { options.signal.throwIfAborted(); };
  await assert.rejects(client.children({id:'folder'},'',abort.signal), { name:'AbortError' });
});
test('an API key reads public folders without a token, and sign-in takes precedence', async () => {
  const calls = [];
  const client = new DriveClient(async (url, options) => { calls.push({ url: new URL(url), options }); return Response.json({ files: [] }); });
  await assert.rejects(client.children({ id: 'folder' }), /Connect/);
  client.apiKey = 'AIza-test';
  assert.equal(client.publicAccess, true);
  await client.children({ id: 'folder', resourceKey: 'rk' });
  assert.equal(calls[0].url.searchParams.get('key'), 'AIza-test');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers['X-Goog-Drive-Resource-Keys'], 'folder/rk');
  client.authorize({ access_token: 'test-token', expires_in: 3600, scope: DRIVE_SCOPE });
  assert.equal(client.publicAccess, false);
  await client.children({ id: 'folder' });
  assert.equal(calls[1].url.searchParams.has('key'), false);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');
});
test('public access explains sharing and key errors', async () => {
  for (const [status, pattern] of [[400, /API key/], [403, /Anyone with the link/], [404, /Anyone with the link/]]) {
    const client = new DriveClient(async () => new Response('failure', { status }));
    client.apiKey = 'AIza-test';
    await assert.rejects(client.folder({ id: 'folder' }), pattern);
  }
});
