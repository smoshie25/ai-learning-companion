import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('companion', { getVersion: (): Promise<string> => ipcRenderer.invoke('app:version') })
