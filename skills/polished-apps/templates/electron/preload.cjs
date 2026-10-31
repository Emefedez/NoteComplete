// One narrow bridge per concern. The UI feature-detects these (window.appTabs etc.).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appWindows', {
  open: () => ipcRenderer.invoke('windows:new'),
});
contextBridge.exposeInMainWorld('appTabs', {
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
// AI through the user's own CLI tools (see references/ai.md). Streams with a per-request id.
contextBridge.exposeInMainWorld('appAI', {
  providers: () => ipcRenderer.invoke('ai:providers'),
  run: (request, onDelta) => {
    if (typeof onDelta !== 'function') return ipcRenderer.invoke('ai:run', request);
    const stream = Math.random().toString(36).slice(2);
    const listener = (_event, id, text) => { if (id === stream) onDelta(text); };
    ipcRenderer.on('ai:delta', listener);
    return ipcRenderer.invoke('ai:run', { ...request, stream }).finally(() => ipcRenderer.removeListener('ai:delta', listener));
  },
  cancel: tag => ipcRenderer.send('ai:cancel', typeof tag === 'string' ? tag : ''),
});
