import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preload = path.join(root, 'dist-electron', 'preload.cjs')

if (!existsSync(preload)) throw new Error(`Compiled preload is missing: ${preload}`)

app.whenReady().then(async () => {
  ipcMain.handle('vhostra:get-state', () => ({ settings: { selectedWebServer: 'nginx' } }))
  const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  try {
    await window.loadURL('data:text/html,<title>Vhostra bridge test</title>')
    const bridgeIsAvailable = await window.webContents.executeJavaScript(`window.vhostra?.getState().then(state => state.settings.selectedWebServer === 'nginx' && typeof window.vhostra.openSite === 'function')`)
    if (!bridgeIsAvailable) throw new Error('window.vhostra was not exposed by the preload script.')
    console.log('Vhostra preload bridge verified.')
  } finally {
    ipcMain.removeHandler('vhostra:get-state')
    window.destroy()
    app.quit()
  }
}).catch(error => { console.error(error); app.exit(1) })
