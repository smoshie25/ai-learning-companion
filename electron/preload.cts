import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionBridge } from '../shared/contracts.cjs'
// Type imports are erased: the sandboxed preload requires only Electron.
const bridge: CompanionBridge = {
  getVersion: () => ipcRenderer.invoke('app:version'),
  workspace: { bootstrap: seed => ipcRenderer.invoke('workspace:bootstrap', seed), update: update => ipcRenderer.invoke('workspace:update', update) },
  ai: {
    status: () => ipcRenderer.invoke('ai:status', null), validate: () => ipcRenderer.invoke('ai:validate', null),
    tutor: input => ipcRenderer.invoke('ai:tutor', input), summarize: input => ipcRenderer.invoke('ai:summarize', input), interview: input => ipcRenderer.invoke('ai:interview', input),
    realtimeConnect: input => ipcRenderer.invoke('ai:realtime-connect', input), realtimeSend: input => ipcRenderer.invoke('ai:realtime-send', input), realtimeClose: input => ipcRenderer.invoke('ai:realtime-close', input),
  },
}
contextBridge.exposeInMainWorld('companion', bridge)
