import { app, BrowserWindow, dialog, net, protocol, session, ipcMain, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopCredentials, desktopSignIn } from './google-auth.js';
import { assetPath } from './asset-path.js';
import { libraryFiles } from './library-files.js';

const home = 'notecomplete://reader/';
const root = fileURLToPath(new URL('./reader/', import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'notecomplete', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 900, minWidth: 360, minHeight: 480,
    // The reader draws its own File/Edit/View menubar; Alt still reveals the native one and its accelerators keep working.
    title: 'NoteComplete', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)) } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(home)) event.preventDefault(); });
  win.loadURL(home).catch(error => dialog.showErrorBox('Could not open NoteComplete', error.message));
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
    const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Keep downloaded notes in…', defaultPath: await files.folder(), properties: ['openDirectory', 'createDirectory'] });
    return chosen.canceled ? null : files.setFolder(chosen.filePaths[0]);
  }));
  ipcMain.handle('files:read', guarded((_event, name) => files.read(name)));
  ipcMain.handle('files:write', guarded((_event, name, bytes) => files.write(name, bytes)));
  ipcMain.handle('files:open', guarded(async event => {
    const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Open a note', properties: ['openFile'], filters: [{ name: 'Notes, PDFs and images', extensions: ['noteful', 'nfedit', 'pdf', 'png', 'jpg', 'jpeg', 'webp'] }] });
    if (chosen.canceled) return null;
    const file = chosen.filePaths[0];
    await files.remember(file);
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await readFile(file)) };
  }));
  ipcMain.handle('files:read-recent', guarded((_event, file) => files.readRecent(file)));
  ipcMain.on('drive:cancel', event => { if (trusted(event)) pendingAuth.get(event.sender.id)?.abort(); });
  ipcMain.handle('drive:sign-in', async event => {
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
        const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender), { title: 'Choose Google Desktop OAuth client JSON', filters: [{ name: 'Google OAuth client', extensions: ['json'] }], properties: ['openFile'] });
        if (chosen.canceled) throw Error('Google sign-in cancelled.');
        const value = JSON.parse(await readFile(chosen.filePaths[0], 'utf8'));
        config = desktopCredentials(value);
        await writeFile(saved, JSON.stringify({ installed: { client_id: config.clientId, client_secret: config.clientSecret } }), { mode: 0o600 });
      }
      return await desktopSignIn({ credentials: config, signal: abort.signal, openExternal: url => shell.openExternal(url) });
    } finally { pendingAuth.delete(sender.id); sender.removeListener('destroyed', cancelled); }
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
