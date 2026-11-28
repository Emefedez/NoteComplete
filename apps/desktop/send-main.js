// The main process's side of NoteComplete Send (send-hub.js): what each tab shows (its reader
// reports it), the Recent notebooks, and handing sent files to the right tab:
//   'tab:<id>'   that tab, brought to the front;
//   'path:<file>' the tab that has the file open, or a new tab that opens it first (its reader
//                collects the files with send:take once the file is open);
//   'pick'       the front tab's reader asks which notebook (send:pick), then routes them.
// Each delivery waits for the reader's send:done (what it did with the files) to answer the
// extension.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { listTargets, sendHub, sendSocketPath } from './send-hub.js';
import { browserSend } from './browser-send.js';

const DELIVERY_MS = 120_000;

export function sendMain({ app, ipcMain, guarded, shell, windows, views, tabs, activate, openTab, createWindow }) {
  const userData = app.getPath('userData');
  const socketPath = sendSocketPath(userData);
  const targetsFile = path.join(userData, 'send-targets.json');
  const states = new Map(); // tab id → { kind, title, path }
  let recent = [];
  let lastFocused = null; // window id: when the browser has the focus, no app window is focused
  const pending = new Map(); // token → { files, resolve, timer }
  const queued = new Map(); // tab id → [token] waiting for the tab's file to open

  const launch = process.env.APPIMAGE ? [process.env.APPIMAGE] : app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  const installer = browserSend({
    userData, socketPath, targetsFile, launch,
    exe: process.env.APPIMAGE || process.execPath,
    hostSource: fileURLToPath(new URL('./send-host.cjs', import.meta.url)),
  });

  function windowsInOrder() {
    const list = [...windows.values()].filter((w) => !w.isDestroyed());
    list.sort((a, b) => (b.id === lastFocused) - (a.id === lastFocused));
    return list.map((w) => ({ id: w.id, focused: w.id === lastFocused, tabs: tabs.list(w.id) }));
  }
  const targets = () => ({ ...listTargets({ windowsInOrder: windowsInOrder(), states, recent }), running: true });
  const frontWindow = () => windows.get(lastFocused) || [...windows.values()].at(-1) || null;
  function bringToFront(win, id) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (id != null) activate(win, id);
  }
  const payload = (token, extra = {}) => ({ token, files: pending.get(token).files.map((f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(f.bytes) })), ...extra });

  function sendToTab(id, token, extra) {
    const view = views.get(id), win = windows.get(tabs.windowOf(id));
    if (!view || !win) throw Error('That notebook is no longer open.');
    bringToFront(win, id);
    view.webContents.send('send:files', payload(token, { ...extra, here: `tab:${id}` }));
  }
  // Routes the files of `token` to `target`; throws when it cannot.
  function route(token, target) {
    if (!target) target = targets().default || 'pick';
    if (target.startsWith('tab:')) return sendToTab(Number(target.slice(4)), token);
    if (target.startsWith('path:')) {
      const file = target.slice(5);
      for (const [id, s] of states) if (s.path === file && views.has(id)) return sendToTab(id, token);
      if (!recent.some((r) => r.path === file)) throw Error('That notebook is not in Recent any more.');
      const win = frontWindow() || createWindow({ tab: false });
      openTab(win, file);
      const id = tabs.list(win.id).at(-1)?.id;
      queued.set(id, [...(queued.get(id) || []), token]);
      return bringToFront(win, id);
    }
    if (target === 'pick') {
      let win = frontWindow();
      if (!win) {
        win = createWindow({ tab: true });
        const id = tabs.list(win.id).at(-1)?.id;
        queued.set(id, [...(queued.get(id) || []), token]);
        pending.get(token).pick = true;
        return bringToFront(win);
      }
      return sendToTab(tabs.active(win.id), token, { pick: true });
    }
    throw Error('Unknown notebook.');
  }
  function deliver({ target, files }) {
    const token = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(token, { ok: false, error: 'NoteComplete did not take the files in time.' }), DELIVERY_MS);
      pending.set(token, { files, resolve, timer });
      try { route(token, target); } catch (e) { finish(token, { ok: false, error: e.message }); }
    });
  }
  function finish(token, result) {
    const p = pending.get(token);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(token);
    p.resolve(result?.ok ? { ok: true, text: String(result.text || 'Sent.') } : { ok: false, error: String(result?.error || 'Not sent.') });
  }

  const hub = sendHub({ socketPath, targets, deliver, version: app.getVersion() });
  const keepRecent = () => writeFile(targetsFile, JSON.stringify({ recent: listTargets({ windowsInOrder: [], states, recent }).recent })).catch(() => {});

  ipcMain.handle('send:state', guarded((event, state) => {
    const ok = state && typeof state === 'object';
    states.set(event.sender.id, ok ? { kind: state.kind === 'note' ? 'note' : null, title: String(state.title || '').slice(0, 200), path: typeof state.path === 'string' ? state.path : '' } : { kind: null });
    hub.changed();
  }));
  ipcMain.handle('send:recent', guarded((_event, list) => {
    if (!Array.isArray(list)) return;
    recent = list.filter((r) => r && typeof r.path === 'string' && path.isAbsolute(r.path)).slice(0, 30).map((r) => ({ path: r.path, title: String(r.title || '').slice(0, 200) }));
    hub.changed();
    keepRecent();
  }));
  // The files queued for this tab (sent to a notebook it was opened for, or to pick in it).
  ipcMain.handle('send:take', guarded((event) => {
    const tokens = queued.get(event.sender.id) || [];
    queued.delete(event.sender.id);
    return tokens.filter((t) => pending.has(t)).map((t) => payload(t, { pick: !!pending.get(t).pick, here: `tab:${event.sender.id}` }));
  }));
  ipcMain.handle('send:targets', guarded(() => targets()));
  ipcMain.handle('send:route', guarded((_event, token, target) => {
    if (!pending.has(token)) throw Error('Those files were already handled.');
    try { route(token, String(target || '')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }));
  ipcMain.handle('send:done', guarded((_event, token, result) => finish(token, result)));
  ipcMain.handle('browserSend:status', guarded(() => installer.status()));
  ipcMain.handle('browserSend:install', guarded(async (event) => {
    const result = await installer.install((p) => { if (!event.sender.isDestroyed()) event.sender.send('browserSend:progress', p); });
    return result;
  }));
  ipcMain.handle('browserSend:uninstall', guarded(() => installer.uninstall()));
  ipcMain.handle('browserSend:openFolder', guarded(async () => { const error = await shell.openPath(installer.extensionDir); return { ok: !error, error }; }));
  ipcMain.handle('browserSend:openBrowserPage', guarded(async () => {
    // chrome://extensions cannot be opened from outside the browser; the wizard tells the person.
    return { ok: true, url: 'chrome://extensions' };
  }));

  return {
    async start() {
      try { await hub.start(); } catch (e) { console.warn('NoteComplete Send socket:', e.message); return; }
      // The helper keeps the path of the executable: after an update moved it, write it again.
      installer.status().then((s) => { if (s.browsers.length) installer.refreshHost().catch(() => {}); }).catch(() => {});
    },
    stop: () => hub.stop(),
    focused(windowId) { lastFocused = windowId; hub.changed(); },
    tabGone(id) {
      states.delete(id);
      for (const token of queued.get(id) || []) finish(token, { ok: false, error: 'The notebook closed before it took the files.' });
      queued.delete(id);
      hub.changed();
    },
  };
}
