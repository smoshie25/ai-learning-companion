import { app, BrowserWindow, session, dialog, desktopCapturer, safeStorage } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase } from './persistence/database.cjs'
import { WorkspaceRepository } from './persistence/repositories.cjs'
import { loadAIConfig } from './ai/config.cjs'
import { AIService } from './ai/service.cjs'
import { RealtimeService } from './ai/realtime.cjs'
import { registerIPC } from './ipc/register.cjs'
import { IntelligenceRepository } from './persistence/session-repository.cjs'
import { SessionIntelligence } from './ai/session-intelligence.cjs'
import { CredentialStore } from './ai/credentials.cjs'
const development = !app.isPackaged && process.argv.includes('--dev')
const projectRoot = path.join(__dirname, '../..')
const rendererURL = development ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(projectRoot, 'dist/index.html')).href
const requestedUserData = app.commandLine.getSwitchValue('user-data-dir')
if (requestedUserData) app.setPath('userData', path.resolve(requestedUserData))
let window: BrowserWindow | null = null
let closeOwner: ((owner: number) => void) | undefined
let closeServices: (() => void) | undefined
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 600, backgroundColor: '#f8f9f6', title: 'AI Learning Companion', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const owner = window.webContents.id
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== rendererURL) event.preventDefault() })
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) closeOwner?.(owner) })
  window.on('closed', () => { closeOwner?.(owner); window = null })
  void window.loadURL(rendererURL)
}
app.whenReady().then(async () => {
  try {
    const db = openDatabase(path.join(app.getPath('userData'), 'companion.sqlite'))
    const repository = new WorkspaceRepository(db)
    const credentials = new CredentialStore(path.join(app.getPath('userData'), 'openai-key.enc'), {
      available: async () => await safeStorage.isAsyncEncryptionAvailable() && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())),
      encrypt: key => safeStorage.encryptStringAsync(key), decrypt: bytes => safeStorage.decryptStringAsync(bytes),
    })
    await credentials.load()
    const config = loadAIConfig(projectRoot, development); config.apiKey = credentials.getKey()
    const ai = new AIService(config, repository, undefined, credentials)
    const realtime = new RealtimeService(ai, repository.usage)
    const intelligence = new SessionIntelligence(new IntelligenceRepository(db), ai, repository.usage)
    closeOwner = registerIPC(() => window, rendererURL, repository, ai, realtime, intelligence)
    closeServices = () => { intelligence.closeAll(); realtime.closeAll(); db.close() }
    const trusted = (contents: Electron.WebContents | null) => !!contents && contents === window?.webContents && contents.mainFrame.url.split('#')[0] === rendererURL
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(trusted(contents) && permission === 'media' && details.isMainFrame && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && intelligence.canCapture(contents.id)))
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => trusted(contents) && details.isMainFrame && permission === 'media' && details.mediaType === 'audio' && intelligence.canCapture(contents!.id))
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      const target = window
      if (process.platform !== 'win32' || !target || request.frame !== target.webContents.mainFrame || !trusted(target.webContents) || !request.audioRequested || !intelligence.canCapture(target.webContents.id, true)) { callback({}); return }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        const choice = await dialog.showMessageBox(target, { type: 'question', title: 'Allow system audio capture?', message: 'Capture audio playing on this computer?', detail: 'All system audio may include other applications and participants. Confirm everyone has consented. Audio is sent to OpenAI; screen pixels are not recorded or transmitted.', buttons: ['Cancel', ...sources.map(source => `Allow · ${source.name}`)], defaultId: 0, cancelId: 0 })
        if (choice.response === 0 || !sources[choice.response - 1] || target.isDestroyed() || !intelligence.canCapture(target.webContents.id, true)) { callback({}); return }
        callback({ video: sources[choice.response - 1], audio: 'loopback' })
      } catch { callback({}) }
    })
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [development ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'" : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'"] } }))
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  } catch { dialog.showErrorBox('Companion could not start', 'Local data or AI configuration could not be initialized. Check the configuration and database permissions.'); app.quit() }
})
app.on('before-quit', () => { closeServices?.(); closeServices = undefined })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
