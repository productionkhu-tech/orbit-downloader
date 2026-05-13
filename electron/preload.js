const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (partial) => ipcRenderer.invoke('set-config', partial),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  showFile: (filePath) => ipcRenderer.invoke('show-file', filePath),
  checkYtdlp: () => ipcRenderer.invoke('check-ytdlp'),
  startDownload: (params) => ipcRenderer.send('start-download', params),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  onDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.on('download-progress', (_event, data) => callback(data));
  },
  onDownloadComplete: (callback) => {
    ipcRenderer.removeAllListeners('download-complete');
    ipcRenderer.on('download-complete', (_event, data) => callback(data));
  },
  onUpdateReady: (callback) => {
    ipcRenderer.removeAllListeners('update-ready');
    ipcRenderer.on('update-ready', (_event, data) => callback(data));
  },
  restartForUpdate: () => ipcRenderer.invoke('restart-for-update'),
});
