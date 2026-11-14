import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('strenxDesktop', {
  getAppInfo: () => ipcRenderer.invoke('strenx:get-app-info'),
  openDataFolder: () => ipcRenderer.invoke('strenx:open-data-folder'),
});
