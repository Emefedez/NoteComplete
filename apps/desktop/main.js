import { app, BaseWindow, Menu, WebContentsView, dialog, nativeTheme, net, protocol, session, ipcMain, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopCredentials, desktopSignIn } from './google-auth.js';
import { assetPath } from './asset-path.js';
import { libraryFiles } from './library-files.js';
import { launchFiles, openablePath } from './open-with.js';
import { aiRunner } from './ai-runner.js';
import { agentSetup, stableBinary } from './agent-setup.js';
import { transcriber } from './transcriber.js';
import { existsSync } from 'node:fs';
import { tabStore } from './tabs.js';
import { updater } from './updater.js';
import { menuTemplate } from './app-menu.js';
// Loaded with the first sharing session only (docs/COLLABORATION.md).
const collabServer = () => import('./collab-server.js');

const home = 'notecomplete://reader/';
const root = fileURLToPath(new URL('./reader/', import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'notecomplete', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
// Windows hold tabs: one reader view per tab, only the active one shown. The
// readers draw the tab strip in their own top bar from the list sent here.
const tabs = tabStore();
// Google Drive access tokens, shared by all tabs (see drive:session below).
const driveSession = { read: null, write: null };
function currentDriveSession() {
  const out = {};
  for (const kind of ['read', 'write']) {
    const t = driveSession[kind];
    if (t && t.expires - Date.now() > 10000) out[kind] = { access_token: t.access_token, scope: t.scope, expires_in: Math.floor((t.expires - Date.now()) / 1000) };
  }
  return out;
}
function sendDriveSession() {
  const session = currentDriveSession();
  for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.send('drive:session', session);
}
function shareDriveSession(kind, token) {
  driveSession[kind] = { access_token: token.access_token, scope: token.scope, expires: Date.now() + Number(token.expires_in || 0) * 1000 };
  sendDriveSession();
}
const views = new Map(), windows = new Map();
// Called when a tab's page is gone, so work started for it stops (set once the AI runners exist).
let tabGone = () => {};
// Files the system asked to open ("Open with…", double-click, the dock): each gets a tab of
// its own, whose reader collects it once ready (files:launched). Launch arguments and macOS
// open-file events that come before the app is ready wait in launchQueue.
const launchPending = new Map();
const launchQueue = launchFiles(process.argv, { packaged: app.isPackaged });
let started = false;
// No spell checker: notes are written in many languages and the red underlines get in the way.
// The open dialogs' filter; "All files" also offers names without an extension.
const OPENABLE = ['noteful', 'notepart', 'notecomplete', 'notecomp', 'nfedit', 'html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'odt', 'xlsx', 'ods', 'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'sh', 'py', 'c', 'h', 'cpp', 'hpp', 'java', 'js', 'ts', 'rs', 'go', 'sql', 'tex', 'r', 'm', 'asm', 's', 'lua', 'vhd', 'vhdl', 'v'];
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
function openTab(win, file = null) {
  const view = new WebContentsView({ webPreferences });
  view.setBackgroundColor(backdrop());
  const contents = view.webContents, id = contents.id;
  views.set(id, view);
  if (file) launchPending.set(id, file);
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
  contents.on('destroyed', () => {
    views.delete(id);
    launchPending.delete(id);
    tabGone(id);
    if (sharing?.owner === id) { sharing.server.stop(); sharing = null; }
  });
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
// The sharing session (notes with guests, drawing tablets): one at a time, owned by the
// tab that started it. Closing that tab's window asks first (Minimize / End session and close).
let sharing = null;
function sharingPrompt(win) {
  if (!sharing || win.closing || tabs.windowOf(sharing.owner) !== win.id) return 'close';
  const others = sharing.server.hub.members().filter((p) => p.role !== 'host').length;
  if (!others) return 'end';
  const answer = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Minimize', 'End session and close', 'Cancel'], defaultId: 0, cancelId: 2,
    message: others === 1 ? 'Notes are shared with 1 person. Closing ends the session for everyone.' : `Notes are shared with ${others} people. Closing ends the session for everyone.`,
    detail: 'Minimize keeps the session running.' });
  return ['minimize', 'end', 'cancel'][answer];
}
// Ends the session, then closes once everyone has saved (at most a couple of seconds).
function endSharing() {
  if (!sharing) return Promise.resolve();
  const { server } = sharing;
  return new Promise((resolve) => {
    sharing.closed = resolve;
    server.hub.end();
    setTimeout(resolve, 4000);
  }).then(() => new Promise((resolve) => setTimeout(resolve, 300)));
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
function createWindow({ tab = true, files = [] } = {}) {
  const win = new BaseWindow({ width: 1280, height: 900, minWidth: 360, minHeight: 480, backgroundColor: backdrop(),
    // The reader draws its own File/Edit/View menubar; Alt still reveals the native one and its accelerators keep working.
    title: 'NoteComplete', autoHideMenuBar: true });
  // The id is read once: in 'closed' the window is already destroyed and win.id throws.
  const id = win.id;
  windows.set(id, win);
  win.on('resize', () => layout(win));
  win.on('close', event => {
    const choice = sharingPrompt(win);
    if (choice !== 'close') {
      event.preventDefault();
      if (choice === 'minimize') win.minimize();
      // The owner's reader writes the final notes when the session ends, then the window closes.
      if (choice === 'end') endSharing().then(() => { if (!win.isDestroyed()) win.close(); });
      return;
    }
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
  if (tab) for (const file of files.length ? files : [null]) openTab(win, file);
  return win;
}
// Opens files from the system in new tabs of the focused window (or the last one), brought
// to the front; a new window when none is open. False when none of them can be opened.
function openSystemFiles(list) {
  const wanted = list.filter(openablePath);
  if (!wanted.length) return false;
  if (!started) { launchQueue.push(...wanted.filter(f => !launchQueue.includes(f))); return true; }
  const focused = BaseWindow.getFocusedWindow();
  const win = (focused && windows.get(focused.id)) || [...windows.values()].at(-1);
  if (!win) { createWindow({ files: wanted }); return true; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  for (const file of wanted) openTab(win, file);
  return true;
}
// macOS hands files over as events, also before the app is ready (a cold launch).
app.on('open-file', (event, file) => {
  event.preventDefault();
  openSystemFiles([file]);
});
// One process per profile: a second launch would find IndexedDB and Local Storage
// locked (Recent, decks and settings would come up empty), so it opens a window here.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
// Launching the app again (menu, dock, terminal) opens a new window; Ctrl+T
// and + make tabs from inside a window. A launch with files (Open with… on Windows and
// Linux) opens them in tabs of the open window instead.
app.on('second-instance', (_event, argv, workingDirectory) => {
  if (!openSystemFiles(launchFiles(argv, { cwd: workingDirectory, packaged: app.isPackaged })) && started) createWindow();
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
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*.archive.org/*', '*://archive.org/*'] }, (details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders['access-control-allow-origin'] = ['*'];
    responseHeaders['access-control-allow-headers'] = ['*'];
    responseHeaders['cross-origin-resource-policy'] = ['cross-origin'];
    callback({ responseHeaders });
  });
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
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Open a note', properties: ['openFile'], filters: [{ name: 'Notes, PDFs, HTML pages, text, Office files and images', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }] });
    if (chosen.canceled) return null;
    const file = chosen.filePaths[0];
    await files.remember(file);
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await readFile(file)) };
  }));
  // The file the system asked this tab to open, once; it joins Recent like a dialog pick.
  ipcMain.handle('files:launched', guarded(async event => {
    const file = launchPending.get(event.sender.id);
    launchPending.delete(event.sender.id);
    if (!openablePath(file)) return null;
    const bytes = new Uint8Array(await readFile(file));
    await files.remember(file);
    return { path: file, name: path.basename(file), bytes };
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
  ipcMain.handle('files:download-url', guarded(async (event, url, streamId) => {
    const res = await net.fetch(url);
    if (!res.ok) throw Error(`Download answered ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (streamId) event.sender.send(`download:progress:${streamId}`, { received, total });
    }
    const combined = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }));
  ipcMain.handle('files:pick', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Add documents', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Notes, PDFs, HTML pages, text, Office files and images', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }] });
    if (chosen.canceled) return [];
    for (const file of [...chosen.filePaths].reverse()) await files.remember(file);
    return chosen.filePaths.map(file => ({ path: file, name: path.basename(file) }));
  }));
  // Flashcards, quizzes and chat through the user's own AI CLIs; see ai-runner.js.
  const serverName = process.platform === 'win32' ? 'noteful.exe' : 'noteful';
  const bundled = app.isPackaged ? path.join(process.resourcesPath, serverName) : fileURLToPath(new URL(`../../target/release/${serverName}`, import.meta.url));
  const ai = aiRunner({ mcpBinary: existsSync(bundled) ? bundled : null });
  // The same server, at a path that survives updates and AppImage remounts, for the
  // user's AI tools outside the app (see agent-setup.js).
  let stableServer = null;
  const serverReady = existsSync(bundled)
    ? stableBinary({ bundled, folder: path.join(app.getPath('userData'), 'mcp') }).then(p => { stableServer = p; }, () => { stableServer = bundled; })
    : Promise.resolve();
  const agents = agentSetup({ tools: () => ai.tools(), server: () => stableServer });
  ipcMain.handle('agents:status', guarded(async () => { await serverReady; return { server: stableServer, tools: await agents.status() }; }));
  ipcMain.handle('agents:connect', guarded(async (_event, id) => { await serverReady; return agents.connect(String(id)); }));
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
  // Closing a tab or window stops its AI requests and transcriptions: no child process
  // (claude, agy, codex, ffmpeg, voxtype) keeps running for a reader that is gone.
  tabGone = id => { ai.cancel(id); asr.cancel(id); };
  ipcMain.handle('asr:backends', guarded(() => asr.backends()));
  ipcMain.handle('asr:run', guarded((event, request) => asr.run(event.sender.id, request, (done, total, segments, skipped) => {
    if (!event.sender.isDestroyed()) event.sender.send('asr:progress', { done, total, segments, skipped });
  })));
  ipcMain.on('asr:cancel', event => { if (trusted(event)) asr.cancel(event.sender.id); });
  // Several documents: tabs in a window, and windows; the command palette lists every tab.
  ipcMain.handle('windows:new', guarded(() => { createWindow(); }));
  // Version checks (updater.js): on open, every few hours while running, or from Help; installing always
  // waits for the user's go-ahead in the reader.
  const updates = updater({ app, stateFile: path.join(app.getPath('userData'), 'updates.json') });
  // Windows opening together share one check; a later one (the app left running) asks again.
  let opening = null, openedAt = 0;
  ipcMain.handle('update:check', guarded((_event, manual) => {
    if (manual) return updates.check({ manual: true });
    if (!opening || Date.now() - openedAt > 60_000) {
      openedAt = Date.now();
      opening = updates.check().catch(error => ({ current: app.getVersion(), error: error.message }));
    }
    return opening;
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
  // Sharing: the server is started for this tab, which joins it as the host over loopback.
  ipcMain.handle('collab:start', guarded(async (event, options = {}) => {
    const owner = event.sender.id;
    if (sharing && sharing.owner !== owner) throw Error('Another tab is already sharing. Stop sharing there first.');
    if (!sharing) {
      const notes = ['edit', 'view'].includes(options.notes) ? options.notes : null;
      const server = await (await collabServer()).startServer({
        root, notes,
        onEnded: (result) => {
          const contents = views.get(owner)?.webContents;
          if (contents && !contents.isDestroyed()) contents.send('collab:ended', { reason: result.reason });
          const done = sharing?.closed;
          sharing = null;
          done?.();
        },
      });
      sharing = { owner, server };
      // A Linux firewall would keep phones out: the dialog shows how to let them in.
      sharing.firewall = await (await collabServer()).firewallHint(server.port).catch(() => null);
    }
    return sharingInfo(sharing.server);
  }));
  const sharingInfo = (server) => ({ hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: server.guestLink, tabletLink: server.tabletLink(), address: server.address, addresses: server.addresses, port: server.port, onlineLink: server.onlineLink, onlineTabletLink: server.onlineTabletLink, online: server.online, firewall: sharing?.firewall || null, ...server.code() });
  ipcMain.handle('collab:address', guarded((event, address) => {
    if (sharing?.owner !== event.sender.id) return null;
    sharing.server.useAddress(String(address));
    return sharingInfo(sharing.server);
  }));
  // Online access for notes guests (tunnel.js): the first time, cloudflared is downloaded
  // into the app's data folder and checked before it runs.
  ipcMain.handle('collab:online', guarded(async (event, on) => {
    if (sharing?.owner !== event.sender.id) return null;
    const { server } = sharing, sender = event.sender;
    if (!on) { server.stopOnline(); return sharingInfo(server); }
    await server.goOnline({
      dir: path.join(app.getPath('userData'), 'bin'),
      progress: (p) => { if (!sender.isDestroyed()) sender.send('collab:online-progress', p); },
      onExit: () => { if (!sender.isDestroyed()) sender.send('collab:online-ended'); },
    });
    return sharingInfo(server);
  }));
  ipcMain.handle('collab:stop', guarded(async (event) => {
    if (sharing?.owner !== event.sender.id) return;
    await endSharing();
    await sharing?.server.stop();
    sharing = null;
  }));
  ipcMain.handle('collab:info', guarded((event) => (sharing?.owner === event.sender.id ? { tabletLink: sharing.server.tabletLink(), address: sharing.server.address, ...sharing.server.code() } : null)));
  ipcMain.handle('collab:minimize', guarded((event) => windowOf(event.sender)?.minimize()));
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
  // The Drive session belongs to the app, not to one tab: kept here in memory (never on disk)
  // and handed to every tab, so a new tab does not start signed out.
  ipcMain.handle('drive:session', event => (trusted(event) ? currentDriveSession() : null));
  ipcMain.on('drive:forget', event => { if (trusted(event)) { driveSession.read = driveSession.write = null; sendDriveSession(); } });
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
      const token = await desktopSignIn({ credentials: config, signal: abort.signal, openExternal: url => shell.openExternal(url), write: options?.write === true });
      shareDriveSession(options?.write === true ? 'write' : 'read', token);
      return token;
    } finally { pendingAuth.delete(sender.id); sender.removeListener('destroyed', cancelled); }
  });
  started = true;
  createWindow({ files: launchQueue.splice(0) });
  app.on('activate', () => { if (!windows.size) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
