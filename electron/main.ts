import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VhostraStore } from './store.js'
import { DockerRuntimeController, type RuntimeState } from './runtime.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
let store: VhostraStore
let services: DockerRuntimeController
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
  const devServer = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:9000'
  const renderer = app.isPackaged
    ? pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()
    : devServer
  window.loadURL(renderer)
  return window
}

app.whenReady().then(() => {
  store = new VhostraStore(app.getPath('userData'), path.join(__dirname, '../dist-welcome'))
  services = new DockerRuntimeController(store.layout, () => store.getState(), message => store.updateLocalhostWelcome(message))
  services.subscribe(() => { primaryWindow?.webContents.send('vhostra:runtime-status', services.current()) })
  registerIpc()
  registerScreenshotProtocol()
  createTray()
  createWindow()
  void services.refresh()
  app.on('activate', () => { void openApplicationWindow() })
})
app.on('before-quit', () => { isQuitting = true })

function registerIpc() {
  ipcMain.handle('vhostra:get-state', () => store.getState())
  ipcMain.handle('vhostra:save-settings', async (_event, settings) => { const result = await store.saveSettings(settings); await services.applyConfiguration(); return result })
  ipcMain.handle('vhostra:add-site', async (_event, input) => { const result = await store.addSite(input); await services.applyConfiguration(); return result })
  ipcMain.handle('vhostra:update-site', async (_event, input) => { const result = await store.updateSite(input); await services.applyConfiguration(); return result })
  ipcMain.handle('vhostra:remove-site', async (_event, id: string) => { const result = await store.removeSite(id); await services.applyConfiguration(); return result })
  ipcMain.handle('vhostra:set-vhost-rewrite', async (_event, id: string, enabled: boolean) => { const result = await store.setVirtualHostRewrite(id, enabled); await services.setOpenLiteSpeedRewrite(enabled); return result })
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
  ipcMain.handle('vhostra:get-runtime-status', () => services.current())
  ipcMain.handle('vhostra:start-services', () => services.start())
  ipcMain.handle('vhostra:stop-services', () => services.stop())
  ipcMain.handle('vhostra:restart-services', () => services.restart())
  ipcMain.handle('vhostra:check-port', (_event, port: number) => services.checkPort(port))
  ipcMain.handle('vhostra:find-available-port', (_event, port: number) => services.findAvailablePort(port))
  ipcMain.handle('vhostra:reload-web-server', () => services.reloadWebServer())
  ipcMain.handle('vhostra:list-databases', () => services.listDatabases())
  ipcMain.handle('vhostra:create-database', (_event, input) => services.createDatabase(input))
  ipcMain.handle('vhostra:open-phpmyadmin', async (_event, database?: string) => { await openExternal(await services.phpMyAdminUrl(database)) })
  ipcMain.handle('vhostra:import-database', async (_event, database: string) => {
    const result = await dialog.showOpenDialog({ title: `Import into ${database}`, properties: ['openFile'], filters: [{ name: 'SQL database dump', extensions: ['sql'] }] })
    return result.canceled || !result.filePaths[0] ? null : services.importDatabase(database, result.filePaths[0])
  })
  ipcMain.handle('vhostra:export-database', async (_event, database: string) => {
    const result = await dialog.showSaveDialog({ title: `Export ${database}`, defaultPath: `${database}.sql`, filters: [{ name: 'SQL database dump', extensions: ['sql'] }] })
    return result.canceled || !result.filePath ? null : services.exportDatabase(database, result.filePath)
  })
  ipcMain.handle('vhostra:repair-database', (_event, database: string) => services.repairDatabase(database))
  ipcMain.handle('vhostra:delete-database', (_event, database: string) => services.deleteDatabase(database))
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
  const status = services.current(); const state = trayState(status.state); const controlsAvailable = !['unavailable', 'starting', 'stopping'].includes(status.state)
  const action = (operation: 'start' | 'stop' | 'restart') => () => { void services[operation]().catch(error => console.error(`[Vhostra] ${operation} services failed:`, error)).finally(updateTrayMenu); updateTrayMenu() }
  const items: MenuItemConstructorOptions[] = [
    { label: 'Open Vhostra', click: () => { void openApplicationWindow() } },
    { label: 'Open localhost in default browser', click: () => { void store.getLocalhostUrl().then(openExternal).catch(error => console.error('[Vhostra] Opening localhost failed:', error)) } },
    { type: 'separator' },
    ...(state === 'unavailable' ? [{ label: status.message, enabled: false } satisfies MenuItemConstructorOptions] : []),
    { label: 'Start Services', enabled: controlsAvailable && (state === 'stopped' || state === 'not-created' || state === 'error'), click: action('start') },
    { label: 'Stop Services', enabled: controlsAvailable && state === 'running', click: action('stop') },
    { label: 'Restart Services', enabled: controlsAvailable && state === 'running', click: action('restart') },
    { type: 'separator' },
    { label: 'Quit Vhostra', click: () => { isQuitting = true; app.quit() } },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(state === 'unavailable' ? 'Vhostra — Docker unavailable' : `Vhostra — services ${state}`)
}

function trayState(state: RuntimeState): RuntimeState { return state }

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
