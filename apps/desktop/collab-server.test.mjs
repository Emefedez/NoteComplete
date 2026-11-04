import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awareness from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { startServer, lanAddress, lanAddresses, readerFile, firewallHint, pickEncoding } from './collab-server.js';
import { SyncClient, parseInvite, applyTextDiff } from '../reader/sync.js';

const yjs = { Y, sync, awareness, encoding, decoding };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what = 'condition', ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error(`Timed out waiting for ${what}`);
    await wait(10);
  }
}
async function reader() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'collab-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>NoteComplete</title>');
  await mkdir(path.join(root, 'pkg'));
  await writeFile(path.join(root, 'pkg', 'a.js'), 'export {}');
  await writeFile(path.join(root, '.secret'), 'no');
  return root;
}
// A stand-in for the core: an edit history with an undo cursor, like editor.rs.
class Replica {
  constructor(state = { history: [], cursor: 0 }) { Object.assign(this, structuredClone(state)); }
  apply({ op, args }) {
    if (op === 'draw') {
      if (args.bad) throw Error('Invalid fixed-width line');
      this.history.length = this.cursor;
      this.history.push(args.line);
      this.cursor++;
    } else if (op === 'undo') this.cursor = Math.max(0, this.cursor - 1);
    else if (op === 'redo') this.cursor = Math.min(this.history.length, this.cursor + 1);
    return { edit_count: this.cursor };
  }
  visible() { return this.history.slice(0, this.cursor); }
  digest() { return JSON.stringify([this.cursor, this.history]); }
}
function client(server, options) {
  const events = [];
  const c = new SyncClient({ url: server.hostUrl, retries: [], ...options, on: (type, detail) => { events.push([type, detail]); options.on?.(type, detail); } });
  c.events = events;
  c.connect();
  return c;
}
function host(server, replica = new Replica(), options = {}) {
  return client(server, { token: server.hostToken, role: 'host', yjs: options.yjs, apply: (e) => replica.apply(e), snapshot: async () => JSON.stringify(replica), digest: async () => replica.digest(), ...options });
}
function tablet(server, options = {}) {
  const t = { replica: null };
  t.client = client(server, {
    role: 'tablet',
    apply: (e) => t.replica.apply(e),
    load: async ({ project }) => { t.replica = new Replica(JSON.parse(project)); },
    digest: async () => t.replica.digest(),
    ...options,
  });
  return t;
}
const welcomed = (c) => until(() => c.state === 'open', 'welcome');
const closedWith = (c) => until(() => c.state === 'closed', 'refusal').then(() => c.events.find(([t]) => t === 'closed')?.[1].reason);

test('serves reader files only, and finds a private LAN address', async () => {
  const root = await reader();
  assert.equal(readerFile(root, '/../etc/passwd'), null);
  assert.equal(readerFile(root, '/%2e%2e/%2e%2e/x'), null);
  assert.equal(readerFile(root, '/.secret'), null);
  assert.equal(readerFile(root, '/node_modules/x.js'), null);
  assert.equal(readerFile(root, '/tablet'), path.join(root, 'index.html'));
  assert.equal(lanAddress({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], tun: [{ family: 'IPv4', address: '100.64.1.2', internal: false }], wlan: [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }), '192.168.1.20');
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1' });
  try {
    const page = await fetch(`${server.origin}/tablet`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NoteComplete/);
    assert.equal((await fetch(`${server.origin}/pkg/a.js`)).headers.get('content-type'), 'text/javascript');
    assert.equal((await fetch(`${server.origin}/.secret`)).status, 404);
    assert.equal((await fetch(`${server.origin}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${server.origin}/`, { method: 'POST' })).status, 405);
    assert.match(server.tabletLink(), /^http:\/\/127\.0\.0\.1:\d+\/tablet#[0-9a-f]{8}\.[\w-]{22}$/);
    assert.match(server.guestLink, /\/join#/);
  } finally { await server.stop(); }
});

test('the links use the Wi-Fi address, not a virtual adapter, and can switch', async () => {
  const v4 = (address) => [{ family: 'IPv4', address, internal: false }];
  // libvirt's bridge sorts like a home network, but a phone cannot reach it.
  const nets = { virbr0: v4('192.168.122.1'), docker0: v4('172.17.0.1'), wlp2s0: v4('10.0.0.23') };
  assert.deepEqual(lanAddresses(nets), ['10.0.0.23', '192.168.122.1', '172.17.0.1']);
  // The default route's address wins.
  assert.equal(lanAddress({ eth0: v4('192.168.1.5'), wlan0: v4('192.168.0.40') }, '192.168.0.40'), '192.168.0.40');
  const root = await reader();
  const first = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1' });
  // The usual port is taken: another free one.
  const second = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: first.port });
  try {
    assert.notEqual(second.port, first.port);
    assert.equal(second.useAddress('10.9.9.9'), '127.0.0.1');
    assert.match(second.tabletLink(), /^http:\/\/127\.0\.0\.1:/);
  } finally { await first.stop(); await second.stop(); }
});

test('parses invite links and address + code', () => {
  assert.deepEqual(parseInvite('http://192.168.1.20:41237/tablet#ab12cd34.TOKEN_x'), { url: 'ws://192.168.1.20:41237/sync', token: 'TOKEN_x', role: 'tablet' });
  assert.equal(parseInvite('https://notes.example/join#s.t').url, 'wss://notes.example/sync');
  assert.equal(parseInvite('http://h:1/join#s.t').role, 'guest');
  assert.deepEqual(parseInvite('192.168.1.20:41237', '482 913'), { url: 'ws://192.168.1.20:41237/sync', code: '482913', role: 'tablet' });
  assert.throws(() => parseInvite('192.168.1.20:41237', '12'), /6-digit/);
  assert.throws(() => parseInvite('192.168.1.20', '123456'), /port/);
  assert.throws(() => parseInvite('javascript:alert(1)'), /not a link/);
});

test('refuses missing, wrong and expired invites; limits size and rate', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', maxPeers: 2, hubOptions: { maxMessage: 1024, rate: { burst: 50, perSecond: 1 } } });
  try {
    assert.match(await closedWith(client(server, { token: 'nope' })), /not valid/);
    assert.match(await closedWith(client(server, {})), /not valid/);
    // A second host is refused while one is connected.
    const h = host(server);
    await welcomed(h);
    assert.match(await closedWith(client(server, { token: server.hostToken, role: 'host' })), /not valid/);
    // Pairing codes: five wrong tries use the code up.
    for (let i = 0; i < 5; i++) assert.match(await closedWith(client(server, { code: '000000' === server.code().code ? '111111' : '000000' })), /Wrong code/);
    assert.match(await closedWith(client(server, { code: server.code().code })), /expired/);
    h.newCode();
    await until(() => h.events.some(([t]) => t === 'code' || t === 'status') || true);
    await wait(50);
    const t = tablet(server, { code: server.code().code });
    await welcomed(t.client);
    assert.equal(t.client.role, 'tablet');
    assert.equal(t.client.token, server.hub.tokens.tablet);
    // Guests of an editable session may draw (refused here only because no note is open);
    // tablets add blank pages and typed text, but no PDF, picture or handwritten Markdown.
    const g = client(server, { token: server.hub.tokens.guest });
    await welcomed(g);
    await assert.rejects(g.submit('draw', { line: {} }), /The note changed/);
    await assert.rejects(t.client.submit('insertPages', { at: 1, pages: [{ size: [600, 800] }] }), /The note changed/);
    await assert.rejects(t.client.submit('image', { page: 0, image: { base64: '', mime: '', bounds: [0, 0, 10, 10], layer: 0, text: { runs: [] } } }), /The note changed/);
    await assert.rejects(t.client.submit('editText', { page: 0, itemId: 'image:0', text: {} }), /The note changed/);
    await assert.rejects(t.client.submit('insertPages', {}), /Not allowed/);
    await assert.rejects(t.client.submit('insertPages', { at: 1, pages: [{ size: [600, 800], pdf: { resource: 'x', page_index: 0 } }], pdf: { id: 'x', base64: '' } }), /Not allowed/);
    await assert.rejects(t.client.submit('image', { page: 0, image: { base64: 'AAAA', mime: 'image/png', bounds: [0, 0, 10, 10], layer: 0 } }), /Not allowed/);
    await assert.rejects(t.client.submit('insertHandwritten', {}), /Not allowed/);
    await assert.rejects(t.client.submit('resizePage', { size: [10, 10] }), /Not allowed/);
    // Full: the host plus two others.
    assert.match(await closedWith(client(server, { token: server.hub.tokens.guest })), /full/);
    // Oversized messages close the connection.
    g.send({ t: 'rename', name: 'x'.repeat(2000) });
    await until(() => g.state === 'closed', 'oversize close');
    // A flood is disconnected.
    for (let i = 0; i < 80; i++) t.client.send({ t: 'live', gen: 0, page: 0, points: [[1, 1]] });
    await until(() => t.client.state === 'closed', 'flood close');
    assert.match(t.client.events.find(([e]) => e === 'closed')[1].reason, /Too many/);
    h.close();
  } finally { await server.stop(); }
});

test('a tablet joins from a snapshot; everyone applies edits in one order', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: null, hubOptions: { rate: { burst: 2000, perSecond: 2000 }, checkEvery: 5 } });
  try {
    const mine = new Replica();
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Exam' });
    await h.submit('draw', { page: 0, line: 'host-1' });
    // Handwritten pages from Markdown are the host's edits too.
    await h.submit('insertHandwritten', { at: 0, markdown: '# Tema' });
    const t = tablet(server, { token: server.hub.tokens.tablet });
    await until(() => t.client.loaded, 'snapshot');
    assert.deepEqual(t.replica.visible(), ['host-1']);
    assert.equal(t.client.events.find(([e]) => e === 'welcome')[1].title, 'Exam');
    // Concurrent edits from both sides end in the same order everywhere.
    const sent = [];
    for (let i = 0; i < 10; i++) {
      sent.push(h.submit('draw', { line: `h${i}` }), t.client.submit('draw', { line: `t${i}` }));
      if (i === 4) sent.push(t.client.submit('undo', {}));
    }
    await Promise.all(sent);
    await until(() => t.client.seq === h.seq, 'catch up');
    assert.deepEqual(t.replica.visible(), mine.visible());
    assert.equal(t.replica.digest(), mine.digest());
    assert.equal(mine.visible().length, 1 + 20 - 1);
    // A refused edit is refused by every copy; they still agree.
    await assert.rejects(t.client.submit('draw', { bad: true }), /Invalid/);
    await t.client.submit('redo', {});
    await until(() => t.client.seq === h.seq);
    assert.equal(t.replica.digest(), mine.digest());
    // Live strokes reach the host, with the tablet's colour.
    t.client.live({ page: 0, id: 's1', points: [[1, 2]] });
    await until(() => h.events.some(([e, d]) => e === 'live' && d.id === 's1'), 'live');
    // A copy that went wrong is noticed by the digest check and reloaded.
    t.replica.history[0] = 'stray';
    for (let i = 0; i < 6; i++) await h.submit('draw', { line: `c${i}` });
    await until(() => t.client.events.some(([e, d]) => e === 'status' && d.state === 'resync'), 'resync');
    await until(() => t.client.loaded && t.client.seq === h.seq, 'reloaded');
    assert.equal(t.replica.digest(), mine.digest());
    // The host opens another note: the tablet reloads it.
    mine.history = []; mine.cursor = 0;
    h.documentChanged({ open: true, title: 'Other' });
    await until(() => t.client.loaded && t.client.gen === h.gen, 'new note');
    assert.deepEqual(t.replica.visible(), []);
    await t.client.submit('draw', { line: 'on other' });
    assert.deepEqual(mine.visible(), ['on other']);
    // Removing the tablet replaces its link: it cannot come back with the old token.
    const old = server.hub.tokens.tablet;
    h.removePeer(t.client.id);
    await until(() => t.client.state === 'closed', 'removed');
    assert.notEqual(server.hub.tokens.tablet, old);
    assert.match(await closedWith(client(server, { token: old, role: 'tablet' })), /not valid/);
    h.close();
  } finally { await server.stop(); }
});

test('guests see the note live; they draw only when the notes are editable', async () => {
  const root = await reader();
  for (const notes of ['view', 'edit']) {
    const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes, hubOptions: { rate: { burst: 2000, perSecond: 2000 } } });
    try {
      const mine = new Replica();
      const h = host(server, mine, { yjs });
      await welcomed(h);
      h.documentChanged({ open: true, title: 'Exam' });
      await h.submit('draw', { page: 0, line: 'host-1' });
      // A guest is loaded like a tablet and follows every edit.
      const g = tablet(server, { token: server.hub.tokens.guest, role: 'guest', yjs });
      await until(() => g.client.loaded, 'snapshot');
      assert.deepEqual(g.replica.visible(), ['host-1']);
      await h.submit('draw', { line: 'host-2' });
      await until(() => g.client.seq === h.seq, 'follows');
      assert.deepEqual(g.replica.visible(), ['host-1', 'host-2']);
      if (notes === 'view') await assert.rejects(g.client.submit('draw', { line: 'guest' }), /Not allowed/);
      else {
        await g.client.submit('draw', { line: 'guest' });
        assert.deepEqual(mine.visible(), ['host-1', 'host-2', 'guest']);
      }
      assert.equal(g.client.canEdit, notes === 'edit');
      g.client.close(); h.close();
    } finally { await server.stop(); }
  }
});

test('online tablets join with their own link through the tunnel, never with the local one', async () => {
  const { default: WebSocket } = await import('ws');
  const { EventEmitter } = await import('node:events');
  const server = await startServer({ root: await reader(), host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null });
  const hello = (message) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/sync`, { headers: { Host: 'quiet-forest-1234.trycloudflare.com' } });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'iPad', ...message })));
    ws.on('message', (data, binary) => { if (binary) return; const m = JSON.parse(data.toString()); resolve(m.t === 'closed' ? 'refused' : m.t === 'welcome' ? `welcome ${m.role} ${m.token === message.token}` : m.t); ws.close(); });
    ws.on('error', () => resolve('refused'));
    ws.on('close', () => resolve('refused'));
  });
  try {
    const spawn = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => c.emit('exit', 0); setTimeout(() => c.stderr.emit('data', Buffer.from('https://quiet-forest-1234.trycloudflare.com')), 5); return c; };
    // A session without notes: online access is for tablets only.
    assert.equal(await server.goOnline({ binary: 'x', spawn }), '');
    const link = server.onlineTabletLink;
    assert.match(link, /^https:\/\/quiet-forest-1234\.trycloudflare\.com\/tablet#[0-9a-f]{8}\.[\w-]{22}$/);
    const online = link.split('.').pop();
    // The tablet gets its online token back to reconnect with.
    assert.equal(await hello({ token: online, role: 'tablet' }), 'welcome tablet true');
    assert.equal(await hello({ token: server.hub.tokens.tablet, role: 'tablet' }), 'refused');
    assert.equal(await hello({ code: server.code().code }), 'refused');
    server.stopOnline();
    assert.equal(server.onlineTabletLink, '');
    assert.equal(await hello({ token: online, role: 'tablet' }), 'refused');
  } finally { await server.stop(); }
});

test('notes: host and guests type at the same place and end with the same text; view-only edits are dropped', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: 'edit' });
  try {
    const h = host(server, new Replica(), { yjs });
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Exam', notes: '# Tema 2\n\n' });
    const a = client(server, { token: server.hub.tokens.guest, yjs });
    const b = client(server, { token: server.hub.tokens.guest, yjs, name: 'Ana' });
    await Promise.all([welcomed(a), welcomed(b)]);
    assert.equal(a.name, 'Guest 1');
    assert.equal(b.name, 'Ana');
    await until(() => a.text.toString() === '# Tema 2\n\n' && b.text.toString() === '# Tema 2\n\n' && h.text.toString() === '# Tema 2\n\n', 'initial notes');
    // Three people type at the end at once.
    applyTextDiff(h.text, h.text.toString() + 'host ');
    applyTextDiff(a.text, a.text.toString() + 'guest1 ');
    applyTextDiff(b.text, b.text.toString() + 'ana ');
    await until(() => new Set([h, a, b].map((c) => c.text.toString())).size === 1 && h.text.length === 26, 'merge');
    for (const word of ['host', 'guest1', 'ana']) assert.match(h.text.toString(), new RegExp(word));
    assert.equal(server.hub.text(), h.text.toString());
    // Presence: names and colours reach everyone; cursors travel as awareness.
    await until(() => h.peers.length === 3);
    assert.deepEqual(h.peers.map((p) => p.name).sort(), ['Ana', 'Guest 1', 'Host']);
    a.rename('Bea');
    await until(() => h.peers.some((p) => p.name === 'Bea'), 'rename');
    a.awareness.setLocalStateField('cursor', { index: 3 });
    await until(() => [...h.awareness.getStates().values()].some((s) => s.cursor?.index === 3), 'cursor');
    // A guest offline for a while: its edits merge when it reconnects.
    a.ws.close();
    a.attempt = 0; a.retries = [200];
    applyTextDiff(a.text, 'offline ' + a.text.toString());
    await until(() => a.state === 'open' && h.text.toString().startsWith('offline '), 'offline merge');
    a.close(); b.close(); h.close();
  } finally { await server.stop(); }
  const viewServer = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: 'view' });
  try {
    const h = host(viewServer, new Replica(), { yjs });
    await welcomed(h);
    h.documentChanged({ open: true, notes: 'shared' });
    const v = client(viewServer, { token: viewServer.hub.tokens.guest, yjs });
    await welcomed(v);
    assert.equal(v.canEdit, false);
    await until(() => v.text.toString() === 'shared');
    applyTextDiff(v.text, 'vandalised');
    applyTextDiff(h.text, 'shared!');
    await until(() => v.text.toString().includes('!'));
    await wait(100);
    assert.equal(h.text.toString(), 'shared!');
    assert.equal(viewServer.hub.text(), 'shared!');
    h.close(); v.close();
  } finally { await viewServer.stop(); }
});

test('ending: guests flush and keep a copy, the host gets the final text, the server stops', async () => {
  const root = await reader();
  let ended = null;
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', onEnded: (r) => { ended = r; } });
  const h = host(server, new Replica(), { yjs });
  await welcomed(h);
  h.documentChanged({ open: true, notes: 'start' });
  const g = client(server, { token: server.hub.tokens.guest, yjs });
  await until(() => g.text?.toString() === 'start');
  applyTextDiff(g.text, 'start, last words');
  h.end();
  await until(() => ended, 'end');
  assert.equal(ended.text, 'start, last words');
  await until(() => g.state === 'ended' && h.state === 'ended');
  assert.ok(g.events.some(([e, d]) => e === 'ending' && d.text === 'start, last words'));
  assert.equal(h.events.find(([e]) => e === 'ended')[1].text, 'start, last words');
  await assert.rejects(fetch(server.origin), /fetch failed/);
});

test('the session ends when the host disappears', async () => {
  const root = await reader();
  let ended = null;
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', onEnded: (r) => { ended = r; } });
  const h = host(server);
  await welcomed(h);
  const t = tablet(server, { token: server.hub.tokens.tablet });
  await welcomed(t.client);
  h.ws.close();
  await until(() => ended && t.client.state === 'ended');
  assert.equal(ended.reason, 'The host left.');
});

test('online access: only notes guests with the online link join through the tunnel', async () => {
  const { default: WebSocket } = await import('ws');
  const { EventEmitter } = await import('node:events');
  const server = await startServer({ root: await reader(), host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: 'edit' });
  // As cloudflared does: a connection from this computer, naming the tunnel's host.
  const hello = (message, headers = { Host: 'quiet-forest-1234.trycloudflare.com' }) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/sync`, { headers });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Ana', ...message })));
    ws.on('message', (data, binary) => { if (binary) return; const m = JSON.parse(data.toString()); if (m.t !== 'closed') { resolve(m.t); ws.close(); } else resolve('refused: ' + m.reason); });
    ws.on('unexpected-response', () => resolve('refused'));
    ws.on('error', () => resolve('refused'));
    ws.on('close', () => resolve('refused'));
  });
  const [, guest] = server.guestLink.split('#')[1].split('.');
  try {
    // Off: nothing from outside gets a session, not even with a valid invite.
    assert.equal(await hello({ token: guest }), 'refused');
    // On (a stand-in cloudflared that prints its address).
    let child;
    const spawn = () => { child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => child.emit('exit', 0); setTimeout(() => child.stderr.emit('data', Buffer.from('INF |  https://quiet-forest-1234.trycloudflare.com  |')), 10); return child; };
    const link = await server.goOnline({ binary: '/bin/cloudflared', spawn });
    assert.match(link, /^https:\/\/quiet-forest-1234\.trycloudflare\.com\/join#[0-9a-f]{8}\.[\w-]{22}$/);
    assert.equal(parseInvite(link).url, 'wss://quiet-forest-1234.trycloudflare.com/sync');
    const online = parseInvite(link).token;
    assert.notEqual(online, guest);
    // Online: the online link works; the local invite, a tablet, the code and the host token do not.
    assert.notEqual(await hello({ token: online }), 'refused');
    assert.match(await hello({ token: guest }), /^refused/);
    assert.match(await hello({ token: online, role: 'tablet' }), /^refused/);
    assert.match(await hello({ code: server.code().code }), /^refused/);
    assert.match(await hello({ token: server.hostToken }), /^refused/);
    // A Cloudflare header makes even a local-looking request remote.
    assert.match(await hello({ token: guest }, { Host: `127.0.0.1:${server.port}`, 'CF-Connecting-IP': '203.0.113.9' }), /^refused/);
    // This network is unchanged: the local invite still works.
    assert.notEqual(await hello({ token: guest }, { Host: `127.0.0.1:${server.port}` }), 'refused');
    // Off again: the online link stops working.
    server.stopOnline();
    assert.equal(server.onlineLink, '');
    assert.equal(await hello({ token: online }), 'refused');
  } finally { await server.stop(); }
});

test('the firewall hint names the running Linux firewall and the port to open', async () => {
  const active = (name) => async (_f, args) => (args[1] === name ? 'active\n' : 'inactive\n');
  assert.equal(await firewallHint(41237, { platform: 'darwin', run: active('firewalld') }), null);
  assert.deepEqual(await firewallHint(41237, { platform: 'linux', run: active('ufw') }), { name: 'ufw', command: 'sudo ufw allow 41237/tcp' });
  assert.match((await firewallHint(41237, { platform: 'linux', run: active('firewalld') })).command, /--permanent --add-port=41237\/tcp/);
  assert.equal(await firewallHint(41237, { platform: 'linux', run: async () => '' }), null);
});

test('the host’s auto-save switch reaches everyone, joiners included; others cannot change it', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: 'edit' });
  try {
    const h = host(server, new Replica(), { yjs });
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Exam' });
    const first = tablet(server, { token: server.hub.tokens.tablet });
    await welcomed(first.client);
    assert.equal(first.client.events.find(([t]) => t === 'welcome')[1].autosave, false);
    h.settings({ autosave: true });
    await until(() => first.client.events.some(([t, d]) => t === 'settings' && d.autosave === true), 'settings');
    // A guest who joins later learns it from the welcome; a guest cannot turn it off.
    const g = tablet(server, { token: server.hub.tokens.guest, role: 'guest', yjs });
    await welcomed(g.client);
    assert.equal(g.client.events.find(([t]) => t === 'welcome')[1].autosave, true);
    g.client.settings({ autosave: false });
    await wait(200);
    assert.equal(server.hub.autosave, true);
    first.client.close(); g.client.close(); h.close();
  } finally { await server.stop(); }
});

test('reader files are compressed and kept by the browser, checked on each use', async () => {
  const root = await reader();
  const big = `export const text = ${JSON.stringify('note '.repeat(5000))};\n`;
  await writeFile(path.join(root, 'pkg', 'big.js'), big);
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(pickEncoding(''), '');
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0 });
  try {
    const url = `${server.origin}/pkg/big.js`;
    // fetch unzips on its own: read the raw bytes with node:http instead.
    const raw = (encoding, extra = {}) => new Promise((resolve, reject) => {
      import('node:http').then(({ get }) => get(url, { headers: { 'Accept-Encoding': encoding, ...extra } }, (res) => {
        const parts = [];
        res.on('data', (d) => parts.push(d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      }).on('error', reject));
    });
    const zipped = await raw('gzip, deflate');
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.equal(zipped.headers.vary, 'Accept-Encoding');
    assert.ok(zipped.body.length < big.length / 10, 'much smaller');
    assert.equal(gunzipSync(zipped.body).toString(), big);
    const br = await raw('gzip, br');
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(brotliDecompressSync(br.body).toString(), big);
    const plain = await raw('identity');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), big);
    // Kept, but checked each time: the same version is a 304 with no body.
    assert.equal(zipped.headers['cache-control'], 'no-cache');
    assert.ok(zipped.headers['last-modified']);
    assert.notEqual(zipped.headers.etag, plain.headers.etag, 'each encoding its own validator');
    const again = await raw('gzip', { 'If-None-Match': zipped.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    // A changed file is sent again.
    await wait(20);
    await writeFile(path.join(root, 'pkg', 'big.js'), big + '// changed\n');
    const changed = await raw('gzip', { 'If-None-Match': zipped.headers.etag });
    assert.equal(changed.status, 200);
    assert.match(gunzipSync(changed.body).toString(), /changed/);
    // Small files go as they are.
    const small = await fetch(`${server.origin}/pkg/a.js`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(small.headers.get('content-encoding'), null);
    assert.equal(small.headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(`${server.origin}/nothing.js`)).headers.get('cache-control'), 'no-store');
  } finally { await server.stop(); }
});

test('snapshots go gzipped to joiners that can unzip them, plain to others', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null });
  // The snapshot frames each joiner receives: their header.
  const headers = [];
  class Spy extends WebSocket {
    set onmessage(fn) {
      super.onmessage = (event) => {
        if (typeof event.data !== 'string' && new Uint8Array(event.data)[0] === 2) {
          const bytes = new Uint8Array(event.data), length = new DataView(event.data).getUint32(1);
          headers.push({ ...JSON.parse(new TextDecoder().decode(bytes.subarray(5, 5 + length))), bytes: bytes.length });
        }
        fn(event);
      };
    }
  }
  try {
    const mine = new Replica();
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Exam' });
    for (let i = 0; i < 50; i++) await h.submit('draw', { line: `a long enough line to compress ${i}` });
    // `chunks: false` is a joiner from before notes came in parts: one gzipped frame.
    const zipped = tablet(server, { token: server.hub.tokens.tablet, WebSocketImpl: Spy, chunks: false });
    await until(() => zipped.client.loaded, 'gzipped snapshot');
    const plain = tablet(server, { token: server.hub.tokens.tablet, WebSocketImpl: Spy, gzip: false });
    await until(() => plain.client.loaded, 'plain snapshot');
    assert.equal(headers[0].enc, 'gzip');
    assert.equal(headers[1].enc, undefined);
    assert.ok(headers[0].bytes < headers[1].bytes / 2, `${headers[0].bytes} < ${headers[1].bytes} / 2`);
    assert.equal(zipped.replica.digest(), mine.digest());
    assert.equal(plain.replica.digest(), mine.digest());
    zipped.client.close(); plain.client.close(); h.close();
  } finally { await server.stop(); }
});

test('a joiner back after a dropped connection gets only the edits it missed', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null, hubOptions: { rate: { burst: 2000, perSecond: 2000 } } });
  let asked = 0;
  const request = server.hub.requestSnapshot.bind(server.hub);
  server.hub.requestSnapshot = (peer) => { asked++; return request(peer); };
  try {
    const mine = new Replica();
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Exam' });
    await h.submit('draw', { line: 'one' });
    const t = tablet(server, { token: server.hub.tokens.tablet, retries: [200, 200, 200] });
    await until(() => t.client.loaded, 'snapshot');
    assert.equal(asked, 1);
    const drop = async () => {
      const welcomes = t.client.events.filter(([e]) => e === 'welcome').length;
      t.client.ws.close();
      await until(() => t.client.state !== 'open', 'dropped');
      return () => t.client.events.filter(([e]) => e === 'welcome').length > welcomes;
    };
    // Edits made while it was away (it retries after 200 ms) arrive once it is back; no new snapshot.
    let back = await drop();
    await h.submit('draw', { line: 'two' });
    await until(back, 'reconnected');
    assert.equal(t.client.events.findLast(([e]) => e === 'welcome')[1].resumed, true);
    await until(() => t.client.seq === h.seq, 'caught up');
    assert.deepEqual(t.replica.visible(), ['one', 'two']);
    assert.equal(asked, 1);
    await t.client.submit('draw', { line: 'three' });
    assert.deepEqual(mine.visible(), ['one', 'two', 'three']);
    // The host opened another note meanwhile: that one is loaded whole.
    back = await drop();
    mine.history = []; mine.cursor = 0;
    h.documentChanged({ open: true, title: 'Other' });
    await until(back, 'reconnected');
    assert.equal(t.client.events.findLast(([e]) => e === 'welcome')[1].resumed, false);
    await until(() => t.client.loaded && t.client.gen === h.gen && asked === 2, 'reloaded');
    assert.deepEqual(t.replica.visible(), []);
    t.client.close(); h.close();
  } finally { await server.stop(); }
});

test('a big note arrives in parts, and the joiner and the host both see how far it is', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null });
  try {
    // A note past the size where only entropy coding is used (the note's own bytes, in base64).
    const mine = new Replica();
    mine.history.push(randomBytes(26 * 1024 * 1024).toString('base64')); mine.cursor = 1;
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Big note' });
    const t = tablet(server, { token: server.hub.tokens.tablet });
    await until(() => t.client.loaded, 'the big snapshot', 60000);
    // The joiner saw every stage in order, the bytes only going up to the whole.
    const stages = t.client.events.filter(([type]) => type === 'progress').map(([, d]) => d);
    const order = [...new Set(stages.map((d) => d.stage))];
    assert.deepEqual(order, ['preparing', 'receiving', 'opening', 'ready']);
    const receiving = stages.filter((d) => d.stage === 'receiving');
    assert.ok(receiving.length > 10, `${receiving.length} parts`);
    assert.ok(receiving.every((d, i) => d.total > 30e6 && (i === 0 || d.done >= receiving[i - 1].done)));
    assert.equal(receiving.at(-1).done, receiving[0].total, 'ends at the whole');
    assert.equal(t.replica.digest(), mine.digest());
    // The host was told who was loading and how far, then that nobody is.
    await until(() => h.events.some(([type, d]) => type === 'loading' && d.length === 0), 'the host told loading ended');
    const lists = h.events.filter(([type]) => type === 'loading').map(([, d]) => d);
    const seen = lists.flat().filter((p) => p.role === 'tablet');
    assert.ok(seen.some((p) => p.stage === 'preparing' || p.stage === 'sending'), JSON.stringify(seen.slice(0, 3)));
    assert.ok(seen.every((p) => p.total >= 0 && p.done <= (p.total || Infinity)));
    t.client.close(); h.close();
  } finally { await server.stop(); }
});

test('a copy that drifts is caught within seconds on a quiet note, and the host is told', async () => {
  const root = await reader();
  // The count-based check would wait for 1000 edits; only the timer can notice this one.
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null, hubOptions: { checkEvery: 1000, checkInterval: 80 } });
  try {
    const mine = new Replica();
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Quiet' });
    await h.submit('draw', { page: 0, line: 'one' });
    const t = tablet(server, { token: server.hub.tokens.tablet });
    await until(() => t.client.loaded, 'snapshot');
    // A few edits, then a copy goes wrong and nothing more is drawn.
    await h.submit('draw', { page: 0, line: 'two' });
    await until(() => t.client.seq === h.seq, 'caught up');
    t.replica.history[0] = 'stray';
    await h.submit('draw', { page: 0, line: 'three' });
    await until(() => t.client.events.some(([e, d]) => e === 'status' && d.state === 'resync'), 'resync by the timer', 4000);
    await until(() => t.client.loaded && t.client.seq === h.seq, 'reloaded');
    assert.equal(t.replica.digest(), mine.digest());
    assert.ok(h.events.some(([e, d]) => e === 'resynced' && /Tablet/.test(d.name)), 'the host was told which copy was reloaded');
    t.client.close(); h.close();
  } finally { await server.stop(); }
});

test('edits made while a big note is still being sent arrive after it, in order', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null, hubOptions: { rate: { burst: 5000, perSecond: 5000 }, checkInterval: 0 } });
  try {
    const mine = new Replica();
    mine.history.push(randomBytes(20 * 1024 * 1024).toString('base64')); mine.cursor = 1;
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Big' });
    await h.submit('draw', { line: 'before' });
    // The host keeps drawing (and the tablet joins) while the snapshot is on its way.
    const t = tablet(server, { token: server.hub.tokens.tablet });
    const drawing = (async () => { for (let i = 0; i < 40; i++) { await h.submit('draw', { line: `during-${i}` }); await wait(15); } })();
    await until(() => t.client.state === 'open', 'welcome');
    await Promise.all([drawing, until(() => t.client.loaded, 'the big snapshot', 60000)]);
    await h.submit('draw', { line: 'after' });
    await until(() => t.client.seq === h.seq, 'caught up');
    assert.equal(t.replica.visible().length, mine.visible().length);
    assert.equal(t.replica.digest(), mine.digest());
    assert.equal(t.replica.visible().at(-1), 'after');
    // Some edits really were made while it was being sent (otherwise this proved nothing).
    const receiving = t.client.events.findIndex(([e, d]) => e === 'progress' && d.stage === 'receiving');
    assert.ok(receiving >= 0 && h.seq > 20, `seq ${h.seq}`);
    t.client.close(); h.close();
  } finally { await server.stop(); }
});

test('a connection that goes quiet is dropped and resumed from the edit log, not reloaded', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null, hubOptions: { checkInterval: 0 } });
  const state = { muted: null };
  // A tablet whose socket stops hearing the hub (but can still send), like a half-dead Wi-Fi link.
  class Deaf extends WebSocket {
    set onmessage(fn) { super.onmessage = (event) => { if (state.muted === this) return; fn(event); }; }
  }
  try {
    const mine = new Replica();
    const h = host(server, mine);
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Quiet' });
    await h.submit('draw', { line: 'one' });
    const t = tablet(server, { token: server.hub.tokens.tablet, WebSocketImpl: Deaf, retries: [20, 20, 20], heartbeat: { every: 40, dead: 160 } });
    await until(() => t.client.loaded, 'snapshot');
    const welcomes = () => t.client.events.filter(([e]) => e === 'welcome').length;
    assert.equal(welcomes(), 1);
    const snapshots = server.hub.requestSnapshot;
    let asked = 0;
    server.hub.requestSnapshot = (p) => { asked++; return snapshots.call(server.hub, p); };
    state.muted = t.client.ws;
    await h.submit('draw', { line: 'made while it was deaf' });
    await until(() => t.client.events.some(([e, d]) => e === 'status' && d.state === 'reconnecting'), 'the quiet link noticed', 3000);
    await until(() => welcomes() === 2 && t.client.loaded && t.client.seq === h.seq, 'resumed', 3000);
    assert.equal(asked, 0, 'no new snapshot: only the missed edits came');
    assert.deepEqual(t.replica.visible(), ['one', 'made while it was deaf']);
    assert.equal(t.replica.digest(), mine.digest());
    t.client.close(); h.close();
  } finally { await server.stop(); }
});

test('a text document open on the host is shown to guests as text, and follows the host', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: 'edit' });
  const texts = (c) => c.events.filter(([e]) => e === 'text').map(([, d]) => d);
  try {
    const h = host(server, new Replica(), { yjs });
    await welcomed(h);
    // The host opens a Markdown file: not a drawn note (open: false), but its text is shared.
    h.documentChanged({ open: false, title: 'Apuntes', notes: '', text: { name: 'Apuntes.md', markdown: true, content: '# Tema 1\n\nHola' } });
    // A guest that joins afterwards gets it at once; a tablet gets nothing to draw on, and no text.
    const g = tablet(server, { token: server.hub.tokens.guest, role: 'guest', yjs });
    const t = tablet(server, { token: server.hub.tokens.tablet });
    await until(() => texts(g.client).length > 0, 'the text on the guest');
    assert.deepEqual(texts(g.client).at(-1), { t: 'text', shared: true, name: 'Apuntes.md', markdown: true, content: '# Tema 1\n\nHola' });
    await welcomed(t.client);
    assert.equal(texts(t.client).length, 0);
    // The host types: guests get the new text a moment later.
    h.textChanged({ name: 'Apuntes.md', markdown: true, content: '# Tema 1\n\nHola mundo' });
    await until(() => texts(g.client).at(-1)?.content === '# Tema 1\n\nHola mundo', 'the edit on the guest');
    // Only the host may set it.
    g.client.send({ t: 'text', name: 'x.md', markdown: true, content: 'not allowed' });
    await wait(100);
    assert.equal(texts(g.client).at(-1).content, '# Tema 1\n\nHola mundo');
    // Too long: guests are told it cannot be shown, not sent it.
    h.textChanged({ name: 'Grande.md', markdown: true, content: 'x'.repeat(5 * 1024 * 1024) });
    await until(() => texts(g.client).at(-1)?.tooBig, 'too big');
    assert.equal(texts(g.client).at(-1).content, undefined);
    // The host moves to a drawn note: the text is gone for guests.
    h.documentChanged({ open: true, title: 'Dibujo', notes: '' });
    await until(() => texts(g.client).at(-1)?.shared === false, 'the text withdrawn');
    g.client.close(); t.client.close(); h.close();
  } finally { await server.stop(); }
});

test('the 6-digit code brings a guest of the notes as well as a drawing tablet', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: 'edit' });
  try {
    const h = host(server, new Replica(), { yjs });
    await welcomed(h);
    const code = server.code().code;
    // A guest enters the address and the code: it is a guest (notes), and gets a token to come back with.
    const g = client(server, { code, role: 'guest', yjs });
    await welcomed(g);
    assert.equal(g.events.find(([e]) => e === 'welcome')[1].role, 'guest');
    assert.equal(g.token, server.hub.tokens.guest);
    // The same code still brings a tablet (the default), with the tablet's token.
    const t = client(server, { code, role: 'tablet' });
    await welcomed(t);
    assert.equal(t.events.find(([e]) => e === 'welcome')[1].role, 'tablet');
    assert.equal(t.token, server.hub.tokens.tablet);
    // A wrong code is refused for guests too, and counts against the five tries.
    assert.match(await closedWith(client(server, { code: '000000', role: 'guest', yjs })), /Wrong code/);
    g.close(); t.close(); h.close();
  } finally { await server.stop(); }
  // A session that shares no notes does not let a guest in by code.
  const quiet = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null });
  try {
    assert.match(await closedWith(client(quiet, { code: quiet.code().code, role: 'guest' })), /shares no notes/);
  } finally { await quiet.stop(); }
});

test('study material goes from one NoteComplete to another through the sharing server, and the host decides', async () => {
  const { sendPack } = await import('../reader/sync.js');
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null });
  try {
    const h = host(server, new Replica());
    await welcomed(h);
    const parts = new Map(), begun = [];
    // The receiving side: assemble the parts, answer when done.
    const watch = (type, detail) => {
      if (type === 'pack-begin') begun.push(detail);
      if (type === 'pack-part') { const list = parts.get(detail.id) || []; list[detail.index] = detail.data; parts.set(detail.id, list); }
    };
    h.events.push = ((push) => (...entry) => { watch(...entry[0]); return push.apply(h.events, entry); })(h.events.push);
    const invite = { url: server.hostUrl, code: server.code().code, role: 'sender' };
    const big = JSON.stringify({ format: 'notecomplete-study', version: 1, notes: 'é'.repeat(1200000) });   // three parts
    const sent = sendPack(invite, big, { name: 'Ana', timeout: 8000 });
    await until(() => begun.length === 1 && parts.get(begun[0].id)?.filter(Boolean).length === begun[0].parts, 'the parts at the host', 8000);
    assert.equal(begun[0].from, 'Ana');
    assert.equal(begun[0].parts, 3);
    assert.equal(parts.get(begun[0].id).join(''), big, 'the host has exactly what was sent, accents included');
    // The host accepts: the sender is told what was done.
    h.packResult(begun[0].id, true, 'Added 2 decks.');
    assert.deepEqual(await sent, { message: 'Added 2 decks.' });
    // Declined: the sender gets the reason as an error.
    const again = sendPack(invite, '{"x":1}', { timeout: 8000 });
    await until(() => begun.length === 2, 'the second pack');
    h.packResult(begun[1].id, false, 'Declined.');
    await assert.rejects(again, /Declined/);
    // Too big is refused before anything is sent on; a wrong PIN is refused at the door.
    await assert.rejects(sendPack({ ...invite, code: '000000' }, '{}', { timeout: 4000 }), /Wrong code/);
    const huge = sendPack(invite, 'x'.repeat(25 * 1024 * 1024), { timeout: 4000 });
    await assert.rejects(huge, /too much/);
    // A sender is not a guest: it never receives the notes or the note, and shows to nobody as a person to follow.
    await until(() => ![...server.hub.peers.values()].some((p) => p.role === 'sender'), 'the sender gone when done');
    h.close();
  } finally { await server.stop(); }
});

test('a sender that leaves in the middle makes the host drop the partial pack', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: null });
  try {
    const h = host(server, new Replica());
    await welcomed(h);
    const ws = new WebSocket(server.hostUrl);
    await new Promise((resolve) => { ws.onopen = resolve; });
    ws.send(JSON.stringify({ t: 'hello', code: server.code().code, role: 'sender', name: 'Leo' }));
    await new Promise((resolve) => { ws.onmessage = ({ data }) => { if (JSON.parse(data).t === 'welcome') resolve(); }; });
    ws.send(JSON.stringify({ t: 'pack-begin', id: 'a1', size: 100, parts: 2 }));
    ws.send(JSON.stringify({ t: 'pack-part', id: 'a1', index: 0, data: 'x'.repeat(50) }));
    await until(() => h.events.some(([e]) => e === 'pack-begin'), 'begin');
    ws.close();
    await until(() => h.events.some(([e]) => e === 'pack-cancel'), 'cancel');
    h.close();
  } finally { await server.stop(); }
});

test('the send link admits senders only: a token that cannot make a guest or a tablet', async () => {
  const root = await reader();
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, notes: 'edit' });
  try {
    const h = host(server, new Replica());
    await welcomed(h);
    const token = server.sendLink().split('.').pop();
    assert.match(server.sendLink(), /\/send#[\w-]+\.[\w-]+$/);
    const sender = client(server, { token, role: 'sender' });
    await welcomed(sender);
    assert.equal(sender.events.find(([e]) => e === 'welcome')[1].role, 'sender');
    // The same token does not make a guest or a drawing tablet.
    assert.match(await closedWith(client(server, { token, role: 'guest', yjs })), /not valid/);
    assert.match(await closedWith(client(server, { token, role: 'tablet' })), /not valid/);
    // And no other token makes a sender except the local guest, tablet and PIN ones.
    assert.match(await closedWith(client(server, { token: 'nope', role: 'sender' })), /not valid/);
    sender.close(); h.close();
  } finally { await server.stop(); }
});
