import { createConnection } from 'node:net'
import { createActionRuntime } from './actions/runtime.cjs'
import { createLearningMCP } from './mcp/server.cjs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { LearningService } from './ai/learning-service.cjs'
import { LearningRepository } from './persistence/learning-repository.cjs'
import { InterviewRepository } from './persistence/interview-repository.cjs'
import { InterviewService } from './ai/interview-service.cjs'
import { app, BrowserWindow, session, dialog, desktopCapturer, safeStorage, shell } from 'electron'
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
const mcpMode = process.argv.includes('--mcp')
if(mcpMode) app.disableHardwareAcceleration()
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
    const encryption = {
      available: async () => await safeStorage.isAsyncEncryptionAvailable() && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())),
      encrypt: (key: string) => safeStorage.encryptStringAsync(key), decrypt: (bytes: Buffer) => safeStorage.decryptStringAsync(bytes),
    }
    const actions = createActionRuntime(db, app.getPath('userData'), encryption, url => shell.openExternal(url))
    const credentials = new CredentialStore(path.join(app.getPath('userData'), 'openai-key.enc'), encryption)
    await credentials.load()
    const config = loadAIConfig(projectRoot, development); config.apiKey = credentials.getKey()
    const ai = new AIService(config, repository, undefined, credentials)
    if(mcpMode) {
      process.stderr.write('Companion MCP profile initialized.\n')
      if(!repository.isInitialized()) { process.stderr.write('Open the desktop app once with this profile before starting its MCP server.\n'); db.close(); app.exit(1); return }
      const recordings = new IntelligenceRepository(db); const interviewData = new InterviewRepository(db); const library = new LearningRepository(db)
      const learning = new LearningService(library, repository, recordings, interviewData, ai)
      const server = createLearningMCP(actions.engine, repository, recordings, interviewData, library, query => learning.discover({goal:'Free courses, scholarships, certifications, and learning opportunities: '+query,gapIds:[],textOnly:true}))
      const pipe = app.commandLine.getSwitchValue('mcp-transport'); const nonce = process.env.COMPANION_MCP_NONCE; delete process.env.COMPANION_MCP_NONCE
      if(!pipe || !nonce || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error('Use the direct MCP launcher.')
      const stream = createConnection({path:pipe})
      await new Promise<void>((resolve,reject)=>{stream.once('connect',()=>resolve());stream.once('error',reject)})
      stream.write(nonce+'\n')
      const transport = new StdioServerTransport(stream,stream,{maxBufferSize:256*1024}); closeServices = () => { stream.destroy(); db.close() }
      await server.connect(transport)
      process.stderr.write('Companion MCP stdio transport ready.\n')
      stream.on('end',()=>{void server.close().finally(()=>app.quit())})
      stream.on('error',()=>app.quit())
      const onClose = transport.onclose; transport.onclose = () => { onClose?.(); app.quit() }
      return
    }
    const realtime = new RealtimeService(ai, repository.usage)
    const intelligence = new SessionIntelligence(new IntelligenceRepository(db), ai, repository.usage)
    const interviews = new InterviewService(new InterviewRepository(db), ai, repository.usage)
    const learning = new LearningService(new LearningRepository(db), repository, intelligence.repository, interviews.repository, ai, undefined, url => shell.openExternal(url))
    closeOwner = registerIPC(() => window, rendererURL, repository, ai, realtime, intelligence, interviews, learning, actions)
    closeServices = () => { intelligence.closeAll(); interviews.closeAll(); realtime.closeAll(); db.close() }
    const trusted = (contents: Electron.WebContents | null) => !!contents && contents === window?.webContents && contents.mainFrame.url.split('#')[0] === rendererURL
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(trusted(contents) && permission === 'media' && details.isMainFrame && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && (intelligence.canCapture(contents.id) || interviews.canCapture(contents.id))))
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => trusted(contents) && details.isMainFrame && permission === 'media' && details.mediaType === 'audio' && (intelligence.canCapture(contents!.id) || interviews.canCapture(contents!.id)))
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
  } catch { if(mcpMode) { process.stderr.write('The Companion MCP runtime could not initialize its local profile or secure storage.\n'); app.exit(1); return } dialog.showErrorBox('Companion could not start', 'Local data or AI configuration could not be initialized. Check the configuration and database permissions.'); app.quit() }
})
app.on('before-quit', () => { closeServices?.(); closeServices = undefined })
app.on('window-all-closed', () => { if (!mcpMode && process.platform !== 'darwin') app.quit() })
