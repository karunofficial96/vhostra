import { BrowserWindow, session, type Session } from 'electron'
import { X509Certificate, randomUUID } from 'node:crypto'
import type { Screenshot, VhostraStore, Site } from './store.js'
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
  constructor(private store: VhostraStore, private resolver: SiteUrlResolver, private visible = () => true, private databaseReady: (site: Site) => Promise<boolean> = async () => true) {}
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
    if (site.database && (!site.database.ready || !await this.databaseReady?.(site))) return { captured: false, message: 'Preview waiting for database setup.' }
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
          const resolution = await browserSession.resolveHost(new URL(resolved.url).hostname)
          if (!resolution.endpoints.length || resolution.endpoints.some(endpoint => !['127.0.0.1', '::1'].includes(endpoint.address))) throw new Error('Electron could not resolve the Site hostname to this computer. Check its local Hosts mapping.')
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
            const failed = details.resourceType === 'mainFrame' && ((route !== site.vhostId && !(route === undefined && resolved.verifiedOrigins?.includes(new URL(details.url).origin))) || details.statusCode >= 400 || !localUrl(details.url))
            if (failed) routingFailure = 'The loaded page did not verify the requested Site routing.'
            callback({ cancel: failed })
          })
          window = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true, devTools: false, offscreen: true, backgroundThrottling: false } })
          this.activeWindow = window
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          window.webContents.on('will-navigate', (event, destination) => { if (!localUrl(destination)) event.preventDefault() })
          window.webContents.on('will-redirect', (event, destination) => { if (!localUrl(destination)) event.preventDefault() })
          const currentWindow = window
          // DOM readiness starts a temporary, bounded visual readiness check.
          await new Promise<void>((resolve, reject) => {
            currentWindow.webContents.once('dom-ready', () => resolve())
            void currentWindow.loadURL(resolved.url!).catch(reject)
          })
          await currentWindow.webContents.insertCSS('* { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }', { cssOrigin: 'user' })
          await currentWindow.webContents.executeJavaScript(`(${waitForVisualReadiness.toString()})()`)
          if (abort.signal.aborted || !this.visible() || currentWindow.isDestroyed()) throw new Error('Preview capture cancelled.')
          if (routingFailure) throw new Error(routingFailure)
          const incompleteDatabasePage = await currentWindow.webContents.executeJavaScript(`(() => { const text = (document.body?.innerText || '').slice(0, 12000).toLowerCase(); return ['error establishing a database connection', 'database connection failed', 'database connection error', 'could not connect to the database'].some(phrase => text.includes(phrase)) || (text.includes('sqlstate[hy000]') && (text.includes('connection refused') || text.includes('unknown database'))) || ['/wp-admin/install.php', '/wp-admin/setup-config.php'].some(path => location.pathname.endsWith(path)) })()`)
          if (incompleteDatabasePage) return { captured: false, message: 'Preview waiting for database setup.' }
          const finalUrl = currentWindow.webContents.getURL()
          if (!localUrl(finalUrl)) throw new Error('Site navigation left its mapped local URLs.')
          const image = await currentWindow.webContents.capturePage()
          if (image.isEmpty() || abort.signal.aborted) throw new Error('No rendered Site viewport.')
          await this.store.saveScreenshot(id, site.url, image.resize({ width: 960 }).toJPEG(75), force ? 'manual' : 'automatic', { documentRoot: site.documentRoot, updatedAt: site.updatedAt }, { url: publicSiteUrl(finalUrl), identity })
          const saved = (await this.store.getState()).sites.find(item => item.id === id)
          return { captured: true, message: 'Preview updated successfully.', screenshot: saved?.screenshot }
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Local preview timed out.')) }, 15000) }),
      ])
    } catch (error) { result = { captured: false, message: captureFailureReason(error), details: previewErrorText(error instanceof Error ? error.message : String(error)).slice(0, 4000) } }
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

/** Runs only in the transient capture renderer; all observation ends before capture. */
function waitForVisualReadiness(): Promise<void> {
  return new Promise(resolve => {
    const started = performance.now()
    let changed = started
    let fontsReady = !document.fonts || document.fonts.status === 'loaded'
    const mark = () => { changed = performance.now() }
    const observer = new MutationObserver(mark)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true })
    const layout = () => {
      const root = document.documentElement
      const visible = Array.from(document.body?.children ?? []).slice(0, 24).map(element => {
        const box = element.getBoundingClientRect()
        return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)].join(',')
      }).join(';')
      return `${root.scrollWidth}:${root.scrollHeight}:${visible}`
    }
    let geometry = layout()
    const firstViewportImagesReady = () => Array.from(document.images).every(image => {
      const rect = image.getBoundingClientRect()
      return rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth || image.complete
    })
    const finish = () => { clearInterval(sample); clearTimeout(deadline); observer.disconnect(); resolve() }
    const sample = setInterval(() => {
      const now = performance.now()
      const next = layout()
      if (next !== geometry) { geometry = next; changed = now }
      if (now - started >= 2000 && now - changed >= 500 && document.readyState === 'complete' && fontsReady && firstViewportImagesReady()) finish()
    }, 100)
    const deadline = setTimeout(finish, 8000)
    document.fonts?.ready.then(() => { fontsReady = true; mark() }, () => { fontsReady = true })
  })
}

function captureFailureReason(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  if (/timed out/i.test(text)) return 'The local preview took too long to load.'
  if (/resolve|ERR_NAME_NOT_RESOLVED/i.test(text)) return 'Electron could not resolve the Site hostname locally.'
  if (/ERR_CERT|certificate/i.test(text)) return 'The local HTTPS certificate was not accepted.'
  if (/ERR_CONNECTION_REFUSED/i.test(text)) return 'The local web server refused the connection.'
  if (/routing|mapped local URLs/i.test(text)) return 'The loaded page did not match this Site’s local routing.'
  if (/cancelled|ERR_ABORTED/i.test(text)) return 'The preview capture was cancelled.'
  if (/No rendered/i.test(text)) return 'The Site did not produce a rendered viewport.'
  return 'The Site page could not be loaded in the local preview browser.'
}
