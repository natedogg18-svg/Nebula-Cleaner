const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nebula', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  scanDuplicates: (dir) => ipcRenderer.invoke('scan-duplicates', dir),
  scanLargeFiles: (dir, minSizeMB) => ipcRenderer.invoke('scan-large-files', dir, minSizeMB),
  scanJunk: (dir) => ipcRenderer.invoke('scan-junk', dir),
  moveToBin: (paths) => ipcRenderer.invoke('move-to-bin', paths),
  getBin: () => ipcRenderer.invoke('get-bin'),
  restoreFromBin: (id) => ipcRenderer.invoke('restore-from-bin', id),
  deleteFromBin: (ids) => ipcRenderer.invoke('delete-from-bin', ids),
  getDiskInfo: () => ipcRenderer.invoke('get-disk-info'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
});
