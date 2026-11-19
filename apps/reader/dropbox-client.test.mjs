import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DropboxClient,
  DROPBOX_ROOT,
  dropboxFile,
  dropboxPath,
  headerArg,
  supportedDropboxFile,
} from './dropbox-client.js';
import { FOLDER_MIME } from './drive-client.js';

function authorized(fetcher) {
  const client = new DropboxClient(fetcher);
  client.authorize({ access_token: 'dbx-token', expires_in: 14400, scope: 'files.metadata.read files.content.read' });
  return client;
}

test('dropboxPath normalizes paths, root, IDs and dropbox.com/home links while rejecting shared links', () => {
  assert.equal(dropboxPath(''), '');
  assert.equal(dropboxPath('/'), '');
  assert.equal(dropboxPath('Noteful/Backups/'), '/Noteful/Backups');
  assert.equal(dropboxPath('id:abc123'), 'id:abc123');
  assert.equal(dropboxPath('https://www.dropbox.com/home/Noteful/Tema%201/'), '/Noteful/Tema 1');
  assert.equal(dropboxPath('https://www.dropbox.com/home'), '');
  assert.throws(() => dropboxPath('https://www.dropbox.com/sh/abc/def?dl=0'), /Shared links/);
  assert.throws(() => dropboxPath('https://example.com/Noteful'), /Shared links/);
});

test('headerArg escapes non-ASCII characters for Dropbox-API-Arg header', () => {
  const encoded = headerArg({ path: '/Español/Tema 1 — Café.noteful' });
  assert.match(encoded, /^[\x00-\x7f]+$/);
  assert.deepEqual(JSON.parse(encoded), { path: '/Español/Tema 1 — Café.noteful' });
});

test('dropboxFile maps Dropbox metadata into Drive-shaped entries', () => {
  const folder = dropboxFile({ '.tag': 'folder', id: 'id:f1', name: 'Noteful', path_lower: '/noteful', path_display: '/Noteful' });
  assert.equal(folder.source, 'dropbox');
  assert.equal(folder.mimeType, FOLDER_MIME);
  assert.deepEqual(folder.parents, ['']);
  assert.equal(folder.capabilities.canDownload, true);

  const note = dropboxFile({
    '.tag': 'file',
    id: 'id:n1',
    name: 'Tema 1.noteful',
    path_lower: '/noteful/tema 1.noteful',
    path_display: '/Noteful/Tema 1.noteful',
    server_modified: '2026-11-01T10:00:00Z',
    size: 12345,
    rev: 'rev1',
    content_hash: 'hash1',
    is_downloadable: true,
  });
  assert.equal(note.source, 'dropbox');
  assert.equal(note.size, '12345');
  assert.equal(note.rev, 'rev1');
  assert.equal(note.contentHash, 'hash1');
  assert.deepEqual(note.parents, ['/noteful']);
  assert.equal(supportedDropboxFile(note), true);
  assert.equal(supportedDropboxFile(folder), false);
});

test('DropboxClient authorizes, lists roots/folders, searches and handles pagination', async () => {
  const calls = [];
  const client = authorized(async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('files/list_folder')) {
      return Response.json({
        entries: [
          { '.tag': 'file', id: 'id:b', name: '2.noteful', path_lower: '/2.noteful', size: 20 },
          { '.tag': 'folder', id: 'id:a', name: 'Sub', path_lower: '/sub' },
          { '.tag': 'file', id: 'id:c', name: '1.noteful', path_lower: '/1.noteful', size: 10 },
        ],
        has_more: true,
        cursor: 'cur1',
      });
    }
    if (url.endsWith('files/list_folder/continue')) {
      return Response.json({ entries: [{ '.tag': 'file', id: 'id:d', name: '3.pdf', path_lower: '/3.pdf', size: 30 }], has_more: false });
    }
    if (url.endsWith('files/search_v2')) {
      return Response.json({
        matches: [{ metadata: { metadata: { '.tag': 'file', id: 'id:r', name: 'Tema.noteful', path_lower: '/tema.noteful' } } }],
        has_more: false,
      });
    }
    throw Error('Unexpected ' + url);
  });

  const root = await client.roots('');
  assert.equal(root.files[0].mimeType, FOLDER_MIME);
  assert.deepEqual(root.files.map(f => f.name), ['Sub', '1.noteful', '2.noteful']);
  assert.equal(root.nextPageToken, 'cur1');

  const more = await client.roots(root.nextPageToken);
  assert.equal(more.files[0].name, '3.pdf');
  assert.equal(more.nextPageToken, '');

  const found = await client.children({ ...DROPBOX_ROOT, path: '/sub' }, '', undefined, 'Tema');
  assert.equal(found.files[0].name, 'Tema.noteful');
  assert.equal(calls[2].body.options.path, '/sub');
});

test('DropboxClient downloads bytes, supports byte ranges, thumbnails, sameName and 401 silent refresh', async () => {
  let refreshed = 0;
  let attempt = 0;
  const client = authorized(async (url, init) => {
    attempt++;
    if (attempt === 1) return Response.json({ error_summary: 'expired_access_token' }, { status: 401 });
    if (url.endsWith('files/download')) {
      if (init.headers.Range) {
        return new Response(new Uint8Array([9, 8]), { status: 206, headers: { 'Content-Length': '2' } });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Length': '4' } });
    }
    if (url.endsWith('files/search_v2')) {
      return Response.json({
        matches: [
          { metadata: { metadata: { '.tag': 'file', id: 'id:root', name: 'Note.noteful', path_lower: '/note.noteful', server_modified: '2026-11-02T00:00:00Z' } } },
          { metadata: { metadata: { '.tag': 'file', id: 'id:sub', name: 'Note.noteful', path_lower: '/sub/note.noteful', server_modified: '2026-11-03T00:00:00Z' } } },
        ],
        has_more: false,
      });
    }
    throw Error('Unexpected ' + url);
  });
  client.onRefresh = async () => {
    refreshed++;
    client.authorize({ access_token: 'new-token', expires_in: 3600, scope: 'files.content.read' });
    return true;
  };

  const dl = await client.download({ source: 'dropbox', id: 'id:1', name: 'Note.noteful', mimeType: 'application/octet-stream', size: '4' });
  assert.equal(refreshed, 1);
  assert.deepEqual([...new Uint8Array(await dl.arrayBuffer())], [1, 2, 3, 4]);

  const part = await client.range({ source: 'dropbox', id: 'id:1', name: 'Note.noteful', size: '4' }, 1, 3);
  assert.deepEqual([...part], [9, 8]);

  const rootMatches = await client.sameName('Note.noteful', '');
  assert.deepEqual(rootMatches.map(f => f.id), ['id:root']);
});

test('DropboxClient refuses authorization without files.content.read', () => {
  const client = new DropboxClient();
  assert.throws(() => client.authorize({ access_token: 'x', scope: 'account_info.read', expires_in: 3600 }), /read files/);
  assert.throws(() => client.authorize({ access_token: 'x', scope: 'files.content.read', expires_in: 0 }), /invalid session/);
});
