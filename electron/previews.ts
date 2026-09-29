import { BrowserWindow, session, type Session } from 'electron'
import { X509Certificate, randomUUID } from 'node:crypto'
import type { Screenshot, VhostraStore } from './store.js'
import { SiteUrlResolver, previewIdentity, previewMatches, publicSiteUrl, previewErrorText, validLocalCertificate } from './site-url.js'

export interface PreviewResult { captured: boolean; message: string; details?: string; repair?: boolean; screenshot?: Screenshot }
/** One transient local renderer at a time. One memory-only session, no idle timer. */
export class SitePreviews {
  private pending = new Map<string, Promise<PreviewResult>>()
  private attempted = new Map<string, { identity: string; at: number; result: PreviewResult }>()
  private queue: Promise<unknown> = Promise.resolve()
  private browserSession?: Session
  private activeAbort?: AbortController
  private activeWindow?: BrowserWindow
  clearFailures() { this.attempted.clear() }
  cancel() { this.activeAbort?.abort(); if (this.activeWindow && !this.activeWindow.isDestroyed()) this.activeWindow.destroy() }
  constructor(private store: VhostraStore, private resolver: SiteUrlResolver, private visible = () => true) {}
  capture(id: string, force = false): Promise<PreviewResult> {
    if (this.pending.has(id)) return this.pending.get(id)!
    if (this.pending.size >= 6) return Promise.resolve({ captured: false, message: 'Preview queue is busy. Refresh this preview later.' })
    const task = this.queue.then(() => this.captureOne(id, force)).finally(() => this.pending.delete(id))
    this.pending.set(id, task); this.queue = task.catch(() => undefined); return task
  }
  private async captureOne(id: string, force: boolean): Promise<PreviewResult> {
    if (!this.visible()) return { captured: false, message: 'Open Dashboard to refresh previews.' }
    const state = await this.store.getState(); const site = state.sites.find(site => site.id === id)
    if (!site) return { captured: false, message: 'Choose an existing Site.' }
    const identity = previewIdentity(state, site)
    const attemptIdentity = JSON.stringify([identity, site.updatedAt, state.virtualHosts.find(host => host.id === site.vhostId)?.aliases])
    if (!force && previewMatches(state, site) && Date.now() - Date.parse(site.screenshot!.capturedAt) < 86400000 && await this.store.readScreenshot(id)) return { captured: false, message: 'Using the cached local preview.', screenshot: site.screenshot }
    const recent = this.attempted.get(id)
    if (!force && recent?.identity === attemptIdentity && Date.now() - recent.at < 600000) return recent.result
    let window: BrowserWindow | undefined; let browserSession: Session | undefined; let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController(); this.activeAbort = abort
    let result: PreviewResult
    try {
      result = await Promise.race([
        (async (): Promise<PreviewResult> => {
          const resolved = await this.resolver.resolve(id, abort.signal)
          if (!resolved.available || !resolved.url) return { captured: false, message: resolved.message, details: resolved.details, repair: resolved.repair }
          if (abort.signal.aborted || !this.visible()) return { captured: false, message: 'Open Dashboard to refresh previews.' }
          this.browserSession ??= session.fromPartition(`vhostra-preview-${randomUUID()}`, { cache: false })
          browserSession = this.browserSession
          browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
          browserSession.setPermissionCheckHandler(() => false)
          browserSession.on('will-download', preventDownload)
          await browserSession.setProxy({ mode: 'direct' })
          await browserSession.clearHostResolverCache()
          if (abort.signal.aborted || !this.visible()) throw new Error('Preview capture cancelled.')
          const allowed = new Set(resolved.candidates!.map(url => new URL(url).origin))
          const localUrl = (value: string) => { try { const target = new URL(value); return !target.username && !target.password && allowed.has(target.origin) } catch { return false } }
          browserSession.webRequest.onBeforeRequest((details, callback) => { try { const target = new URL(details.url); callback({ cancel: !localUrl(details.url) && !['data:', 'blob:'].includes(target.protocol) }) } catch { callback({ cancel: true }) } })
          browserSession.setCertificateVerifyProc((request, callback) => {
            // Only this private session may trust the exact managed certificate,
            // with its SAN and validity checked. Normal system trust stays intact.
            try {
              const pem = resolved.certificate
              const accepted = pem && resolved.candidates!.some(url => new URL(url).hostname === request.hostname) && validLocalCertificate(pem, request.hostname) && new X509Certificate(pem).fingerprint256 === new X509Certificate(request.certificate.data).fingerprint256
              callback(accepted ? 0 : -3)
            } catch { callback(-3) }
          })
          let routingFailure = ''
          browserSession.webRequest.onHeadersReceived((details, callback) => {
            const headers = details.responseHeaders ?? {}
            const route = Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-vhostra-site')?.[1]?.[0]
            const failed = details.resourceType === 'mainFrame' && (route !== site.vhostId || details.statusCode >= 400 || !localUrl(details.url))
            if (failed) routingFailure = 'The loaded page did not verify the requested Site routing.'
            callback({ cancel: failed })
          })
          window = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true, devTools: false, offscreen: true, backgroundThrottling: false } })
          this.activeWindow = window
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          window.webContents.on('will-navigate', (event, destination) => { if (!localUrl(destination)) event.preventDefault() })
          window.webContents.on('will-redirect', (event, destination) => { if (!localUrl(destination)) event.preventDefault() })
          const currentWindow = window
          // DOM readiness plus bounded render time: analytics/long polling cannot hold capture open.
          await new Promise<void>((resolve, reject) => {
            currentWindow.webContents.once('dom-ready', () => resolve())
            void currentWindow.loadURL(resolved.url!).catch(reject)
          })
          await currentWindow.webContents.insertCSS('* { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }', { cssOrigin: 'user' })
          await new Promise<void>(resolve => { const renderTimer = setTimeout(done, 500); function done() { clearTimeout(renderTimer); abort.signal.removeEventListener('abort', done); resolve() } abort.signal.addEventListener('abort', done, { once: true }); if (abort.signal.aborted) done() })
          if (abort.signal.aborted || !this.visible() || currentWindow.isDestroyed()) throw new Error('Preview capture cancelled.')
          if (routingFailure) throw new Error(routingFailure)
          const finalUrl = currentWindow.webContents.getURL()
          if (!localUrl(finalUrl)) throw new Error('Site navigation left its mapped local URLs.')
          const image = await currentWindow.webContents.capturePage()
          if (image.isEmpty() || abort.signal.aborted) throw new Error('No rendered Site viewport.')
          await this.store.saveScreenshot(id, site.url, image.resize({ width: 960 }).toJPEG(75), force ? 'manual' : 'automatic', { documentRoot: site.documentRoot, updatedAt: site.updatedAt }, { url: publicSiteUrl(finalUrl), identity })
          const saved = (await this.store.getState()).sites.find(item => item.id === id)
          return { captured: true, message: 'Local preview refreshed.', screenshot: saved?.screenshot }
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Local preview timed out.')) }, 15000) }),
      ])
    } catch (error) { result = { captured: false, message: 'Vhostra could not open the Site URL.', details: previewErrorText(error instanceof Error ? error.message : String(error)).slice(0, 4000) } }
    finally {
      clearTimeout(timer); abort.abort(); this.activeAbort = undefined; this.activeWindow = undefined; if (window && !window.isDestroyed()) window.destroy()
      if (browserSession) {
        browserSession.webRequest.onBeforeRequest(null); browserSession.webRequest.onHeadersReceived(null)
        browserSession.setCertificateVerifyProc(null); browserSession.setPermissionRequestHandler(null); browserSession.setPermissionCheckHandler(null)
        browserSession.removeListener('will-download', preventDownload)
        await Promise.allSettled([browserSession.clearStorageData(), browserSession.clearCache(), browserSession.closeAllConnections()])
      }
    }
    if (!result.captured && result.message !== 'The web server is stopped.' && this.visible() && !result.details?.includes('cancelled') && !result.details?.includes('ERR_ABORTED')) this.attempted.set(id, { identity: attemptIdentity, at: Date.now(), result })
    else this.attempted.delete(id)
    if (this.attempted.size > 500) this.attempted.delete(this.attempted.keys().next().value!)
    return result
  }
}
function preventDownload(event: Electron.Event) { event.preventDefault() }
