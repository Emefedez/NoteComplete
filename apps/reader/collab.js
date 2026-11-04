// Sharing sessions in the reader (docs/COLLABORATION.md), loaded only when one starts:
// - the host (desktop app) shares its notes and pairs drawing tablets: QR code, short code,
//   invite link and the people list;
// - a guest edits the shared notes, full width, with everyone's cursors;
// - a drawing tablet (a phone or tablet, in the app or a browser) shows the host's note
//   with only a tool dock, and draws on it: the edits are the host's own edits.
// The protocol is in sync.js; the host's server in apps/desktop/collab-server.js.
import { SyncClient, parseInvite, applyTextDiff } from './sync.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const LOCAL = Symbol('local notes edit');
const NAME_KEY = 'notecomplete-collab-name';
const SIDE_KEY = 'notecomplete-tablet-dock';
// The desktop bridge's online-access events are listened to once for the whole tab.
let onlineHooked = false;
const DRAWING = new Set(['draw', 'highlight', 'erase', 'tape', 'shape']);
let session = null;
// The open session, for checks in the browser (tools/collab_e2e.mjs).
export const currentSession = () => session;
let yjsLoading = null;
let qrLoading = null;

// Yjs, its sync and awareness protocols, vendored by tools/build_web.py.
function loadYjs() {
  return yjsLoading ||= Promise.all([
    import('./vendor/yjs/yjs.mjs'),
    import('./vendor/y-protocols/sync.js'),
    import('./vendor/y-protocols/awareness.js'),
    import('./vendor/lib0/encoding.js'),
    import('./vendor/lib0/decoding.js'),
  ]).then(([Y, sync, awareness, encoding, decoding]) => ({ Y, sync, awareness, encoding, decoding }))
    .catch((e) => { yjsLoading = null; throw Error('Sharing could not be loaded: ' + e.message); });
}
async function qrSvg(text) {
  const { default: qrcode } = await (qrLoading ||= import('./vendor/qrcode/qrcode.mjs'));
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
const remembered = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const remember = (name) => { try { localStorage.setItem(NAME_KEY, name); } catch { /* Optional. */ } };
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.includes('-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
// One dialog for every sharing step; its contents are replaced.
function dialog(title, ...body) {
  let d = $('collabDialog');
  if (!d) {
    d = el('dialog', { id: 'collabDialog', className: 'ocr-dialog collab-dialog' });
    d.setAttribute('aria-labelledby', 'collabTitle');
    document.body.append(d);
  }
  d.replaceChildren(el('h2', { id: 'collabTitle', textContent: title }), ...body.filter(Boolean));
  if (!d.open) d.showModal();
  return d;
}
function closeDialog() { $('collabDialog')?.close(); }
function buttons(...list) { return el('div', { className: 'dialog-actions' }, ...list); }

// Entry point (app.js): mode is host, join-tablet, join-notes or link (an invite URL).
export async function openCollab(host, mode) {
  if (session && (mode === 'share-menu' || (mode === 'host' && session.role !== 'host'))) return session.showSession();
  if (session && mode !== 'host') throw Error('Leave the current session first.');
  if (mode === 'host') return session?.role === 'host' ? session.showShare() : hostDialog(host);
  if (mode === 'share-menu') return joinMenu(host);
  if (mode === 'link') {
    const invite = parseInvite(location.href);
    history.replaceState(null, '', location.pathname);
    return join(host, invite);
  }
  return joinDialog(host, mode === 'join-tablet' ? 'tablet' : 'guest');
}

// Share on a device that cannot host (browser, phone): the two ways to join.
function joinMenu(host) {
  const go = (mode) => () => { closeDialog(); openCollab(host, mode).catch((e) => host.status(e.message, true)); };
  dialog('Share',
    el('p', { textContent: 'Sharing starts in NoteComplete on a computer. From here you can join it:' }),
    el('div', { className: 'collab-join-menu' },
      el('button', { type: 'button', className: 'accent', textContent: 'Join shared notes…', onclick: go('join-notes') }),
      el('button', { type: 'button', className: 'accent', textContent: 'Join as drawing tablet…', onclick: go('join-tablet') })),
    buttons(el('button', { type: 'button', textContent: 'Close', onclick: closeDialog })));
}

// Host: choose what to share, then start the server and connect to it.
function hostDialog(host) {
  const choice = (value, label, detail, checked = false) => el('label', { className: 'collab-choice' },
    el('input', { type: 'radio', name: 'collabNotes', value, checked }), el('span', {}, el('strong', { textContent: label }), el('small', { className: 'muted', textContent: detail })));
  const start = el('button', { className: 'primary', type: 'button', textContent: 'Start sharing' });
  const cancel = el('button', { type: 'button', textContent: 'Cancel', onclick: closeDialog });
  dialog('Share and draw on a tablet',
    el('p', { textContent: 'People and devices on this network join with a link, a QR code or a short code. Drawing tablets draw on the note open in this tab; notes guests write the Markdown notes with you.' }),
    el('fieldset', { className: 'collab-choices' }, el('legend', { textContent: 'Notes' }),
      choice('edit', 'Guests can edit', 'Everyone writes the notes together.', true),
      choice('view', 'Guests can view', 'They follow the notes and cursors; edits are refused.'),
      choice('none', 'Not shared', 'Only drawing tablets join.')),
    el('p', { className: 'muted', textContent: 'Meant for a trusted network (home, school): the connection is not encrypted; the invite holds a secret.' }),
    buttons(cancel, start));
  start.onclick = async () => {
    const notes = document.querySelector('input[name=collabNotes]:checked')?.value;
    start.disabled = true;
    try {
      const info = await window.notecompleteCollab.start({ notes: notes === 'none' ? null : notes });
      const yjs = notes === 'none' ? null : await loadYjs();
      session = new Session(host, { url: info.hostUrl, token: info.hostToken, role: 'host', name: remembered() || 'Host', yjs, info: { ...info, notesMode: notes } });
      session.showShare();
    } catch (e) {
      start.disabled = false;
      host.status(e.message, true);
    }
  };
}
// Guest or tablet: a link, or the computer's address and code.
function joinDialog(host, role) {
  const tablet = role === 'tablet';
  const link = el('input', { type: 'text', autocomplete: 'off', placeholder: '192.168.1.20:41237 or the link', spellcheck: false });
  const code = el('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', placeholder: '123 456', maxLength: 7 });
  const go = el('button', { className: 'primary', type: 'submit', textContent: 'Join' });
  const error = el('p', { className: 'collab-error', hidden: true });
  try { link.value = localStorage.getItem('notecomplete-collab-address') || ''; } catch { /* Optional. */ }
  const form = el('form', { method: 'dialog', className: 'collab-join' },
    el('label', {}, el('span', { textContent: 'Computer address or link' }), link),
    el('label', {}, el('span', { textContent: 'PIN (when you typed an address, not a link)' }), code),
    error,
    buttons(el('button', { type: 'button', textContent: 'Cancel', onclick: closeDialog }), go));
  dialog(tablet ? 'Join as drawing tablet' : 'Join shared notes',
    el('p', { textContent: tablet
      ? 'On the computer: File → Share and draw on a tablet. Scan its QR code with the camera, or enter the address and the 6-digit PIN it shows.'
      : 'Paste the invite link the host gave you, or enter the address and the 6-digit PIN the computer shows (File → Share…).' }),
    form);
  (link.value ? code : link).focus();
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const invite = parseInvite(link.value, code.value, role);
      if (tablet && invite.role !== 'tablet') throw Error('That is a notes invite; use File → Join shared notes.');
      if (!tablet && invite.role === 'tablet' && /[#]/.test(link.value)) throw Error('That is a drawing tablet link; use File → Join as drawing tablet.');
      if (!/^[a-z]+:\/\//i.test(link.value.trim())) try { localStorage.setItem('notecomplete-collab-address', link.value.trim()); } catch { /* Optional. */ }
      closeDialog();
      await join(host, invite);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };
}
async function join(host, invite) {
  const yjs = invite.role === 'guest' ? await loadYjs() : null;
  session = new Session(host, { ...invite, name: remembered(), yjs });
  host.status(invite.role === 'tablet' ? 'Connecting to the computer…' : 'Joining the shared notes…');
  if (invite.role === 'tablet') session.loading('Connecting to the computer…');
  // A guest sees each step in a small bar that leaves the notes usable.
  else session.loading('Connecting…', { inline: true });
}

// "147 MB", "3.4 MB", "820 KB"; "1 min 5 s".
const megabytes = (bytes) => (bytes >= 1e6 ? `${bytes >= 1e7 ? Math.round(bytes / 1e6) : (bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const duration = (seconds) => (seconds >= 90 ? `${Math.round(seconds / 60)} min` : seconds >= 60 ? '1 min' : `${Math.max(1, seconds)} s`);

class Session {
  constructor(host, { url, token, code, role, name, yjs, info = null }) {
    Object.assign(this, { host, role, yjs, info, people: [], live: new Map() });
    this.client = new SyncClient({
      url, token, code, role, name, yjs,
      retries: role === 'host' ? [] : undefined,
      apply: (entry, mine) => this.apply(entry, mine),
      load: (snapshot) => this.load(snapshot),
      snapshot: () => host.call('save'),
      digest: () => host.call('digest'),
      on: (type, detail) => this.event(type, detail),
    });
    host.setCollab(this);
    this.client.connect();
  }
  // Ink goes through the shared order only while it matters: someone follows the note (a
  // tablet or a guest, for the host), or this is a tablet or a guest. Otherwise the host
  // edits exactly as without a session.
  get ink() {
    if (this.client.state !== 'open') return false;
    if (this.role === 'tablet' || this.role === 'guest') return this.client.loaded;
    return this.role === 'host' && this.host.kind === 'note' && this.people.some((p) => p.role === 'tablet' || p.role === 'guest');
  }
  // A guest of a view-only session sees the note but cannot change it.
  get readOnly() { return this.role === 'guest' && this.client.loaded && !this.client.canEdit; }
  submit(op, args) { return this.client.submit(op, args); }
  // Another person's stroke drawn live is now a real edit: its line goes to the page, which
  // keeps it until a render there has the stroke (app.js holdInk). Dropping it here left a
  // gap until the page was redrawn. A person's strokes reach the shared order in the order
  // they were drawn, so it is the oldest of theirs on that page.
  apply(entry, mine) {
    let line = null;
    if (!mine && (entry.op === 'draw' || entry.op === 'erase')) {
      const erase = entry.op === 'erase';
      const key = [...this.live.keys()].find((k) => {
        const s = this.live.get(k);
        return s.from === entry.from && s.page === entry.args?.page && (s.tool === 'erase') === erase;
      });
      if (key) {
        line = this.live.get(key).line;
        clearTimeout(this.live.get(key).timer);
        this.live.delete(key);
      }
    }
    return this.host.applyShared(entry, mine, line);
  }
  // Tablets and guests: the host's note, as a project.
  async load({ project, title }) {
    for (let i = 0; i < 200 && (!this.host.ready || this.host.busy); i++) await new Promise((r) => setTimeout(r, 50));
    const view = this.view();
    // A guest sees the pages as they are made (the first one's PDF can take a moment) and the
    // notes beside them, not the notes alone until the whole first page is drawn.
    if (this.role === 'guest') {
      document.body.classList.remove('guest-mode');
      this.loading('Loading the note…', { inline: true });
    }
    try {
      await this.host.openProject(project, title);
    } catch (e) {
      if (this.role === 'guest') { this.loading(null); this.enterGuest(); }
      throw e;
    }
    this.restoreView(view);
    this.waiting(false);
    // The note is open: the app may now cache itself for offline use (app.js).
    dispatchEvent(new Event('notecomplete:joined'));
    if (this.role === 'guest') {
      // The note itself, its pages and tools, not only the notes: guest-mode is the layout
      // for a session with no note open (enterGuest), and it hid the pages and the tool bar.
      document.body.classList.remove('guest-mode');
      // Opening a note loads its own notes: the panel goes back to the shared ones.
      document.body.classList.toggle('guest-readonly', !this.client.canEdit);
      if (!this.client.canEdit) this.host.setTool?.('pan');
      const notes = await this.host.notesApi();
      if (!notes.visible) $('notesToggle')?.click();
      this.bindNotes();
      this.showTitle();
      this.loading(null);
      this.host.status(this.client.canEdit ? `You can draw on “${title || 'the note'}” and write its notes.` : `Viewing “${title || 'the note'}”.`);
      return;
    }
    this.loading(null);
    this.host.status(`Drawing on “${title || 'the note'}”.`);
  }
  // A full-screen "Connecting… / Loading the note…" with a moving bar; null hides it.
  // `inline` (guests): a small bar at the top that leaves the page and the notes usable.
  // `fraction` (0..1) makes the bar show how far it is; `detail` is a second line (speed, time left).
  loading(text, { inline = false, fraction = null, detail = '' } = {}) {
    if (!text) { this.loader?.remove(); this.loader = null; this.transfer = null; return; }
    if (this.loader && this.loader.classList.contains('inline') !== inline) { this.loader.remove(); this.loader = null; }
    if (!this.loader) {
      this.loader = el('div', { className: 'tablet-loader', role: 'status' }, el('div', { className: 'loader-bar' }), el('p'), el('small', { className: 'loader-detail' }),
        el('button', { type: 'button', textContent: 'Cancel', onclick: () => this.leave() }));
      this.loader.classList.toggle('inline', inline);
      document.body.append(this.loader);
    }
    this.loader.querySelector('p').textContent = text;
    const detailLine = this.loader.querySelector('.loader-detail'), bar = this.loader.querySelector('.loader-bar');
    detailLine.textContent = detail;
    detailLine.hidden = !detail;
    bar.classList.toggle('determinate', fraction != null);
    if (fraction != null) bar.style.setProperty('--p', `${Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 10}%`);
    else bar.style.removeProperty('--p');
  }
  // How the note is arriving (the sync client's progress events): the computer preparing it, the
  // bytes received with the speed and time left, then opening it.
  joinProgress({ stage, done, total }) {
    const inline = this.role === 'guest' || !!this.host.doc;
    if (stage === 'preparing') { this.transfer = null; return this.loading('The computer is preparing the note…', { inline }); }
    if (stage === 'opening') { this.transfer = null; return this.loading('Opening the note…', { inline }); }
    if (stage !== 'receiving') return;
    const now = Date.now(), t = (this.transfer ||= { at: now, last: now, lastDone: 0, rate: 0 });
    // A smoothed speed from the last few parts; the time left comes from it.
    if (now - t.last >= 400 && done >= t.lastDone) {
      const instant = (done - t.lastDone) / ((now - t.last) / 1000);
      t.rate = t.rate ? t.rate * 0.7 + instant * 0.3 : instant;
      t.last = now; t.lastDone = done;
    }
    const fraction = total ? done / total : null;
    const left = t.rate > 0 && total > done ? Math.ceil((total - done) / t.rate) : null;
    this.loading(total ? `Receiving the note · ${megabytes(done)} of ${megabytes(total)} (${Math.floor(fraction * 100)} %)` : 'Receiving the note…', {
      inline, fraction,
      detail: t.rate > 0 ? `${megabytes(t.rate)}/s${left != null ? ` · about ${duration(left)} left` : ''}` : 'Starting…',
    });
  }
  event(type, detail) {
    const host = this.host;
    if (type === 'welcome' || type === 'doc') this.docTitle = detail.title || this.docTitle;
    if (type === 'welcome') {
      if (this.role === 'tablet') this.enterTablet();
      if (this.role === 'guest') this.enterGuest();
      if (this.role === 'host') { this.documentChanged(); this.settingsChanged(); }
      else this.host.setSharedAutosave?.(detail.autosave);
      // resumed: back after a dropped connection, with the note still open here.
      if (this.role === 'guest') {
        this.loading(detail.open && !detail.resumed ? 'Loading the note…' : null, { inline: true });
        if (!detail.resumed) this.askName(detail.name);
        host.status(`Joined the notes${detail.title ? ` of “${detail.title}”` : ''}.`);
        this.showTitle();
      }
      if (this.role === 'tablet' && detail.resumed) host.status('Connected again.');
      else if (this.role === 'tablet') { host.status('Connected. Waiting for the computer’s note…'); this.waiting(!detail.open); this.loading(detail.open ? 'Loading the note…' : null); }
    } else if (type === 'text') {
      this.showText(detail);
    } else if (type === 'resynced') {
      // Host: a tablet's or guest's copy no longer matched, and is being sent the note again.
      host.status(`${detail.name || 'A device'} had drifted out of sync; sending it the note again.`, true);
    } else if (type === 'progress') {
      this.joinProgress(detail);
    } else if (type === 'loading') {
      // Host: who is receiving the note, and how far.
      const before = this.loadingPeers || new Map();
      this.loadingPeers = new Map(detail.map((p) => [p.id, p]));
      for (const [id, p] of before) if (!this.loadingPeers.has(id) && p.stage === 'opening') this.host.status(`${p.name} has the note.`);
      this.drawPeople();
      if ($('collabDialog')?.open && this.shareShown) this.drawShareList();
    } else if (type === 'peers') {
      this.people = detail;
      this.drawPeople();
      if (this.role === 'host' && $('collabDialog')?.open && this.shareShown) this.drawShareList();
      for (const [key, stroke] of this.live) if (!detail.some((p) => p.id === stroke.from)) this.dropLive(key);
    } else if (type === 'doc') {
      if (this.role === 'guest') this.showTitle();
      // The host closed the note (or opened something that is not a note): notes only.
      if (this.role === 'guest' && !detail.open && host.doc) { host.closeDocument(); this.enterGuest(); }
      if (this.role === 'guest') this.loading(detail.open && !host.doc ? 'Loading the note…' : null, { inline: true });
      if (this.role === 'tablet' && !detail.open) { host.closeDocument(); this.waiting(true); this.loading(null); }
      else if (this.role === 'tablet' && detail.open) this.loading('Loading the note…');
    } else if (type === 'settings') {
      if (this.role !== 'host') this.host.setSharedAutosave?.(detail.autosave);
    } else if (type === 'live') {
      this.showLive(detail);
    } else if (type === 'notes-reset') {
      this.bindNotes();
    } else if (type === 'code') {
      Object.assign(this.info, { code: detail.code, expires: detail.expires });
      if (this.shareShown) this.drawTablet();
    } else if (type === 'status') {
      if (detail.state === 'reconnecting') host.status('Connection lost. Reconnecting…', true);
      else if (detail.error) host.status(detail.error, true);
    } else if (type === 'ending') {
      this.keepCopy(detail.text);
    } else if (type === 'ended') {
      this.finish(this.role === 'host' ? 'Sharing ended. The notes were saved.' : this.role === 'tablet' ? 'The computer ended the session.' : 'The host ended the session; your copy of the notes was saved.', detail.text);
    } else if (type === 'lost') {
      if (this.role === 'guest') this.keepCopy(detail.text);
      this.finish(this.role === 'guest' ? 'The session ended: the host could not be reached. Your copy of the notes was saved.' : 'The computer could not be reached.', detail.text);
    } else if (type === 'closed') {
      this.finish(detail.reason || 'Disconnected.', null, true);
    } else if (type === 'nack') {
      host.status(detail.error, true);
    }
  }

  // Host --------------------------------------------------------------------------------
  // The tab opened another note, or closed it: tablets reload; notes start from its text.
  // Host: the auto-save switch, which everyone in the session follows.
  settingsChanged() {
    if (this.role === 'host' && this.client.state === 'open') this.client.settings({ autosave: this.host.autosaveOn?.() });
  }
  async documentChanged() {
    if (this.role !== 'host' || this.client.state !== 'open') return;
    const kind = this.host.kind;
    let notes;
    if (this.yjs) {
      notes = kind === 'note' ? await this.host.call('getMarkdown').catch(() => '')
        : kind === 'side' && this.host.fingerprint ? await this.host.library.store.get('settings', `notes:${this.host.fingerprint}`).catch(() => '') || '' : '';
    }
    this.client.documentChanged({ open: kind === 'note', title: this.host.title(), notes, text: kind === 'side' ? this.host.textDocument?.() : null });
  }
  // Host: the text document was typed in; guests get the new text a moment after the last key.
  textChanged() {
    if (this.role !== 'host' || this.client.state !== 'open') return;
    clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => this.client.textChanged(this.host.textDocument?.()), 500);
  }
  // Guest: the host's text document, read here as the host has it (no editing; it follows the host).
  showText(m) {
    if (this.role !== 'guest') return;
    if (!m.shared) { if (this.host.sharedText) { this.host.closeDocument(); this.enterGuest(); } return; }
    if (m.tooBig) return this.host.status(`“${m.name}” is too large to share as text.`, true);
    document.body.classList.remove('guest-mode');
    this.loading(null);
    this.host.openSharedText({ name: m.name, markdown: m.markdown, content: m.content }).catch((e) => this.host.status(e.message, true));
  }
  async showShare() {
    this.shareShown = true;
    const online = !!window.notecompleteCollab?.online;
    const tabs = [['local', 'Local'], ...(online ? [['online', 'Online']] : []), ['fixes', 'Fixes']];
    // Local: this network, with the address and PIN and the links. Online: other networks.
    // Fixes: what to try when a device does not connect (firewall, another address).
    const pin = el('section', { id: 'collabPin', className: 'collab-section' });
    const tablet = el('section', { id: 'collabTablet', className: 'collab-section' });
    const invite = el('section', { id: 'collabInvite', className: 'collab-section' });
    const pointer = el('p', { className: 'muted collab-pointer' }, 'A device does not connect? ', el('button', { type: 'button', className: 'link', textContent: 'See Fixes', onclick: () => this.showTab('fixes') }));
    const panels = {
      local: el('div', { id: 'collabPanelLocal', className: 'collab-panel', role: 'tabpanel' }, pin, tablet, invite, pointer),
      online: el('div', { id: 'collabPanelOnline', className: 'collab-panel', role: 'tabpanel' }, el('section', { id: 'collabOnline', className: 'collab-section' })),
      fixes: el('div', { id: 'collabPanelFixes', className: 'collab-panel', role: 'tabpanel' }, el('section', { id: 'collabFixes', className: 'collab-section' })),
    };
    const bar = el('div', { className: 'collab-tabs', role: 'tablist', 'aria-label': 'How people and devices connect' },
      ...tabs.map(([id, label]) => el('button', { type: 'button', role: 'tab', id: `collabTab-${id}`, textContent: label, onclick: () => this.showTab(id) })));
    this.tabs = tabs.map(([id]) => id);
    const people = el('section', { className: 'collab-section' }, el('h3', { textContent: 'People' }), el('ul', { id: 'collabPeople', className: 'collab-people' }));
    const stop = el('button', { type: 'button', className: 'danger', textContent: 'Stop sharing', onclick: () => this.end() });
    const done = el('button', { type: 'button', className: 'primary', textContent: 'Done', onclick: closeDialog });
    const d = dialog('Sharing', bar, ...tabs.map(([id]) => panels[id]), people, buttons(stop, done));
    // Enter must never end the session by accident: focus starts on Done.
    done.focus();
    let last = 'local';
    try { last = localStorage.getItem('notecomplete-collab-tab') || 'local'; } catch { /* Optional. */ }
    this.showTab(this.tabs.includes(last) ? last : 'local');
    clearInterval(this.codeClock);
    this.codeClock = setInterval(() => this.tickCode(), 1000);
    d.addEventListener('close', () => { this.shareShown = false; clearInterval(this.codeClock); }, { once: true });
    await this.drawTablet();
    await this.drawInvite();
    await this.drawOnline();
    await this.drawFixes();
    this.drawShareList();
  }
  showTab(id) {
    if (!this.tabs?.includes(id)) return;
    for (const tab of this.tabs) {
      const on = tab === id;
      $(`collabTab-${tab}`)?.setAttribute('aria-selected', String(on));
      const panel = $(`collabPanel${tab[0].toUpperCase()}${tab.slice(1)}`);
      if (panel) panel.hidden = !on;
    }
    try { localStorage.setItem('notecomplete-collab-tab', id); } catch { /* Optional. */ }
  }
  // How long the PIN works; a fresh one comes by itself when it runs out.
  tickCode() {
    const left = $('collabCodeLeft');
    if (!left || !this.info.expires) return;
    const seconds = Math.max(0, Math.ceil((this.info.expires - Date.now()) / 1000));
    left.textContent = seconds ? `Valid for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Expired: making a new one…';
    if (!seconds && !this.renewing) {
      this.renewing = true;
      this.client.newCode();
      setTimeout(() => { this.renewing = false; }, 3000);
    }
  }
  // People on other networks (online access, desktop tunnel.js): a separate link through
  // Cloudflare, for the notes only; it stops when turned off or when sharing ends.
  async drawOnline(state = {}) {
    const section = $('collabOnline'), bridge = window.notecompleteCollab;
    if (!section) return;
    if (!bridge?.online) return;
    const title = el('h3', { textContent: 'Online access' });
    if (state.busy) {
      section.replaceChildren(title, el('p', { className: 'muted', id: 'collabOnlineStatus', textContent: state.busy }));
      return;
    }
    if (!this.info.online) {
      const on = el('button', { type: 'button', className: 'accent', textContent: 'Turn on online access' });
      on.onclick = async () => {
        if (!onlineHooked) {
          onlineHooked = true;
          bridge.onOnlineProgress?.((p) => { const s = $('collabOnlineStatus'); if (s) s.textContent = `Downloading Cloudflare’s tunnel (once)… ${Math.round(p * 100)}%`; });
          bridge.onOnlineEnded?.(() => { if (!session?.info) return; Object.assign(session.info, { online: false, onlineLink: '', onlineTabletLink: '' }); session.host.status('Online access stopped: the tunnel closed.', true); session.drawOnline(); });
        }
        await this.drawOnline({ busy: 'Connecting to Cloudflare…' });
        try {
          Object.assign(this.info, await bridge.online(true));
          this.host.status('Online access is on. Send the online links to people and devices on other networks.');
        } catch (e) { this.host.status(e.message, true); }
        await this.drawOnline();
      };
      section.replaceChildren(title,
        el('p', { textContent: 'Reach people and devices on other networks through a temporary internet address from Cloudflare. They get their own links, which work until you turn this off or stop sharing.' }),
        el('p', { className: 'muted', textContent: !this.info.guestLink ? 'Drawing tablets only: this session shares no notes.' : this.info.notesMode === 'view' ? 'Guests see the note and can only read the notes.' : 'Guests see the note, draw on it and write the notes, as on this network.' }),
        on);
      return;
    }
    const off = el('button', { type: 'button', className: 'danger', textContent: 'Turn off', onclick: async () => {
      try { Object.assign(this.info, await bridge.online(false)); } catch (e) { this.host.status(e.message, true); }
      Object.assign(this.info, { online: false, onlineLink: '', onlineTabletLink: '' });
      this.host.status('Online access is off; people and devices that joined online were disconnected.');
      this.drawOnline();
    } });
    const block = async (label, link, text) => {
      const copy = el('button', { type: 'button', className: 'collab-copy', title: 'Copy the link', 'aria-label': 'Copy the link' }, icon('copy'));
      copy.onclick = () => navigator.clipboard.writeText(link).then(() => this.host.status('Link copied.'), () => this.host.status('Select the link and copy it.', true));
      const qr = el('div', { className: 'collab-qr small' });
      qr.innerHTML = await qrSvg(link);
      return el('div', { className: 'collab-pair' }, qr, el('div', {},
        el('p', {}, el('strong', { textContent: label }), ` ${text}`),
        el('div', { className: 'collab-linkrow' }, el('input', { type: 'text', readOnly: true, value: link, className: 'collab-link', 'aria-label': 'Link', onfocus: (e) => e.target.select() }), copy)));
    };
    const blocks = [];
    if (this.info.onlineLink) blocks.push(await block('People:', this.info.onlineLink, 'the note and its notes, in a browser anywhere.'));
    if (this.info.onlineTabletLink) blocks.push(await block('Drawing tablet:', this.info.onlineTabletLink, 'a phone or tablet on any network.'));
    section.replaceChildren(title, ...blocks, el('div', { className: 'collab-online-actions' }, off));
  }

  async drawInvite() {
    const invite = $('collabInvite');
    if (!invite) return;
    if (!this.info.guestLink) { invite.hidden = true; return; }
    invite.hidden = false;
    const qr = el('div', { className: 'collab-qr small' });
    qr.innerHTML = await qrSvg(this.info.guestLink);
    const can = this.info.notesMode === 'view' ? 'They can read the note and its notes and follow along, but not change anything.' : 'They can also draw on the note and write the notes with you.';
    invite.replaceChildren(el('h3', { textContent: 'Guests' }), el('div', { className: 'collab-pair' }, qr, el('div', {},
      el('p', { textContent: 'People who read the note along with you, in a browser or in NoteComplete (File → Join shared notes): the pages with their tools, and the shared notes beside them, with everyone’s cursors. A Markdown or text document you open is shown to them as text. ' + can }),
      this.linkRow(this.info.guestLink, 'Guest link copied.'))));
  }
  // A link in a box that selects on focus, with Copy.
  linkRow(link, done) {
    const copy = el('button', { type: 'button', className: 'collab-copy', title: 'Copy the link', 'aria-label': 'Copy the link' }, icon('copy'));
    copy.onclick = () => navigator.clipboard.writeText(link).then(() => this.host.status(done), () => this.host.status('Select the link and copy it.', true));
    return el('div', { className: 'collab-linkrow' }, el('input', { type: 'text', readOnly: true, value: link, className: 'collab-link', 'aria-label': 'Link', onfocus: (e) => e.target.select() }), copy);
  }
  // Phones never load the page: on Linux, firewalld or ufw blocks the port. The command to
  // allow it, to copy into a terminal; or the online link, which needs no firewall change.
  firewallHint() {
    const hint = this.info.firewall;
    if (!hint?.command) return null;
    const copy = el('button', { type: 'button', className: 'collab-copy', title: 'Copy the command', 'aria-label': 'Copy the command' }, icon('copy'));
    copy.onclick = () => navigator.clipboard.writeText(hint.command).then(() => this.host.status('Command copied. Run it in a terminal.'), () => this.host.status('Select the command and copy it.', true));
    return el('div', { className: 'collab-firewall' },
      el('p', { textContent: `The page never loads on the device? This computer's firewall (${hint.name}) blocks it. Allow NoteComplete's port once, in a terminal:` }),
      el('div', { className: 'collab-linkrow' }, el('input', { type: 'text', readOnly: true, value: hint.command, className: 'collab-link', 'aria-label': 'Command', onfocus: (e) => e.target.select() }), copy),
      window.notecompleteCollab?.online ? el('p', { className: 'muted', textContent: 'Or turn on online access (Online tab): it works without changing the firewall.' }) : '');
  }
  // This computer has several networks (Wi-Fi and a VPN, say): the links can use another.
  networkPicker() {
    const list = this.info.addresses || [];
    if (list.length < 2 || !window.notecompleteCollab?.useAddress) return null;
    const select = el('select', { 'aria-label': 'Network address for the links', onchange: async () => {
      const fresh = await window.notecompleteCollab.useAddress(select.value).catch(() => null);
      if (fresh) Object.assign(this.info, fresh);
      await this.drawTablet();
      await this.drawInvite();
      await this.drawFixes();
    } }, ...list.map((a) => el('option', { value: a, textContent: a, selected: a === this.info.address })));
    return el('label', { className: 'collab-network' }, el('span', { textContent: 'Address of this computer for the links and the PIN: ' }), select);
  }
  // The address and PIN (for tablets and for guests), then the tablet's link with its QR code.
  async drawTablet() {
    const section = $('collabTablet'), pin = $('collabPin');
    if (!section || !pin) return;
    const fresh = await window.notecompleteCollab.info().catch(() => null);
    if (fresh) Object.assign(this.info, fresh);
    const qr = el('div', { className: 'collab-qr' });
    qr.innerHTML = await qrSvg(this.info.tabletLink);
    const code = String(this.info.code || ''), address = `${this.info.address}:${this.info.port}`;
    const copy = (text, label, message) => el('button', { type: 'button', className: 'collab-copy', title: `Copy the ${label}`, 'aria-label': `Copy the ${label}`, onclick: () => navigator.clipboard.writeText(text).then(() => this.host.status(message), () => this.host.status('Select it and copy it.', true)) }, icon('copy'));
    const renew = el('button', { type: 'button', className: 'collab-copy', title: 'Make a new PIN now', 'aria-label': 'New PIN', onclick: () => this.client.newCode() }, icon('restart'));
    // One address and PIN for both kinds of device on this network.
    pin.replaceChildren(el('h3', { textContent: 'Join with the address and PIN' }),
      el('p', { className: 'muted', textContent: `On a device on the same Wi-Fi, in NoteComplete: File → Join as drawing tablet${this.info.guestLink ? ', or File → Join shared notes for a guest' : ''}. Type:` }),
      el('dl', { className: 'collab-code' },
        el('dt', { textContent: 'Address' }), el('dd', {}, el('span', { textContent: address }), el('span', { className: 'collab-icons' }, copy(address, 'address', 'Address copied.'))),
        el('dt', { textContent: 'PIN' }), el('dd', { className: 'code' }, el('span', { textContent: `${code.slice(0, 3)} ${code.slice(3)}` }), el('span', { className: 'collab-icons' }, copy(code, 'PIN', 'PIN copied.'), renew))),
      el('p', { className: 'muted' }, el('span', { id: 'collabCodeLeft' }), ' · after joining, the device reconnects by itself.'));
    section.replaceChildren(el('h3', { textContent: 'Tablets' }), el('div', { className: 'collab-pair' }, qr, el('div', {},
      el('p', { textContent: 'A phone or tablet used as a drawing surface for the note open on this computer: it shows the pages and a pen dock (pen, highlighter, eraser, tape, text, undo) and nothing else, and what it draws appears here as it is drawn. Scan the code with its camera, or open the link.' }),
      this.linkRow(this.info.tabletLink, 'Tablet link copied.'))));
    this.tickCode();
  }
  // What to try when a device does not connect, in the order that fixes it most often.
  async drawFixes() {
    const section = $('collabFixes');
    if (!section) return;
    const online = !!window.notecompleteCollab?.online;
    const steps = [
      'Both devices are on the same Wi-Fi network: not a guest network, not a VPN, and with “client isolation” (AP isolation) off in the router.',
      'The device types the address and PIN instead of opening a link: that works even where links are blocked or cut off by a chat app.',
      ...(this.info.firewall?.command ? [`This computer’s firewall (${this.info.firewall.name}) may block the port: allow it with the command below.`] : []),
      ...((this.info.addresses || []).length > 1 ? ['This computer has more than one network: pick the address the device can reach below.'] : []),
      ...(online ? ['Still nothing: use the Online tab; it needs no firewall change.'] : []),
    ];
    section.replaceChildren(el('h3', { textContent: 'The device does not connect' }),
      el('ol', { className: 'collab-steps' }, ...steps.map((text) => el('li', { textContent: text }))),
      this.firewallHint() || '', this.networkPicker() || '',
      online ? el('p', {}, el('button', { type: 'button', className: 'link', textContent: 'Go to Online', onclick: () => this.showTab('online') })) : '');
  }
  drawShareList() {
    const list = $('collabPeople');
    if (!list) return;
    const others = this.people.filter((p) => p.id !== this.client.id);
    list.replaceChildren(...(others.length ? others.map((p) => el('li', {},
      el('span', { className: 'collab-dot', style: `background:${p.color}` }),
      el('span', { textContent: p.name }),
      el('small', { className: 'muted', textContent: this.loadingPeers?.has(p.id) ? this.loadingText(this.loadingPeers.get(p.id)) : p.role === 'tablet' ? 'tablet' : 'guest' }),
      (() => { const b = el('button', { type: 'button', className: 'collab-remove', title: `Remove ${p.name}`, 'aria-label': `Remove ${p.name}`, onclick: () => this.client.removePeer(p.id) }); b.append(icon('close')); return b; })())) : [el('li', { className: 'muted', textContent: 'No one has joined yet.' })]));
  }
  // Closing the tab while sharing (app.js asks this first): Minimize / End session and close / Cancel.
  beforeClose() {
    if (this.role !== 'host') { this.leave(); return true; }
    if (!this.people.some((p) => p.id !== this.client.id)) { this.end(); return true; }
    const others = this.people.length - 1;
    return new Promise((resolve) => {
      const answer = (value) => () => { closeDialog(); resolve(value); };
      const minimize = el('button', { type: 'button', className: 'primary', textContent: 'Minimize', onclick: () => { window.notecompleteCollab?.minimize(); answer(false)(); } });
      dialog('End the session?',
        el('p', { textContent: `Notes are shared with ${others} ${others === 1 ? 'person' : 'people'}. Closing ends the session for everyone.` }),
        buttons(el('button', { type: 'button', textContent: 'Cancel', onclick: answer(false) }),
          el('button', { type: 'button', className: 'danger', textContent: 'End session and close', onclick: async () => { closeDialog(); await this.end(); resolve(true); } }),
          minimize));
      minimize.focus();
    });
  }
  // Everyone is told and saves first; resolves when the session is over (a few seconds at most).
  end() {
    if (this.role !== 'host') return this.leave();
    closeDialog();
    this.host.status('Ending the session: everyone is saving the notes…');
    return new Promise((resolve) => {
      this.ended = resolve;
      this.client.end();
      setTimeout(() => { window.notecompleteCollab?.stop().catch(() => {}); this.finish('Sharing ended.', null); }, 5000);
    });
  }

  // Guests and tablets ------------------------------------------------------------------
  askName(suggested) {
    const input = el('input', { type: 'text', maxLength: 40, value: remembered() || suggested, 'aria-label': 'Your name' });
    const ok = el('button', { className: 'primary', type: 'submit', textContent: 'OK' });
    const form = el('form', { method: 'dialog', className: 'collab-name' }, input, ok);
    const d = dialog('Your name', el('p', { textContent: 'Others see it beside your cursor and in the bar.' }), form);
    d.classList.add('collab-name-dialog');
    form.onsubmit = (event) => {
      event.preventDefault();
      const name = input.value.trim() || suggested;
      remember(name);
      this.client.rename(name);
      closeDialog();
      d.classList.remove('collab-name-dialog');
    };
    input.focus();
    input.select();
  }
  showTitle() {
    const title = this.docTitle ? `${this.docTitle} · shared notes` : 'Shared notes';
    $('title').textContent = title;
    document.title = `${title} — NoteComplete`;
  }
  rename(current) {
    const name = prompt('Your name', current)?.trim();
    if (!name) return;
    remember(name);
    this.client.rename(name);
  }
  enterGuest() {
    // The notes stay open for a guest, the whole session (style.css hides their close button).
    document.body.classList.add('guest-session');
    // Notes only, while no note is open (the note may arrive before or after this).
    if (!this.host.doc) {
      document.body.classList.add('guest-mode');
      // The notes panel lives in the page editor, shown here without a note.
      $('empty').hidden = true;
      $('editor').hidden = false;
    }
    this.host.notesApi().then(async (notes) => {
      await notes.load('', { core: false });
      await notes.open();
      $('notesToggle')?.setAttribute('aria-expanded', 'true');
      this.bindNotes();
    }).catch((e) => this.host.status(e.message, true));
  }
  // The guest's text is kept on this device as a Markdown file, and in the library.
  keepCopy(text) {
    if (this.copied || !text) return;
    this.copied = text;
    const name = `${(this.docTitle || 'Notes').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')} - shared notes.md`;
    this.copyName = name;
    this.host.library?.store.set('settings', `collab-copy:${this.client.id}:${Date.now()}`, { name, text, at: Date.now() }).catch(() => {});
    this.host.download(text, name, 'text/markdown').catch(() => {});
  }

  // Notes -------------------------------------------------------------------------------
  async bindNotes() {
    if (!this.yjs || !this.client.text) return;
    const notes = await this.host.notesApi();
    const { Y } = this.yjs, ytext = this.client.text;
    this.undo?.destroy();
    this.undo = new Y.UndoManager(ytext, { trackedOrigins: new Set([LOCAL]) });
    ytext.observe((event, transaction) => {
      if (transaction.origin === LOCAL || ytext !== this.client.text) return;
      notes.remote(ytext.toString(), event.delta);
      this.drawCursors();
    });
    notes.share({
      canEdit: this.client.canEdit,
      persist: this.role === 'host',
      text: () => ytext.toString(),
      local: (text) => applyTextDiff(ytext, text, LOCAL),
      // The editor appeared (the panel opened): show where everyone is.
      mounted: () => requestAnimationFrame(() => this.drawCursors()),
    });
    this.notes = notes;
    // Each notes reset brings a new awareness: listen to the current one.
    this.client.awareness.on('change', () => { this.drawCursors(); this.drawPeople(); });
    if (!this.listening) this.listenNotes();
  }
  listenNotes() {
    this.listening = true;
    const editor = $('notesEditor');
    // Undo and redo are each person's own (Y.UndoManager), not the editor's.
    this.onKey = (e) => {
      if (!this.undo || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      e.stopPropagation();
      // The change comes back through the text's observer, like anyone else's.
      if (key === 'y' || e.shiftKey) this.undo.redo();
      else this.undo.undo();
    };
    editor.addEventListener('keydown', this.onKey, true);
    let frame = 0;
    this.onSelection = () => {
      if (frame || !this.client.awareness) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const caret = this.notes?.caret();
        if (!caret) return;
        const { Y } = this.yjs, ytext = this.client.text;
        const rel = (i) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, i));
        this.client.awareness.setLocalStateField('cursor', { head: rel(caret.index), anchor: caret.anchor == null ? null : rel(caret.anchor) });
      });
    };
    document.addEventListener('selectionchange', this.onSelection);
    this.onScroll = () => this.drawCursors();
    editor.addEventListener('scroll', this.onScroll, { passive: true });
  }
  // Others' carets in the notes editor, each in that person's colour with their name.
  drawCursors() {
    const editor = $('notesEditor');
    if (!this.notes || !this.client.awareness || !editor) return;
    let layer = $('notesCursors');
    if (!layer || layer.parentElement !== editor) {
      layer = el('div', { id: 'notesCursors', className: 'notes-cursors' });
      layer.setAttribute('aria-hidden', 'true');
      editor.append(layer);
    }
    const { Y } = this.yjs, carets = [];
    for (const [client, state] of this.client.awareness.getStates()) {
      if (client === this.client.doc.clientID || !state.cursor?.head || !state.user) continue;
      const pos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.head), this.client.doc);
      const box = pos && this.notes.caretBox(pos.index);
      if (!box) continue;
      const caret = el('div', { className: 'notes-caret', style: `left:${box.x}px;top:${box.y}px;height:${box.height}px;--who:${state.user.color}` }, el('span', { textContent: state.user.name }));
      carets.push(caret);
    }
    layer.replaceChildren(...carets);
  }
  cursorOf(peer) {
    if (!this.client.awareness) return null;
    const { Y } = this.yjs;
    for (const [, state] of this.client.awareness.getStates()) {
      if (state.user?.name !== peer.name || !state.cursor?.head) continue;
      return Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.head), this.client.doc)?.index ?? null;
    }
    return null;
  }

  // Presence in the bar -----------------------------------------------------------------
  // What a joiner is doing with the note, for the host: "Sending 43 % · 63 of 147 MB".
  loadingText(p) {
    if (p.stage === 'preparing') return 'Preparing the note…';
    if (p.stage === 'opening') return 'Opening the note…';
    return p.total ? `Sending ${Math.floor((p.done / p.total) * 100)} % · ${megabytes(p.done)} of ${megabytes(p.total)}` : 'Sending the note…';
  }
  loadingPill(list) {
    const first = list[0], fraction = first.stage === 'sending' && first.total ? first.done / first.total : null;
    const bar = el('i', { className: 'collab-loading-bar' });
    if (fraction != null) bar.style.setProperty('--p', `${Math.round(fraction * 1000) / 10}%`); else bar.classList.add('wait');
    const text = list.length > 1 ? `${list.length} people loading…` : `${first.name} · ${first.stage === 'sending' && first.total ? `${Math.floor(fraction * 100)} %` : this.loadingText(first).replace('…', '')}`;
    return el('span', { className: 'collab-loading', role: 'status', title: list.map((p) => `${p.name}: ${this.loadingText(p)}`).join('\n') }, bar, el('span', { textContent: text }));
  }
  drawPeople() {
    let bar = $('collabPeopleBar');
    if (!bar) {
      bar = el('div', { id: 'collabPeopleBar', className: 'collab-bar', role: 'group' });
      bar.setAttribute('aria-label', 'People in this session');
      // Next to Share, so it shows in every bar size, phones included.
      $('collabSlot')?.prepend(bar);
      const share = $('shareButton');
      if (share) { share.classList.add('active'); share.querySelector('span').textContent = this.role === 'host' ? 'Sharing' : 'Shared'; }
    }
    const others = this.people.filter((p) => p.id !== this.client.id);
    const shown = others.slice(0, 4);
    const chip = (p) => {
      const b = el('button', { type: 'button', className: 'collab-chip', title: `${p.name}${p.role === 'tablet' ? ' (drawing tablet)' : ''}`, style: `--who:${p.color}`, textContent: (p.name.trim()[0] || '?').toUpperCase() });
      b.onclick = () => this.goTo(p);
      return b;
    };
    const me = el('button', { type: 'button', className: 'collab-chip me', title: `You: ${this.client.name}. Click to change your name.`, style: `--who:${this.client.color}`, textContent: (this.client.name.trim()[0] || '?').toUpperCase(), onclick: () => this.rename(this.client.name) });
    const loading = [...(this.loadingPeers?.values() || [])].filter((p) => others.some((o) => o.id === p.id));
    bar.replaceChildren(...[me, ...shown.map(chip), ...(loading.length ? [this.loadingPill(loading)] : []), others.length > shown.length ? el('span', { className: 'collab-more', textContent: `+${others.length - shown.length}`, title: others.slice(shown.length).map((p) => p.name).join(', ') }) : null].filter(Boolean));
  }
  // Clicking a name shows that person's cursor in the notes (opening them if closed).
  async goTo(peer) {
    if (peer.role === 'tablet') return this.host.status(`${peer.name} is a drawing tablet.`);
    if (!this.yjs) return;
    const notes = await this.host.notesApi();
    if (!notes.visible) $('notesToggle')?.click();
    const index = this.cursorOf(peer);
    if (index == null) return this.host.status(`${peer.name} has not placed a cursor in the notes yet.`);
    setTimeout(() => notes.scrollToIndex(index), 60);
  }

  // Live strokes ------------------------------------------------------------------------
  // Called for each new point of this reader's stroke (app.js); sends at most once a frame.
  drawing(g) {
    if (!this.ink || !DRAWING.has(g.tool)) return;
    g.liveId ||= Math.random().toString(36).slice(2, 10);
    if (g.liveFrame) return;
    g.liveFrame = requestAnimationFrame(() => {
      g.liveFrame = 0;
      const whole = g.tool === 'shape' || g.straight || g.box;
      const from = whole ? 0 : g.liveSent || 0;
      const points = g.points.slice(from).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      if (!points.length) return;
      g.liveSent = g.points.length;
      this.client.live({ id: g.liveId, page: g.panel.index, tool: g.tool, color: g.color, width: g.width, points, replace: whole || from === 0 });
    });
  }
  drawn(g, cancelled = false) {
    if (!g.liveId) return;
    cancelAnimationFrame(g.liveFrame);
    this.client.live({ id: g.liveId, page: g.panel.index, done: true, cancelled });
  }
  showLive(m) {
    const key = `${m.from}:${m.id}`;
    let stroke = this.live.get(key);
    if (m.done) {
      if (!stroke) return;
      if (m.cancelled) return this.dropLive(key);
      stroke.done = true;
      stroke.timer = setTimeout(() => this.dropLive(key), 4000);
      return;
    }
    const p = this.host.panels[m.page];
    if (!p?.overlay) return;
    if (!stroke) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.classList.add('remote-ink');
      const erase = m.tool === 'erase';
      for (const [k, v] of Object.entries({ fill: 'none', stroke: erase ? '#ed6b55' : /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#246bce', 'stroke-width': Math.min(200, Math.max(0.5, Number(m.width) || 2)), 'stroke-linecap': m.tool === 'tape' ? 'butt' : 'round', 'stroke-linejoin': 'round', opacity: erase ? 0.3 : m.tool === 'highlight' ? 0.5 : 1 }))
        line.setAttribute(k, String(v));
      stroke = { from: m.from, page: m.page, tool: m.tool, line, points: [] };
      this.live.set(key, stroke);
    }
    const points = (Array.isArray(m.points) ? m.points : []).filter((pt) => Array.isArray(pt) && pt.every(Number.isFinite)).slice(0, 8192);
    stroke.points = m.replace ? points : stroke.points.concat(points).slice(0, 8192);
    stroke.line.setAttribute('points', stroke.points.map((pt) => pt.join(',')).join(' '));
    // The overlay is rebuilt when the page redraws: put the stroke back on the current one.
    if (stroke.line.parentNode !== p.overlay) p.overlay.append(stroke.line);
  }
  dropLive(key) {
    const stroke = this.live.get(key);
    if (!stroke) return;
    clearTimeout(stroke.timer);
    stroke.line.remove();
    this.live.delete(key);
  }

  // Drawing tablet ----------------------------------------------------------------------
  // Fingers move and zoom the page once a stylus has drawn; before that they draw.
  touchPans(e) {
    if (this.role !== 'tablet' || e.pointerType !== 'touch') return false;
    return this.host.tool === 'pan' || (this.host.penActive() && DRAWING.has(this.host.tool));
  }
  enterTablet() {
    if (this.dock) return;
    document.body.classList.add('tablet-mode');
    this.host.setTool('draw');
    let side = 'left';
    try { side = localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : 'left'; } catch { /* Optional. */ }
    const tool = (name, label, glyph) => {
      const b = el('button', { type: 'button', className: 'dock-tool', title: label, 'aria-label': label });
      b.append(icon(glyph));
      b.dataset.dockTool = name;
      b.onclick = () => { this.host.setTool(name); this.markTool(); };
      return b;
    };
    const swatch = (color) => {
      const b = el('button', { type: 'button', className: 'dock-swatch', title: color, style: `--swatch:${color}` });
      b.setAttribute('aria-label', `Colour ${color}`);
      b.onclick = () => { const input = $('color'); input.value = color; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); this.markTool(); };
      return b;
    };
    const width = (value, label) => {
      const b = el('button', { type: 'button', className: 'dock-width', title: label, 'aria-label': label }, el('span', { style: `--w:${Math.min(14, value + 2)}px` }));
      b.dataset.width = value;
      b.onclick = () => { const select = $('width'); select.value = String(value); select.dispatchEvent(new Event('change', { bubbles: true })); this.markTool(); };
      return b;
    };
    const action = (label, glyph, onclick) => { const b = el('button', { type: 'button', className: 'dock-tool', title: label, 'aria-label': label, onclick }); b.append(icon(glyph)); return b; };
    this.swatch = swatch;
    // The pen's colours and widths; tape and text have their own (the tape group, the
    // text's format bar), so these hide for them.
    const ink = el('div', { className: 'dock-ink' },
      el('hr'),
      ...['#202d40', '#246bce', '#d13b30', '#2f9a4c', '#f2c500'].map(swatch),
      el('hr'),
      width(1, 'Fine'), width(2, 'Medium'), width(4, 'Thick'), this.pressureButton());
    this.dot = el('span', { className: 'dock-status', title: 'Connected' });
    this.dock = el('aside', { id: 'tabletDock', className: 'tablet-dock' },
      tool('draw', 'Pen', 'draw'), tool('highlight', 'Highlighter', 'highlight'), tool('shape', 'Shapes', 'shape'), this.shapeGroup(),
      tool('tape', 'Tape', 'tape'), this.tapeGroup(), tool('text', 'Text', 'text'),
      tool('erase', 'Eraser', 'erase'), tool('pan', 'Move the page', 'pan'),
      ink,
      el('hr'),
      action('Undo', 'undo', () => $('undo').click()), action('Redo', 'redo', () => $('redo').click()),
      action('Fit the page width', 'fit', () => this.host.setZoom('fit')),
      action('New page after this one', 'plus', () => this.host.doc?.canvas ? this.host.status('An infinite canvas grows as you draw; it has no pages to add.') : this.host.addPage()),
      el('span', { className: 'dock-spacer' }),
      action('Move this bar to the other side', 'swap', () => this.flipDock()),
      action('Disconnect', 'close', () => this.leave()),
      this.dot);
    this.dock.dataset.side = side;
    document.body.dataset.dock = side;
    document.body.append(this.dock);
    // No zooming into a text box as the keyboard opens (iOS does it for small text): the
    // pages zoom with two fingers and the dock instead.
    const meta = document.querySelector('meta[name=viewport]');
    if (meta && !/maximum-scale/.test(meta.content)) { this.viewportMeta = meta.content; meta.content += ',maximum-scale=1'; }
    this.markTool();
  }
  // Pen pressure on or off, the same setting as in the Pen's options (remembered).
  pressureButton() {
    const b = el('button', { type: 'button', className: 'dock-tool dock-pressure', title: 'Pen pressure changes the width', 'aria-label': 'Pen pressure' });
    b.append(icon('pressure'));
    b.onclick = () => { const select = $('pressure'); select.value = select.value === 'off' ? 'on' : 'off'; select.dispatchEvent(new Event('change', { bubbles: true })); this.markTool(); };
    return b;
  }
  // While Shapes is chosen: its kinds and fill, mirroring the main tool settings.
  shapeGroup() {
    const group = el('div', { className: 'dock-group dock-shapes', hidden: true });
    const mirror = (source, attr) => {
      for (const original of document.querySelectorAll(source)) {
        const b = original.cloneNode(true);
        b.removeAttribute('id');
        b.setAttribute('aria-label', original.title);
        b.dataset.mirror = `${attr}:${original.dataset[attr]}`;
        b.onclick = () => { original.click(); this.markTool(); };
        group.append(b);
      }
    };
    mirror('#shapePicker [data-shape]', 'shape');
    group.append(el('hr'));
    mirror('#shapeFill [data-fill]', 'fill');
    return group;
  }
  // While Tape is chosen: strip or rectangle, its colours and its widths, as in the tool bar.
  tapeGroup() {
    const group = el('div', { className: 'dock-group dock-tape', hidden: true });
    for (const original of document.querySelectorAll('.choice-row[data-for="tapeMode"] [data-value]')) {
      const b = el('button', { type: 'button', title: original.title, 'aria-label': `Tape: ${original.title}` });
      b.innerHTML = original.innerHTML;
      b.dataset.tapeMode = original.dataset.value;
      b.onclick = () => { original.click(); this.markTool(); };
      group.append(b);
    }
    group.append(el('hr'), ...(this.host.palette?.('tape') || []).map(this.swatch), el('hr'), el('div', { className: 'dock-tape-widths' }));
    return group;
  }
  // The tape's widths are the tool bar's (they can be changed there), so they are read again
  // each time: the bar's width row shows the chosen tool's.
  tapeWidths(row) {
    const values = [...document.querySelectorAll('.choice-row[data-for="width"] [data-value]')].map((b) => b.dataset.value);
    if (row.dataset.values === values.join()) return;
    row.dataset.values = values.join();
    row.replaceChildren(...values.map((value) => {
      const b = el('button', { type: 'button', className: 'dock-width', title: `Tape ${value} px`, 'aria-label': `Tape width ${value} px` }, el('span', { style: `--w:${Math.min(14, Math.max(3, Number(value) / 4.5))}px` }));
      b.dataset.width = value;
      b.onclick = () => { document.querySelector(`.choice-row[data-for="width"] [data-value="${value}"]`)?.click(); this.markTool(); };
      return b;
    }));
  }
  markTool() {
    const tool = this.host.tool;
    const group = this.dock?.querySelector('.dock-shapes');
    if (group) {
      group.hidden = tool !== 'shape';
      for (const b of group.querySelectorAll('[data-mirror]')) {
        const [attr, value] = b.dataset.mirror.split(':');
        const original = document.querySelector(attr === 'shape' ? `#shapePicker [data-shape="${value}"]` : `#shapeFill [data-fill="${value}"]`);
        b.setAttribute('aria-pressed', String(original?.getAttribute('aria-checked') === 'true'));
      }
    }
    const tape = this.dock?.querySelector('.dock-tape');
    if (tape) {
      tape.hidden = tool !== 'tape';
      if (tool === 'tape') this.tapeWidths(tape.querySelector('.dock-tape-widths'));
      for (const b of tape.querySelectorAll('[data-tape-mode]')) b.setAttribute('aria-pressed', String(b.dataset.tapeMode === $('tapeMode').value));
    }
    const ink = this.dock?.querySelector('.dock-ink');
    if (ink) ink.hidden = tool === 'tape' || tool === 'text';
    for (const b of this.dock?.querySelectorAll('[data-dock-tool]') || []) b.setAttribute('aria-pressed', String(b.dataset.dockTool === this.host.tool));
    const pressure = this.dock?.querySelector('.dock-pressure');
    if (pressure) pressure.setAttribute('aria-pressed', String($('pressure')?.value !== 'off'));
    for (const b of this.dock?.querySelectorAll('.dock-width') || []) b.setAttribute('aria-pressed', String(b.dataset.width === $('width').value));
    for (const b of this.dock?.querySelectorAll('.dock-swatch') || []) b.setAttribute('aria-pressed', String(b.title.toLowerCase() === $('color').value.toLowerCase()));
  }
  flipDock() {
    const side = this.dock.dataset.side === 'left' ? 'right' : 'left';
    this.dock.dataset.side = document.body.dataset.dock = side;
    try { localStorage.setItem(SIDE_KEY, side); } catch { /* Optional. */ }
  }
  view() {
    const viewport = $('viewport');
    return viewport ? { left: viewport.scrollLeft, top: viewport.scrollTop, page: this.host.page } : null;
  }
  restoreView(view) {
    if (!view || !this.restored) { this.restored = true; return; }
    // A reload (another edit order, reconnect) keeps where this device was looking.
    this.host.jump(Math.min(view.page, (this.host.doc?.pages || 1) - 1));
    requestAnimationFrame(() => { $('viewport').scrollLeft = view.left; $('viewport').scrollTop = view.top; });
  }
  waiting(on) {
    document.body.classList.toggle('tablet-waiting', on);
    if (this.dot) this.dot.title = on ? 'Waiting for the computer’s note' : 'Connected';
  }

  // Share pressed by a guest or a tablet: what this session is, and leaving it.
  showSession() {
    if (this.role === 'host') return this.showShare();
    const leave = el('button', { type: 'button', className: 'danger', textContent: this.role === 'tablet' ? 'Disconnect' : 'Leave', onclick: () => { closeDialog(); this.leave(); } });
    dialog('Shared session',
      el('p', { textContent: this.role === 'tablet' ? 'This device draws on the note open on the computer.' : `You write these notes with ${Math.max(0, this.people.length - 1)} other ${this.people.length === 2 ? 'person' : 'people'}.` }),
      buttons(leave, el('button', { type: 'button', className: 'primary', textContent: 'Done', onclick: closeDialog })));
  }

  // Leaving -----------------------------------------------------------------------------
  leave() {
    this.client.close();
    this.finish(this.role === 'tablet' ? 'Disconnected from the computer.' : 'You left the shared notes.', null);
  }
  finish(message, text, refused = false) {
    if (this.finished) return;
    this.finished = true;
    const host = this.host;
    if (this.role === 'host') window.notecompleteCollab?.stop().catch(() => {});
    for (const key of [...this.live.keys()]) this.dropLive(key);
    // The host writes the final notes where they live (project, notes:<fp>) before letting go.
    if (this.role === 'host') this.notes?.flush();
    this.notes?.unshare();
    this.undo?.destroy();
    if (this.onKey) $('notesEditor').removeEventListener('keydown', this.onKey, true);
    if (this.onSelection) document.removeEventListener('selectionchange', this.onSelection);
    if (this.onScroll) $('notesEditor').removeEventListener('scroll', this.onScroll);
    $('collabPeopleBar')?.remove();
    const share = $('shareButton');
    if (share) { share.classList.remove('active'); share.querySelector('span').textContent = 'Share'; }
    this.dock?.remove();
    if (this.viewportMeta) document.querySelector('meta[name=viewport]').content = this.viewportMeta;
    this.loading(null);
    document.body.classList.remove('tablet-mode', 'tablet-waiting', 'guest-mode', 'guest-readonly', 'guest-session');
    delete document.body.dataset.dock;
    if (this.client.state !== 'closed' && this.client.state !== 'ended') this.client.close();
    // A guest or tablet keeps an automatic save of the shared note (when the host has
    // auto-save on) before it closes, so a lost connection loses nothing.
    const kept = this.role !== 'host' && host.doc ? host.keepCopy?.().catch(() => null) ?? Promise.resolve(null) : Promise.resolve(null);
    host.setCollab(null);
    session = null;
    kept.then((copy) => {
      if (this.role === 'tablet' && host.doc) host.closeDocument();
      if (this.role === 'guest') host.notesApi().then((n) => n.close()).then(() => host.closeDocument()).catch(() => {});
      closeDialog();
      this.ended?.();
      if (refused || this.role === 'host' || (!this.copied && !copy)) return host.status(message, refused);
      const actions = [el('button', { type: 'button', textContent: 'Close', onclick: closeDialog })];
      if (copy) actions.push(el('button', { type: 'button', className: this.copied ? '' : 'primary', textContent: `Open the automatic save (${copy.label})`, onclick: () => { closeDialog(); copy.open(); } }));
      if (this.copied) actions.push(el('button', { type: 'button', className: 'primary', textContent: 'Open my copy of the notes', onclick: () => { closeDialog(); host.openFile?.(new File([this.copied], this.copyName, { type: 'text/markdown' })); } }));
      dialog('Session ended', el('p', { textContent: copy ? `${message} The note as it was is in File → automatic saves.` : message }), buttons(...actions));
    });
  }
}
