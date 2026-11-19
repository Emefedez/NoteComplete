import test from 'node:test';
import assert from 'node:assert/strict';
import { dropboxBrowser } from './dropbox-browser.js';
import { FOLDER_MIME } from './drive-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.value = ''; this.open = false; this.classList = { add() {}, remove() {}, toggle() {} }; }
  append(...nodes) { for (const node of nodes) this.children.push(...(node.tag === 'fragment' ? node.children : [node])); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute() {}
  closest() { return this; }
  querySelector() { return null; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}

function setup(t, overrides = {}) {
  const thumbs = overrides.thumbs || { get: () => Promise.resolve(''), cancel() {} };
  const originals = Object.fromEntries(['document', 'window', 'location', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, value] of Object.entries(originals)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const nodes = new Map(), node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const storage = new Map();
  globalThis.document = {
    getElementById: node,
    querySelector: selector => selector.includes('dropbox-app-key') && overrides.siteKey ? { content: overrides.siteKey } : null,
    createElement: tag => new Element(tag),
    createDocumentFragment: () => new Element('fragment'),
  };
  globalThis.window = { isSecureContext: true, open: () => ({ close() {} }) };
  globalThis.location = { protocol: 'https:', href: 'https://reader.example/index.html' };
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const opened = [], calls = [];
  const folder = { source: 'dropbox', id: 'id:folder', name: 'Noteful', path: '/noteful', pathDisplay: '/Noteful', mimeType: FOLDER_MIME };
  const file = { source: 'dropbox', id: 'id:file', name: 'Test.noteful', path: '/noteful/test.noteful', pathDisplay: '/Noteful/Test.noteful', rev: 'r1', parents: ['/noteful'] };
  const client = {
    connected: false, token: '',
    get publicAccess() { return false; },
    get ready() { return this.connected; },
    clear() { this.connected = false; this.token = ''; },
    authorize() { this.connected = true; this.token = 'test'; },
    async revoke() { calls.push('revoke'); },
    async userEmail() { return 'user@example.com'; },
    async roots() { calls.push('roots'); return { files: [folder] }; },
    async search() { calls.push('search'); return { files: [file] }; },
    async children(...args) { calls.push('children'); (overrides.filters ??= []).push(args[3] ?? ''); return { files: [file] }; },
    async folder(ref) { calls.push('folder:' + (ref.path || ref.id)); return folder; },
    async sameName() { calls.push('sameName'); return [file]; },
    async parentOf() { return '/noteful'; },
    async download() { calls.push('download'); return new File(['bytes'], file.name); },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['siteKey', 'thumbs', 'filters', 'library'].includes(key))),
  };
  let resolveAuth;
  const dropbox = dropboxBrowser({
    open: async f => { opened.push(f); return true; },
    client,
    thumbs,
    library: overrides.library,
    identity: { native: false },
    signIn: () => new Promise(resolve => { resolveAuth = resolve; }),
  });
  node('dropboxAppKey').value = 'appkey1234';
  return { node, storage, opened, calls, client, overrides, dropbox, authorize: () => resolveAuth({ access_token: 'dbx', expires_in: 3600, scope: 'files.content.read' }) };
}

test('Dropbox panel lists without downloading and opens only the chosen file', async t => {
  const ui = setup(t);
  await ui.dropbox.show();
  ui.node('dropboxConnect').onclick();
  ui.authorize();
  await tick();
  assert.deepEqual(ui.calls, ['roots']);
  ui.node('dropboxList').querySelectorAll('button')[0].onclick();
  await tick();
  assert.deepEqual(ui.calls, ['roots', 'children']);
  assert.equal(ui.opened.length, 0);
  ui.node('dropboxList').querySelectorAll('button')[0].onclick();
  await tick();
  assert.deepEqual(ui.calls, ['roots', 'children', 'download']);
  assert.equal(ui.opened[0].name, 'Test.noteful');
});

test('leaving the home screen during a Dropbox download ignores late completion', async t => {
  let resolveDownload, signal;
  const ui = setup(t, { download: (_file, abort) => { signal = abort; return new Promise(resolve => { resolveDownload = resolve; }); } });
  await ui.dropbox.show();
  ui.node('dropboxConnect').onclick();
  ui.authorize();
  await tick();
  ui.node('dropboxList').querySelectorAll('button')[0].onclick();
  await tick();
  ui.node('dropboxList').querySelectorAll('button')[0].onclick();
  await tick();
  assert.equal(signal.aborted, false);
  ui.dropbox.hide();
  assert.equal(signal.aborted, true);
  resolveDownload(new File(['bytes'], 'Test.noteful'));
  await tick();
  assert.equal(ui.opened.length, 0);
});

test('Dropbox supports folder path entry, back/forward history, newest() and disconnect', async t => {
  const ui = setup(t);
  await ui.dropbox.show();
  ui.node('dropboxConnect').onclick();
  ui.authorize();
  await tick();
  ui.node('dropboxFolderPath').value = '/Noteful';
  await ui.node('dropboxUseFolder').onclick();
  await tick();
  assert.equal(ui.dropbox.canGoBack(), true);
  assert.equal(ui.dropbox.back(), true);
  await tick();
  assert.equal(ui.dropbox.canGoForward(), true);
  assert.equal(ui.dropbox.forward(), true);
  await tick();
  const latest = await ui.dropbox.newest({ key: 'dropbox:id:file', source: 'dropbox', dropboxId: 'id:file', name: 'Test.noteful', parent: '/noteful' });
  assert.equal(latest[0].id, 'id:file');
  ui.node('dropboxDisconnect').onclick();
  assert.equal(ui.client.connected, false);
  assert.ok(ui.calls.includes('revoke'));
});
