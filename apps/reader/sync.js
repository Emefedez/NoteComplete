// The reader's side of a sharing session (docs/COLLABORATION.md; the hub is
// apps/desktop/collab-hub.js). Loaded only while a session is open.
//
// - Ink: edits go to the hub, which puts everyone's in one order; every reader holding the
//   note (host and tablets) applies them in that order, its own included, so all copies stay
//   the same. A tablet starts from a snapshot of the host's project.
// - Notes: a Yjs Y.Text, merged as a CRDT, with awareness for cursors. Yjs is passed in
//   (`yjs`) and only by readers that show the notes; tablets never load it.
// chunk: a piece of a snapshot sent in parts ([3][id u32][plain bytes so far u32][gzip data]).
export const FRAME = { sync: 0, awareness: 1, snapshot: 2, chunk: 3 };
const RETRIES = [500, 1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];
// A gzipped snapshot (the hub compresses it for joiners that say they can unzip it).
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A pasted or scanned invite: a link (http://host:port/tablet#session.token or /join#…),
// or a computer address plus the short pairing code shown on it.
export function parseInvite(link, code = '', role = 'tablet') {
  const text = String(link || '').trim();
  if (!text) throw Error('Enter the link or the computer address shown on the computer.');
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`); } catch { throw Error('That is not a link or an address.'); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw Error('That is not a link or an address.');
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  const ws = `${secure ? 'wss' : 'ws'}://${url.host}/sync`;
  const [, token] = url.hash.slice(1).split('.');
  if (token) return { url: ws, token, role: url.pathname.startsWith('/tablet') ? 'tablet' : role === 'sender' ? 'sender' : 'guest' };
  const digits = String(code).replace(/\D/g, '');
  if (digits.length !== 6) throw Error('Enter the 6-digit code shown on the computer.');
  if (!url.port) throw Error('Add the port shown on the computer, for example 192.168.1.20:41237.');
  return { url: ws, code: digits, role: role === 'guest' ? 'guest' : role === 'sender' ? 'sender' : 'tablet' };
}
export function packSnapshot(header, payload) {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const out = new Uint8Array(5 + head.length + body.length);
  out[0] = FRAME.snapshot;
  new DataView(out.buffer).setUint32(1, head.length);
  out.set(head, 5);
  out.set(body, 5 + head.length);
  return out;
}
export function unpackSnapshot(bytes) {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  return { header: JSON.parse(new TextDecoder().decode(bytes.subarray(5, 5 + length))), payload: bytes.subarray(5 + length) };
}

export class SyncClient {
  // apply(entry) applies one ordered edit to this reader's core and returns its result.
  // load({ project, seq, gen, title }) replaces the note with the host's snapshot (tablets).
  // snapshot() returns the host's project text, taken between two edits (host).
  // digest() returns the core's history digest (tablets and host, for the agreement check).
  // on(type, detail) reports: welcome, peers, doc, live, notes-reset, ending, ended, lost,
  // closed, status, nack.
  // heartbeat: a ping every `every` ms; nothing heard for `dead` ms means the connection is half
  // dead (Wi-Fi power saving, a NAT that forgot it): it is dropped and resumed from the edit log.
  // gzip: this reader can unzip snapshots (DecompressionStream; old browsers get them plain).
  // chunks: it takes the snapshot in parts and reports progress({ stage, done, total }) while it
  // is prepared (preparing), received (receiving) and opened (opening); then ready.
  constructor({ url, token, code, name = '', role = 'guest', yjs = null, WebSocketImpl = globalThis.WebSocket, apply = async () => {}, load = async () => {}, snapshot = async () => '', digest = async () => '', on = () => {}, retries = RETRIES, gzip = typeof DecompressionStream === 'function', chunks = true, heartbeat = { every: 10000, dead: 30000 } }) {
    Object.assign(this, { url, token, code, name, role, yjs, WebSocketImpl, apply, load, snapshot, digest, on, retries, gzip, chunks: gzip && chunks, heartbeat });
    this.queue = Promise.resolve();
    this.pending = new Map();
    this.ref = 0;
    this.gen = 0;
    this.seq = 0;
    this.attempt = 0;
    this.state = 'connecting';
    this.peers = [];
    if (yjs) this.newNotes();
  }
  connect() {
    if (this.state === 'closed' || this.state === 'ended') return;
    this.rx = null;
    const ws = (this.ws = new this.WebSocketImpl(this.url));
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.attempt = 0;
      this.beat(ws);
      // Back after a dropped connection with the note loaded: the hub sends only the edits
      // made since, when it still has them, instead of the whole note again.
      const have = this.role !== 'host' && this.loaded && this.session ? { session: this.session, gen: this.gen, seq: this.seq } : undefined;
      this.send({ t: 'hello', token: this.token, code: this.token ? undefined : this.code, name: this.name, role: this.role, accept: this.gzip ? (this.chunks ? ['gzip', 'chunks'] : ['gzip']) : undefined, have });
    };
    ws.onmessage = ({ data }) => {
      if (ws !== this.ws) return;
      this.heard = Date.now();
      if (typeof data === 'string') this.message(JSON.parse(data));
      else this.binary(new Uint8Array(data));
    };
    ws.onclose = (event) => this.closed(ws, event);
  }
  // Pings now and then, and drops a connection that has gone quiet (see `heartbeat`).
  beat(ws) {
    clearInterval(this.beating);
    if (!this.heartbeat?.every) return;
    this.heard = Date.now();
    this.beating = setInterval(() => {
      if (ws !== this.ws) return clearInterval(this.beating);
      if (Date.now() - this.heard > this.heartbeat.dead) {
        ws.onopen = ws.onmessage = ws.onclose = null;
        try { ws.close(); } catch { /* Already gone. */ }
        return this.closed(ws, { code: 4002, reason: 'No answer.' });
      }
      this.send({ t: 'ping' });
    }, this.heartbeat.every);
    this.beating.unref?.();
  }
  closed(ws, event) {
    if (ws !== this.ws) return;
    clearInterval(this.beating);
    this.ws = null;
    this.failPending('Disconnected.');
    if (this.state === 'closed' || this.state === 'ended') return;
    // Refused (bad invite, removed, full): no point retrying.
    if (event.code === 1008 || event.code === 4001 || event.code === 1009 || !this.welcomed && this.attempt >= 2) {
      this.state = 'closed';
      this.awareness?.destroy();
      return this.on('closed', { reason: this.refusal || event.reason || 'Could not connect.' });
    }
    const wait = this.retries[this.attempt++];
    if (wait == null) {
      this.state = 'closed';
      this.awareness?.destroy();
      return this.on('lost', { text: this.text?.toString() ?? '' });
    }
    this.state = 'reconnecting';
    this.on('status', { state: 'reconnecting' });
    this.retry = setTimeout(() => this.connect(), wait);
  }
  // Tells the screen how the note is arriving, and (at most a few times a second) the hub, which
  // shows the host.
  progress(stage, done, total) {
    this.on('progress', { stage, done, total });
    if (this.role === 'host') return;
    const now = Date.now();
    if (stage === 'receiving' && stage === this.reported?.stage && now - this.reported.at < 300) return;
    this.reported = { stage, at: now };
    this.send({ t: 'progress', stage, done, total });
  }
  send(message) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(typeof message === 'string' || message instanceof Uint8Array ? message : JSON.stringify(message));
    return true;
  }
  // Runs tasks one at a time, in arrival order: edits, snapshots and checks never interleave.
  enqueue(task) {
    this.queue = this.queue.then(task).catch((e) => this.on('status', { state: 'error', error: e.message }));
    return this.queue;
  }
  message(m) {
    switch (m.t) {
      case 'welcome':
        this.welcomed = true;
        Object.assign(this, { id: m.id, role: m.role, canEdit: m.canEdit, color: m.color, name: m.name, notesShared: m.notes, session: m.session });
        if (m.token) this.token = m.token;
        if (this.role !== 'host') this.gen = m.gen;
        // Not resumed (a first join, or back after the log moved on or another note opened):
        // this copy is stale until the snapshot on its way is loaded.
        if (this.role !== 'host' && !m.resumed) this.loaded = false;
        this.state = 'open';
        this.on('welcome', m);
        if (this.yjs && m.notes) this.startNotes();
        return;
      case 'peers':
        this.peers = m.peers;
        return this.on('peers', m.peers);
      case 'closed':
        this.refusal = m.reason;
        return;
      case 'code':
        return this.on('code', m);
      case 'op':
        return this.enqueue(() => this.applyEntry(m));
      case 'nack': {
        const p = this.pending.get(m.ref);
        this.pending.delete(m.ref);
        p?.reject(Error(m.error));
        return this.on('nack', m);
      }
      case 'pack-begin': case 'pack-part': case 'pack-cancel': case 'pack-result':
        // Study material between NoteComplete instances: the host gets the parts of what a sender
        // sends, the sender gets the host's answer.
        return this.on(m.t, m);
      case 'text':
        // Guest: the host's open text document (or none: shared is false).
        return this.on('text', m);
      case 'resynced':
        return this.on('resynced', m);
      case 'loading':
        // Host: who is receiving the note, and how far (from the hub).
        return this.on('loading', m.peers);
      case 'prepare':
        // The computer is making the snapshot of the note for this joiner.
        this.rx = null;
        return this.progress('preparing', 0, 0);
      case 'begin':
        this.rx = { id: m.id, total: m.total, seq: m.seq, gen: m.gen, title: m.title, enc: m.enc, chunks: [], done: 0, at: Date.now() };
        return this.progress('receiving', 0, m.total);
      case 'end':
        return this.enqueue(async () => {
          const rx = this.rx;
          if (!rx || rx.id !== m.id) return;
          this.rx = null;
          if (rx.gen !== this.gen) return;
          this.progress('opening', rx.total, rx.total);
          const parts = new Blob(rx.chunks);
          const project = rx.enc === 'gzip' ? await gunzip(parts) : new Uint8Array(await parts.arrayBuffer());
          await this.load({ project: new TextDecoder().decode(project), seq: rx.seq, gen: rx.gen, title: rx.title });
          this.seq = rx.seq;
          this.loaded = true;
          this.progress('ready', 0, 0);
        });
      case 'snapshot':
        return this.enqueue(async () => {
          const project = await this.snapshot();
          this.send(packSnapshot({ req: m.req, gen: m.gen, seq: this.seq }, project));
        });
      case 'check':
        // Right after edit `seq` in the stream: report this copy's digest (the hub compares).
        return this.enqueue(async () => {
          if (m.gen !== this.gen || m.seq !== this.seq || (this.role !== 'host' && !this.loaded)) return;
          this.send({ t: 'digest', gen: m.gen, seq: m.seq, digest: await this.digest() });
        });
      case 'resyncing':
        return this.enqueue(() => {
          this.loaded = false;
          this.on('status', { state: 'resync', error: 'This copy differed from the computer’s; reloading.' });
        });
      case 'doc':
        // The host reset itself when it sent this (documentChanged).
        if (this.role === 'host') return this.on('doc', m);
        return this.enqueue(() => {
          this.gen = m.gen;
          this.seq = 0;
          this.loaded = false;
          this.failPending('The note changed.');
          this.on('doc', m);
        });
      case 'live':
        return this.on('live', m);
      case 'settings':
        return this.on('settings', m);
      case 'notes-reset':
        if (!this.yjs) return;
        this.newNotes();
        this.startNotes();
        return this.on('notes-reset', m);
      case 'ending':
        this.state = 'ending';
        this.on('ending', { text: this.text?.toString() ?? '' });
        // Every notes change was sent when it happened; tell the host this side is done.
        this.send({ t: 'flushed' });
        return;
      case 'ended':
        this.state = 'ended';
        clearTimeout(this.retry);
        this.failPending('The session ended.');
        this.awareness?.destroy();
        return this.on('ended', { reason: m.reason, text: m.text ?? this.text?.toString() ?? '' });
    }
  }
  async applyEntry(entry) {
    if (entry.gen !== this.gen) return;
    if (this.role !== 'host' && !this.loaded) return;
    if (entry.seq <= this.seq) return;
    if (entry.seq !== this.seq + 1) return this.resync('Missed an edit; reloading the note.');
    this.seq = entry.seq;
    const mine = entry.from === this.id ? this.pending.get(entry.ref) : null;
    if (mine) this.pending.delete(entry.ref);
    try {
      const result = await this.apply(entry, !!mine);
      mine?.resolve(result);
    } catch (e) {
      // Every copy refuses the same edit in the same state, so they still agree.
      mine?.reject(e);
    }
  }
  resync(reason) {
    this.loaded = false;
    this.on('status', { state: 'resync', error: reason });
    this.send({ t: 'resync' });
  }
  binary(bytes) {
    if (bytes[0] === FRAME.chunk) {
      const rx = this.rx, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (!rx || view.getUint32(1) !== rx.id) return;
      rx.chunks.push(bytes.subarray(9));
      rx.done = view.getUint32(5);
      return this.progress('receiving', rx.done, rx.total);
    }
    if (bytes[0] === FRAME.snapshot) {
      const { header, payload } = unpackSnapshot(bytes);
      return this.enqueue(async () => {
        if (header.gen !== this.gen) return;
        const project = header.enc === 'gzip' ? await gunzip(payload) : payload;
        this.on('progress', { stage: 'opening', done: 0, total: 0 });
        await this.load({ project: new TextDecoder().decode(project), seq: header.seq, gen: header.gen, title: header.title });
        this.seq = header.seq;
        this.loaded = true;
        this.on('progress', { stage: 'ready', done: 0, total: 0 });
      });
    }
    if (!this.doc) return;
    const { encoding, decoding, sync, awareness } = this.yjs;
    const decoder = decoding.createDecoder(bytes);
    const kind = decoding.readVarUint(decoder);
    if (kind === FRAME.sync) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, FRAME.sync);
      sync.readSyncMessage(decoder, e, this.doc, this);
      if (encoding.length(e) > 1) this.send(encoding.toUint8Array(e));
    } else if (kind === FRAME.awareness) {
      awareness.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }
  // Sends an edit to be put in the shared order; resolves once this reader has applied it.
  submit(op, args) {
    if (this.state !== 'open') return Promise.reject(Error(this.state === 'reconnecting' ? 'Reconnecting… try again in a moment.' : 'Not connected.'));
    const ref = ++this.ref;
    return new Promise((resolve, reject) => {
      this.pending.set(ref, { resolve, reject });
      if (!this.send({ t: 'op', gen: this.gen, ref, op, args })) {
        this.pending.delete(ref);
        reject(Error('Not connected.'));
      }
    });
  }
  failPending(message) {
    for (const p of this.pending.values()) p.reject(Error(message));
    this.pending.clear();
  }
  // A stroke being drawn (new points only); others draw it until the edit arrives.
  live(stroke) {
    this.send({ t: 'live', gen: this.gen, ...stroke });
  }
  // Host: another note is open now (or none). Edits after this belong to it.
  // Host: the answer to a sender (accepted or not, and what was done).
  packResult(id, ok, message = '') { this.send({ t: 'pack-result', id, ok: !!ok, message }); }
  // Host: the open text document changed (typed in): guests see the new text.
  textChanged(text) { if (text) this.send({ t: 'text', ...text }); }
  documentChanged({ open, title = '', notes, text = null }) {
    this.gen++;
    this.seq = 0;
    this.failPending('The note changed.');
    this.send({ t: 'doc', open, title });
    if (text) this.send({ t: 'text', ...text });
    if (typeof notes === 'string' && this.notesShared) this.send({ t: 'notes', text: notes });
  }
  // Host: the session's settings (auto-save), which everyone follows.
  settings({ autosave }) { this.send({ t: 'settings', autosave: !!autosave }); }
  rename(name) {
    this.name = name;
    this.send({ t: 'rename', name });
    this.awareness?.setLocalStateField('user', { name, color: this.color });
  }
  removePeer(id) { this.send({ t: 'remove', id }); }
  newCode() { this.send({ t: 'code' }); }
  end() { this.send({ t: 'end' }); }
  close() {
    this.state = 'closed';
    clearTimeout(this.retry);
    clearInterval(this.beating);
    this.failPending('Disconnected.');
    this.ws?.close(1000, 'Left');
    this.ws = null;
    this.awareness?.destroy();
  }

  // Notes ------------------------------------------------------------------------------
  newNotes() {
    const { Y, awareness } = this.yjs;
    this.awareness?.destroy();
    this.doc?.destroy();
    this.doc = new Y.Doc();
    this.text = this.doc.getText('notes');
    this.awareness = new awareness.Awareness(this.doc);
    this.doc.on('update', (update, origin) => {
      if (origin === this) return;
      const { encoding, sync } = this.yjs;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, FRAME.sync);
      sync.writeUpdate(e, update);
      this.send(encoding.toUint8Array(e));
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      const { encoding } = this.yjs;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, FRAME.awareness);
      encoding.writeVarUint8Array(e, awareness.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
      this.send(encoding.toUint8Array(e));
    });
  }
  startNotes() {
    const { encoding, sync } = this.yjs;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, FRAME.sync);
    sync.writeSyncStep1(e, this.doc);
    this.send(encoding.toUint8Array(e));
    this.awareness.setLocalStateField('user', { name: this.name, color: this.color });
  }
}

// Replaces `from` with `to` in a Y.Text with the smallest change (one delete and one
// insert around the common start and end), so concurrent edits elsewhere are kept.
export function applyTextDiff(ytext, to, origin = null) {
  const from = ytext.toString();
  if (from === to) return;
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  // Never split a surrogate pair (an emoji): Yjs stores text as UTF-8.
  const high = (c) => c >= 0xd800 && c <= 0xdbff;
  if (start && high(from.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  if (end && high(from.charCodeAt(from.length - end - 1)) && from.length - end - 1 >= start) end--;
  ytext.doc.transact(() => {
    if (from.length - start - end) ytext.delete(start, from.length - start - end);
    if (to.length - start - end) ytext.insert(start, to.slice(start, to.length - end));
  }, origin);
}

// Sends study material (a JSON text) to another NoteComplete that is sharing: connects as a
// `sender` with its address and PIN or an invite link, passes the text in parts, and waits
// for the person there to accept. Resolves with what they did; rejects with why not.
// progress({ stage: 'connecting' | 'sending' | 'waiting', sent, total }).
export const PACK_PART = 512 * 1024;
export function sendPack(invite, text, { name = '', WebSocketImpl = globalThis.WebSocket, progress = () => {}, timeout = 10 * 60e3 } = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2, 8), total = text.length, parts = Math.max(1, Math.ceil(total / PACK_PART));
    const ws = new WebSocketImpl(invite.url);
    let finished = false, refusal = '';
    const finish = (settle, value) => { if (finished) return; finished = true; clearTimeout(timer); try { ws.close(1000, 'Done'); } catch { /* Already closed. */ } settle(value); };
    const timer = setTimeout(() => finish(reject, Error('No answer: the other NoteComplete did not respond in time.')), timeout);
    progress({ stage: 'connecting', sent: 0, total });
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: invite.token, code: invite.token ? undefined : invite.code, name, role: 'sender' }));
    ws.onerror = () => {};
    ws.onmessage = ({ data }) => {
      if (typeof data !== 'string') return;
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'welcome') {
        ws.send(JSON.stringify({ t: 'pack-begin', id, size: total, parts }));
        for (let i = 0; i < parts; i++) ws.send(JSON.stringify({ t: 'pack-part', id, index: i, data: text.slice(i * PACK_PART, (i + 1) * PACK_PART) }));
        progress({ stage: 'waiting', sent: total, total });
      } else if (m.t === 'closed') refusal = m.reason || '';
      else if (m.t === 'pack-result' && m.id === id) finish(m.ok ? resolve : reject, m.ok ? { message: m.message || '' } : Error(m.message || 'The other NoteComplete did not accept it.'));
    };
    ws.onclose = (event) => finish(reject, Error(refusal || event.reason || 'Could not connect. Check the address and PIN, and that the other NoteComplete is sharing (File → Share…).'));
  });
}
