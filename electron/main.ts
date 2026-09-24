import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VhostraStore } from './store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
let store: VhostraStore
let primaryWindow: BrowserWindow | null = null
const applicationIcon = process.platform === 'darwin'
  ? path.join(__dirname, '../build/icon.icns')
  : process.platform === 'win32'
    ? path.join(__dirname, '../build/icon.ico')
    : path.join(__dirname, '../build/icons/512x512.png')
const preloadPath = path.join(__dirname, 'preload.cjs')

const createWindow = () => {
  if (primaryWindow && !primaryWindow.isDestroyed()) { primaryWindow.focus(); return primaryWindow }
  if (!existsSync(preloadPath)) console.error(`[Vhostra] Preload script is missing: ${preloadPath}. Run the Electron build before starting the app.`)
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    title: 'Vhostra',
    icon: applicationIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      preload: preloadPath,
    },
  })
  primaryWindow = window
  window.on('closed', () => { primaryWindow = null })
  window.webContents.on('preload-error', (_event, failedPath, error) => console.error(`[Vhostra] Failed to load preload script at ${failedPath}:`, error))
  window.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    if (message.includes('[Vhostra preload]')) console.error(`[Vhostra] Preload diagnostic (${sourceId}:${line}): ${message}`)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { VhostraStore.validateUrl(url); void shell.openExternal(url) } catch { /* deny untrusted/non-web URLs */ }
    return { action: 'deny' }
  })
  const devServer = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
  const renderer = app.isPackaged
    ? pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()
    : devServer
  window.loadURL(renderer)
}

app.whenReady().then(() => {
  store = new VhostraStore(app.getPath('userData'))
  registerIpc()
  registerScreenshotProtocol()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function registerIpc() {
  ipcMain.handle('vhostra:get-state', () => store.getState())
  ipcMain.handle('vhostra:save-settings', (_event, settings) => store.saveSettings(settings))
  ipcMain.handle('vhostra:add-site', (_event, input) => store.addSite(input))
  ipcMain.handle('vhostra:update-site', (_event, input) => store.updateSite(input))
  ipcMain.handle('vhostra:remove-site', (_event, id: string) => store.removeSite(id))
  ipcMain.handle('vhostra:choose-document-root', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('vhostra:open-site', async (_event, value: string) => {
    VhostraStore.validateUrl(value)
    await shell.openExternal(value)
  })
  ipcMain.handle('vhostra:get-storage-layout', () => {
    const layout = store.layout
    return {
      root: layout.root, settings: layout.settings, sites: layout.sites, virtualHosts: layout.virtualHosts,
      sourceConfiguration: layout.configuration.source, customConfiguration: layout.configuration.custom, importedConfiguration: layout.configuration.imported, generatedConfiguration: layout.configuration.generated,
      runtime: layout.runtime, certificates: layout.certificates, persistentData: layout.persistentData, logs: layout.logs, backups: layout.backups, exports: layout.exports,
    }
  })
  ipcMain.handle('vhostra:export-configuration', async () => {
    const result = await dialog.showSaveDialog({ title: 'Export Vhostra configuration', defaultPath: path.join(store.layout.exports, 'vhostra-configuration.json'), filters: [{ name: 'Vhostra configuration', extensions: ['json'] }] })
    return result.canceled || !result.filePath ? null : { path: await store.exportBundle(result.filePath) }
  })
  ipcMain.handle('vhostra:preview-configuration-import', async () => {
    const result = await dialog.showOpenDialog({ title: 'Preview Vhostra configuration import', properties: ['openFile'], filters: [{ name: 'Vhostra configuration', extensions: ['json'] }] })
    return result.canceled || !result.filePaths[0] ? null : store.previewBundle(result.filePaths[0])
  })
}

function registerScreenshotProtocol() {
  protocol.handle('vhostra-screenshot', async request => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'site') return new Response('Not found', { status: 404 })
      const image = await store.readScreenshot(url.pathname.slice(1))
      return image ? new Response(image.data, { headers: { 'content-type': image.mime, 'cache-control': 'private, max-age=3600' } }) : new Response('Not found', { status: 404 })
    } catch { return new Response('Not found', { status: 404 }) }
  })
}
