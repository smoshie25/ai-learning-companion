import { app, BrowserWindow, session, dialog } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase } from './persistence/database.cjs'
import { WorkspaceRepository } from './persistence/repositories.cjs'
import { loadAIConfig } from './ai/config.cjs'
import { AIService } from './ai/service.cjs'
import { RealtimeService } from './ai/realtime.cjs'
import { registerIPC } from './ipc/register.cjs'
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
app.whenReady().then(() => {
  try {
    const db = openDatabase(path.join(app.getPath('userData'), 'companion.sqlite'))
    const repository = new WorkspaceRepository(db)
    const ai = new AIService(loadAIConfig(projectRoot, development), repository)
    const realtime = new RealtimeService(ai, repository.usage)
    closeOwner = registerIPC(() => window, rendererURL, repository, ai, realtime)
    closeServices = () => { realtime.closeAll(); db.close() }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [development ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'" : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'"] } }))
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  } catch { dialog.showErrorBox('Companion could not start', 'Local data or AI configuration could not be initialized. Check the configuration and database permissions.'); app.quit() }
})
app.on('before-quit', () => { closeServices?.(); closeServices = undefined })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
