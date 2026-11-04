// One sharing session (docs/COLLABORATION.md): the host's notes and ink, shared with guests
// and drawing tablets. Pure session logic with no sockets, so it runs behind the desktop's
// LAN server (collab-server.js) today and could run behind a relay later.
//
// Two kinds of shared state travel on the same connection:
// - Markdown notes: a Yjs document (Y.Text "notes"), merged as a CRDT. Binary frames, first
//   byte 0 (y-protocols sync) or 1 (awareness: cursors and selections).
// - Ink: the core's edit history. Edits are not merged but put in one order: the hub numbers
//   each edit (`seq`) and sends it to every peer that holds the document, the host included,
//   and each applies it to its own core. Same snapshot + same edits in the same order = the
//   same document, with the same item ids ("new:<index>"), so undo is the shared history's.
//   A snapshot (binary frame, first byte 2) brings a joining tablet to the current state.
// Everything else is a JSON text frame `{ t: type, ... }`.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createGzip, gzip as gzipCallback, constants as zlib } from 'node:zlib';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// chunk: a piece of a snapshot sent in parts ([3][id u32][plain bytes so far u32][gzip data]).
export const FRAME = { sync: 0, awareness: 1, snapshot: 2, chunk: 3 };
// A big note is sent in parts, so the joiner (and the host) can see how far it is: the note
// is fed to the compressor a slice at a time, and the next slice waits while the joiner's
// socket still holds AHEAD bytes, so the progress is what has really crossed the network.
const SLICE = 1 << 20, AHEAD = 8 << 20;
// Past this size the note's own bytes (already compressed, in base64) are nearly all of the
// snapshot: gzip's search for repeats finds nothing and costs four times as long, so only
// its entropy coding is used (about 1% larger).
const FAST_ABOVE = 32 << 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function chunkFrame(id, done, data) {
  const out = Buffer.alloc(9 + data.length);
  out[0] = FRAME.chunk;
  out.writeUInt32BE(id >>> 0, 1);
  out.writeUInt32BE(done >>> 0, 5);
  data.copy(out, 9);
  return out;
}
// Edits a peer may send, by role. Tablets (and guests who may draw) draw, highlight, tape,
// erase, type text, add blank pages and undo; the host edits anything.
export const TABLET_OPS = new Set(['draw', 'erase', 'undo', 'redo', 'insertPages', 'image', 'editText', 'remove']);
export const HOST_OPS = new Set([...TABLET_OPS, 'adjust', 'crop', 'lock', 'layer', 'resize', 'resizePage', 'resizePages', 'insertHandwritten']);
// Of those, a tablet adds only blank pages and typed text: a PDF or a picture stays the host's
// to bring in (they are large, and come from the computer's files).
export function tabletMay(op, args) {
  if (op === 'insertPages') {
    const pages = args?.pages;
    return !args.pdf && Array.isArray(pages) && pages.length >= 1 && pages.length <= 10
      && pages.every((p) => p && Object.keys(p).length === 1 && Array.isArray(p.size) && p.size.length === 2 && p.size.every((v) => Number.isFinite(v) && v > 0));
  }
  if (op === 'image') return typeof args?.image === 'object' && !!args.image?.text && !args.image.base64;
  return true;
}
export const COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#ad7f58'];
const LOG_LIMIT = 20000;
// A shared text document (a .txt or Markdown file open on the host) goes to guests as text, up to this long.
const TEXT_LIMIT = 4 * 1024 * 1024;
// Study material sent by another NoteComplete (a `sender`): in parts of at most PACK_PART characters,
// at most PACK_LIMIT in all. The hub only passes the parts on to the host, who decides.
const PACK_LIMIT = 24 * 1024 * 1024, PACK_PART = 700 * 1024, PACK_PARTS = 64;
const gzip = promisify(gzipCallback);

const token = () => randomBytes(16).toString('base64url');
const pairingCode = () => String(randomBytes(4).readUInt32BE() % 1e6).padStart(6, '0');
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function packSnapshot(header, payload) {
  const head = Buffer.from(JSON.stringify(header));
  const out = Buffer.alloc(5 + head.length + payload.length);
  out[0] = FRAME.snapshot;
  out.writeUInt32BE(head.length, 1);
  head.copy(out, 5);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(out, 5 + head.length);
  return out;
}
export function unpackSnapshot(frame) {
  const bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const length = bytes.readUInt32BE(1);
  return { header: JSON.parse(bytes.subarray(5, 5 + length).toString()), payload: bytes.subarray(5 + length) };
}

export class CollabHub {
  // notes: 'edit' | 'view' | null (no notes shared, tablets only). The clock and limits are
  // options for the tests.
  constructor({ notes = 'edit', maxPeers = 10, now = Date.now, codeLife = 10 * 60e3, flushWait = 2000, rate = { burst: 800, perSecond: 400 }, maxMessage = 2 * 1024 * 1024, checkEvery = 100, checkInterval = 10000, onEnded = () => {} } = {}) {
    Object.assign(this, { notes, maxPeers, now, codeLife, flushWait, rate, maxMessage, checkEvery, checkInterval, onEnded });
    this.checked = 0;
    this.digests = new Map();
    this.streams = 0;
    this.id = randomBytes(4).toString('hex');
    this.tokens = { host: token(), guest: token(), tablet: token() };
    this.newCode();
    this.peers = new Map();
    this.next = 1;
    this.state = 'open';
    // Ink: the document generation (a new note on the host starts a new one), its edit log.
    this.gen = 0;
    this.open = false;
    this.title = '';
    // The host's auto-save switch: everyone in the session follows it (autosave.js).
    this.autosave = false;
    this.seq = 0;
    this.log = [];
    this.requests = new Map();
    this.request = 0;
    this.resetNotes('');
  }
  newCode() {
    this.code = { value: pairingCode(), expires: this.now() + this.codeLife, failures: 0 };
  }
  // Called by the transport for each new connection; returns the peer it reports to.
  // `remote`: the connection came through the online tunnel (tunnel.js), not this network.
  connect(transport, { remote = false } = {}) {
    const peer = { id: this.next++, transport, remote, role: null, name: '', color: '', synced: false, clients: new Set(), tokens: this.rate.burst, refilled: this.now(), flushed: false };
    this.peers.set(peer.id, peer);
    return {
      id: peer.id,
      receive: (data, binary) => this.receive(peer, data, binary),
      closed: () => this.drop(peer),
    };
  }
  get host() {
    for (const p of this.peers.values()) if (p.role === 'host') return p;
    return null;
  }
  members() {
    return [...this.peers.values()].filter((p) => p.role);
  }
  send(peer, message) {
    try { peer.transport.send(typeof message === 'string' || message instanceof Uint8Array ? message : JSON.stringify(message)); }
    catch { /* A closing socket; its close event drops the peer. */ }
  }
  broadcast(message, filter = () => true) {
    const data = typeof message === 'string' || message instanceof Uint8Array ? message : JSON.stringify(message);
    for (const p of this.members()) if (filter(p)) this.send(p, data);
  }
  kick(peer, code, reason) {
    this.send(peer, { t: 'closed', reason });
    try { peer.transport.close(code, reason); } catch { /* Already closed. */ }
    this.drop(peer);
  }
  allowed(peer) {
    // A token bucket: bursts of strokes and typing are fine, a flood is disconnected.
    const now = this.now();
    peer.tokens = Math.min(this.rate.burst, peer.tokens + ((now - peer.refilled) / 1000) * this.rate.perSecond);
    peer.refilled = now;
    if (peer.role === 'host') return true;
    if (peer.tokens < 1) return false;
    peer.tokens--;
    return true;
  }
  receive(peer, data, binary) {
    if (!this.peers.has(peer.id) || this.state === 'ended') return;
    if (!this.allowed(peer)) return this.kick(peer, 1008, 'Too many messages');
    // Only the host sends big messages (snapshots, images it places).
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (peer.role !== 'host' && size > this.maxMessage) return this.kick(peer, 1009, 'Message too big');
    if (binary) {
      if (!peer.role) return this.kick(peer, 1008, 'Say hello first');
      return this.binary(peer, data instanceof Uint8Array ? data : new Uint8Array(data));
    }
    let message;
    try { message = JSON.parse(String(data)); } catch { return this.kick(peer, 1003, 'Invalid message'); }
    if (!message || typeof message.t !== 'string') return this.kick(peer, 1003, 'Invalid message');
    if (!peer.role) return message.t === 'hello' ? this.hello(peer, message) : this.kick(peer, 1008, 'Say hello first');
    const handler = this[`on_${message.t}`];
    if (typeof handler !== 'function') return;
    handler.call(this, peer, message);
  }
  // First message: a token (host, guest invite or tablet link) or a tablet pairing code.
  // Online access: separate invites that work through the tunnel, one for notes guests (when
  // notes are shared) and one for drawing tablets. Turning it off revokes both and
  // disconnects everyone who came in that way.
  allowOnline() {
    this.tokens.online = this.notes ? token() : null;
    this.tokens.onlineTablet = token();
    return { guest: this.tokens.online, tablet: this.tokens.onlineTablet };
  }
  closeOnline() {
    this.tokens.online = null;
    this.tokens.onlineTablet = null;
    for (const p of [...this.peers.values()]) if (p.remote) this.kick(p, 1008, 'Online access was turned off.');
  }
  hello(peer, { token, code, name, role, accept, have }) {
    let granted = null;
    // Through the tunnel only the online invites work: never the host's token, the local
    // invites or the 6-digit code.
    if (peer.remote) {
      if (token && this.notes && this.tokens.online && same(token, this.tokens.online) && role !== 'tablet') granted = role === 'sender' ? 'sender' : 'guest';
      else if (token && this.tokens.onlineTablet && same(token, this.tokens.onlineTablet)) granted = 'tablet';
      else return this.kick(peer, 1008, 'This invite does not work from another network. Ask for the online link.');
    } else if (token && same(token, this.tokens.host) && !this.host) granted = 'host';
    else if (token && same(token, this.tokens.tablet)) granted = 'tablet';
    else if (token && this.notes && same(token, this.tokens.guest)) granted = role === 'tablet' ? null : role === 'sender' ? 'sender' : 'guest';
    else if (code != null) {
      if (this.now() > this.code.expires || this.code.failures >= 5) return this.kick(peer, 1008, 'This code expired. Show a new code on the computer.');
      // The same code brings a drawing tablet, or a guest of the notes (who says so).
      if (same(String(code).replace(/\D/g, ''), this.code.value)) {
        if (role === 'guest' && !this.notes) return this.kick(peer, 1008, 'This session shares no notes. Join as a drawing tablet.');
        granted = role === 'guest' ? 'guest' : role === 'sender' ? 'sender' : 'tablet';
      } else {
        this.code.failures++;
        return this.kick(peer, 1008, 'Wrong code.');
      }
    }
    if (!granted) return this.kick(peer, 1008, 'This invite is not valid.');
    if (this.state !== 'open') return this.kick(peer, 1008, 'The session is ending.');
    if (granted !== 'host' && this.members().filter((p) => p.role !== 'host').length >= this.maxPeers) return this.kick(peer, 1008, 'The session is full.');
    peer.role = granted;
    // A joiner that can unzip gets the note's snapshot gzipped (a third smaller or more).
    peer.gzip = Array.isArray(accept) && accept.includes('gzip');
    // A joiner that can take the note in parts shows how far it is (older ones get it whole).
    peer.chunks = peer.gzip && accept.includes('chunks');
    const resumed = this.follows(peer) && this.open && !!this.host && this.canResume(have);
    const taken = new Set(this.members().map((p) => p.color));
    peer.color = COLORS.find((c) => !taken.has(c)) || COLORS[peer.id % COLORS.length];
    peer.name = clean(name) || (granted === 'host' ? 'Host' : granted === 'tablet' ? 'Tablet' : granted === 'sender' ? 'Sender' : this.guestName());
    this.send(peer, {
      t: 'welcome', id: peer.id, role: granted, name: peer.name, color: peer.color, session: this.id,
      canEdit: granted === 'host' || (granted === 'guest' && this.notes === 'edit'),
      notes: granted !== 'tablet' && !!this.notes,
      // A tablet or guest paired with a code reconnects with the full token.
      token: granted === 'tablet' ? (peer.remote ? this.tokens.onlineTablet : this.tokens.tablet) : granted === 'guest' && !peer.remote ? this.tokens.guest : undefined,
      gen: this.gen, open: this.open, title: this.title, autosave: this.autosave, resumed,
    });
    this.sendPeers();
    if (granted === 'host') {
      peer.synced = true;
      // Tablets and guests that came first wait for the host's document.
      for (const p of this.members()) if (this.follows(p) && !p.synced && this.open) this.requestSnapshot(p);
    }
    if (resumed) this.catchUp(peer, have.seq);
    else if (this.follows(peer) && this.open && this.host) this.requestSnapshot(peer);
    if ((peer.role === 'host' || peer.role === 'guest') && this.notes) this.startNotes(peer);
    if (this.docText) this.sendText(peer);
  }
  // A tablet or guest back after a dropped connection, with this note as it was at edit `seq`:
  // the edits since then are enough when the log still has them, so it does not download
  // the whole note again.
  canResume(have) {
    if (!have || have.session !== this.id || have.gen !== this.gen || !Number.isInteger(have.seq) || have.seq < 0 || have.seq > this.seq) return false;
    return have.seq === this.seq || (this.log.length > 0 && this.log[0].seq <= have.seq + 1);
  }
  catchUp(peer, seq) {
    for (const entry of this.log) if (entry.seq > seq) this.send(peer, JSON.stringify(entry));
    peer.synced = true;
  }
  // Who follows the note itself: drawing tablets and notes guests (both get its snapshot
  // and every edit). Who may change it: the host, tablets, and guests when notes are 'edit'.
  follows(p) { return p.role === 'tablet' || p.role === 'guest'; }
  draws(p) { return p.role === 'host' || p.role === 'tablet' || (p.role === 'guest' && this.notes === 'edit'); }
  guestName() {
    const used = new Set(this.members().map((p) => p.name));
    for (let n = 1; ; n++) if (!used.has(`Guest ${n}`)) return `Guest ${n}`;
  }
  sendPeers() {
    const peers = this.members().map(({ id, name, color, role }) => ({ id, name, color, role }));
    this.broadcast({ t: 'peers', peers });
  }
  drop(peer) {
    if (!this.peers.delete(peer.id)) return;
    if (peer.stage) this.loadingChanged();
    // A sender that left before the end: the host drops what it had of the pack.
    if (peer.pack && this.host) this.send(this.host, { t: 'pack-cancel', id: `${peer.id}:${peer.pack.id}` });
    if (peer.clients.size) awarenessProtocol.removeAwarenessStates(this.awareness, [...peer.clients], peer);
    if (peer.role) this.sendPeers();
    for (const waiting of this.requests.values()) waiting.delete(peer.id);
    // The host vanished (crash, closed socket): the session ends for everyone.
    if (peer.role === 'host' && this.state !== 'ended') this.finish('The host left.');
    else if (this.state === 'ending') this.maybeFinish();
  }
  on_rename(peer, { name }) {
    const value = clean(name);
    if (!value) return;
    peer.name = value;
    this.sendPeers();
  }

  // The host's session settings (auto-save on or off), passed on to everyone.
  on_settings(peer, { autosave }) {
    if (peer.role !== 'host') return;
    this.autosave = !!autosave;
    this.broadcast({ t: 'settings', autosave: this.autosave });
  }

  // Ink ----------------------------------------------------------------------------------
  // The host opened another note (or closed it): a new generation, and tablets reload.
  on_doc(peer, { open, title }) {
    if (peer.role !== 'host') return;
    this.docText = null;
    this.gen++;
    this.open = !!open;
    this.title = clean(title, 200);
    this.seq = 0;
    this.checked = 0;
    this.log = [];
    this.digests.clear();
    this.requests.clear();
    this.broadcast({ t: 'doc', gen: this.gen, open: this.open, title: this.title });
    this.sendText();
    for (const p of this.members()) {
      if (!this.follows(p)) continue;
      p.synced = false;
      if (this.open) this.requestSnapshot(p);
    }
  }
  // Study material from another NoteComplete (docs/COLLABORATION.md, "Sending study material"):
  // `pack-begin { id, size, parts }`, then `pack-part { id, index, data }` for each part; the hub
  // gives the host `pack-begin { id: "<sender>:<id>", from, size, parts }` and the parts, and the
  // host's `pack-result { id, ok, message }` goes back to the sender. A sender holds one
  // pack at a time.
  'on_pack-begin'(peer, { id, size, parts }) {
    if (peer.role !== 'sender' && peer.role !== 'guest') return;
    const host = this.host;
    const fail = (message) => this.send(peer, { t: 'pack-result', id, ok: false, message });
    if (!host) return fail('The other NoteComplete is not receiving right now.');
    if (!Number.isInteger(size) || size < 1 || size > PACK_LIMIT || !Number.isInteger(parts) || parts < 1 || parts > PACK_PARTS) return fail('That is too much to send at once (the limit is 24 MB).');
    if (peer.pack) return fail('Wait for the first one to be answered.');
    peer.pack = { id, size, parts, got: 0, bytes: 0 };
    this.send(host, { t: 'pack-begin', id: `${peer.id}:${id}`, from: peer.name, size, parts });
  }
  'on_pack-part'(peer, { id, index, data }) {
    const pack = peer.pack, host = this.host;
    if (!pack || pack.id !== id || !host || typeof data !== 'string' || data.length > PACK_PART || index !== pack.got) return;
    pack.bytes += data.length;
    if (pack.bytes > pack.size * 1.1 + 1024) { peer.pack = null; return this.send(peer, { t: 'pack-result', id, ok: false, message: 'The parts do not match what was announced.' }); }
    pack.got++;
    this.send(host, { t: 'pack-part', id: `${peer.id}:${id}`, index, data });
  }
  'on_pack-result'(peer, { id, ok, message }) {
    if (peer.role !== 'host' || typeof id !== 'string') return;
    const [who, mine] = id.split(':'), target = this.peers.get(Number(who));
    if (!target?.pack || String(target.pack.id) !== mine) return;
    target.pack = null;
    this.send(target, { t: 'pack-result', id: mine, ok: !!ok, message: clean(message, 300) });
  }
  // The host's open text document (.txt, Markdown…), shown to guests as text, and again whenever
  // the host edits it. Drawn notes are shared as notes and ink instead (snapshots); a tablet has
  // nothing to draw on in a text document.
  on_text(peer, { name, markdown, content }) {
    if (peer.role !== 'host') return;
    if (typeof content !== 'string') this.docText = null;
    else if (content.length > TEXT_LIMIT) this.docText = { name: clean(name, 200), tooBig: true };
    else this.docText = { name: clean(name, 200), markdown: !!markdown, content };
    this.sendText();
  }
  sendText(only = null) {
    const message = JSON.stringify({ t: 'text', shared: !!this.docText, ...(this.docText || {}) });
    for (const p of this.members()) if (p.role === 'guest' && (!only || p === only)) this.send(p, message);
  }
  on_op(peer, { gen, ref, op, args }) {
    const allowed = peer.role === 'host' ? HOST_OPS : this.draws(peer) ? TABLET_OPS : null;
    const nack = (error) => this.send(peer, { t: 'nack', ref, error });
    if (!allowed?.has(op)) return nack('Not allowed.');
    if (args == null || typeof args !== 'object' || Array.isArray(args)) return nack('Invalid edit.');
    if (peer.role !== 'host' && !tabletMay(op, args)) return nack('Not allowed.');
    if (!this.open || gen !== this.gen) return nack('The note changed.');
    if (!peer.synced) return nack('Still loading the note.');
    const entry = { t: 'op', gen: this.gen, seq: ++this.seq, from: peer.id, ref, op, args };
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    const data = JSON.stringify(entry);
    for (const p of this.members()) if (p.synced) this.send(p, data);
    // Now and then every copy reports its history digest right after this edit (in the same
    // stream, so all at the same point); a tablet that differs from the host reloads.
    if (this.checkEvery && entry.seq % this.checkEvery === 0) this.check();
    // And on a timer, so a copy that drifted is caught within seconds on a quiet note too.
    if (this.checkInterval && !this.checkTimer) {
      this.checkTimer = setInterval(() => { if (this.seq > this.checked) this.check(); }, this.checkInterval);
      this.checkTimer.unref?.();
    }
  }
  // Every copy reports its history digest right after the latest edit (in the same stream, so
  // all at the same point).
  check() {
    if (!this.members().some((p) => this.follows(p) && p.synced)) return;
    this.checked = this.seq;
    const check = JSON.stringify({ t: 'check', gen: this.gen, seq: this.seq });
    for (const p of this.members()) if (p.synced) this.send(p, check);
  }
  // A stroke being drawn: shown live on the other screens, never stored.
  on_live(peer, message) {
    if (!this.draws(peer) || message.gen !== this.gen) return;
    const data = JSON.stringify({ ...message, from: peer.id, color: peer.color });
    for (const p of this.members()) if (p !== peer && p.synced) this.send(p, data);
  }
  // Digests at a check: kept until the host's arrives, then each tablet's is compared with it.
  on_digest(peer, { gen, seq, digest }) {
    if (gen !== this.gen || typeof digest !== 'string' || (peer.role !== 'host' && !this.follows(peer))) return;
    let round = this.digests.get(seq);
    if (!round) {
      round = { host: null, tablets: new Map() };
      this.digests.set(seq, round);
      for (const key of [...this.digests.keys()]) if (key < seq - 5 * this.checkEvery) this.digests.delete(key);
    }
    if (peer.role === 'host') round.host = digest;
    else round.tablets.set(peer.id, digest);
    if (round.host == null) return;
    for (const [id, value] of round.tablets) {
      const p = this.peers.get(id);
      if (p && value !== round.host) {
        this.send(p, { t: 'resyncing' });
        p.synced = false;
        this.requestSnapshot(p);
        const host = this.host;
        if (host) this.send(host, { t: 'resynced', name: p.name });
      }
    }
    round.tablets.clear();
  }
  requestSnapshot(peer) {
    const host = this.host;
    if (!host) return;
    for (const waiting of this.requests.values()) if (waiting.has(peer.id)) return;
    const id = ++this.request;
    this.requests.set(id, new Set([peer.id]));
    this.send(host, { t: 'snapshot', req: id, gen: this.gen });
    // The joiner and the host can say what is happening while the computer makes the snapshot.
    if (peer.chunks) {
      peer.stage = 'preparing';
      peer.progress = { done: 0, total: 0 };
      this.send(peer, { t: 'prepare' });
      this.loadingChanged();
    }
  }
  // Who is loading the note, and how far: sent to the host, a few times a second at most.
  loadingChanged() {
    if (this.loadingTimer) return;
    this.loadingTimer = setTimeout(() => { this.loadingTimer = null; this.sendLoading(); }, 200);
    this.loadingTimer.unref?.();
  }
  sendLoading() {
    const host = this.host;
    if (!host || this.state === 'ended') return;
    const peers = this.members().filter((p) => p.stage).map(({ id, name, role, stage, progress }) => ({ id, name, role, stage, done: progress?.done || 0, total: progress?.total || 0 }));
    if (!peers.length && !this.hadLoading) return;
    this.hadLoading = peers.length > 0;
    this.send(host, { t: 'loading', peers });
  }
  // The reader's heartbeat: answering shows the connection still works both ways.
  on_ping(peer) { this.send(peer, { t: 'pong' }); }
  // A joiner's own report of how much of the note it has and what it is doing with it.
  on_progress(peer, { stage, done, total }) {
    if (!this.follows(peer)) return;
    const count = (n) => (Number.isFinite(n) && n >= 0 && n <= 2 ** 32 - 1 ? Math.floor(n) : 0);
    if (stage === 'ready') { peer.stage = ''; peer.progress = null; }
    else if (stage === 'receiving' || stage === 'opening') { peer.stage = stage === 'receiving' ? 'sending' : 'opening'; peer.progress = { done: count(done), total: count(total) }; }
    else return;
    this.loadingChanged();
  }
  // The host's project at its edit `seq`: sent to the waiting tablets with the edits after it.
  // Gzipped once for those that can unzip it (zlib works off the main thread); edits made
  // meanwhile are in the log and follow the snapshot, so the order holds.
  async snapshot(peer, frame) {
    if (peer.role !== 'host') return;
    const { header, payload } = unpackSnapshot(frame);
    const waiting = this.requests.get(header.req);
    if (!waiting || header.gen !== this.gen) { this.requests.delete(header.req); return; }
    // Joiners that take it in parts: streamed, compressed as it goes (their own request ends
    // here, so a joiner arriving meanwhile asks the host for its own snapshot).
    const parts = [...waiting].map((id) => this.peers.get(id)).filter((p) => p?.chunks);
    if (parts.length) {
      for (const p of parts) waiting.delete(p.id);
      if (!waiting.size) this.requests.delete(header.req);
      this.stream(parts, header, payload).catch(() => { /* A joiner that vanished; its close drops it. */ });
      if (!waiting.size) return;
    }
    // Still listed as waiting while it is compressed, so nobody asks the host for another.
    const zipped = [...waiting].some((id) => this.peers.get(id)?.gzip) ? await gzip(payload, { level: 6 }).catch(() => null) : null;
    // The note changed or the session ended meanwhile: this snapshot is stale.
    if (this.requests.get(header.req) !== waiting || header.gen !== this.gen || this.state === 'ended') return;
    this.requests.delete(header.req);
    const missing = this.log.length && this.log[0].seq > header.seq + 1;
    const plain = packSnapshot({ gen: this.gen, seq: header.seq, title: this.title }, payload);
    const packed = zipped && packSnapshot({ gen: this.gen, seq: header.seq, title: this.title, enc: 'gzip' }, zipped);
    for (const id of waiting) {
      const p = this.peers.get(id);
      if (!p) continue;
      if (missing) { this.requestSnapshot(p); continue; }
      this.send(p, p.gzip && packed ? packed : plain);
      this.catchUp(p, header.seq);
    }
  }
  // The snapshot to joiners that take it in parts: a header, gzip pieces as they are made, and
  // an end, then the edits made meanwhile. A slice is fed only when every joiner's socket has
  // drained below AHEAD, so `done` (plain bytes fed) follows the wire.
  async stream(targets, header, payload) {
    const id = ++this.streams, total = payload.length;
    const live = () => this.state !== 'ended' && header.gen === this.gen;
    const here = () => targets.filter((p) => this.peers.get(p.id) === p);
    const begin = JSON.stringify({ t: 'begin', id, total, enc: 'gzip', seq: header.seq, gen: this.gen, title: this.title });
    for (const p of targets) { p.stage = 'sending'; p.progress = { done: 0, total }; this.send(p, begin); }
    this.loadingChanged();
    const gz = createGzip(total > FAST_ABOVE ? { level: 1, strategy: zlib.Z_HUFFMAN_ONLY } : { level: 6 });
    let fed = 0;
    gz.on('data', (data) => { const frame = chunkFrame(id, fed, data); for (const p of here()) this.send(p, frame); });
    const ended = new Promise((resolve, reject) => { gz.on('end', resolve); gz.on('error', reject); });
    ended.catch(() => {});
    for (let at = 0; at < total && live() && here().length; at += SLICE) {
      while (live() && here().some((p) => (p.transport.buffered?.() ?? 0) > AHEAD)) await sleep(25);
      const slice = payload.subarray(at, Math.min(total, at + SLICE));
      fed = at + slice.length;
      if (!gz.write(slice)) await new Promise((resolve) => gz.once('drain', resolve));
    }
    if (!live() || !here().length) { gz.destroy(); return; }
    gz.end();
    await ended;
    // Edits made meanwhile are in the log and follow the snapshot, so the order holds.
    for (const p of here()) {
      if (this.log.length && this.log[0].seq > header.seq + 1) { this.requestSnapshot(p); continue; }
      this.send(p, { t: 'end', id });
      p.stage = 'opening';
      this.catchUp(p, header.seq);
    }
    this.loadingChanged();
  }
  // A tablet whose copy disagrees with the host's (see the core's history digest) reloads.
  on_resync(peer) {
    if (!this.follows(peer)) return;
    peer.synced = false;
    if (this.open) this.requestSnapshot(peer);
  }

  // Notes --------------------------------------------------------------------------------
  resetNotes(text) {
    this.awareness?.destroy();
    this.doc?.destroy();
    this.doc = new Y.Doc();
    this.doc.getText('notes').insert(0, text);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on('update', (update, origin) => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, FRAME.sync);
      sync.writeUpdate(e, update);
      const data = encoding.toUint8Array(e);
      this.broadcast(data, (p) => p !== origin && (p.role === 'host' || p.role === 'guest'));
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin && origin.clients) {
        for (const c of added) origin.clients.add(c);
        for (const c of removed) origin.clients.delete(c);
      }
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, FRAME.awareness);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
      this.broadcast(encoding.toUint8Array(e), (p) => p.role === 'host' || p.role === 'guest');
    });
  }
  // The host's notes for the note it opened: everyone's notes start again from that text.
  on_notes(peer, { text }) {
    if (peer.role !== 'host' || !this.notes || typeof text !== 'string') return;
    for (const p of this.members()) p.clients.clear();
    this.resetNotes(text);
    this.notesGen = (this.notesGen || 0) + 1;
    this.broadcast({ t: 'notes-reset', gen: this.notesGen }, (p) => p.role === 'host' || p.role === 'guest');
    for (const p of this.members()) if (p.role === 'host' || p.role === 'guest') this.startNotes(p);
  }
  startNotes(peer) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, FRAME.sync);
    sync.writeSyncStep1(e, this.doc);
    this.send(peer, encoding.toUint8Array(e));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, FRAME.awareness);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      this.send(peer, encoding.toUint8Array(a));
    }
  }
  binary(peer, data) {
    const kind = data[0];
    if (kind === FRAME.snapshot) return this.snapshot(peer, data).catch(() => { /* A malformed frame: nobody is sent it. */ });
    if (peer.role === 'tablet' || peer.role === 'sender' || !this.notes) return;
    const decoder = decoding.createDecoder(data);
    decoding.readVarUint(decoder);
    try {
      if (kind === FRAME.sync) {
        const type = decoding.peekVarUint(decoder);
        // View-only guests may ask for the state but their edits are not applied.
        const canEdit = peer.role === 'host' || this.notes === 'edit';
        if (type !== sync.messageYjsSyncStep1 && !canEdit) return;
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, FRAME.sync);
        sync.readSyncMessage(decoder, e, this.doc, peer);
        if (encoding.length(e) > 1) this.send(peer, encoding.toUint8Array(e));
      } else if (kind === FRAME.awareness) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), peer);
      }
    } catch {
      this.kick(peer, 1003, 'Invalid message');
    }
  }
  text() {
    return this.doc.getText('notes').toString();
  }

  // People and the end -------------------------------------------------------------------
  on_remove(peer, { id }) {
    const target = this.peers.get(id);
    if (peer.role !== 'host' || !target || target === peer) return;
    // A removed tablet cannot come back with its link or code: both are replaced.
    if (target.role === 'tablet') {
      if (target.remote) this.tokens.onlineTablet = token();
      else { this.tokens.tablet = token(); this.newCode(); }
    }
    this.kick(target, 4001, 'The host removed you from the session.');
  }
  on_code(peer) {
    if (peer.role !== 'host') return;
    this.newCode();
    this.send(peer, { t: 'code', code: this.code.value, expires: this.code.expires });
  }
  // Ending: everyone is told, guests send their last edits and keep a copy, then it closes.
  on_end(peer) {
    if (peer.role !== 'host') return;
    this.end();
  }
  on_flushed(peer) {
    peer.flushed = true;
    this.maybeFinish();
  }
  end() {
    if (this.state !== 'open') return;
    this.state = 'ending';
    this.broadcast({ t: 'ending' }, (p) => p.role !== 'host');
    this.timer = setTimeout(() => this.finish(), this.flushWait);
    this.maybeFinish();
  }
  maybeFinish() {
    if (this.state === 'ending' && this.members().every((p) => p.role === 'host' || p.flushed)) this.finish();
  }
  finish(reason = 'The host ended the session.') {
    if (this.state === 'ended') return;
    clearTimeout(this.timer);
    clearInterval(this.checkTimer);
    clearTimeout(this.loadingTimer);
    this.state = 'ended';
    const text = this.text();
    for (const p of [...this.peers.values()]) {
      this.send(p, { t: 'ended', reason, text: p.role === 'host' ? text : undefined });
      try { p.transport.close(1000, 'Session ended'); } catch { /* Already closed. */ }
    }
    this.peers.clear();
    this.dispose();
    this.onEnded({ text, reason });
  }
  // Awareness keeps a timer: release it with the session.
  dispose() {
    clearTimeout(this.timer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
function clean(value, max = 40) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
}
