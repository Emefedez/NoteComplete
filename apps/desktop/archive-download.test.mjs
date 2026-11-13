import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { archiveDownload, declaredLength, downloadRedirectAllowed, downloadRegistry, downloadStartAllowed, MAX_DOWNLOAD_BYTES } from './archive-download.js';
import { archiveUrl } from '../reader/archive-client.js';

test('a download starts only from an Internet Archive download address', () => {
  assert.ok(downloadStartAllowed(archiveUrl('1GREIUvigo', 'PDF/A B/c#.pdf')));
  assert.ok(downloadStartAllowed('https://archive.org/download/id/a.noteful'));
  for (const bad of [
    'file:///etc/passwd', 'file://archive.org/download/x', 'http://archive.org/download/id/a.pdf', 'https://archive.org.evil.example/download/id/a.pdf',
    'https://evilarchive.org/download/id/a.pdf', 'https://user:pw@archive.org/download/id/a.pdf', 'https://archive.org@evil.example/download/id/a.pdf',
    'https://archive.org:8443/download/id/a.pdf', 'https://ia800000.us.archive.org/download/id/a.pdf', 'https://archive.org/metadata/id', 'https://archive.org/',
    'https://127.0.0.1/download/x', 'notecomplete://reader/index.html', 'data:text/plain,x', 'blob:https://archive.org/1', '/download/id/a.pdf', '', null, undefined, {}, 7,
  ]) assert.equal(downloadStartAllowed(bad), false, String(bad));
});

test('redirects are followed only to archive.org hosts over https', () => {
  for (const ok of ['https://ia800000.us.archive.org/12/items/id/a.pdf', 'https://archive.org/download/id/a.pdf', 'https://dn720000.ca.archive.org/0/items/id/a.pdf']) assert.ok(downloadRedirectAllowed(ok), ok);
  for (const bad of [
    'http://ia800000.us.archive.org/a.pdf', 'file:///etc/passwd', 'https://archive.org.evil.example/a', 'https://evilarchive.org/a', 'https://example.com/?archive.org',
    'https://x@evil.example/.archive.org', 'https://a:b@ia800000.us.archive.org/a', 'https://ia800000.us.archive.org:444/a', 'https://localhost/a', '', null,
  ]) assert.equal(downloadRedirectAllowed(bad), false, String(bad));
});

test('the announced size is read from the headers, in any of the shapes they come in', () => {
  assert.equal(declaredLength({ 'content-length': '120' }), 120);
  assert.equal(declaredLength({ 'content-length': ['7'] }), 7);
  assert.equal(declaredLength({ 'Content-Length': ' 9 ' }), 9);
  for (const none of [{}, null, undefined, { 'content-length': 'abc' }, { 'content-length': '-4' }, { 'content-length': '' }]) assert.equal(declaredLength(none), 0);
});

// A stand-in for Electron's net.request: `script(req)` plays the server's part.
function fakeNet(script) {
  const seen = [];
  const request = options => {
    const req = new EventEmitter();
    Object.assign(req, { options, ended: false, aborted: false, followed: 0 });
    req.end = () => { req.ended = true; queueMicrotask(() => script(req)); };
    req.abort = () => { if (!req.aborted) { req.aborted = true; req.emit('abort'); } };
    req.followRedirect = () => { req.followed += 1; };
    seen.push(req);
    return req;
  };
  return { request, seen };
}
function respond(req, { status = 200, headers = {}, chunks = [], end = true }) {
  const response = new EventEmitter();
  Object.assign(response, { statusCode: status, headers });
  req.emit('response', response);
  for (const chunk of chunks) response.emit('data', Buffer.from(chunk));
  if (end) response.emit('end');
  return response;
}
const START = 'https://archive.org/download/id/a.pdf';

test('a download follows the redirect to a file server and returns the bytes with progress', async () => {
  const net = fakeNet(req => {
    req.emit('redirect', 302, 'GET', 'https://ia800000.us.archive.org/1/items/id/a.pdf', {});
    assert.equal(req.followed, 1);
    respond(req, { headers: { 'content-length': '5' }, chunks: ['ab', 'cde'] });
  });
  const progress = [];
  const bytes = await archiveDownload({ request: net.request, url: START, onProgress: (received, total) => progress.push([received, total]) });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes).toString(), 'abcde');
  assert.deepEqual(progress, [[2, 5], [5, 5]]);
  assert.deepEqual(net.seen[0].options, { url: START, method: 'GET', redirect: 'manual' });
  assert.equal(net.seen[0].aborted, false);
});

test('a refused address never reaches the network', async () => {
  for (const url of ['file:///etc/passwd', 'https://example.com/a.pdf', 'http://archive.org/download/id/a.pdf']) {
    const net = fakeNet(() => assert.fail('requested'));
    await assert.rejects(archiveDownload({ request: net.request, url }), /Only Internet Archive/);
    assert.equal(net.seen.length, 0);
  }
});

test('a redirect outside Internet Archive stops the download without following it', async () => {
  for (const target of ['https://evil.example/a.pdf', 'file:///etc/passwd', 'http://ia800000.us.archive.org/a.pdf', 'https://127.0.0.1/a']) {
    const net = fakeNet(req => {
      req.emit('redirect', 302, 'GET', target, {});
      // Whatever arrives afterwards is not delivered.
      respond(req, { chunks: ['secret'] });
    });
    await assert.rejects(archiveDownload({ request: net.request, url: START }), /outside Internet Archive/);
    assert.equal(net.seen[0].followed, 0);
    assert.ok(net.seen[0].aborted);
  }
});

test('a redirect loop ends', async () => {
  const net = fakeNet(req => { for (let i = 0; i < 20; i += 1) req.emit('redirect', 302, 'GET', 'https://archive.org/download/id/a.pdf', {}); });
  await assert.rejects(archiveDownload({ request: net.request, url: START }), /too many times/);
  assert.equal(net.seen[0].followed, 5);
  assert.ok(net.seen[0].aborted);
});

test('a file above the limit is refused, from its announced size or from what arrives', async () => {
  assert.equal(MAX_DOWNLOAD_BYTES, 2 * 1024 ** 3);
  const announced = fakeNet(req => respond(req, { headers: { 'content-length': '11' }, chunks: ['x'] }));
  await assert.rejects(archiveDownload({ request: announced.request, url: START, limit: 10 }), /larger than/);
  assert.ok(announced.seen[0].aborted);
  // No size announced (or a false one): the running total decides.
  for (const headers of [{}, { 'content-length': '3' }]) {
    const progress = [];
    const silent = fakeNet(req => respond(req, { headers, chunks: ['12345', '67890', 'a', 'more'] }));
    await assert.rejects(archiveDownload({ request: silent.request, url: START, limit: 10, onProgress: received => progress.push(received) }), /larger than/);
    assert.ok(silent.seen[0].aborted);
    assert.deepEqual(progress, [5, 10]);
  }
  const exact = fakeNet(req => respond(req, { headers: { 'content-length': '10' }, chunks: ['12345', '67890'] }));
  assert.equal((await archiveDownload({ request: exact.request, url: START, limit: 10 })).length, 10);
});

test('an error status and a broken transfer are reported', async () => {
  const missing = fakeNet(req => respond(req, { status: 404 }));
  await assert.rejects(archiveDownload({ request: missing.request, url: START }), /answered 404/);
  // A redirect that was not followed must not be taken for the file.
  const moved = fakeNet(req => respond(req, { status: 302, chunks: ['x'] }));
  await assert.rejects(archiveDownload({ request: moved.request, url: START }), /answered 302/);
  const offline = fakeNet(req => req.emit('error', Error('net::ERR_INTERNET_DISCONNECTED')));
  await assert.rejects(archiveDownload({ request: offline.request, url: START }), /ERR_INTERNET_DISCONNECTED/);
  const cut = fakeNet(req => respond(req, { chunks: ['ab'], end: false }).emit('aborted'));
  await assert.rejects(archiveDownload({ request: cut.request, url: START }), /interrupted/);
});

test('cancelling stops the transfer with an AbortError', async () => {
  const before = new AbortController();
  before.abort();
  const unused = fakeNet(() => assert.fail('requested'));
  await assert.rejects(archiveDownload({ request: unused.request, url: START, signal: before.signal }), { name: 'AbortError' });
  assert.equal(unused.seen.length, 0);

  const controller = new AbortController();
  let response;
  const net = fakeNet(req => { response = respond(req, { chunks: ['ab'], end: false }); controller.abort(); });
  await assert.rejects(archiveDownload({ request: net.request, url: START, signal: controller.signal }), { name: 'AbortError' });
  assert.ok(net.seen[0].aborted);
  // Late pieces of a cancelled download are ignored.
  response.emit('data', Buffer.from('late'));
  response.emit('end');
});

test('downloads are cancelled by their tab and stream id, or all at once for a closed tab', () => {
  const registry = downloadRegistry();
  const a = registry.open(1, 'dl_a'), b = registry.open(1, 'dl_b'), other = registry.open(2, 'dl_a');
  assert.throws(() => registry.open(1, 'dl_a'), /already running/);
  registry.cancel(2, 'dl_b');
  registry.cancel(3, 'dl_a');
  assert.deepEqual([a, b, other].map(c => c.signal.aborted), [false, false, false]);
  // Another tab cannot stop this one's download by guessing its id.
  registry.cancel(1, 'dl_a');
  assert.deepEqual([a, b, other].map(c => c.signal.aborted), [true, false, false]);
  registry.close(1, 'dl_a');
  assert.equal(registry.size, 2);
  registry.cancelTab(1);
  assert.deepEqual([b.signal.aborted, other.signal.aborted], [true, false]);
  registry.close(1, 'dl_b');
  registry.close(2, 'dl_a');
  registry.close(2, 'dl_a');
  assert.equal(registry.size, 0);
  registry.cancelTab(9);
});

test('the packaged app contains the module, and the handler uses it', async () => {
  const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.build.files.includes('archive-download.js'));
  const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const handler = main.slice(main.indexOf("ipcMain.handle('files:download-url'"), main.indexOf("ipcMain.handle('files:pick'"));
  assert.match(handler, /archiveDownload\(/);
  assert.doesNotMatch(handler, /net\.fetch/);
});
