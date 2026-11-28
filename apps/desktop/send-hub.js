// Files sent from the browser (the NoteComplete Send extension, github.com/Emefedez/NoteComplete-send):
// the extension talks to a native messaging host (send-host.cjs, installed by the setup wizard's
// Browser extension card, browser-send.js), and the host to this hub, a local socket the main
// process serves (a Unix socket in the app's settings folder, a named pipe on Windows).
//
// Protocol: one JSON object per line each way. Requests carry an `id` the reply repeats:
//   { id, op: 'hello' }                      → { id, ok, app: 'NoteComplete', version }
//   { id, op: 'targets' }                    → { id, ok, open: [...], recent: [...], default }
//   { id, op: 'send', target, files }        → { id, ok, text } once the notebook took them
//   { id, op: 'subscribe' }                  → { id, ok }, then { event: 'targets', ... } on changes
// `target` is a target id from `targets` ('tab:<n>' an open notebook, 'path:<file>' a Recent
// one, opened for it) or 'pick' (NoteComplete asks which). Missing: the default (the notebook
// open in the focused window). `files`: [{ name, type, base64 }].
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

export const HOST_NAME = 'com.notecomplete.send';
export const MAX_FILES = 20;
export const MAX_BYTES = 200 * 1024 * 1024; // all files of one send, decoded
const MAX_LINE = Math.ceil(MAX_BYTES * 4 / 3) + 1024 * 1024;

export function sendSocketPath(userData, platform = process.platform, user = safeUser()) {
  if (platform === 'win32') return `\\\\.\\pipe\\notecomplete-send-${user}`;
  return path.join(userData, 'send.sock');
}
function safeUser() {
  try { return os.userInfo().username.replace(/[^\w.-]/g, '_') || 'user'; } catch { return 'user'; }
}

// Splits a stream into lines and parses each as JSON; a line too long or not JSON is reported
// through onError, and the rest goes on.
export function lineReader(onMessage, onError = () => {}) {
  let buffered = '';
  return (chunk) => {
    buffered += chunk;
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at).trim();
      buffered = buffered.slice(at + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch (e) { onError(e); }
    }
    if (buffered.length > MAX_LINE) { buffered = ''; onError(Error('Message too large')); }
  };
}

// The files of a send request, checked: names kept to their base name, at most MAX_FILES and
// MAX_BYTES in all. Throws with a message for the extension.
export function checkFiles(files) {
  if (!Array.isArray(files) || !files.length) throw Error('No files to send.');
  if (files.length > MAX_FILES) throw Error(`Send at most ${MAX_FILES} files at once.`);
  let total = 0;
  return files.map((f, i) => {
    if (!f || typeof f.base64 !== 'string') throw Error('A file without its contents.');
    const name = path.basename(String(f.name || `file-${i + 1}`)).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || `file-${i + 1}`;
    const bytes = Buffer.from(f.base64, 'base64');
    total += bytes.length;
    if (total > MAX_BYTES) throw Error('These files are too large to send at once (200 MB in all).');
    return { name, type: typeof f.type === 'string' ? f.type.slice(0, 100) : '', bytes };
  });
}

// What the extension lists: open notebooks (each tab's reader reports what it shows) and Recent
// notebooks on this computer not already open. `windowsInOrder`: [{ id, focused, tabs: [{ id,
// active }] }], focused window first. `states`: tab id → { kind, title, path }.
export function listTargets({ windowsInOrder, states, recent }) {
  const open = [];
  let first = null, activeAnywhere = null, chosen = null;
  for (const w of windowsInOrder) {
    for (const t of w.tabs) {
      const s = states.get(t.id);
      if (s?.kind !== 'note') continue;
      const target = { id: `tab:${t.id}`, title: s.title || 'Untitled', path: s.path || '' };
      open.push(target);
      first ||= target.id;
      if (t.active) { activeAnywhere ||= target.id; if (w.focused) chosen ||= target.id; }
    }
  }
  const openPaths = new Set(open.map((t) => t.path).filter(Boolean));
  const seen = new Set();
  const others = (recent || []).filter((r) => r?.path && !openPaths.has(r.path) && !seen.has(r.path) && seen.add(r.path))
    .slice(0, 15).map((r) => ({ id: `path:${r.path}`, title: r.title || path.basename(r.path), path: r.path }));
  return { open, recent: others, default: chosen || activeAnywhere || first };
}

// The socket server. `targets()` → the list above; `deliver({ target, files })` → Promise of
// { ok, text }. `changed()` tells subscribers the list changed.
export function sendHub({ socketPath, targets, deliver, version = '', log = () => {} }) {
  const subscribers = new Set();
  let server = null;
  const write = (socket, message) => { if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n'); };
  async function handle(socket, request) {
    const id = request?.id ?? null;
    try {
      switch (request?.op) {
        case 'hello': return write(socket, { id, ok: true, app: 'NoteComplete', version });
        case 'targets': return write(socket, { id, ok: true, ...targets() });
        case 'subscribe':
          subscribers.add(socket);
          write(socket, { id, ok: true });
          return write(socket, { event: 'targets', ...targets() });
        case 'send': {
          const files = checkFiles(request.files);
          const target = typeof request.target === 'string' && request.target ? request.target : null;
          log(`send: ${files.length} file(s) to ${target || 'default'}`);
          const result = await deliver({ target, files });
          return write(socket, { id, ...result });
        }
        default: throw Error(`Unknown request: ${request?.op}`);
      }
    } catch (e) {
      write(socket, { id, ok: false, error: e?.message || String(e) });
    }
  }
  async function start() {
    if (process.platform !== 'win32') await rm(socketPath, { force: true }).catch(() => {});
    server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', lineReader((m) => handle(socket, m), (e) => write(socket, { id: null, ok: false, error: e.message })));
      socket.on('close', () => subscribers.delete(socket));
      socket.on('error', () => subscribers.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolve(); });
    });
    return socketPath;
  }
  let pendingChange = 0;
  return {
    start,
    changed() {
      clearTimeout(pendingChange);
      pendingChange = setTimeout(() => { const list = targets(); for (const s of subscribers) write(s, { event: 'targets', ...list }); }, 150);
    },
    async stop() {
      for (const s of subscribers) s.destroy();
      subscribers.clear();
      await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
      if (process.platform !== 'win32') await rm(socketPath, { force: true }).catch(() => {});
    },
  };
}
