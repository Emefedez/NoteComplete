const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notecompleteFiles', {
  folder: () => ipcRenderer.invoke('files:folder'),
  choose: () => ipcRenderer.invoke('files:choose'),
  read: name => ipcRenderer.invoke('files:read', name),
  write: (name, bytes) => ipcRenderer.invoke('files:write', name, bytes),
  openFile: () => ipcRenderer.invoke('files:open'),
  readRecent: file => ipcRenderer.invoke('files:read-recent', file),
});
contextBridge.exposeInMainWorld('notecompleteWindows', {
  open: () => ipcRenderer.invoke('windows:new'),
  list: () => ipcRenderer.invoke('windows:list'),
  focus: id => ipcRenderer.invoke('windows:focus', id),
});
contextBridge.exposeInMainWorld('notecompleteAI', {
  providers: () => ipcRenderer.invoke('ai:providers'),
  run: request => ipcRenderer.invoke('ai:run', request),
  cancel: () => ipcRenderer.send('ai:cancel'),
});
contextBridge.exposeInMainWorld('notecompleteDrive', {
  signIn: () => ipcRenderer.invoke('drive:sign-in'),
  cancel: () => ipcRenderer.send('drive:cancel'),
});
