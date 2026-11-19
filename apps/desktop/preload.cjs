const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notecompleteFiles', {
  folder: () => ipcRenderer.invoke('files:folder'),
  choose: () => ipcRenderer.invoke('files:choose'),
  read: name => ipcRenderer.invoke('files:read', name),
  write: (name, bytes) => ipcRenderer.invoke('files:write', name, bytes),
  remove: name => ipcRenderer.invoke('files:remove', name),
  openFile: () => ipcRenderer.invoke('files:open'),
  // The file the system asked this tab to open (Open with…), or null.
  launched: () => ipcRenderer.invoke('files:launched'),
  readRecent: file => ipcRenderer.invoke('files:read-recent', file),
  readLocalNote: file => ipcRenderer.invoke('files:read-local-note', file),
  statLocalNote: file => ipcRenderer.invoke('files:stat-local-note', file),
  openFolder: () => ipcRenderer.invoke('files:open-folder'),
  listFolder: folder => ipcRenderer.invoke('files:list-folder', folder),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  writeOpened: (file, bytes) => ipcRenderer.invoke('files:write-opened', file, bytes),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke('files:save', defaultName, bytes, filters),
  saveEntry: (name, bytes) => ipcRenderer.invoke('files:save-entry', name, bytes),
  readSibling: (file, relative) => ipcRenderer.invoke('files:read-sibling', file, relative),
  saveCopy: (file, options) => ipcRenderer.invoke('files:save-copy', file, options),
  renderHtmlPdf: html => ipcRenderer.invoke('files:render-html-pdf', html),
  renameOpened: (file, name) => ipcRenderer.invoke('files:rename-opened', file, name),
  trashOpened: (file) => ipcRenderer.invoke('files:trash-opened', file),
  // onCancel(cancel) hands the caller a function that stops the download. A function, not an
  // AbortSignal: only functions and plain values cross from the page to this script.
  downloadUrl: (url, onProgress, onCancel) => {
    const streamId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const listener = (_event, data) => onProgress?.(data.received, data.total);
    ipcRenderer.on(`download:progress:${streamId}`, listener);
    const result = ipcRenderer.invoke('files:download-url', url, streamId).finally(() => {
      ipcRenderer.removeListener(`download:progress:${streamId}`, listener);
    });
    if (typeof onCancel === 'function') onCancel(() => ipcRenderer.send('files:download-cancel', streamId));
    return result;
  },
});
// PlantUML diagrams (.puml…) drawn by the PlantUML installed on this computer (diagrams.js).
contextBridge.exposeInMainWorld('notecompleteDiagrams', {
  plantuml: (text, file) => ipcRenderer.invoke('diagrams:plantuml', text, file),
});
// Copied items as a picture that keeps them (reader png-clip.js): the PNG as it is, chunk and
// all, with the reader's marker text (desktop png-clipboard.js).
contextBridge.exposeInMainWorld('notecompleteClipboard', {
  writePng: (bytes, text) => ipcRenderer.invoke('clipboard:write-png', bytes, text),
});
// Connecting the user's AI tools to the bundled note server (agent-setup.js).
contextBridge.exposeInMainWorld('notecompleteAgents', {
  status: () => ipcRenderer.invoke('agents:status'),
  connect: id => ipcRenderer.invoke('agents:connect', id),
});
contextBridge.exposeInMainWorld('notecompleteWindows', {
  zoom: step => ipcRenderer.invoke('ui:zoom', step),
  open: () => ipcRenderer.invoke('windows:new'),
  list: () => ipcRenderer.invoke('windows:list'),
  focus: id => ipcRenderer.invoke('windows:focus', id),
});
// Tabs in this window: the reader draws the strip and reports its title and
// unsaved state; closing asks the reader first (onCloseRequest).
contextBridge.exposeInMainWorld('notecompleteTabs', {
  list: () => ipcRenderer.invoke('tabs:list'),
  open: () => ipcRenderer.invoke('tabs:new'),
  activate: id => ipcRenderer.invoke('tabs:activate', id),
  close: id => ipcRenderer.invoke('tabs:close', id),
  closeSelf: () => ipcRenderer.invoke('tabs:close-self'),
  move: (id, index) => ipcRenderer.invoke('tabs:move', id, index),
  detach: id => ipcRenderer.invoke('tabs:detach', id),
  update: state => ipcRenderer.invoke('tabs:update', { title: String(state?.title ?? ''), dirty: state?.dirty === true }),
  onList: callback => ipcRenderer.on('tabs:list', (_event, list) => callback(list)),
  onCloseRequest: callback => ipcRenderer.on('tabs:close-request', () => callback()),
});
contextBridge.exposeInMainWorld('notecompleteTranscribe', {
  backends: () => ipcRenderer.invoke('asr:backends'),
  run: (request, onProgress) => {
    const listener = (_event, value) => onProgress?.(value);
    ipcRenderer.on('asr:progress', listener);
    return ipcRenderer.invoke('asr:run', request).finally(() => ipcRenderer.removeListener('asr:progress', listener));
  },
  cancel: () => ipcRenderer.send('asr:cancel'),
});
contextBridge.exposeInMainWorld('notecompleteAI', {
  providers: () => ipcRenderer.invoke('ai:providers'),
  models: (provider, options) => ipcRenderer.invoke('ai:models', provider, { fresh: options?.fresh === true }),
  // onDelta(text) receives the answer while it is written, when the tool streams.
  // onActivity(note) gets what the tool is doing before its answer starts ("Thinking…").
  run: (request, onDelta, onActivity) => {
    if (typeof onDelta !== 'function') return ipcRenderer.invoke('ai:run', request);
    const stream = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const listener = (_event, id, text) => { if (id === stream) onDelta(text); };
    const activity = (_event, id, text) => { if (id === stream && typeof onActivity === 'function') onActivity(text); };
    ipcRenderer.on('ai:delta', listener);
    ipcRenderer.on('ai:activity', activity);
    return ipcRenderer.invoke('ai:run', { ...request, stream }).finally(() => { ipcRenderer.removeListener('ai:delta', listener); ipcRenderer.removeListener('ai:activity', activity); });
  },
  cancel: tag => ipcRenderer.send('ai:cancel', typeof tag === 'string' ? tag : ''),
});
// Help → Keep a diagnostic log, Open the log.
contextBridge.exposeInMainWorld('notecompleteLog', {
  get: () => ipcRenderer.invoke('log:get'),
  set: on => ipcRenderer.invoke('log:set', on === true),
  open: () => ipcRenderer.invoke('log:open'),
});
// After a restart for an update: what this tab showed before it (desktop session.js).
// Settings → Prefab modules: the folder of modules in use (desktop prefab-folder.js).
contextBridge.exposeInMainWorld('notecompletePrefabs', {
  list: () => ipcRenderer.invoke('prefabs:list'),
  copyTo: () => ipcRenderer.invoke('prefabs:copy-to'),
  use: () => ipcRenderer.invoke('prefabs:use'),
  reset: () => ipcRenderer.invoke('prefabs:reset'),
  open: () => ipcRenderer.invoke('prefabs:open'),
});
contextBridge.exposeInMainWorld('notecompleteRestore', {
  take: () => ipcRenderer.invoke('session:take'),
});
contextBridge.exposeInMainWorld('notecompleteUpdates', {
  check: (manual = false) => ipcRenderer.invoke('update:check', manual === true),
  install: onProgress => {
    const listener = (_event, value) => onProgress?.(value);
    ipcRenderer.on('update:progress', listener);
    return ipcRenderer.invoke('update:install').finally(() => ipcRenderer.removeListener('update:progress', listener));
  },
  skip: version => ipcRenderer.invoke('update:skip', version),
  settings: () => ipcRenderer.invoke('update:settings'),
  setCheckOnOpen: on => ipcRenderer.invoke('update:check-on-open', on === true),
  openPage: url => ipcRenderer.invoke('update:page', url),
  restart: () => ipcRenderer.invoke('update:restart'),
});
contextBridge.exposeInMainWorld('notecompleteDrive', {
  signIn: (options = {}) => ipcRenderer.invoke('drive:sign-in', { write: options.write === true, silent: options.silent === true }),
  refresh: (options = {}) => ipcRenderer.invoke('drive:refresh', { write: options.write === true, force: options.force === true }),
  cancel: () => ipcRenderer.send('drive:cancel'),
  // The session shared by every tab: what is signed in now, and changes made in other tabs.
  session: () => ipcRenderer.invoke('drive:session'),
  onSession: callback => { ipcRenderer.on('drive:session', (_event, session) => callback(session)); },
  disconnect: () => ipcRenderer.send('drive:forget'),
});
contextBridge.exposeInMainWorld('notecompleteDropbox', {
  signIn: (options = {}) => ipcRenderer.invoke('dropbox:sign-in', { appKey: typeof options.appKey === 'string' ? options.appKey : '' }),
  refresh: (options = {}) => ipcRenderer.invoke('dropbox:refresh', { force: options.force === true }),
  cancel: () => ipcRenderer.send('dropbox:cancel'),
  // The session shared by every tab: what is signed in now, and changes made in other tabs.
  session: () => ipcRenderer.invoke('dropbox:session'),
  onSession: callback => { ipcRenderer.on('dropbox:session', (_event, session) => callback(session)); },
  disconnect: () => ipcRenderer.send('dropbox:forget'),
});
// Sharing notes and pairing drawing tablets (docs/COLLABORATION.md): the server runs in the
// main process; the reader connects to it as the host.
contextBridge.exposeInMainWorld('notecompleteCollab', {
  start: (options = {}) => ipcRenderer.invoke('collab:start', { notes: ['edit', 'view'].includes(options.notes) ? options.notes : null }),
  stop: () => ipcRenderer.invoke('collab:stop'),
  info: () => ipcRenderer.invoke('collab:info'),
  shareFile: (options = {}) => ipcRenderer.invoke('collab:share-file', { name: String(options.name || 'note.nfedit'), mime: String(options.mime || 'application/octet-stream'), bytes: options.bytes }),
  shareLinks: id => ipcRenderer.invoke('collab:share-links', String(id || '')),
  unshareFile: id => ipcRenderer.invoke('collab:unshare-file', String(id || '')),
  useAddress: address => ipcRenderer.invoke('collab:address', String(address)),
  online: on => ipcRenderer.invoke('collab:online', on === true),
  onOnlineProgress: callback => ipcRenderer.on('collab:online-progress', (_event, p) => callback(Number(p) || 0)),
  onOnlineEnded: callback => ipcRenderer.on('collab:online-ended', () => callback()),
  minimize: () => ipcRenderer.invoke('collab:minimize'),
  onEnded: callback => ipcRenderer.on('collab:ended', (_event, detail) => callback(detail)),
});
