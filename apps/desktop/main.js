import { app, BaseWindow, Menu, WebContentsView, dialog, nativeTheme, net, protocol, session, ipcMain, shell } from 'electron';
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
import { updater } from './updater.js';
import { menuTemplate } from './app-menu.js';

const home = 'notecomplete://reader/';
const root = fileURLToPath(new URL('./reader/', import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'notecomplete', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
// Windows hold tabs: one reader view per tab, only the active one shown. The
// readers draw the tab strip in their own top bar from the list sent here.
const tabs = tabStore();
const views = new Map(), windows = new Map();
// No spell checker: notes are written in many languages and the red underlines get in the way.
// The open dialogs' filter; "All files" also offers names without an extension.
const OPENABLE = ['noteful', 'notepart', 'notecomplete', 'notecomp', 'nfedit', 'html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'sh', 'py', 'c', 'h', 'cpp', 'hpp', 'java', 'js', 'ts', 'rs', 'go', 'sql', 'tex', 'r', 'm', 'asm', 's', 'lua', 'vhd', 'vhdl', 'v'];
const webPreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false, webviewTag: true, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)) };
// Web links (reader web-view.js) open in <webview>s: web pages only, sandboxed, no preload,
// in their own session so sign-ins stay apart from the reader's storage.
const WEB_SESSION = 'persist:notecomplete-web';
const isWeb = url => /^https?:\/\//i.test(String(url || ''));
const windowOf = contents => windows.get(tabs.windowOf(contents.id)) ?? null;
// The reader's own chrome colour, painted before a tab has drawn anything so
// new tabs and windows never flash white.
const backdrop = () => nativeTheme.shouldUseDarkColors ? '#202328' : '#f7f8fa';
// Interface size (the whole UI, like a browser's zoom), the same in every tab and
// window and remembered: Ctrl+Shift+− / + / 0 or View → Interface size. Ctrl+− / + / 0
// without Shift stay the document's zoom.
const UI_SIZES = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
let uiZoom = 1;
const uiFile = () => path.join(app.getPath('userData'), 'interface.json');
function setUiZoom(step) {
  const at = UI_SIZES.findIndex(z => z >= uiZoom - 0.001);
  uiZoom = step === 0 ? 1 : UI_SIZES[Math.max(0, Math.min(UI_SIZES.length - 1, (at < 0 ? 4 : at) + step))];
  for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.setZoomFactor(uiZoom);
  writeFile(uiFile(), JSON.stringify({ zoom: uiZoom })).catch(() => {});
  return uiZoom;
}
// Which interface-size step a key press asks for (Shift held), on US and Spanish layouts.
export function uiZoomStep(input) {
  if (!(input.control || input.meta) || !input.shift || input.alt) return null;
  if (input.key === '_' || input.code === 'NumpadSubtract') return -1;
  if (input.key === '+' || input.key === '*' || input.code === 'NumpadAdd') return 1;
  if (input.code === 'Digit0' || input.code === 'Numpad0') return 0;
  return null;
}
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
  view.setBackgroundColor(backdrop());
  const contents = view.webContents, id = contents.id;
  views.set(id, view);
  tabs.add(win.id, id);
  contents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event, prefs, params) => {
    if (!isWeb(params.src)) return event.preventDefault();
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true });
    params.partition = WEB_SESSION;
  });
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(home)) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  // Tab keys work in every tab; Ctrl+W must close the tab, not the window.
  // The tab's window is looked up each time: a tab can move to another window.
  contents.on('did-finish-load', () => contents.setZoomFactor(uiZoom));
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const size = uiZoomStep(input);
    if (size !== null) { setUiZoom(size); event.preventDefault(); return; }
    const key = input.key.toLowerCase(), here = windowOf(contents);
    const step = key === 'tab' ? (input.shift ? -1 : 1) : key === 'pagedown' ? 1 : key === 'pageup' ? -1 : 0;
    if (!here) return;
    if (key === 't' && !input.shift) openTab(here);
    else if (key === 'w' && !input.shift) requestClose(id);
    else if (step) activate(here, tabs.neighbour(here.id, step));
    else return;
    event.preventDefault();
  });
  contents.on('destroyed', () => views.delete(id));
  // The new tab is shown once it has drawn its page (or after a moment), so
  // switching never shows an empty frame; the old tab stays up until then.
  view.setVisible(false);
  win.contentView.addChildView(view);
  layout(win);
  let shown = false;
  const show = () => { const here = windowOf(contents); if (shown || !here) return; shown = true; activate(here, id); };
  contents.once('dom-ready', () => setTimeout(show, 30));
  setTimeout(show, 700);
  contents.loadURL(home).catch(error => dialog.showErrorBox('Could not open NoteComplete', error.message));
  return id;
}
// A tab dragged out of its strip moves to a new window, still loaded.
function detachTab(id) {
  const from = windows.get(tabs.windowOf(id)), view = views.get(id);
  if (!from || !view || tabs.list(from.id).length < 2) return false;
  const win = createWindow({ tab: false });
  from.contentView.removeChildView(view);
  const result = tabs.transfer(id, win.id);
  win.contentView.addChildView(view);
  layout(win);
  activate(win, id);
  activate(from, result.active);
  return true;
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
function createWindow({ tab = true } = {}) {
  const win = new BaseWindow({ width: 1280, height: 900, minWidth: 360, minHeight: 480, backgroundColor: backdrop(),
    // The reader draws its own File/Edit/View menubar; Alt still reveals the native one and its accelerators keep working.
    title: 'NoteComplete', autoHideMenuBar: true });
  // The id is read once: in 'closed' the window is already destroyed and win.id throws.
  const id = win.id;
  windows.set(id, win);
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
    for (const tab of tabs.list(id)) {
      tabs.remove(tab.id);
      const contents = views.get(tab.id)?.webContents;
      if (contents && !contents.isDestroyed()) contents.close();
      views.delete(tab.id);
    }
    windows.delete(id);
  });
  if (tab) openTab(win);
  return win;
}
// One process per profile: a second launch would find IndexedDB and Local Storage
// locked (Recent, decks and settings would come up empty), so it opens a window here.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
// Launching the app again (menu, dock, terminal) opens a new window; Ctrl+T
// and + make tabs from inside a window.
app.on('second-instance', () => {
  if (app.isReady()) createWindow();
});
app.whenReady().then(async () => {
  if (!primary) return;
  try { const z = Number(JSON.parse(await readFile(uiFile(), 'utf8')).zoom); if (UI_SIZES.includes(z)) uiZoom = z; } catch { /* First run. */ }
  // Two web permissions, for the reader itself only: writing text to the clipboard (Grab → Copy text)
  // and the microphone (Record in the audio panel); never the camera.
  const allowed = (permission, url = '', media = []) => String(url).startsWith(home)
    && (permission === 'clipboard-sanitized-write' || (permission === 'media' && media.length > 0 && media.every(type => type === 'audio')));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed(permission, details?.requestingUrl || contents?.getURL?.(), details?.mediaTypes || [])));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin, details) => allowed(permission, origin?.endsWith('/') ? origin : `${origin}/`, details?.mediaType ? [details.mediaType] : []));
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
  // Web pages may sign in (pop-ups in their own sandboxed windows) and copy text; nothing else.
  const web = session.fromPartition(WEB_SESSION);
  web.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen'));
  web.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
  app.on('web-contents-created', (_event, guest) => {
    if (guest.session !== web) return;
    guest.setWindowOpenHandler(({ url }) => isWeb(url)
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: backdrop(), webPreferences: { partition: WEB_SESSION, sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      : { action: 'deny' });
    guest.on('will-navigate', (event, url) => { if (!isWeb(url)) event.preventDefault(); });
  });
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
  const files = libraryFiles({ settingsFile: path.join(app.getPath('userData'), 'library.json'), defaultFolder: path.join(app.getPath('documents'), 'NoteComplete'), trash: (file) => shell.trashItem(file) });
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
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Open a note', properties: ['openFile'], filters: [{ name: 'Notes, HTML pages, text, PDFs and images', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }] });
    if (chosen.canceled) return null;
    const file = chosen.filePaths[0];
    await files.remember(file);
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await readFile(file)) };
  }));
  ipcMain.handle('files:read-recent', guarded((_event, file) => files.readRecent(file)));
  // Groups: a whole folder, or several files added to the open document.
  ipcMain.handle('files:open-folder', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Open a folder of notes', properties: ['openDirectory'] });
    if (chosen.canceled) return null;
    const folder = chosen.filePaths[0];
    await files.rememberFolder(folder);
    return { folder, name: path.basename(folder), files: await files.listFolder(folder) };
  }));
  ipcMain.handle('files:list-folder', guarded((_event, folder) => files.listFolder(folder)));
  ipcMain.handle('files:write-opened', guarded((_event, file, bytes) => files.writeOpened(file, bytes)));
  ipcMain.handle('files:rename-opened', guarded((_event, file, name) => files.renameOpened(file, name)));
  ipcMain.handle('files:trash-opened', guarded((_event, file) => files.trashOpened(file)));
  ipcMain.handle('files:pick', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Add documents', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Notes, HTML pages, text, PDFs and images', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }] });
    if (chosen.canceled) return [];
    for (const file of [...chosen.filePaths].reverse()) await files.remember(file);
    return chosen.filePaths.map(file => ({ path: file, name: path.basename(file) }));
  }));
  // Flashcards, quizzes and chat through the user's own AI CLIs; see ai-runner.js.
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'noteful') : fileURLToPath(new URL('../../target/release/noteful', import.meta.url));
  const ai = aiRunner({ mcpBinary: existsSync(bundled) ? bundled : null });
  ipcMain.handle('ai:providers', guarded(() => ai.providers()));
  ipcMain.handle('ai:models', guarded((_event, provider, options) => ai.models(String(provider), { fresh: options?.fresh === true })));
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
  // Version checks (updater.js): once per session on open, or from Help; installing always
  // waits for the user's go-ahead in the reader.
  const updates = updater({ app, stateFile: path.join(app.getPath('userData'), 'updates.json') });
  let opening = null;
  ipcMain.handle('update:check', guarded((_event, manual) => {
    if (manual) return updates.check({ manual: true });
    return (opening ||= updates.check().catch(error => ({ current: app.getVersion(), error: error.message })));
  }));
  ipcMain.handle('update:install', guarded(event => updates.install(p => { if (!event.sender.isDestroyed()) event.sender.send('update:progress', p); })));
  ipcMain.handle('update:skip', guarded((_event, version) => updates.skip(String(version))));
  ipcMain.handle('update:settings', guarded(() => updates.settings()));
  ipcMain.handle('update:check-on-open', guarded((_event, on) => updates.setCheckOnOpen(on)));
  // Only this project's release pages open (releases here are pre-releases, which /latest skips).
  ipcMain.handle('update:page', guarded((_event, url) => shell.openExternal(/^https:\/\/github\.com\/Emefedez\/NoteComplete\/releases\/[\w./-]+$/.test(String(url)) ? String(url) : 'https://github.com/Emefedez/NoteComplete/releases')));
  ipcMain.handle('update:restart', guarded(() => updates.restart()));
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
  ipcMain.handle('ui:zoom', guarded((_event, step) => setUiZoom([-1, 0, 1].includes(step) ? step : 0)));
  ipcMain.handle('tabs:detach', guarded((event, id) => tabs.windowOf(id) === tabs.windowOf(event.sender.id) && detachTab(id)));
  // Keep the backdrop in step with the system theme.
  nativeTheme.on('updated', () => {
    for (const win of windows.values()) win.setBackgroundColor(backdrop());
    for (const view of views.values()) view.setBackgroundColor(backdrop());
  });
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
