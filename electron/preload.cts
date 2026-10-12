import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionBridge } from '../shared/contracts.cjs'
// Type imports are erased: the sandboxed preload requires only Electron.
const bridge: CompanionBridge = {
  intelligence: {
    capabilities: () => ipcRenderer.invoke('intelligence:capabilities', null),
    start: input => ipcRenderer.invoke('intelligence:start', input), get: input => ipcRenderer.invoke('intelligence:get', input), search: input => ipcRenderer.invoke('intelligence:search', input),
    connect: input => ipcRenderer.invoke('intelligence:connect', input), audio: input => ipcRenderer.invoke('intelligence:audio', input),
    pause: input => ipcRenderer.invoke('intelligence:pause', input), resume: input => ipcRenderer.invoke('intelligence:resume', input), end: input => ipcRenderer.invoke('intelligence:end', input), interrupt: input => ipcRenderer.invoke('intelligence:interrupt', input),
    note: input => ipcRenderer.invoke('intelligence:note', input), pin: input => ipcRenderer.invoke('intelligence:pin', input), summarize: input => ipcRenderer.invoke('intelligence:summarize', input),
  },
  getVersion: () => ipcRenderer.invoke('app:version'),
  workspace: { bootstrap: seed => ipcRenderer.invoke('workspace:bootstrap', seed), update: update => ipcRenderer.invoke('workspace:update', update) },
  ai: {
    status: () => ipcRenderer.invoke('ai:status', null), validate: () => ipcRenderer.invoke('ai:validate', null),
    tutor: input => ipcRenderer.invoke('ai:tutor', input), summarize: input => ipcRenderer.invoke('ai:summarize', input), interview: input => ipcRenderer.invoke('ai:interview', input),
    realtimeConnect: input => ipcRenderer.invoke('ai:realtime-connect', input), realtimeSend: input => ipcRenderer.invoke('ai:realtime-send', input), realtimeClose: input => ipcRenderer.invoke('ai:realtime-close', input),
  },
}
contextBridge.exposeInMainWorld('companion', bridge)
