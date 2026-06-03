const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  getConfig:  ()     => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
  testApiKey: (key)  => ipcRenderer.invoke('test-api-key', key),
  pickFile:   ()     => ipcRenderer.invoke('pick-file'),
  close:      ()     => ipcRenderer.send('close-settings'),
});
