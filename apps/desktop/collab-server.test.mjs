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
import { startServer, lanAddress, readerFile } from './collab-server.js';
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
    // Guests cannot draw, and the tablet cannot edit pages.
    const g = client(server, { token: server.hub.tokens.guest });
    await welcomed(g);
    await assert.rejects(g.submit('draw', { line: {} }), /Not allowed/);
    await assert.rejects(t.client.submit('insertPages', {}), /Not allowed/);
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
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: null, hubOptions: { rate: { burst: 2000, perSecond: 2000 } } });
  try {
    const mine = new Replica();
    const h = host(server, mine, { checkEvery: 5 });
    await welcomed(h);
    h.documentChanged({ open: true, title: 'Exam' });
    await h.submit('draw', { page: 0, line: 'host-1' });
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
