import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'

function createWindow() {
  const window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 600, backgroundColor: '#f8f9f6', title: 'AI Learning Companion', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url !== current) event.preventDefault()
  })
  if (app.isPackaged || process.env.NODE_ENV === 'production' || !process.argv.includes('--dev')) window.loadFile(path.join(__dirname, '../dist/index.html'))
  else window.loadURL('http://127.0.0.1:5173')
}
app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
