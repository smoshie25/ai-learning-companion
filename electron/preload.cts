import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionBridge } from '../shared/contracts.cjs'
// Type imports are erased: the sandboxed preload requires only Electron.
const bridge: CompanionBridge = {
  actions: {
    list: () => ipcRenderer.invoke('actions:list',null), propose: input => ipcRenderer.invoke('actions:propose',input), edit: input => ipcRenderer.invoke('actions:edit',input), approve: input => ipcRenderer.invoke('actions:approve',input), reject: input => ipcRenderer.invoke('actions:reject',input), execute: input => ipcRenderer.invoke('actions:execute',input), completeTask: input => ipcRenderer.invoke('actions:complete-task',input),
    cancelGoogleConnect: () => ipcRenderer.invoke('google:cancel-connect',null),
    integrations: () => ipcRenderer.invoke('google:status',null), saveGoogleClient: input => ipcRenderer.invoke('google:save-client',input), connectGoogle: input => ipcRenderer.invoke('google:connect',input), disconnectGoogle: input => ipcRenderer.invoke('google:disconnect',input),
  },
  learning: {
    load: () => ipcRenderer.invoke('learning:load',null), analyzeGaps: () => ipcRenderer.invoke('learning:analyze-gaps',null), discover: input => ipcRenderer.invoke('learning:discover',input),
    saveResource: input => ipcRenderer.invoke('learning:save-resource',input), verifyResource: input => ipcRenderer.invoke('learning:verify-resource',input), openResource: input => ipcRenderer.invoke('learning:open-resource',input),
    propose: input => ipcRenderer.invoke('learning:propose',input), planAction: input => ipcRenderer.invoke('learning:plan-action',input), editTask: input => ipcRenderer.invoke('learning:edit-task',input), taskAction: input => ipcRenderer.invoke('learning:task-action',input), assess: input => ipcRenderer.invoke('learning:assess',input),
  },
  interviews: {
    start: input => ipcRenderer.invoke('interviews:start', input), get: input => ipcRenderer.invoke('interviews:get', input), list: () => ipcRenderer.invoke('interviews:list', null),
    answer: input => ipcRenderer.invoke('interviews:answer', input), connect: input => ipcRenderer.invoke('interviews:connect', input), audio: input => ipcRenderer.invoke('interviews:audio', input), poll: input => ipcRenderer.invoke('interviews:poll', input),
    pause: input => ipcRenderer.invoke('interviews:pause', input), resume: input => ipcRenderer.invoke('interviews:resume', input), end: input => ipcRenderer.invoke('interviews:end', input), evaluate: input => ipcRenderer.invoke('interviews:evaluate', input),
  },
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
    saveKey: input => ipcRenderer.invoke('ai:save-key', input), removeKey: () => ipcRenderer.invoke('ai:remove-key', null),
    status: () => ipcRenderer.invoke('ai:status', null), validate: () => ipcRenderer.invoke('ai:validate', null),
    tutor: input => ipcRenderer.invoke('ai:tutor', input), summarize: input => ipcRenderer.invoke('ai:summarize', input), interview: input => ipcRenderer.invoke('ai:interview', input),
    realtimeConnect: input => ipcRenderer.invoke('ai:realtime-connect', input), realtimeSend: input => ipcRenderer.invoke('ai:realtime-send', input), realtimeClose: input => ipcRenderer.invoke('ai:realtime-close', input),
  },
}
contextBridge.exposeInMainWorld('companion', bridge)
