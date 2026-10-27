// Electron shell: windows hold tabs, one sandboxed view per tab, UI served from
// a private protocol. Copy, rename `app://ui/`, add your IPC handlers with guarded().
import { app, BaseWindow, WebContentsView, nativeTheme, net, protocol, ipcMain } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { tabStore } from './tabs.js';

const home = 'app://ui/';
const root = fileURLToPath(new URL('./ui/', import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const tabs = tabStore();
const views = new Map(), windows = new Map();
// Spell check off: users write in several languages; offer it as a setting if needed.
const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)) };
const windowOf = contents => windows.get(tabs.windowOf(contents.id)) ?? null;
// Same colour as the UI's --chrome token, so nothing flashes white.
const backdrop = () => nativeTheme.shouldUseDarkColors ? '#202328' : '#f7f8fa';

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
  if (active) win.setTitle(`${active.title} — App`);
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
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!url.startsWith(home)) event.preventDefault(); });
  // Tab keys; the window is looked up each time because tabs move between windows.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const key = input.key.toLowerCase(), here = windowOf(contents);
    const step = key === 'tab' ? (input.shift ? -1 : 1) : 0;
    if (!here) return;
    if (key === 't' && !input.shift) openTab(here);
    else if (key === 'w' && !input.shift) requestClose(id);
    else if (step) activate(here, tabs.neighbour(here.id, step));
    else return;
    event.preventDefault();
  });
  contents.on('destroyed', () => views.delete(id));
  // Shown once drawn (or after a moment); the previous tab stays up meanwhile.
  view.setVisible(false);
  win.contentView.addChildView(view);
  layout(win);
  let shown = false;
  const show = () => { const here = windowOf(contents); if (shown || !here) return; shown = true; activate(here, id); };
  contents.once('dom-ready', () => setTimeout(show, 30));
  setTimeout(show, 700);
  contents.loadURL(home);
  return id;
}
// The UI confirms unsaved changes itself, then calls tabs:close-self.
function requestClose(id) {
  const win = windows.get(tabs.windowOf(id));
  if (!win) return;
  activate(win, id);
  views.get(id)?.webContents.send('tabs:close-request');
}
function closeTab(id) {
  const view = views.get(id), result = tabs.remove(id);
  if (!view || !result) return;
  const win = windows.get(result.window);
  win?.contentView.removeChildView(view);
  view.webContents.close();
  views.delete(id);
  if (!win) return;
  if (!result.left) { win.closing = true; win.close(); } else activate(win, result.active);
}
// A tab dragged out of its strip: re-parent the view, nothing reloads.
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
function createWindow({ tab = true } = {}) {
  const win = new BaseWindow({ width: 1280, height: 900, minWidth: 360, minHeight: 480, backgroundColor: backdrop(), title: 'App', autoHideMenuBar: true });
  const id = win.id; // win.id throws once the window is destroyed ('closed')
  windows.set(id, win);
  win.on('resize', () => layout(win));
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

// One process per profile (storage locks); launching again opens a window.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => { if (app.isReady()) createWindow(); });

app.whenReady().then(() => {
  if (!primary) return;
  protocol.handle('app', async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 405 });
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root)) return new Response('', { status: 403 });
    try {
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');            // WASM threads
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  // Every handler checks the caller is the app's own main frame.
  const trusted = event => event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith(home);
  const guarded = handler => async (event, ...args) => { if (!trusted(event)) throw Error('Unexpected caller.'); return handler(event, ...args); };
  const sameWindow = (event, id) => tabs.windowOf(id) === tabs.windowOf(event.sender.id);

  ipcMain.handle('windows:new', guarded(() => { createWindow(); }));
  ipcMain.handle('tabs:list', guarded(event => tabs.list(tabs.windowOf(event.sender.id)).map(t => ({ ...t, current: t.id === event.sender.id }))));
  ipcMain.handle('tabs:new', guarded(event => { const win = windowOf(event.sender); if (win) openTab(win); }));
  ipcMain.handle('tabs:activate', guarded((event, id) => { const win = windowOf(event.sender); if (win && sameWindow(event, id)) activate(win, id); }));
  ipcMain.handle('tabs:close', guarded((event, id) => { if (sameWindow(event, id)) requestClose(id); }));
  ipcMain.handle('tabs:close-self', guarded(event => closeTab(event.sender.id)));
  ipcMain.handle('tabs:move', guarded((event, id, index) => { const win = windowOf(event.sender); if (win && sameWindow(event, id) && tabs.move(id, index)) broadcast(win); }));
  ipcMain.handle('tabs:detach', guarded((event, id) => sameWindow(event, id) && detachTab(id)));
  ipcMain.handle('tabs:update', guarded((event, state = {}) => { const win = windowOf(event.sender); if (win && tabs.update(event.sender.id, { title: state.title, dirty: state.dirty })) broadcast(win); }));
  nativeTheme.on('updated', () => {
    for (const win of windows.values()) win.setBackgroundColor(backdrop());
    for (const view of views.values()) view.setBackgroundColor(backdrop());
  });
  createWindow();
  app.on('activate', () => { if (!windows.size) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
