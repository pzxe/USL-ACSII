const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usl', {
  getMangaImages: () => ipcRenderer.invoke('assets:manga'),
  getFontBase64: () => ipcRenderer.invoke('assets:font-base64'),
  getCliFile: () => ipcRenderer.invoke('app:cli-file'),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  onMangaReady: (cb) => ipcRenderer.on('assets:ready', () => cb()),
  onWindowState: (cb) => ipcRenderer.on('win:state', (_e, maxed) => cb(maxed)),
});
