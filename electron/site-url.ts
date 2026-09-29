import http from 'node:http'
import https from 'node:https'
import { X509Certificate, createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppState, Site, VirtualHost, VhostraStore } from './store.js'
import type { HostsFileManager } from './hosts.js'
import { redactProgress } from './progress.js'

export interface SiteUrlResult { available: boolean; url?: string; message: string; details?: string; repair?: boolean }
export interface ResolvedSiteUrl extends SiteUrlResult { site?: Site; host?: VirtualHost; candidates?: string[]; certificate?: string }
/** Canonical host first, then configured aliases; HTTP always supported, TLS only when requested and active. */
export function siteUrlCandidates(state: AppState, site: Site, httpsAvailable: boolean) {
  const host = state.virtualHosts.find(item => item.id === site.vhostId)
  if (!host || host.documentRoot !== site.documentRoot) return []
  const names = site.builtIn ? ['localhost'] : [host.hostname, ...host.aliases]
  return [...new Set(names)].filter(name => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(name) && (site.builtIn || !['localhost', '127.0.0.1'].includes(name))).flatMap(name => {
    const protocols = host.https.enabled && httpsAvailable ? ['https', 'http'] : ['http']
    return protocols.map(protocol => { const port = protocol === 'https' ? state.settings.ports.https : state.settings.ports.http; const target = new URL(`${protocol}://${name}:${port}/`); const configured = new URL(site.url); target.pathname = configured.pathname; target.search = configured.search; target.hash = configured.hash; return target.toString() })
  })
}
export function previewIdentity(state: AppState, site: Site) {
  const host = state.virtualHosts.find(item => item.id === site.vhostId)
  const configured = new URL(site.url)
  return createHash('sha256').update(JSON.stringify([site.vhostId, site.documentRoot, host?.hostname, host?.https.enabled, state.settings.ports.http, state.settings.ports.https, configured.pathname, configured.search, configured.hash])).digest('hex')
}
export function previewMatches(state: AppState, site: Site) {
  if (!site.screenshot?.url || site.screenshot.identity !== previewIdentity(state, site)) return false
  try { const url = new URL(site.screenshot.url); return !url.username && !url.password && siteUrlCandidates(state, site, true).some(candidate => new URL(candidate).origin === url.origin) } catch { return false }
}
/** Query/fragment state can contain credentials; it is not needed by preview cache/UI metadata. */
export function publicSiteUrl(value: string) { const url = new URL(value); url.search = ''; url.hash = ''; url.username = ''; url.password = ''; return url.toString() }
export function previewErrorText(value: string) {
  return redactProgress(value).replace(/https?:\/\/[^\s"'<>]+/gi, url => { try { return publicSiteUrl(url) } catch { return '[Site URL omitted]' } })
}
export function validLocalCertificate(pem: string, hostname: string) {
  try { const cert = new X509Certificate(pem); const now = Date.now(); return now >= Date.parse(cert.validFrom) && now < Date.parse(cert.validTo) && Boolean(cert.checkHost(hostname)) } catch { return false }
}
/** Only loopback transport; Host and SNI stay named. Never follows an external redirect or reads Site bodies. */
async function probe(url: string, id: string, certificate: string | undefined, signal: AbortSignal) {
  const target = new URL(url)
  return new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const request = (target.protocol === 'https:' ? https : http).request(target, {
      method: 'GET', agent: false, signal, family: 4, ...(target.protocol === 'https:' && certificate ? { ca: certificate } : {}),
      lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4),
    }, response => {
      const status = response.statusCode ?? 0
      const identity = response.headers['x-vhostra-site']
      const location = response.headers.location
      response.destroy()
      if (identity !== id) reject(new Error(`Routing verification failed: HTTP ${status} did not identify the requested virtual host. Repair Site configuration.`))
      else if (status < 200 || status >= 400) reject(new Error(`Site returned HTTP ${status}.`))
      else resolve({ status, location })
    })
    request.setTimeout(1500, () => request.destroy(new Error('Site connection timed out.')))
    request.on('error', reject); request.end()
  })
}
export class SiteUrlResolver {
  constructor(private store: VhostraStore, private mappings: () => Pick<HostsFileManager, 'mappingStatus'>, private availability: () => { running: boolean; https: boolean }) {}
  async resolve(id: string, signal?: AbortSignal): Promise<ResolvedSiteUrl> {
    const state = await this.store.getState(); const site = state.sites.find(item => item.id === id)
    if (!site) return { available: false, message: 'Choose an existing Site.' }
    const host = state.virtualHosts.find(item => item.id === site.vhostId)
    const runtime = this.availability()
    if (!runtime.running) return { available: false, message: 'The web server is stopped.' }
    const candidates = siteUrlCandidates(state, site, runtime.https)
    const mappings = await this.mappings().mappingStatus(host ? [host.hostname, ...host.aliases] : [])
    const mapped = new Set(mappings.filter(item => item.state === 'mapped').map(item => item.hostname.toLowerCase()))
    if (site.builtIn) mapped.add('localhost')
    const local = candidates.filter(url => mapped.has(new URL(url).hostname))
    if (!local.length) return { available: false, message: 'The Site hostname is not mapped locally.', repair: !site.builtIn }
    let certificate: string | undefined
    try { const file = path.join(this.store.layout.certificates.public, 'localhost.pem'); if ((await fs.stat(file)).size < 65536) certificate = await fs.readFile(file, 'utf8') } catch { /* system trust may already cover TLS */ }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 6000)
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    const errors: string[] = []
    try {
      for (const url of local.slice(0, 16)) {
        if (controller.signal.aborted) break
        try {
          // Verify every redirect, preserving named routing and limiting loops.
          let current = url
          for (let redirects = 0; redirects < 4; redirects++) {
            const response = await probe(current, site.vhostId, certificate, controller.signal)
            if (response.status < 300) return { available: true, url: current, message: 'Site routing verified.', site, host, candidates: local, certificate }
            if (!response.location) throw new Error('Site redirect has no destination.')
            const next = new URL(response.location, current)
            if (next.username || next.password || !local.some(candidate => new URL(candidate).origin === next.origin)) throw new Error('Site redirects outside its mapped local URLs.')
            current = next.toString()
          }
          throw new Error('Site redirects too many times.')
        } catch (error) { errors.push(previewErrorText(`${publicSiteUrl(url)}: ${error instanceof Error ? error.message : String(error)}`)) }
      }
      return { available: false, message: 'The Site could not be reached or its routing could not be verified.', details: errors.join('\n').slice(0, 4000), repair: !site.builtIn }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
}
