const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notecompleteFiles', {
  folder: () => ipcRenderer.invoke('files:folder'),
  choose: () => ipcRenderer.invoke('files:choose'),
  read: name => ipcRenderer.invoke('files:read', name),
  write: (name, bytes) => ipcRenderer.invoke('files:write', name, bytes),
  openFile: () => ipcRenderer.invoke('files:open'),
  readRecent: file => ipcRenderer.invoke('files:read-recent', file),
});
contextBridge.exposeInMainWorld('notecompleteDrive', {
  signIn: () => ipcRenderer.invoke('drive:sign-in'),
  cancel: () => ipcRenderer.send('drive:cancel'),
});
