const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notecompleteFiles', {
  folder: () => ipcRenderer.invoke('files:folder'),
  choose: () => ipcRenderer.invoke('files:choose'),
  read: name => ipcRenderer.invoke('files:read', name),
  write: (name, bytes) => ipcRenderer.invoke('files:write', name, bytes),
  remove: name => ipcRenderer.invoke('files:remove', name),
  openFile: () => ipcRenderer.invoke('files:open'),
  readRecent: file => ipcRenderer.invoke('files:read-recent', file),
});
contextBridge.exposeInMainWorld('notecompleteWindows', {
  open: () => ipcRenderer.invoke('windows:new'),
  list: () => ipcRenderer.invoke('windows:list'),
  focus: id => ipcRenderer.invoke('windows:focus', id),
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
  run: request => ipcRenderer.invoke('ai:run', request),
  cancel: tag => ipcRenderer.send('ai:cancel', typeof tag === 'string' ? tag : ''),
});
contextBridge.exposeInMainWorld('notecompleteDrive', {
  signIn: (options = {}) => ipcRenderer.invoke('drive:sign-in', { write: options.write === true }),
  cancel: () => ipcRenderer.send('drive:cancel'),
});
