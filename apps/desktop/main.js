import { app, BaseWindow, WebContentsView, dialog, net, protocol, session, ipcMain, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopCredentials, desktopSignIn } from './google-auth.js';
import { assetPath } from './asset-path.js';
import { libraryFiles } from './library-files.js';
import { aiRunner } from './ai-runner.js';
import { transcriber } from './transcriber.js';
import { existsSync } from 'node:fs';
import { tabStore } from './tabs.js';

const home = 'notecomplete://reader/';
const root = fileURLToPath(new URL('./reader/', import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'notecomplete', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
// Windows hold tabs: one reader view per tab, only the active one shown. The
// readers draw the tab strip in their own top bar from the list sent here.
const tabs = tabStore();
const views = new Map(), windows = new Map();
const webPreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)) };
const windowOf = contents => windows.get(tabs.windowOf(contents.id)) ?? null;
function layout(win) {
  const { width, height } = win.getContentBounds();
  for (const tab of tabs.list(win.id)) views.get(tab.id)?.setBounds({ x: 0, y: 0, width, height });
}
function broadcast(win) {
  const list = tabs.list(win.id);
  for (const tab of list) {
    const contents = views.get(tab.id)?.webContents;
    if (contents && !contents.isDestroyed()) contents.send('tabs:list', list.map(t => ({ ...t, current: t.id === tab.id })));
  }
  const active = list.find(t => t.active);
  if (active) win.setTitle(`${active.title} — NoteComplete`);
}
function activate(win, id) {
  if (!tabs.activate(id)) return;
  for (const tab of tabs.list(win.id)) views.get(tab.id)?.setVisible(tab.id === id);
  views.get(id)?.webContents.focus();
  broadcast(win);
}
function openTab(win) {
  const view = new WebContentsView({ webPreferences });
  const contents = view.webContents, id = contents.id;
  views.set(id, view);
  tabs.add(win.id, id);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!url.startsWith(home)) event.preventDefault(); });
  // Tab keys work in every tab; Ctrl+W must close the tab, not the window.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const key = input.key.toLowerCase();
    const step = key === 'tab' ? (input.shift ? -1 : 1) : key === 'pagedown' ? 1 : key === 'pageup' ? -1 : 0;
    if (key === 't' && !input.shift) openTab(win);
    else if (key === 'w' && !input.shift) requestClose(id);
    else if (step) activate(win, tabs.neighbour(win.id, step));
    else return;
    event.preventDefault();
  });
  contents.on('destroyed', () => views.delete(id));
  win.contentView.addChildView(view);
  layout(win);
  activate(win, id);
  contents.loadURL(home).catch(error => dialog.showErrorBox('Could not open NoteComplete', error.message));
  return id;
}
// Closing asks the reader first (it confirms unsaved changes itself).
function requestClose(id) {
  const win = windows.get(tabs.windowOf(id)), contents = views.get(id)?.webContents;
  if (!win || !contents) return;
  activate(win, id);
  contents.send('tabs:close-request');
}
function closeTab(id) {
  const view = views.get(id), result = tabs.remove(id);
  if (!view || !result) return;
  const win = windows.get(result.window);
  win?.contentView.removeChildView(view);
  view.webContents.close();
  views.delete(id);
  if (!win) return;
  if (!result.left) {
    win.closing = true;
    win.close();
  } else activate(win, result.active);
}
function createWindow() {
  const win = new BaseWindow({ width: 1280, height: 900, minWidth: 360, minHeight: 480,
    // The reader draws its own File/Edit/View menubar; Alt still reveals the native one and its accelerators keep working.
    title: 'NoteComplete', autoHideMenuBar: true });
  windows.set(win.id, win);
  win.on('resize', () => layout(win));
  win.on('close', event => {
    const unsaved = tabs.list(win.id).filter(t => t.dirty);
    if (win.closing || !unsaved.length) return;
    const answer = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Cancel', 'Close without saving'], defaultId: 0, cancelId: 0,
      message: unsaved.length === 1 ? `“${unsaved[0].title}” has unsaved changes.` : `${unsaved.length} tabs have unsaved changes.`,
      detail: 'Closing the window discards them.' });
    if (answer === 1) win.closing = true;
    else event.preventDefault();
  });
  win.on('closed', () => {
    for (const tab of tabs.list(win.id)) {
      tabs.remove(tab.id);
      const contents = views.get(tab.id)?.webContents;
      if (contents && !contents.isDestroyed()) contents.close();
      views.delete(tab.id);
    }
    windows.delete(win.id);
  });
  openTab(win);
  return win;
}
const focusedWindow = () => BaseWindow.getFocusedWindow() ?? [...windows.values()].at(-1);
// One process per profile: a second launch would find IndexedDB and Local Storage
// locked (Recent, decks and settings would come up empty), so it opens a window here.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
// A second launch opens a tab in the window in front.
app.on('second-instance', () => {
  if (!app.isReady()) return;
  const win = focusedWindow();
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
  openTab(win);
});
app.whenReady().then(() => {
  if (!primary) return;
  // Only one web permission: writing text to the clipboard (Grab → Copy text), from the reader itself.
  const allowed = (permission, url = '') => permission === 'clipboard-sanitized-write' && String(url).startsWith(home);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed(permission, details?.requestingUrl || contents?.getURL?.())));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => allowed(permission, origin?.endsWith('/') ? origin : `${origin}/`));
  protocol.handle('notecomplete', async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 405 });
    try {
      const response = await net.fetch(pathToFileURL(assetPath(root, request.url)).href);
      // Cross-origin isolation lets the speech engine use multiple WASM threads.
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      // File responses must never be cached: reloads pick up rebuilt assets.
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    catch { return new Response('Not found', { status: 404 }); }
  });
  const pendingAuth = new Map();
  const trusted = event => event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith(home);
  // Downloads folder and Recent for the reader; see library-files.js for the limits.
  const files = libraryFiles({ settingsFile: path.join(app.getPath('userData'), 'library.json'), defaultFolder: path.join(app.getPath('documents'), 'NoteComplete') });
  const guarded = handler => async (event, ...args) => {
    if (!trusted(event)) throw Error('Unexpected reader origin.');
    return handler(event, ...args);
  };
  ipcMain.handle('files:folder', guarded(() => files.folder()));
  ipcMain.handle('files:choose', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Keep downloaded notes in…', defaultPath: await files.folder(), properties: ['openDirectory', 'createDirectory'] });
    return chosen.canceled ? null : files.setFolder(chosen.filePaths[0]);
  }));
  ipcMain.handle('files:read', guarded((_event, name) => files.read(name)));
  ipcMain.handle('files:write', guarded((_event, name, bytes) => files.write(name, bytes)));
  ipcMain.handle('files:remove', guarded((_event, name) => files.remove(name)));
  ipcMain.handle('files:open', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Open a note', properties: ['openFile'], filters: [{ name: 'Notes, PDFs and images', extensions: ['noteful', 'notecomplete', 'notecomp', 'nfedit', 'pdf', 'png', 'jpg', 'jpeg', 'webp'] }] });
    if (chosen.canceled) return null;
    const file = chosen.filePaths[0];
    await files.remember(file);
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await readFile(file)) };
  }));
  ipcMain.handle('files:read-recent', guarded((_event, file) => files.readRecent(file)));
  // Flashcards, quizzes and chat through the user's own AI CLIs; see ai-runner.js.
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'noteful') : fileURLToPath(new URL('../../target/release/noteful', import.meta.url));
  const ai = aiRunner({ mcpBinary: existsSync(bundled) ? bundled : null });
  ipcMain.handle('ai:providers', guarded(() => ai.providers()));
  ipcMain.handle('ai:models', guarded((_event, provider) => ai.models(String(provider))));
  // A request with a stream id gets its answer's pieces as 'ai:delta' messages.
  ipcMain.handle('ai:run', guarded((event, request) => {
    const id = typeof request?.stream === 'string' && /^[\w-]{1,40}$/.test(request.stream) ? request.stream : null;
    const { stream: _stream, ...rest } = request || {};
    return ai.run(event.sender.id, rest, id ? text => { if (!event.sender.isDestroyed()) event.sender.send('ai:delta', id, text); } : null);
  }));
  ipcMain.on('ai:cancel', (event, tag) => { if (trusted(event)) ai.cancel(event.sender.id, typeof tag === 'string' ? tag : ''); });
  // Other transcription backends; pieces stream back to the reader as they finish.
  const asr = transcriber({ tools: () => ai.tools() });
  ipcMain.handle('asr:backends', guarded(() => asr.backends()));
  ipcMain.handle('asr:run', guarded((event, request) => asr.run(event.sender.id, request, (done, total, segments, skipped) => {
    if (!event.sender.isDestroyed()) event.sender.send('asr:progress', { done, total, segments, skipped });
  })));
  ipcMain.on('asr:cancel', event => { if (trusted(event)) asr.cancel(event.sender.id); });
  // Several documents: tabs in a window, and windows; the command palette lists every tab.
  ipcMain.handle('windows:new', guarded(() => { createWindow(); }));
  ipcMain.handle('windows:list', guarded(event => tabs.all().map(t => ({ id: t.id, title: t.title, current: t.id === event.sender.id }))));
  ipcMain.handle('windows:focus', guarded((_event, id) => {
    const win = windows.get(tabs.windowOf(id));
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    activate(win, id);
    return true;
  }));
  ipcMain.handle('tabs:list', guarded(event => tabs.list(tabs.windowOf(event.sender.id)).map(t => ({ ...t, current: t.id === event.sender.id }))));
  ipcMain.handle('tabs:new', guarded(event => { const win = windowOf(event.sender); if (win) openTab(win); }));
  ipcMain.handle('tabs:activate', guarded((event, id) => { const win = windowOf(event.sender); if (win && tabs.windowOf(id) === win.id) activate(win, id); }));
  ipcMain.handle('tabs:close', guarded((event, id) => { if (tabs.windowOf(id) === tabs.windowOf(event.sender.id)) requestClose(id); }));
  ipcMain.handle('tabs:close-self', guarded(event => closeTab(event.sender.id)));
  ipcMain.handle('tabs:move', guarded((event, id, index) => {
    const win = windowOf(event.sender);
    if (win && tabs.windowOf(id) === win.id && tabs.move(id, index)) broadcast(win);
  }));
  ipcMain.handle('tabs:update', guarded((event, state = {}) => {
    const win = windowOf(event.sender);
    if (win && tabs.update(event.sender.id, { title: state.title, dirty: state.dirty })) broadcast(win);
  }));
  ipcMain.on('drive:cancel', event => { if (trusted(event)) pendingAuth.get(event.sender.id)?.abort(); });
  ipcMain.handle('drive:sign-in', async (event, options = {}) => {
    if (!trusted(event)) throw Error('Unexpected authentication origin.');
    if (pendingAuth.has(event.sender.id)) throw Error('Finish the current Google sign-in first.');
    const abort = new AbortController(), sender = event.sender;
    pendingAuth.set(sender.id, abort);
    const cancelled = () => abort.abort();
    sender.once('destroyed', cancelled);
    try {
      const saved = path.join(app.getPath('userData'), 'google-desktop-client.json');
      let config;
      for (const filename of [fileURLToPath(new URL('./google-desktop-client.json', import.meta.url)), saved]) {
        try { config = desktopCredentials(JSON.parse(await readFile(filename, 'utf8'))); break; } catch { /* Try the configured fallback. */ }
      }
      if (!config) {
        const chosen = await dialog.showOpenDialog(windowOf(sender), { title: 'Choose Google Desktop OAuth client JSON', filters: [{ name: 'Google OAuth client', extensions: ['json'] }], properties: ['openFile'] });
        if (chosen.canceled) throw Error('Google sign-in cancelled.');
        const value = JSON.parse(await readFile(chosen.filePaths[0], 'utf8'));
        config = desktopCredentials(value);
        await writeFile(saved, JSON.stringify({ installed: { client_id: config.clientId, client_secret: config.clientSecret } }), { mode: 0o600 });
      }
      return await desktopSignIn({ credentials: config, signal: abort.signal, openExternal: url => shell.openExternal(url), write: options?.write === true });
    } finally { pendingAuth.delete(sender.id); sender.removeListener('destroyed', cancelled); }
  });
  createWindow();
  app.on('activate', () => { if (!windows.size) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
