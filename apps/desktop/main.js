import { app, BaseWindow, BrowserWindow, ClipboardItem, Menu, WebContentsView, clipboard, dialog, nativeTheme, net, protocol, safeStorage, session, ipcMain, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopCredentials, desktopSignIn, refreshDesktopToken } from './google-auth.js';
import { dropboxDesktopSignIn, refreshDropboxDesktopToken } from './dropbox-auth.js';
import { createMoodleService, parseMobileTokenUrl } from './moodle-service.js';
import { detectMacAppleNotesDb, readAppleNotesSqlite } from './apple-notes-db.js';
import { assetPath } from './asset-path.js';
import { archiveDownload, downloadRegistry } from './archive-download.js';
import { libraryFiles, withExtension } from './library-files.js';
import { launchFiles, openablePath } from './open-with.js';
import { integrateLinux, setEuroOfficeMenuEntry } from './linux-integration.js';
import { aiRunner } from './ai-runner.js';
import { T3CodeService } from './t3code-service.js';
import { agentSetup, readMcpSettings, stableBinary, writeMcpSettings } from './agent-setup.js';
import { transcriber } from './transcriber.js';
import { existsSync } from 'node:fs';
import { tabStore } from './tabs.js';
import { updater } from './updater.js';
import { branchBuilder } from './branch-build.js';
import { saveSession, takeSession } from './session.js';
import { prefabFolder, userPrefabPath } from './prefab-folder.js';
import { menuTemplate, uiZoomStep, ownPage } from './app-menu.js';
export { uiZoomStep };
import { readerPermissionAllowed } from './permissions.js';
import { renderHtmlToPdfWithTapes } from './html-pdf.js';
import { appLog } from './app-log.js';
import { diagramRenderer } from './diagrams.js';
import { createRBridge } from './r-bridge.js';
import { createOfficeBridge } from './office-bridge.js';
import { systemOpenWith } from './system-open-with.js';
import { pngClipboard, processRunner } from './png-clipboard.js';
import { spawn } from 'node:child_process';
// Loaded with the first sharing session only (docs/COLLABORATION.md).
const collabServer = () => import('./collab-server.js');

const home = 'notecomplete://reader/';
// Warnings, errors and [NC] progress lines of every tab (app-log.js).
const log = appLog(path.join(app.getPath('userData'), 'logs'));
log.write(`[NC] start ${app.getVersion()} pid ${process.pid}`);
const root = fileURLToPath(new URL('./reader/', import.meta.url));
// The prefab modules folder in use (Settings → Prefab modules).
const prefabs = prefabFolder({ settingsFile: path.join(app.getPath('userData'), 'prefab-modules.json'), shipped: path.join(root, 'prefabs') });
protocol.registerSchemesAsPrivileged([{ scheme: 'notecomplete', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
// Windows hold tabs: one reader view per tab, only the active one shown. The
// readers draw the tab strip in their own top bar from the list sent here.
const tabs = tabStore();
// Google Drive tokens, shared by all tabs and persisted encrypted when available so sign-in survives restarts.
// Refresh tokens never leave the main process; renderers only receive short-lived access tokens.
const driveSession = { read: null, write: null };
const refreshingDrive = new Map();
const driveSessionPath = () => path.join(app.getPath('userData'), 'drive-session.json');
async function readDesktopCredentials() {
  const saved = path.join(app.getPath('userData'), 'google-desktop-client.json');
  for (const filename of [fileURLToPath(new URL('./google-desktop-client.json', import.meta.url)), saved]) {
    try { return desktopCredentials(JSON.parse(await readFile(filename, 'utf8'))); } catch { /* Try the configured fallback. */ }
  }
  return null;
}
async function saveDriveSession() {
  try {
    const payload = {};
    for (const kind of ['read', 'write']) {
      const s = driveSession[kind];
      if (s?.refreshToken || (s?.access_token && s.expires - Date.now() > 10000)) payload[kind] = s;
    }
    if (!payload.read && !payload.write) { await rm(driveSessionPath(), { force: true }); return; }
    const raw = JSON.stringify(payload);
    const wrapped = safeStorage.isEncryptionAvailable()
      ? JSON.stringify({ encrypted: true, data: safeStorage.encryptString(raw).toString('base64') })
      : raw;
    await writeFile(driveSessionPath(), wrapped, { mode: 0o600 });
  } catch { /* Optional on read-only environments. */ }
}
async function loadDriveSession() {
  try {
    const parsed = JSON.parse(await readFile(driveSessionPath(), 'utf8'));
    const data = parsed?.encrypted
      ? (safeStorage.isEncryptionAvailable() ? JSON.parse(safeStorage.decryptString(Buffer.from(parsed.data, 'base64'))) : null)
      : parsed;
    if (!data || typeof data !== 'object') return;
    for (const kind of ['read', 'write']) {
      if (data[kind] && typeof data[kind] === 'object') driveSession[kind] = data[kind];
    }
  } catch { /* No saved session yet. */ }
}
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
function shareDriveSession(kind, token, refreshToken = driveSession[kind]?.refreshToken || '') {
  driveSession[kind] = { access_token: token.access_token, scope: token.scope, expires: Date.now() + Number(token.expires_in || 0) * 1000, ...(refreshToken ? { refreshToken } : {}) };
  void saveDriveSession();
  sendDriveSession();
}
async function refreshDriveKind(kind, { force = false } = {}) {
  const current = driveSession[kind];
  if (!force && current?.access_token && current.expires - Date.now() > 60000) {
    return { access_token: current.access_token, scope: current.scope, expires_in: Math.floor((current.expires - Date.now()) / 1000) };
  }
  if (!current?.refreshToken) throw Error('Connect to Google Drive to continue.');
  if (refreshingDrive.has(kind)) return refreshingDrive.get(kind);
  const task = (async () => {
    const credentials = await readDesktopCredentials();
    if (!credentials) throw Error('Google OAuth client configuration is missing.');
    try {
      let nextRefresh = current.refreshToken;
      const scope = current.scope || (kind === 'write' ? 'https://www.googleapis.com/auth/drive' : 'https://www.googleapis.com/auth/drive.readonly');
      const token = await refreshDesktopToken({ credentials, refreshToken: current.refreshToken, scope, onRefreshToken: rt => { nextRefresh = rt; } });
      shareDriveSession(kind, token, nextRefresh);
      return token;
    } catch (error) {
      if (error.code === 'invalid_grant') {
        driveSession[kind] = null;
        await saveDriveSession();
        sendDriveSession();
      }
      throw error;
    } finally {
      refreshingDrive.delete(kind);
    }
  })();
  refreshingDrive.set(kind, task);
  return task;
}
// Dropbox tokens, shared by all tabs and persisted encrypted when available so sign-in survives restarts.
let dropboxSession = null;
let refreshingDropbox = null;
const dropboxSessionPath = () => path.join(app.getPath('userData'), 'dropbox-session.json');
async function saveDropboxSession() {
  try {
    const s = dropboxSession;
    if (!s || (!s.refreshToken && !(s.access_token && s.expires - Date.now() > 10000))) {
      await rm(dropboxSessionPath(), { force: true });
      return;
    }
    const raw = JSON.stringify(s);
    const wrapped = safeStorage.isEncryptionAvailable()
      ? JSON.stringify({ encrypted: true, data: safeStorage.encryptString(raw).toString('base64') })
      : raw;
    await writeFile(dropboxSessionPath(), wrapped, { mode: 0o600 });
  } catch { /* Optional on read-only environments. */ }
}
async function loadDropboxSession() {
  try {
    const parsed = JSON.parse(await readFile(dropboxSessionPath(), 'utf8'));
    const data = parsed?.encrypted
      ? (safeStorage.isEncryptionAvailable() ? JSON.parse(safeStorage.decryptString(Buffer.from(parsed.data, 'base64'))) : null)
      : parsed;
    if (data && typeof data === 'object') dropboxSession = data;
  } catch { /* No saved session yet. */ }
}
function currentDropboxSession() {
  const t = dropboxSession;
  if (t && t.expires - Date.now() > 10000) return { access_token: t.access_token, scope: t.scope, expires_in: Math.floor((t.expires - Date.now()) / 1000) };
  return null;
}
function sendDropboxSession() {
  const session = currentDropboxSession();
  for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.send('dropbox:session', session);
}
function shareDropboxSession(token, refreshToken = dropboxSession?.refreshToken || '', appKey = dropboxSession?.appKey || '') {
  dropboxSession = {
    access_token: token.access_token,
    scope: token.scope,
    expires: Date.now() + Number(token.expires_in || 0) * 1000,
    ...(refreshToken ? { refreshToken } : {}),
    ...(appKey ? { appKey } : {}),
  };
  void saveDropboxSession();
  sendDropboxSession();
}
async function refreshDropboxSession({ force = false } = {}) {
  const current = dropboxSession;
  if (!force && current?.access_token && current.expires - Date.now() > 60000) {
    return { access_token: current.access_token, scope: current.scope, expires_in: Math.floor((current.expires - Date.now()) / 1000) };
  }
  if (!current?.refreshToken || !current?.appKey) throw Error('Connect to Dropbox to continue.');
  if (refreshingDropbox) return refreshingDropbox;
  const task = (async () => {
    try {
      let nextRefresh = current.refreshToken;
      const token = await refreshDropboxDesktopToken({ appKey: current.appKey, refreshToken: current.refreshToken, onRefreshToken: rt => { nextRefresh = rt; } });
      shareDropboxSession(token, nextRefresh, current.appKey);
      return token;
    } catch (error) {
      if (error.code === 'invalid_grant') {
        dropboxSession = null;
        await saveDropboxSession();
        sendDropboxSession();
      }
      throw error;
    } finally {
      refreshingDropbox = null;
    }
  })();
  refreshingDropbox = task;
  return task;
}
const views = new Map(), windows = new Map();
// Called when a tab's page is gone, so work started for it stops (set once the AI runners exist).
let tabGone = () => {};
// Files the system asked to open ("Open with…", double-click, the dock): each gets a tab of
// its own, whose reader collects it once ready (files:launched). Launch arguments and macOS
// open-file events that come before the app is ready wait in launchQueue.
const launchPending = new Map();
// After a restart for an update, what each new tab opens again (session.js), taken by the
// tab's reader once ready (session:take).
const restorePending = new Map();
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
const launchQueue = launchFiles(process.argv, { packaged: app.isPackaged });
let started = false;
// No spell checker: notes are written in many languages and the red underlines get in the way.
// The open dialogs' filter; "All files" also offers names without an extension.
const OPENABLE = ['noteful', 'notepart', 'notecomplete', 'notecomp', 'nfedit', 'goodnotes', 'ntb', 'rnote', 'zip', 'tar', 'tgz', 'gz', '7z', 'rar', 'html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico', 'mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac', 'weba', 'mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'ogv', 'docx', 'docm', 'dotx', 'doc', 'rtf', 'odt', 'fodt', 'xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'pptx', 'pptm', 'ppt', 'odp', 'epub', 'ipynb', 'rdata', 'rda', 'rds', 'txt', 'md', 'markdown', 'rst', 'adoc', 'asciidoc', 'org', 'rmd', 'qmd', 'csv', 'tsv', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'sh', 'py', 'c', 'h', 'cpp', 'hpp', 'java', 'js', 'ts', 'rs', 'go', 'sql', 'tex', 'r', 'm', 'asm', 's', 'lua', 'vhd', 'vhdl', 'v', 'puml', 'plantuml', 'pu', 'iuml', 'wsd'];
// nodeIntegrationInSubFrames only runs the preload in the reader's frames too: in sub-frames it
// exposes nothing and only lifts Euro-Office's 25 FPS paint cap (preload.cjs officePaintHook).
const webPreferences = { nodeIntegration: false, nodeIntegrationInSubFrames: true, contextIsolation: true, sandbox: true, spellcheck: false, webviewTag: true, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)) };
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
// Which interface-size step a key press asks for (Shift held), on US, Spanish and Linux/Wayland layouts.
// UI zoom step parsing lives in app-menu.js alongside keyboard layout notes.
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
function openTab(win, file = null, restore = null) {
  const view = new WebContentsView({ webPreferences });
  view.setBackgroundColor(backdrop());
  const contents = view.webContents, id = contents.id;
  views.set(id, view);
  log.attach(contents, id);
  if (file) launchPending.set(id, file);
  if (restore) restorePending.set(id, restore);
  tabs.add(win.id, id);
  contents.setWindowOpenHandler(({ url }) => {
    if (ownPage(url, home)) { openPage(url.slice(home.length)); return { action: 'deny' }; }
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
    restorePending.delete(id);
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
// A page of the reader on its own (Tools → UML diagram editor, or the reader's Insert menu):
// a plain window with no preload, so it has none of the app's file or system access.
function openPage(page) {
  const win = new BrowserWindow({ width: 1280, height: 860, minWidth: 360, minHeight: 420, backgroundColor: backdrop(), autoHideMenuBar: true, title: 'NoteComplete', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => { if (!ownPage(url, home)) event.preventDefault(); });
  win.loadURL(home + page);
}
// Help ▸ Setup wizard…: the tab in front of the focused window (or the last window) opens it.
function openSetup() {
  const focused = BaseWindow.getFocusedWindow();
  const win = (focused && windows.get(focused.id)) || [...windows.values()].at(-1);
  const view = win && views.get(tabs.active(win.id));
  if (view && !view.webContents.isDestroyed()) view.webContents.send('app:setup-wizard');
}
function createWindow({ tab = true, files = [] } = {}) {
  const win = new BaseWindow({ width: 1280, height: 900, minWidth: 360, minHeight: 480, backgroundColor: backdrop(),
    // The reader draws its own File/Edit/View menubar; Alt still reveals the native one and its accelerators keep working.
    title: 'NoteComplete', autoHideMenuBar: true });
  // The id is read once: in 'closed' the window is already destroyed and win.id throws.
  const id = win.id;
  windows.set(id, win);
  win.on('resize', () => layout(win));
  win.on('app-command', (event, cmd) => {
    if (cmd !== 'browser-backward' && cmd !== 'browser-forward') return;
    event.preventDefault();
    const activeId = tabs.active(id), view = views.get(activeId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: cmd === 'browser-backward' ? 'BrowserBack' : 'BrowserForward' });
    }
  });
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
function openEuroOfficeLauncher() {
  const focused = BaseWindow.getFocusedWindow();
  const win = (focused && windows.get(focused.id)) || [...windows.values()].at(-1) || createWindow({ tab: true });
  const view = win && views.get(tabs.active(win.id));
  if (win.isMinimized()) win.restore();
  win.focus();
  if (view && !view.webContents.isDestroyed()) {
    if (view.webContents.isLoading()) view.webContents.once('did-finish-load', () => { if (!view.webContents.isDestroyed()) view.webContents.send('app:euro-office-launch'); });
    else view.webContents.send('app:euro-office-launch');
  }
}
app.on('second-instance', (_event, argv, workingDirectory) => {
  const euro = Array.isArray(argv) && argv.includes('--euro-office');
  const opened = openSystemFiles(launchFiles(argv, { cwd: workingDirectory, packaged: app.isPackaged }));
  if (!opened && started) {
    if (euro) openEuroOfficeLauncher();
    else createWindow();
  }
});
app.whenReady().then(async () => {
  if (!primary) return;
  integrateLinux().catch(() => { /* Best effort: the app works without file associations. */ });
  try { const z = Number(JSON.parse(await readFile(uiFile(), 'utf8')).zoom); if (UI_SIZES.includes(z)) uiZoom = z; } catch { /* First run. */ }
  // Two web permissions, for the reader itself only: writing text to the clipboard (Grab → Copy text)
  // and camera/microphone media (QR scanning in Share and recording in the audio panel).
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(readerPermissionAllowed(home, permission, details?.requestingUrl || contents?.getURL?.(), details?.mediaTypes || [])));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin, details) => readerPermissionAllowed(home, permission, origin, details?.mediaType ? [details.mediaType] : []));
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*.archive.org/*', '*://archive.org/*'] }, (details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders['access-control-allow-origin'] = ['*'];
    responseHeaders['access-control-allow-headers'] = ['*'];
    responseHeaders['cross-origin-resource-policy'] = ['cross-origin'];
    callback({ responseHeaders });
  });
  // Local Euro-Office DocumentServer runs on 127.0.0.1 and is framed inside the reader
  // (which sends COEP: credentialless for WASM threads). Mark loopback responses embeddable
  // so Chromium does not block the DocsAPI editor iframe with ERR_BLOCKED_BY_RESPONSE.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1:*/*'] }, (details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['X-Frame-Options'];
    responseHeaders['cross-origin-resource-policy'] = ['cross-origin'];
    responseHeaders['cross-origin-embedder-policy'] = ['credentialless'];
    responseHeaders['access-control-allow-origin'] = ['*'];
    callback({ responseHeaders });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(process.platform, { openPage, openSetup })));
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
      // The prefab modules folder in use, at prefabs-user/ (prefab-folder.js).
      const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, '');
      const user = relative.startsWith('prefabs-user/') ? userPrefabPath(relative, { folder: await prefabs.folder(), shipped: path.join(root, 'prefabs') }) : null;
      if (relative.startsWith('prefabs-user/') && !user) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(user || assetPath(root, request.url)).href);
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
  const pendingDropboxAuth = new Map();
  const trusted = event => event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith(home);
  // Downloads folder and Recent for the reader; see library-files.js for the limits.
  const files = libraryFiles({ settingsFile: path.join(app.getPath('userData'), 'library.json'), defaultFolder: path.join(app.getPath('documents'), 'NoteComplete'), trash: (file) => shell.trashItem(file) });
  const guarded = handler => async (event, ...args) => {
    if (!trusted(event)) throw Error('Unexpected reader origin.');
    return handler(event, ...args);
  };
  ipcMain.handle('files:folder', guarded(() => files.folder()));
  // Settings → Prefab modules (prefab-folder.js): the folder in use and its modules; copy the
  // app's modules to a folder, use a folder, go back to the app's own, open it.
  ipcMain.handle('prefabs:list', guarded(() => prefabs.list()));
  ipcMain.handle('prefabs:copy-to', guarded(async (event) => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Copy the prefab modules to…', properties: ['openDirectory', 'createDirectory'] });
    return chosen.canceled ? null : prefabs.copyTo(chosen.filePaths[0]);
  }));
  ipcMain.handle('prefabs:use', guarded(async (event) => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Use this folder of prefab modules', properties: ['openDirectory'] });
    return chosen.canceled ? null : prefabs.use(chosen.filePaths[0]);
  }));
  ipcMain.handle('prefabs:reset', guarded(() => prefabs.use(null)));
  ipcMain.handle('prefabs:open', guarded(async () => { const dir = await prefabs.folder(); if (dir) await shell.openPath(dir); return !!dir; }));
  ipcMain.handle('files:choose', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Keep downloaded notes in…', defaultPath: await files.folder(), properties: ['openDirectory', 'createDirectory'] });
    return chosen.canceled ? null : files.setFolder(chosen.filePaths[0]);
  }));
  ipcMain.handle('files:read', guarded((_event, name) => files.read(name)));
  ipcMain.handle('files:write', guarded((_event, name, bytes) => files.write(name, bytes)));
  ipcMain.handle('files:remove', guarded((_event, name) => files.remove(name)));
  ipcMain.handle('files:open', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Open a note', properties: ['openFile'], filters: [{ name: 'Notes, PDFs, HTML pages, text, media, diagrams, Office files, images and archives', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }] });
    if (chosen.canceled) return null;
    const file = chosen.filePaths[0];
    await files.remember(file);
    if (/\.(mp4|m4v|webm|mkv|mov|avi|ogv)$/i.test(file)) return { path: file, name: path.basename(file), bytes: new Uint8Array(0), external: true };
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await readFile(file)) };
  }));
  ipcMain.handle('files:pick-ai', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), {
      title: 'Attach files to Ask AI',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Notes, PDFs, Markdown, Office & Images', extensions: OPENABLE },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (chosen.canceled || !chosen.filePaths?.length) return [];
    const out = [];
    for (const file of chosen.filePaths.slice(0, 12)) {
      const name = path.basename(file);
      const isImg = /\.(png|jpe?g|webp|gif)$/i.test(name);
      if (isImg) {
        const buf = await readFile(file);
        const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/jpeg';
        out.push({ path: file, name, kind: 'image', url: `data:${mime};base64,${buf.toString('base64')}` });
      } else {
        out.push({ path: file, name, kind: 'file' });
      }
    }
    return out;
  }));
  // The file the system asked this tab to open, once; it joins Recent like a dialog pick.
  ipcMain.handle('files:launched', guarded(async event => {
    const file = launchPending.get(event.sender.id);
    launchPending.delete(event.sender.id);
    if (typeof file !== 'string' || !file) return null;
    if (!openablePath(file) && file !== log.file && !(path.isAbsolute(file) && existsSync(file))) return null;
    const bytes = new Uint8Array(await readFile(file));
    await files.remember(file);
    return { path: file, name: path.basename(file), bytes };
  }));
  ipcMain.handle('files:read-recent', guarded((_event, file) => files.readRecent(file)));
  ipcMain.handle('files:open-external-path', guarded(async (_event, file) => {
    await files.assertOpened(file, { any: true });
    const err = await shell.openPath(file);
    if (err) throw Error(err);
    return true;
  }));
  // A file NoteComplete does not open: the system's "Open with" chooser, else its default app.
  ipcMain.handle('files:open-with-system', guarded(async (_event, file) => {
    await files.assertOpened(file, { any: true });
    if (await systemOpenWith(file)) return 'chooser';
    const err = await shell.openPath(file);
    if (err) throw Error(err);
    return 'default';
  }));
  ipcMain.handle('files:show-in-folder', guarded(async (_event, file) => {
    const resolved = await files.assertRevealable(file);
    shell.showItemInFolder(resolved);
    return true;
  }));
  ipcMain.handle('files:read-local-note', guarded((_event, file) => files.readLocalNote(file)));
  ipcMain.handle('files:stat-local-note', guarded((_event, file) => files.statLocalNote(file)));
  // Groups: a whole folder, or several files added to the open document.
  ipcMain.handle('files:open-folder', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Open a folder of notes', properties: ['openDirectory'] });
    if (chosen.canceled) return null;
    const folder = chosen.filePaths[0];
    await files.rememberFolder(folder);
    return { folder, name: path.basename(folder), files: await files.listFolder(folder) };
  }));
  ipcMain.handle('files:list-folder', guarded((_event, folder, options) => files.listFolder(folder, { all: options?.all === true })));
  ipcMain.handle('files:read-sibling', guarded((_event, file, relative) => files.readSibling(file, relative)));
  ipcMain.handle('files:save-copy', guarded((_event, file, options) => files.saveCopy(file, options)));
  ipcMain.handle('files:render-html-pdf', guarded((_event, html) => renderHtmlToPdfWithTapes({ BrowserWindow, html })));
  ipcMain.handle('files:write-opened', guarded((_event, file, bytes) => files.writeOpened(file, bytes)));
  ipcMain.handle('files:save', guarded(async (event, defaultName, bytes, filters) => {
    const chosen = await dialog.showSaveDialog(windowOf(event.sender), {
      title: 'Save note',
      defaultPath: typeof defaultName === 'string' && defaultName ? path.basename(defaultName) : 'Untitled.nfedit',
      ...(Array.isArray(filters) && filters.length ? { filters } : {}),
    });
    if (chosen.canceled || !chosen.filePath) return null;
    return files.saveChosen(withExtension(chosen.filePath, filters), bytes);
  }));
  // Archive window → Save file…: one entry, anywhere, under any plain name (not remembered).
  ipcMain.handle('files:save-entry', guarded(async (event, name, bytes) => {
    const base = typeof name === 'string' ? path.basename(name.replace(/\\/g, '/')) : '';
    if (!base || base.startsWith('.') || /[\x00-\x1f]/.test(base) || !(bytes instanceof Uint8Array)) throw Error('Invalid file.');
    const chosen = await dialog.showSaveDialog(windowOf(event.sender), { title: 'Save file from the archive', defaultPath: base });
    if (chosen.canceled || !chosen.filePath) return null;
    await writeFile(chosen.filePath, bytes);
    return { path: chosen.filePath, name: path.basename(chosen.filePath), size: bytes.byteLength };
  }));
  ipcMain.handle('files:rename-opened', guarded((_event, file, name) => files.renameOpened(file, name)));
  ipcMain.handle('files:trash-opened', guarded((_event, file) => files.trashOpened(file)));
  // PlantUML diagrams drawn by the PlantUML installed here (diagrams.js).
  const diagrams = diagramRenderer({ folderOf: file => files.documentFolder(file) });
  // R Math & Statistics Bridge (r-bridge.js): connects to R Commander Studio or local Rscript.
  const rBridge = createRBridge({ openPath: (p) => shell.openPath(p) });
  // Euro-Office DocumentServer module (office-bridge.js): starts on demand on 127.0.0.1.
  const officeBridge = createOfficeBridge({
    onSaved: (ev) => {
      const contents = views.get(ev.ownerId)?.webContents;
      if (contents && !contents.isDestroyed()) {
        contents.send('office:saved', { sessionId: ev.sessionId, status: ev.status, bytes: new Uint8Array(ev.bytes), ext: ev.ext, name: ev.name, key: ev.key });
      }
    },
    onLog: (line) => log.write(line),
  });
  let officeQuitting = false;
  app.on('before-quit', (event) => {
    if (officeBridge.running && !officeQuitting) {
      event.preventDefault();
      officeQuitting = true;
      officeBridge.stop().finally(() => app.quit());
    }
  });
  // Copied items as a picture that keeps them (png-clipboard.js): the PNG byte for byte.
  const pictures = pngClipboard({ clipboard, ClipboardItem, run: processRunner(spawn) });
  ipcMain.handle('clipboard:write-png', guarded((_event, bytes, text) => pictures.write(bytes, typeof text === 'string' ? text : '')));
  ipcMain.handle('diagrams:plantuml', guarded((_event, text, file) => diagrams.plantuml(text, typeof file === 'string' ? file : '')));
  ipcMain.handle('rbridge:status', guarded(() => rBridge.status()));
  ipcMain.handle('rbridge:eval-figure', guarded((_event, request) => rBridge.evalFigure(request || {})));
  ipcMain.handle('rbridge:eval-code', guarded((_event, request) => rBridge.evalCode(request || {})));
  ipcMain.handle('rbridge:open-studio', guarded((_event, request) => rBridge.openInStudio(request || {})));
  ipcMain.handle('rbridge:install-studio', guarded((event) => rBridge.installStudio({
    onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('rbridge:install-progress', p); },
  })));
  ipcMain.handle('rbridge:pick-folder', guarded(async (event, defaultPath) => {
    const startDir = typeof defaultPath === 'string' && defaultPath ? defaultPath : await files.folder();
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), {
      title: 'Choose folder for R file or workspace',
      defaultPath: startDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    return chosen.canceled ? null : chosen.filePaths[0];
  }));
  ipcMain.handle('rbridge:create-item', guarded(async (_event, request) => {
    const parentDir = request?.parentDir || await files.folder();
    const created = await rBridge.createRItem({ ...(request || {}), parentDir });
    if (created?.mode === 'workspace' && created.folderPath) {
      await files.rememberFolder(created.folderPath);
      for (const f of created.files || []) await files.remember(f);
      return { ...created, folderListing: await files.listFolder(created.folderPath) };
    }
    if (created?.filePath) await files.remember(created.filePath);
    return created;
  }));
  // Euro-Office module IPC (office-bridge.js).
  void officeBridge.cleanupStale?.().catch(() => {});
  void officeBridge.status().then((s) => setEuroOfficeMenuEntry(Boolean(s?.installed))).catch(() => {});
  ipcMain.handle('office:status', guarded(() => officeBridge.status()));
  ipcMain.handle('office:setup-prereqs', guarded(async (event) => {
    return officeBridge.setupPrereqs((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('office:progress', p);
    });
  }));
  ipcMain.handle('office:install', guarded(async (event) => {
    const res = await officeBridge.install((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('office:progress', p);
    });
    if (res?.ok) void setEuroOfficeMenuEntry(true).catch(() => {});
    return res;
  }));
  ipcMain.handle('office:uninstall', guarded(async (_event, options) => {
    const res = await officeBridge.uninstall(options || {});
    void setEuroOfficeMenuEntry(false).catch(() => {});
    return res;
  }));
  ipcMain.handle('office:open', guarded((event, request) => {
    const ownerId = event.sender.id;
    event.sender.once('destroyed', () => { void officeBridge.closeOwner(ownerId); });
    return officeBridge.openDocument({ ...(request || {}), ownerId });
  }));
  ipcMain.handle('office:template', guarded((_event, ext, lang) => officeBridge.blankTemplate(ext, lang)));
  ipcMain.handle('office:forcesave', guarded((_event, sessionId) => officeBridge.forcesave(String(sessionId || ''))));
  ipcMain.handle('office:close', guarded((_event, sessionId, options) => officeBridge.closeDocument(String(sessionId || ''), options || {})));
  // Internet Archive files for the reader: only archive.org, with a size limit, and stopped
  // by the reader's cancel message or when its tab goes away (archive-download.js).
  const downloads = downloadRegistry();
  ipcMain.handle('files:download-url', guarded(async (event, url, streamId) => {
    const tab = event.sender.id, id = typeof streamId === 'string' && /^[\w-]{1,60}$/.test(streamId) ? streamId : null;
    const controller = id ? downloads.open(tab, id) : new AbortController();
    try {
      return await archiveDownload({
        request: options => net.request(options), url, signal: controller.signal,
        onProgress: (received, total) => { if (id && !event.sender.isDestroyed()) event.sender.send(`download:progress:${id}`, { received, total }); },
      });
    } finally { if (id) downloads.close(tab, id); }
  }));
  ipcMain.on('files:download-cancel', (event, streamId) => { if (trusted(event) && typeof streamId === 'string') downloads.cancel(event.sender.id, streamId); });
  ipcMain.handle('files:pick', guarded(async event => {
    const chosen = await dialog.showOpenDialog(windowOf(event.sender), { title: 'Add documents', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Notes, PDFs, HTML pages, text, diagrams, Office files, images and archives', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }] });
    if (chosen.canceled) return [];
    for (const file of [...chosen.filePaths].reverse()) await files.remember(file);
    return chosen.filePaths.map(file => ({ path: file, name: path.basename(file) }));
  }));
  // Flashcards, quizzes and chat through the user's own AI CLIs; see ai-runner.js.
  const serverName = process.platform === 'win32' ? 'noteful.exe' : 'noteful';
  const bundled = app.isPackaged ? path.join(process.resourcesPath, serverName) : fileURLToPath(new URL(`../../target/release/${serverName}`, import.meta.url));
  const t3 = new T3CodeService();
  const ai = aiRunner({ mcpBinary: existsSync(bundled) ? bundled : null, t3 });
  ipcMain.handle('t3:status', guarded(() => t3.getStatus()));
  ipcMain.handle('t3:start', guarded(() => t3.startBackend()));
  ipcMain.handle('t3:stop', guarded(() => t3.stopBackendIfOwned()));
  ipcMain.handle('t3:install', guarded((event, opts = {}) => t3.installT3Code({
    preferWsl: opts?.preferWsl !== false,
    onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('t3:install-progress', p); },
  })));
  let t3Closing = false;
  app.on('before-quit', (event) => {
    if (!t3.owned || t3Closing) return;
    t3Closing = true;
    event.preventDefault();
    t3.stopBackendIfOwned().catch(() => {}).finally(() => app.quit());
  });
  // The same server, at a path that survives updates and AppImage remounts, for the
  // user's AI tools outside the app (see agent-setup.js).
  let stableServer = null;
  const serverReady = existsSync(bundled)
    ? stableBinary({ bundled, folder: path.join(app.getPath('userData'), 'mcp') }).then(p => { stableServer = p; }, () => { stableServer = bundled; })
    : Promise.resolve();
  const skillsDir = app.isPackaged ? path.join(process.resourcesPath, 'skills') : fileURLToPath(new URL('../../skills', import.meta.url));
  const agents = agentSetup({ tools: () => ai.tools(), server: () => stableServer, skillsDir: existsSync(skillsDir) ? skillsDir : null });
  const mcpSettingsFile = path.join(app.getPath('userData'), 'mcp-settings.json');
  ipcMain.handle('agents:status', guarded(async () => { await serverReady; return { server: stableServer, tools: await agents.status() }; }));
  ipcMain.handle('agents:connect', guarded(async (_event, id) => { await serverReady; return agents.connect(String(id)); }));
  ipcMain.handle('agents:install-skills', guarded(async (_event, id) => agents.installSkills(String(id))));
  ipcMain.handle('agents:settings', guarded(() => readMcpSettings(mcpSettingsFile)));
  ipcMain.handle('agents:set-settings', guarded((_event, patch) => writeMcpSettings(mcpSettingsFile, patch && typeof patch === 'object' ? patch : {})));
  // Help → Keep a diagnostic log / Open the log (app-log.js).
  ipcMain.handle('log:get', guarded(() => ({ on: log.on, file: log.file })));
  ipcMain.handle('log:set', guarded((_event, on) => ({ on: log.setOn(on === true), file: log.file })));
  // Opens the log as a text document in a new NoteComplete tab (no system handler needed).
  ipcMain.handle('log:open', guarded(async event => {
    if (!existsSync(log.file)) return false;
    const win = windowOf(event.sender);
    if (win) openTab(win, log.file);
    return true;
  }));
  ipcMain.handle('ai:providers', guarded(() => ai.providers()));
  ipcMain.handle('ai:models', guarded((_event, provider, options) => ai.models(String(provider), { fresh: options?.fresh === true })));
  // A request with a stream id gets its answer's pieces as 'ai:delta' messages.
  ipcMain.handle('ai:run', guarded((event, request) => {
    const id = typeof request?.stream === 'string' && /^[\w-]{1,40}$/.test(request.stream) ? request.stream : null;
    const { stream: _stream, ...rest } = request || {};
    const send = (channel) => (text) => { if (!event.sender.isDestroyed()) event.sender.send(channel, id, text); };
    const begun = Date.now(), what = `[NC] ai ${rest.provider || '?'}${rest.model ? '/' + rest.model : ''} tag=${rest.tag || '-'} tab ${event.sender.id}`;
    log.write(`${what} start prompt=${String(rest.prompt || '').length} chars images=${(rest.images || []).length}`);
    return ai.run(event.sender.id, rest, id ? send('ai:delta') : null, id ? send('ai:activity') : null).then(
      (out) => { log.write(`${what} done in ${Math.round((Date.now() - begun) / 1000)} s, ${String(out?.text ?? out ?? '').length} chars`); return out; },
      (error) => { log.write(`${what} failed in ${Math.round((Date.now() - begun) / 1000)} s: ${error?.message}`); throw error; });
  }));
  ipcMain.on('ai:cancel', (event, tag) => { if (trusted(event)) ai.cancel(event.sender.id, typeof tag === 'string' ? tag : ''); });
  // Other transcription backends; pieces stream back to the reader as they finish.
  const asr = transcriber({ tools: () => ai.tools() });
  // Closing a tab or window stops its AI requests and transcriptions: no child process
  // (claude, agy, codex, ffmpeg, voxtype) keeps running for a reader that is gone.
  tabGone = id => { ai.cancel(id); asr.cancel(id); downloads.cancelTab(id); };
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
    if (manual) return updates.check({ manual: true }).catch(error => ({ current: app.getVersion(), error: error.message }));
    if (!opening || Date.now() - openedAt > 60_000) {
      openedAt = Date.now();
      opening = updates.check().catch(error => ({ current: app.getVersion(), error: error.message }));
    }
    return opening;
  }));
  ipcMain.handle('update:install', guarded(event => updates.install(p => { if (!event.sender.isDestroyed()) event.sender.send('update:progress', p); })));
  // Beta updates from a branch (branch-build.js): fetched and built on this machine, swapped in
  // only when the build succeeds. One build at a time, for the whole app; every tab sees it.
  const branches = branchBuilder({ app, stateFile: path.join(app.getPath('userData'), 'branch-build.json') });
  const toReaders = (channel, value) => { for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.send(channel, value); };
  ipcMain.handle('update:stable', guarded(() => updates.stable()));
  ipcMain.handle('branch:info', guarded(() => branches.info()));
  ipcMain.handle('branch:list', guarded(() => branches.branches()));
  ipcMain.handle('branch:status', guarded((_event, name) => branches.status(String(name ?? ''))));
  ipcMain.handle('branch:missing', guarded(() => branches.missing()));
  ipcMain.handle('branch:build', guarded(async (_event, name) => {
    const lines = [];
    let flush = null;
    const onLine = (line) => {
      lines.push(String(line).slice(0, 400));
      // At most ten messages a second: cargo and npm print fast.
      flush ??= setTimeout(() => { flush = null; toReaders('branch:line', lines.splice(0)); }, 100);
    };
    try {
      return await branches.build(String(name ?? ''), { onLine, onStep: (step) => toReaders('branch:step', String(step)) });
    } finally {
      clearTimeout(flush);
      if (lines.length) toReaders('branch:line', lines.splice(0));
    }
  }));
  ipcMain.handle('branch:cancel', guarded(() => branches.cancel()));
  ipcMain.handle('branch:log', guarded(async () => { const err = await shell.openPath(branches.logFile); return !err; }));
  app.on('will-quit', () => { branches.cancel(); });
  ipcMain.handle('update:skip', guarded((_event, version) => updates.skip(String(version))));
  ipcMain.handle('update:settings', guarded(() => updates.settings()));
  ipcMain.handle('update:check-on-open', guarded((_event, on) => updates.setCheckOnOpen(on)));
  // Only this project's release pages open (releases here are pre-releases, which /latest skips).
  ipcMain.handle('update:page', guarded((_event, url) => shell.openExternal(/^https:\/\/github\.com\/Emefedez\/NoteComplete\/releases\/[\w./-]+$/.test(String(url)) ? String(url) : 'https://github.com/Emefedez/NoteComplete/releases')));
  // Before restarting for an update, every tab says what it shows (the reader's
  // notecompleteSession: its Recent entry and page, and an automatic save of unsaved
  // changes), so the same windows and tabs open again after it. A tab that does not answer
  // in time is left out; the restart goes on.
  ipcMain.handle('update:restart', guarded(async () => {
    const ask = (contents) => Promise.race([
      contents.executeJavaScript('window.notecompleteSession ? window.notecompleteSession() : null', true),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]).catch(() => null);
    const open = await Promise.all([...windows.values()].map(async (win) => ({
      tabs: await Promise.all(tabs.list(win.id).map(async (tab) => {
        const contents = views.get(tab.id)?.webContents;
        return { active: tab.active, state: contents && !contents.isDestroyed() ? await ask(contents) : null };
      })),
    })));
    await saveSession(sessionFile(), open).catch((error) => log.write?.(`session: ${error.message}`));
    updates.restart();
  }));
  // What this tab opens again after a restart for an update, once.
  ipcMain.handle('session:take', guarded(event => {
    const state = restorePending.get(event.sender.id) ?? null;
    restorePending.delete(event.sender.id);
    return state;
  }));
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
  ipcMain.handle('tabs:new', guarded((event, filePath) => {
    const win = windowOf(event.sender);
    if (!win) return;
    const trimmed = typeof filePath === 'string' ? filePath.trim() : '';
    const target = trimmed && path.isAbsolute(trimmed) && existsSync(trimmed) ? trimmed : null;
    openTab(win, target);
  }));
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
  const sharingInfo = (server) => ({ hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: server.guestLink, tabletLink: server.tabletLink(), sendLink: server.sendLink(), onlineSendLink: server.onlineSendLink, address: server.address, addresses: server.addresses, port: server.port, onlineLink: server.onlineLink, onlineTabletLink: server.onlineTabletLink, online: server.online, firewall: sharing?.firewall || null, ...server.code() });
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
  ipcMain.handle('collab:info', guarded((event) => (sharing?.owner === event.sender.id ? { tabletLink: sharing.server.tabletLink(), sendLink: sharing.server.sendLink(), onlineSendLink: sharing.server.onlineSendLink, address: sharing.server.address, ...sharing.server.code() } : null)));
  ipcMain.handle('collab:share-file', guarded(async (event, options = {}) => {
    const owner = event.sender.id;
    if (sharing && sharing.owner !== owner) throw Error('Another tab is already sharing. Stop sharing there first.');
    if (!sharing) {
      const server = await (await collabServer()).startServer({
        root, notes: null,
        onEnded: (result) => {
          const contents = views.get(owner)?.webContents;
          if (contents && !contents.isDestroyed()) contents.send('collab:ended', { reason: result.reason });
          const done = sharing?.closed;
          sharing = null;
          done?.();
        },
      });
      sharing = { owner, server };
      sharing.firewall = await (await collabServer()).firewallHint(server.port).catch(() => null);
    }
    const shared = sharing.server.shareFile({ name: options.name, mime: options.mime, bytes: options.bytes });
    return { ...shared, ...sharingInfo(sharing.server) };
  }));
  ipcMain.handle('collab:share-links', guarded((event, id) => {
    if (sharing?.owner !== event.sender.id) return null;
    const links = sharing.server.shareLinks(id);
    return links ? { ...links, ...sharingInfo(sharing.server) } : null;
  }));
  ipcMain.handle('collab:unshare-file', guarded((event, id) => (sharing?.owner === event.sender.id ? sharing.server.unshareFile(id) : false)));
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
  // A hidden tab is throttled (Electron's backgroundThrottling) and its downloads crawled or
  // stopped once another tab was opened. While a tab downloads it runs at full speed; it is
  // throttled again when its queue is empty, so idle hidden tabs still cost nothing.
  ipcMain.handle('tabs:busy', guarded((event, busy) => {
    if (!event.sender.isDestroyed()) event.sender.setBackgroundThrottling(busy !== true);
  }));
  ipcMain.handle('tabs:update', guarded((event, state = {}) => {
    const win = windowOf(event.sender);
    if (win && tabs.update(event.sender.id, { title: state.title, dirty: state.dirty })) broadcast(win);
  }));
  await loadDriveSession();
  await loadDropboxSession();
  // The Drive session belongs to the app and persists encrypted in userData (refresh tokens
  // stay in the main process); renderers get short-lived access tokens and silent refreshes.
  ipcMain.handle('drive:session', async event => {
    if (!trusted(event)) return null;
    if (!currentDriveSession().read && driveSession.read?.refreshToken) await refreshDriveKind('read').catch(() => {});
    return currentDriveSession();
  });
  ipcMain.handle('drive:refresh', async (event, options = {}) => {
    if (!trusted(event)) throw Error('Unexpected authentication origin.');
    const kind = options?.write === true ? 'write' : 'read';
    return refreshDriveKind(kind, { force: options?.force === true });
  });
  ipcMain.on('drive:forget', event => { if (trusted(event)) { driveSession.read = driveSession.write = null; void saveDriveSession(); sendDriveSession(); } });
  ipcMain.on('drive:cancel', event => { if (trusted(event)) pendingAuth.get(event.sender.id)?.abort(); });
  ipcMain.handle('drive:sign-in', async (event, options = {}) => {
    if (!trusted(event)) throw Error('Unexpected authentication origin.');
    const kind = options?.write === true ? 'write' : 'read';
    if (options?.silent === true) return refreshDriveKind(kind);
    if (pendingAuth.has(event.sender.id)) throw Error('Finish the current Google sign-in first.');
    const abort = new AbortController(), sender = event.sender;
    pendingAuth.set(sender.id, abort);
    const cancelled = () => abort.abort();
    sender.once('destroyed', cancelled);
    try {
      const saved = path.join(app.getPath('userData'), 'google-desktop-client.json');
      let config = await readDesktopCredentials();
      if (!config) {
        const chosen = await dialog.showOpenDialog(windowOf(sender), { title: 'Choose Google Desktop OAuth client JSON', filters: [{ name: 'Google OAuth client', extensions: ['json'] }], properties: ['openFile'] });
        if (chosen.canceled) throw Error('Google sign-in cancelled.');
        const value = JSON.parse(await readFile(chosen.filePaths[0], 'utf8'));
        config = desktopCredentials(value);
        await writeFile(saved, JSON.stringify({ installed: { client_id: config.clientId, client_secret: config.clientSecret } }), { mode: 0o600 });
      }
      let refreshToken = '';
      const token = await desktopSignIn({ credentials: config, signal: abort.signal, openExternal: url => shell.openExternal(url), write: options?.write === true, onRefreshToken: rt => { refreshToken = rt; } });
      shareDriveSession(kind, token, refreshToken);
      return token;
    } finally { pendingAuth.delete(sender.id); sender.removeListener('destroyed', cancelled); }
  });
  ipcMain.handle('dropbox:session', async event => {
    if (!trusted(event)) return null;
    if (!currentDropboxSession() && dropboxSession?.refreshToken && dropboxSession?.appKey) await refreshDropboxSession().catch(() => {});
    return currentDropboxSession();
  });
  ipcMain.handle('dropbox:refresh', async (event, options = {}) => {
    if (!trusted(event)) throw Error('Unexpected authentication origin.');
    return refreshDropboxSession({ force: options?.force === true });
  });
  ipcMain.on('dropbox:forget', event => { if (trusted(event)) { dropboxSession = null; void saveDropboxSession(); sendDropboxSession(); } });
  ipcMain.on('dropbox:cancel', event => { if (trusted(event)) pendingDropboxAuth.get(event.sender.id)?.abort(); });
  ipcMain.handle('dropbox:sign-in', async (event, options = {}) => {
    if (!trusted(event)) throw Error('Unexpected authentication origin.');
    if (pendingDropboxAuth.has(event.sender.id)) throw Error('Finish the current Dropbox sign-in first.');
    const abort = new AbortController(), sender = event.sender;
    pendingDropboxAuth.set(sender.id, abort);
    const cancelled = () => abort.abort();
    sender.once('destroyed', cancelled);
    try {
      let refreshToken = '';
      const appKey = String(options?.appKey || '').trim();
      const token = await dropboxDesktopSignIn({ appKey, signal: abort.signal, openExternal: url => shell.openExternal(url), onRefreshToken: rt => { refreshToken = rt; } });
      shareDropboxSession(token, refreshToken, appKey);
      return token;
    } finally { pendingDropboxAuth.delete(sender.id); sender.removeListener('destroyed', cancelled); }
  });
  // Moodle LMS (SAML2 SSO via dedicated BrowserWindow + OS-keyring autofill + Web Service token + student tools).
  const moodleCredsFile = path.join(app.getPath('userData'), 'moodle-creds.json');
  async function readMoodleCreds() {
    try {
      const raw = await readFile(moodleCredsFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.encrypted && safeStorage?.isEncryptionAvailable?.()) {
        return JSON.parse(safeStorage.decryptString(Buffer.from(parsed.encrypted, 'base64')));
      }
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }
  async function writeMoodleCreds(map) {
    const serialized = JSON.stringify(map || {});
    const payload = safeStorage?.isEncryptionAvailable?.()
      ? JSON.stringify({ encrypted: safeStorage.encryptString(serialized).toString('base64') })
      : serialized;
    await writeFile(moodleCredsFile, payload, { mode: 0o600 });
  }
  const moodle = createMoodleService({
    sessionFile: path.join(app.getPath('userData'), 'moodle-session.json'),
    safeStorage,
    clearSsoCookies: async () => {
      const ses = session.fromPartition('persist:moodle');
      await ses.clearStorageData({ storages: ['cookies'] });
    },
    openSsoWindow: ({ baseUrl, ssoUrl, mobileLaunchUrl = '', label }) => new Promise((resolve, reject) => {
      const baseOrigin = new URL(baseUrl).origin;
      const win = new BrowserWindow({
        width: 920,
        height: 740,
        title: `Sign in to ${label || 'Moodle'}`,
        autoHideMenuBar: true,
        webPreferences: {
          partition: 'persist:moodle',
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      let settled = false;
      let pendingCred = null;
      let triedMobileFallback = false;
      const finish = (err, val) => {
        if (settled) return;
        settled = true;
        if (!win.isDestroyed()) win.close();
        if (err) reject(err);
        else resolve(val);
      };
      const savePendingCred = async () => {
        if (pendingCred && !pendingCred.forget && pendingCred.remember && pendingCred.username && pendingCred.password) {
          const map = await readMoodleCreds();
          map[baseOrigin] = { username: pendingCred.username, password: pendingCred.password, savedAt: Date.now() };
          await writeMoodleCreds(map).catch(() => {});
        }
      };
      const handleMobileRedirect = async (targetUrl) => {
        const parsed = parseMobileTokenUrl(targetUrl);
        if (!parsed?.token || settled) return false;
        await savePendingCred();
        let cookieStr = '';
        try {
          const cookies = await win.webContents.session.cookies.get({ url: baseUrl });
          cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        } catch { /* Optional */ }
        finish(null, { token: parsed.token, privateToken: parsed.privateToken || '', cookies: cookieStr, sesskey: '', userName: '', userId: 0 });
        return true;
      };
      // Capture form credentials submitted inside the SSO window (only when user keeps "Remember" checked).
      // Electron 35+ passes an Event object with `.message`; older versions pass `(event, level, message)`.
      win.webContents.on('console-message', (e, _level, legacyMessage) => {
        const message = typeof legacyMessage === 'string' ? legacyMessage : (typeof e?.message === 'string' ? e.message : '');
        if (!message) return;
        if (message === '__NC_SSO_FORGET__') {
          pendingCred = { forget: true };
          readMoodleCreds().then((m) => { delete m[baseOrigin]; return writeMoodleCreds(m); }).catch(() => {});
          return;
        }
        if (message.startsWith('__NC_SSO_CRED__:')) {
          try { pendingCred = JSON.parse(message.slice('__NC_SSO_CRED__:'.length)); } catch { /* ignore */ }
        }
      });
      const injectAutofillAndSaveBar = async () => {
        if (settled || win.isDestroyed()) return;
        const allCreds = await readMoodleCreds();
        const saved = allCreds[baseOrigin] || null;
        await win.webContents.executeJavaScript(`(() => {
          const passEl = document.querySelector('input[type="password"]');
          if (!passEl || document.getElementById('__ncSsoBar')) return;
          const form = passEl.form || passEl.closest('form') || document;
          const userEl = form.querySelector('input[type="text"], input[type="email"], input[name*="user" i], input[id*="user" i], input:not([type])');
          const saved = ${JSON.stringify(saved ? { username: saved.username || '', password: saved.password || '' } : null)};
          const setVal = (el, val) => {
            if (!el || !val) return;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          if (saved && saved.username && saved.password) {
            setVal(userEl, saved.username);
            setVal(passEl, saved.password);
          }
          const bar = document.createElement('div');
          bar.id = '__ncSsoBar';
          bar.style.cssText = 'position:sticky;top:0;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 14px;background:#1e293b;color:#f8fafc;font:13px/1.3 system-ui,sans-serif;border-bottom:1px solid #334155;';
          bar.innerHTML = '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;"><input id="__ncSsoRemember" type="checkbox" checked /><span>Remember login in NoteComplete (encrypted)</span></label>';
          if (saved) {
            const note = document.createElement('span');
            note.style.cssText = 'opacity:.8;font-size:12px;';
            note.textContent = 'Autofilled saved credentials';
            const forget = document.createElement('button');
            forget.type = 'button';
            forget.textContent = 'Forget saved';
            forget.style.cssText = 'margin-left:auto;padding:3px 9px;border-radius:6px;border:1px solid #475569;background:#334155;color:#f8fafc;cursor:pointer;font-size:12px;';
            forget.onclick = () => {
              console.debug('__NC_SSO_FORGET__');
              if (userEl) setVal(userEl, '');
              setVal(passEl, '');
              note.textContent = 'Saved login removed';
              forget.remove();
            };
            bar.append(note, forget);
          }
          document.body?.prepend(bar);
          const emit = () => {
            const remember = Boolean(document.getElementById('__ncSsoRemember')?.checked);
            console.debug('__NC_SSO_CRED__:' + JSON.stringify({
              remember,
              username: userEl ? String(userEl.value || '') : '',
              password: String(passEl.value || ''),
            }));
          };
          userEl?.addEventListener('input', emit);
          passEl.addEventListener('input', emit);
          document.getElementById('__ncSsoRemember')?.addEventListener('change', emit);
          if (form && form.addEventListener) form.addEventListener('submit', emit, true);
        })()`, true).catch(() => {});
      };
      const checkLoggedIn = async () => {
        if (settled || win.isDestroyed()) return;
        const curUrl = win.webContents.getURL();
        let u;
        try { u = new URL(curUrl); } catch { return; }
        if (u.origin !== baseOrigin || /\/(login|auth\/saml2)\//i.test(u.pathname)) {
          void injectAutofillAndSaveBar();
          return;
        }
        try {
          const info = await win.webContents.executeJavaScript(`(() => {
            const sesskey = (window.M && window.M.cfg && window.M.cfg.sesskey) || '';
            const bodyNotLoggedIn = Boolean(document.body && document.body.classList && document.body.classList.contains('notloggedin'));
            const hasLogout = Boolean(document.querySelector('a[href*="/login/logout.php"]'));
            const userEl = document.querySelector('.usertext, .usermenu .userbutton, [data-userid]');
            const userName = userEl ? (userEl.textContent || '').trim().slice(0, 80) : '';
            const userId = Number(document.querySelector('[data-userid]')?.getAttribute('data-userid') || (window.M && window.M.cfg && window.M.cfg.userId) || 0);
            const hasUserMenu = Boolean(document.querySelector('.usertext, .usermenu .userbutton, .usermenu .avatar'));
            const isLoggedIn = !bodyNotLoggedIn && (hasLogout || userId > 1 || (hasUserMenu && /\\/(my|course|user)/i.test(location.pathname)));
            return { sesskey, userName, userId, isLoggedIn };
          })()`, true);
          if (!info?.isLoggedIn) {
            void injectAutofillAndSaveBar();
            return;
          }
          const cookies = await win.webContents.session.cookies.get({ url: baseUrl });
          const hasMoodleCookie = cookies.some((c) => /moodlesession/i.test(c.name) && c.value);
          if (hasMoodleCookie && (info?.sesskey || /\/(my|course|user)/i.test(u.pathname))) {
            await savePendingCred();
            const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
            finish(null, { cookies: cookieStr, sesskey: info?.sesskey || '', userName: info?.userName || '', userId: info?.userId || 0 });
          }
        } catch { /* page still loading */ }
      };
      win.webContents.on('will-redirect', (event, targetUrl) => {
        if (/^moodlemobile:\/\//i.test(String(targetUrl || ''))) {
          event.preventDefault();
          void handleMobileRedirect(targetUrl);
        }
      });
      win.webContents.on('will-navigate', (event, targetUrl) => {
        if (/^moodlemobile:\/\//i.test(String(targetUrl || ''))) {
          event.preventDefault();
          void handleMobileRedirect(targetUrl);
        }
      });
      win.webContents.on('did-fail-load', (_event, _code, _desc, validatedUrl) => {
        if (/^moodlemobile:\/\//i.test(String(validatedUrl || ''))) {
          void handleMobileRedirect(validatedUrl);
          return;
        }
        if (mobileLaunchUrl && !triedMobileFallback && String(validatedUrl || '').includes('/admin/tool/mobile/launch.php')) {
          triedMobileFallback = true;
          win.loadURL(ssoUrl).catch((e) => finish(e));
        }
      });
      win.webContents.on('did-finish-load', checkLoggedIn);
      win.webContents.on('did-navigate', checkLoggedIn);
      win.on('closed', () => finish(Error('Moodle sign-in window was closed before completing login.')));
      win.loadURL(mobileLaunchUrl || ssoUrl).catch((e) => {
        if (mobileLaunchUrl && !triedMobileFallback) {
          triedMobileFallback = true;
          win.loadURL(ssoUrl).catch((err) => finish(err));
        } else {
          finish(e);
        }
      });
    }),
  });
  ipcMain.handle('moodle:presets', guarded(() => moodle.presets()));
  ipcMain.handle('moodle:session', guarded(() => moodle.getSession()));
  ipcMain.handle('moodle:sign-in', guarded((_event, opts) => moodle.signIn(opts || {})));
  ipcMain.handle('moodle:disconnect', guarded(() => moodle.disconnect()));
  ipcMain.handle('moodle:courses', guarded(() => moodle.listCourses()));
  ipcMain.handle('moodle:course-contents', guarded((_event, courseId) => moodle.getCourseContents(courseId)));
  ipcMain.handle('moodle:folder-files', guarded((_event, folderUrl) => moodle.getFolderFiles(String(folderUrl || ''))));
  ipcMain.handle('moodle:download', guarded((_event, url, name) => moodle.downloadFile(String(url || ''), String(name || 'document'))));
  ipcMain.handle('moodle:image', guarded((_event, url) => moodle.fetchImageDataUrl(String(url || ''))));
  ipcMain.handle('moodle:deadlines', guarded((_event, opts) => moodle.getUpcomingDeadlines(opts || {})));
  ipcMain.handle('moodle:grades', guarded((_event, courseId) => moodle.getGrades(courseId)));
  ipcMain.handle('moodle:announcements', guarded((_event, courseId) => moodle.getAnnouncements(courseId)));
  ipcMain.handle('moodle:mcp-config', guarded(() => moodle.getMcpConfig()));
  ipcMain.handle('moodle:open-external', guarded((_event, url) => {
    const raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) throw Error('Invalid Moodle URL.');
    return shell.openExternal(raw);
  }));
  // Apple Notes importer (macOS live NoteStore.sqlite detection + cross-platform NoteStore.sqlite file picker)
  ipcMain.handle('apple-notes:detect-mac', guarded(() => detectMacAppleNotesDb()));
  ipcMain.handle('apple-notes:import-mac', guarded(async () => {
    const det = await detectMacAppleNotesDb();
    if (!det.available) throw Error('Apple Notes database not found on this Mac (check Full Disk Access permissions).');
    return readAppleNotesSqlite(det.path);
  }));
  ipcMain.handle('apple-notes:pick-sqlite', guarded(async (event) => {
    const win = windowOf(event.sender);
    const chosen = await dialog.showOpenDialog(win, {
      title: 'Select Apple Notes NoteStore.sqlite',
      properties: ['openFile'],
      filters: [{ name: 'Apple Notes SQLite (NoteStore.sqlite)', extensions: ['sqlite', 'sqlite3', 'db'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (chosen.canceled || !chosen.filePaths?.[0]) return null;
    return readAppleNotesSqlite(chosen.filePaths[0]);
  }));
  started = true;
  const launchedEuroOffice = process.argv.includes('--euro-office');
  // Back from a restart for an update: the windows and tabs that were open, each opening its
  // document again; files the system handed over join the first window.
  const restored = await takeSession(sessionFile()).catch(() => null);
  const initialFiles = launchQueue.splice(0);
  if (restored) {
    restored.windows.forEach((w, i) => {
      const win = createWindow({ tab: false });
      const ids = w.tabs.map((state) => { openTab(win, null, state); return tabs.list(win.id).at(-1)?.id; });
      if (!ids.length) openTab(win);
      if (i === 0) for (const file of initialFiles) openTab(win, file);
      if (ids[w.active] != null) activate(win, ids[w.active]);
    });
  } else createWindow({ files: initialFiles });
  if (launchedEuroOffice && !initialFiles.length) openEuroOfficeLauncher();
  app.on('activate', () => { if (!windows.size) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
