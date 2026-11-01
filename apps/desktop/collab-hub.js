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
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const FRAME = { sync: 0, awareness: 1, snapshot: 2 };
// Edits a peer may send, by role. Tablets draw, highlight, erase and undo; the host edits anything.
export const TABLET_OPS = new Set(['draw', 'erase', 'undo', 'redo']);
export const HOST_OPS = new Set([...TABLET_OPS, 'remove', 'adjust', 'crop', 'lock', 'layer', 'image', 'editText', 'resize', 'resizePage', 'insertPages']);
export const COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#ad7f58'];
const LOG_LIMIT = 20000;

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
  constructor({ notes = 'edit', maxPeers = 10, now = Date.now, codeLife = 10 * 60e3, flushWait = 2000, rate = { burst: 800, perSecond: 400 }, maxMessage = 2 * 1024 * 1024, checkEvery = 100, onEnded = () => {} } = {}) {
    Object.assign(this, { notes, maxPeers, now, codeLife, flushWait, rate, maxMessage, checkEvery, onEnded });
    this.digests = new Map();
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
  connect(transport) {
    const peer = { id: this.next++, transport, role: null, name: '', color: '', synced: false, clients: new Set(), tokens: this.rate.burst, refilled: this.now(), flushed: false };
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
  hello(peer, { token, code, name, role }) {
    let granted = null;
    if (token && same(token, this.tokens.host) && !this.host) granted = 'host';
    else if (token && same(token, this.tokens.tablet)) granted = 'tablet';
    else if (token && this.notes && same(token, this.tokens.guest)) granted = role === 'tablet' ? null : 'guest';
    else if (code != null) {
      if (this.now() > this.code.expires || this.code.failures >= 5) return this.kick(peer, 1008, 'This code expired. Show a new code on the computer.');
      if (same(String(code).replace(/\D/g, ''), this.code.value)) granted = 'tablet';
      else {
        this.code.failures++;
        return this.kick(peer, 1008, 'Wrong code.');
      }
    }
    if (!granted) return this.kick(peer, 1008, 'This invite is not valid.');
    if (this.state !== 'open') return this.kick(peer, 1008, 'The session is ending.');
    if (granted !== 'host' && this.members().filter((p) => p.role !== 'host').length >= this.maxPeers) return this.kick(peer, 1008, 'The session is full.');
    peer.role = granted;
    const taken = new Set(this.members().map((p) => p.color));
    peer.color = COLORS.find((c) => !taken.has(c)) || COLORS[peer.id % COLORS.length];
    peer.name = clean(name) || (granted === 'host' ? 'Host' : granted === 'tablet' ? 'Tablet' : this.guestName());
    this.send(peer, {
      t: 'welcome', id: peer.id, role: granted, name: peer.name, color: peer.color, session: this.id,
      canEdit: granted === 'host' || (granted === 'guest' && this.notes === 'edit'),
      notes: granted !== 'tablet' && !!this.notes,
      // A tablet paired with a code reconnects with the full token.
      token: granted === 'tablet' ? this.tokens.tablet : undefined,
      gen: this.gen, open: this.open, title: this.title,
    });
    this.sendPeers();
    if (granted === 'host') {
      peer.synced = true;
      // Tablets that came first wait for the host's document.
      for (const p of this.members()) if (p.role === 'tablet' && !p.synced && this.open) this.requestSnapshot(p);
    }
    if (granted === 'tablet' && this.open) this.requestSnapshot(peer);
    if (peer.role !== 'tablet' && this.notes) this.startNotes(peer);
  }
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

  // Ink ----------------------------------------------------------------------------------
  // The host opened another note (or closed it): a new generation, and tablets reload.
  on_doc(peer, { open, title }) {
    if (peer.role !== 'host') return;
    this.gen++;
    this.open = !!open;
    this.title = clean(title, 200);
    this.seq = 0;
    this.log = [];
    this.digests.clear();
    this.requests.clear();
    this.broadcast({ t: 'doc', gen: this.gen, open: this.open, title: this.title });
    for (const p of this.members()) {
      if (p.role !== 'tablet') continue;
      p.synced = false;
      if (this.open) this.requestSnapshot(p);
    }
  }
  on_op(peer, { gen, ref, op, args }) {
    const allowed = peer.role === 'host' ? HOST_OPS : peer.role === 'tablet' ? TABLET_OPS : null;
    const nack = (error) => this.send(peer, { t: 'nack', ref, error });
    if (!allowed?.has(op)) return nack('Not allowed.');
    if (!this.open || gen !== this.gen) return nack('The note changed.');
    if (!peer.synced) return nack('Still loading the note.');
    if (args == null || typeof args !== 'object' || Array.isArray(args)) return nack('Invalid edit.');
    const entry = { t: 'op', gen: this.gen, seq: ++this.seq, from: peer.id, ref, op, args };
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    const data = JSON.stringify(entry);
    for (const p of this.members()) if (p.synced && p.role !== 'guest') this.send(p, data);
    // Now and then every copy reports its history digest right after this edit (in the same
    // stream, so all at the same point); a tablet that differs from the host reloads.
    if (this.checkEvery && entry.seq % this.checkEvery === 0 && this.members().some((p) => p.role === 'tablet' && p.synced)) {
      const check = JSON.stringify({ t: 'check', gen: this.gen, seq: entry.seq });
      for (const p of this.members()) if (p.synced && p.role !== 'guest') this.send(p, check);
    }
  }
  // A stroke being drawn: shown live on the other screens, never stored.
  on_live(peer, message) {
    if (peer.role === 'guest' || message.gen !== this.gen) return;
    const data = JSON.stringify({ ...message, from: peer.id, color: peer.color });
    for (const p of this.members()) if (p !== peer && p.synced && p.role !== 'guest') this.send(p, data);
  }
  // Digests at a check: kept until the host's arrives, then each tablet's is compared with it.
  on_digest(peer, { gen, seq, digest }) {
    if (gen !== this.gen || typeof digest !== 'string' || (peer.role !== 'host' && peer.role !== 'tablet')) return;
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
  }
  // The host's project at its edit `seq`: sent to the waiting tablets with the edits after it.
  snapshot(peer, frame) {
    if (peer.role !== 'host') return;
    const { header, payload } = unpackSnapshot(frame);
    const waiting = this.requests.get(header.req);
    this.requests.delete(header.req);
    if (!waiting || header.gen !== this.gen) return;
    const missing = this.log.length && this.log[0].seq > header.seq + 1;
    const out = packSnapshot({ gen: this.gen, seq: header.seq, title: this.title }, payload);
    for (const id of waiting) {
      const p = this.peers.get(id);
      if (!p) continue;
      if (missing) { this.requestSnapshot(p); continue; }
      this.send(p, out);
      for (const entry of this.log) if (entry.seq > header.seq) this.send(p, JSON.stringify(entry));
      p.synced = true;
    }
  }
  // A tablet whose copy disagrees with the host's (see the core's history digest) reloads.
  on_resync(peer) {
    if (peer.role !== 'tablet') return;
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
      this.broadcast(data, (p) => p !== origin && p.role !== 'tablet');
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin && origin.clients) {
        for (const c of added) origin.clients.add(c);
        for (const c of removed) origin.clients.delete(c);
      }
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, FRAME.awareness);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
      this.broadcast(encoding.toUint8Array(e), (p) => p.role !== 'tablet');
    });
  }
  // The host's notes for the note it opened: everyone's notes start again from that text.
  on_notes(peer, { text }) {
    if (peer.role !== 'host' || !this.notes || typeof text !== 'string') return;
    for (const p of this.members()) p.clients.clear();
    this.resetNotes(text);
    this.notesGen = (this.notesGen || 0) + 1;
    this.broadcast({ t: 'notes-reset', gen: this.notesGen }, (p) => p.role !== 'tablet');
    for (const p of this.members()) if (p.role !== 'tablet') this.startNotes(p);
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
    if (kind === FRAME.snapshot) return this.snapshot(peer, data);
    if (peer.role === 'tablet' || !this.notes) return;
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
    if (target.role === 'tablet') { this.tokens.tablet = token(); this.newCode(); }
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
