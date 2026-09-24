import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VhostraStore } from './store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
let store: VhostraStore
let primaryWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const applicationIcon = process.platform === 'darwin'
  ? path.join(__dirname, '../build/icon.icns')
  : process.platform === 'win32'
    ? path.join(__dirname, '../build/icon.ico')
    : path.join(__dirname, '../build/icons/512x512.png')
const preloadPath = path.join(__dirname, 'preload.cjs')
const trayIcon = path.join(__dirname, '../build/icons/32x32.png')

type ServiceState = 'unavailable' | 'stopped' | 'running' | 'transitioning'
interface ServiceController { state(): ServiceState; start(): Promise<void>; stop(): Promise<void>; restart(): Promise<void>; subscribe(listener: () => void): () => void }
class UnavailableServiceController implements ServiceController {
  state(): ServiceState { return 'unavailable' }
  async start() { throw new Error('Vhostra service control is unavailable until the Docker runtime layer is implemented.') }
  async stop() { throw new Error('Vhostra service control is unavailable until the Docker runtime layer is implemented.') }
  async restart() { throw new Error('Vhostra service control is unavailable until the Docker runtime layer is implemented.') }
  subscribe() { return () => undefined }
}
const services: ServiceController = new UnavailableServiceController()

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
  window.on('close', event => { if (!isQuitting && tray) { event.preventDefault(); window.hide() } })
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
  return window
}

app.whenReady().then(() => {
  store = new VhostraStore(app.getPath('userData'), path.join(__dirname, '../dist-welcome'))
  registerIpc()
  registerScreenshotProtocol()
  createTray()
  createWindow()
  app.on('activate', () => { void openApplicationWindow() })
})
app.on('before-quit', () => { isQuitting = true })

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
    await openExternal(value)
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

async function openApplicationWindow() { const window = createWindow(); window.show(); window.focus() }
async function openExternal(value: string) { VhostraStore.validateUrl(value); await shell.openExternal(value) }

function createTray() {
  const image = nativeImage.createFromPath(trayIcon)
  tray = new Tray(image)
  tray.setToolTip('Vhostra')
  tray.on('click', () => { void openApplicationWindow() })
  services.subscribe(updateTrayMenu)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  const state = services.state(); const controlsAvailable = state !== 'unavailable' && state !== 'transitioning'
  const action = (operation: 'start' | 'stop' | 'restart') => () => { void services[operation]().catch(error => console.error(`[Vhostra] ${operation} services failed:`, error)).finally(updateTrayMenu); updateTrayMenu() }
  const items: MenuItemConstructorOptions[] = [
    { label: 'Open Vhostra', click: () => { void openApplicationWindow() } },
    { label: 'Open localhost in default browser', click: () => { void openExternal('http://localhost/').catch(error => console.error('[Vhostra] Opening localhost failed:', error)) } },
    { type: 'separator' },
    ...(state === 'unavailable' ? [{ label: 'Service controls unavailable until runtime setup', enabled: false } satisfies MenuItemConstructorOptions] : []),
    { label: 'Start Services', enabled: controlsAvailable && state === 'stopped', click: action('start') },
    { label: 'Stop Services', enabled: controlsAvailable && state === 'running', click: action('stop') },
    { label: 'Restart Services', enabled: controlsAvailable && state === 'running', click: action('restart') },
    { type: 'separator' },
    { label: 'Quit Vhostra', click: () => { isQuitting = true; app.quit() } },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(state === 'unavailable' ? 'Vhostra — runtime controls unavailable' : `Vhostra — services ${state}`)
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
