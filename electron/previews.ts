import { BrowserWindow, session, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import type { VhostraStore } from './store.js'

/** One local Chromium capture at a time; no persistent browser/profile/timer. */
export class SitePreviews {
  private pending = new Map<string, Promise<{ captured: boolean; message: string }>>()
  private attempted = new Map<string, number>()
  private queue: Promise<unknown> = Promise.resolve()
  private browserSession?: Session
  constructor(private store: VhostraStore) {}
  capture(id: string, force = false) {
    if (this.pending.has(id)) return this.pending.get(id)!
    if (this.pending.size >= 6) return Promise.resolve({ captured: false, message: 'Preview queue is busy. Refresh this preview later.' })
    const task = this.queue.then(() => this.captureOne(id, force)).finally(() => this.pending.delete(id))
    this.pending.set(id, task); this.queue = task.catch(() => undefined)
    return task
  }
  private async captureOne(id: string, force: boolean) {
    const state = await this.store.getState(); const site = state.sites.find(site => site.id === id)
    if (!site) throw new Error('Choose an existing local Site.')
    const recent = this.attempted.get(id) ?? 0
    if (!force && Date.now() - recent < 600000) return { captured: false, message: 'Preview capture was already attempted recently.' }
    if (!force && site.screenshot && Date.now() - Date.parse(site.screenshot.capturedAt) < 86400000 && await this.store.readScreenshot(id)) return { captured: false, message: 'Using the cached local preview.' }
    this.attempted.set(id, Date.now())
    // Bound failure metadata independently of the number of historical sites.
    if (this.attempted.size > 500) this.attempted.delete(this.attempted.keys().next().value!)
    const url = new URL(site.url)
    const host = state.virtualHosts.find(host => host.id === site.vhostId)
    const allowedNames = new Set(['127.0.0.1', 'localhost', ...(host ? [host.hostname, ...host.aliases] : [])])
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    if (!host || !allowedNames.has(url.hostname) || ![state.settings.ports.http, state.settings.ports.https].includes(port) || url.username || url.password) return { captured: false, message: 'Preview requires the configured local Site URL.' }
    if (!this.browserSession) {
      this.browserSession = session.fromPartition(`vhostra-preview-${randomUUID()}`)
      this.browserSession.on('will-download', event => event.preventDefault())
    }
    const browserSession = this.browserSession
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    // These windows must never send Site URLs/content to a remote service.
    // Route allowed virtual hosts through loopback, independently of DNS/Hosts.
    await browserSession.setProxy({ mode: 'direct' })
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      try {
        const request = new URL(details.url)
        const local = ['http:', 'https:'].includes(request.protocol) && allowedNames.has(request.hostname) && Number(request.port || (request.protocol === 'https:' ? 443 : 80)) === port
        if (local && request.hostname !== '127.0.0.1') { request.hostname = '127.0.0.1'; callback({ redirectURL: request.toString() }); return }
        callback({ cancel: !local && !['data:', 'blob:'].includes(request.protocol) })
      } catch { callback({ cancel: true }) }
    })
    // Requests use loopback transport and the canonical Host for routing. This
    // also handles an imported Site whose Hosts entry still awaits Repair.
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Host: url.host } }))
    browserSession.webRequest.onHeadersReceived((details, callback) => callback({ cancel: details.resourceType === 'mainFrame' && details.statusCode >= 400 }))
    const window = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, destination) => { const target = new URL(destination); if (!allowedNames.has(target.hostname)) event.preventDefault() })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const local = new URL(site.url); local.hostname = '127.0.0.1'
      await Promise.race([
        (async () => {
          await window.loadURL(local.toString())
          await new Promise(resolve => setTimeout(resolve, 500))
          const image = await window.webContents.capturePage()
          if (image.isEmpty()) throw new Error('No rendered Site viewport.')
          await this.store.saveScreenshot(id, site.url, image.resize({ width: 960 }).toJPEG(75), force ? 'manual' : 'automatic', { documentRoot: site.documentRoot, updatedAt: site.updatedAt })
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Local preview timed out.')), 12000) }),
      ])
      return { captured: true, message: 'Local preview refreshed.' }
    } catch { return { captured: false, message: 'Site preview unavailable. Start the Site and use Refresh Preview to retry.' } }
    finally { clearTimeout(timer); if (!window.isDestroyed()) window.destroy(); await browserSession.clearStorageData(); await browserSession.closeAllConnections() }
  }
}
