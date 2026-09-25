import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type WebServer = 'apache' | 'nginx' | 'openlitespeed'
export type PhpVersion = '8.1' | '8.2' | '8.3' | '8.4' | '8.5'
export const supportedPhpVersions: PhpVersion[] = ['8.1', '8.2', '8.3', '8.4', '8.5']
export const resolveLatestSupportedPhpVersion = (): PhpVersion => supportedPhpVersions.at(-1)!

export interface ServicePorts { http: number; https: number; mariadb: number; redis: number; memcached: number; phpMyAdmin: number }
export interface Settings { schemaVersion: 1; selectedWebServer: WebServer; selectedPhpVersion: PhpVersion; optionalServices: { redis: boolean; memcached: boolean }; php: { extensions: string[]; opcacheEnabled: boolean }; startup: { launchAtLogin: boolean; startServicesOnLaunch: boolean }; ports: ServicePorts }
export interface Screenshot { cacheFile: string; capturedAt: string; source: 'automatic' | 'manual' }
export interface Site { id: string; name: string; documentRoot: string; url: string; vhostId: string; framework?: string; screenshot?: Screenshot; builtIn?: 'localhost'; createdAt: string; updatedAt: string }
export interface VirtualHost { id: string; hostname: string; aliases: string[]; documentRoot: string; https: { enabled: boolean }; rewriteEnabled: boolean; redirects: []; rewrites: []; headers: []; logs: { access: boolean; error: boolean }; builtIn?: 'localhost' }
export interface AppState { settings: Settings; sites: Site[]; virtualHosts: VirtualHost[] }

export interface StoreLayout {
  root: string; settings: string; sites: string; virtualHosts: string; screenshots: string; exports: string; backups: string
  configuration: { source: string; custom: string; imported: string; generated: string }
  runtime: { apache: string; nginx: string; openLiteSpeed: string; php: string; mariaDb: string; phpMyAdmin: string; redis: string; memcached: string }
  certificates: { directory: string; public: string; private: string }; persistentData: { mariaDb: string }; logs: string
}

export const defaultServicePorts: ServicePorts = { http: 80, https: 443, mariadb: 3306, redis: 6379, memcached: 11211, phpMyAdmin: 9080 }
const defaults: Settings = { schemaVersion: 1, selectedWebServer: 'openlitespeed', selectedPhpVersion: resolveLatestSupportedPhpVersion(), optionalServices: { redis: false, memcached: false }, php: { extensions: [], opcacheEnabled: true }, startup: { launchAtLogin: false, startServicesOnLaunch: false }, ports: { ...defaultServicePorts } }
const localhostSiteId = 'vhostra-localhost'
const localhostVhostId = 'vhostra-localhost-vhost'
const validServers = new Set<WebServer>(['apache', 'nginx', 'openlitespeed'])
const validPhp = new Set<PhpVersion>(['8.1', '8.2', '8.3', '8.4', '8.5'])

export class VhostraStore {
  readonly layout: StoreLayout
  private initialized: Promise<void> | null = null
  constructor(userData: string, private readonly welcomeTemplateDirectory?: string) {
    const root = path.join(userData, 'Vhostra')
    const runtime = path.join(root, 'runtime')
    this.layout = {
      root, settings: path.join(root, 'settings.json'), sites: path.join(root, 'sites'), virtualHosts: path.join(root, 'virtual-hosts'), screenshots: path.join(root, 'cache', 'screenshots'), exports: path.join(root, 'exports'), backups: path.join(root, 'backups'),
      configuration: { source: path.join(root, 'configuration', 'source'), custom: path.join(root, 'configuration', 'custom'), imported: path.join(root, 'configuration', 'imported'), generated: path.join(root, 'configuration', 'generated') },
      runtime: { apache: path.join(runtime, 'apache'), nginx: path.join(runtime, 'nginx'), openLiteSpeed: path.join(runtime, 'openlitespeed'), php: path.join(runtime, 'php'), mariaDb: path.join(runtime, 'mariadb'), phpMyAdmin: path.join(runtime, 'phpmyadmin'), redis: path.join(runtime, 'redis'), memcached: path.join(runtime, 'memcached') },
      certificates: { directory: path.join(root, 'certificates'), public: path.join(root, 'certificates', 'public'), private: path.join(root, 'certificates', 'private') }, persistentData: { mariaDb: path.join(root, 'data', 'mariadb') }, logs: path.join(root, 'logs'),
    }
  }

  async initialize() { this.initialized ??= this.initializeOnce(); await this.initialized }
  async updateLocalhostWelcome(runtimeMessage: string) { await this.initialize(); await this.writeLocalhostWelcome(runtimeMessage) }
  async getState(): Promise<AppState> { await this.initialize(); return { settings: await this.readSettings(), sites: await this.readRecords<Site>(this.layout.sites), virtualHosts: await this.readRecords<VirtualHost>(this.layout.virtualHosts) } }
  async getLocalhostUrl() { return localUrl((await this.readSettings()).ports.http) }
  async saveSettings(settings: Settings) { const normalized = this.normalizeSettings(settings); this.validateSettings(normalized); await this.initialize(); await this.writeJson(this.layout.settings, normalized); await this.updateDefaultSiteUrls(normalized.ports.http); await this.writeLocalhostWelcome(); return normalized }
  async addSite(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) {
    this.validateSiteInput(input); await this.initialize()
    const now = new Date().toISOString(); const id = randomUUID(); const vhostId = randomUUID(); const hostname = new URL(input.url).hostname
    const site: Site = { id, vhostId, name: input.name.trim(), documentRoot: input.documentRoot, url: input.url, ...(input.framework?.trim() ? { framework: input.framework.trim() } : {}), createdAt: now, updatedAt: now }
    const vhost: VirtualHost = { id: vhostId, hostname, aliases: this.validateAliases(input.aliases ?? []), documentRoot: input.documentRoot, https: { enabled: new URL(input.url).protocol === 'https:' }, rewriteEnabled: true, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true } }
    await Promise.all([this.writeJson(this.recordPath(this.layout.sites, id), site), this.writeJson(this.recordPath(this.layout.virtualHosts, vhostId), vhost)])
    await this.writeLocalhostWelcome(); return this.getState()
  }
  async updateSite(input: Pick<Site, 'id' | 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) {
    this.validateSiteInput(input); const state = await this.getState(); const current = state.sites.find(site => site.id === input.id); if (!current) throw new Error('Site definition not found.')
    const updated: Site = { ...current, name: input.name.trim(), documentRoot: input.documentRoot, url: input.url, ...(input.framework?.trim() ? { framework: input.framework.trim() } : { framework: undefined }), updatedAt: new Date().toISOString() }
    const vhost = state.virtualHosts.find(host => host.id === current.vhostId); if (!vhost) throw new Error('Related virtual-host definition not found.')
    await Promise.all([this.writeJson(this.recordPath(this.layout.sites, current.id), updated), this.writeJson(this.recordPath(this.layout.virtualHosts, vhost.id), { ...vhost, hostname: new URL(input.url).hostname, aliases: input.aliases === undefined ? vhost.aliases : this.validateAliases(input.aliases), documentRoot: input.documentRoot, https: { enabled: new URL(input.url).protocol === 'https:' } })])
    await this.writeLocalhostWelcome(); return this.getState()
  }
  async removeSite(id: string) {
    const state = await this.getState(); const site = state.sites.find(item => item.id === id); if (!site) throw new Error('Site definition not found.'); if (site.builtIn === 'localhost') throw new Error('The built-in localhost vhost is protected. Its document root and configuration remain inspectable.')
    await Promise.all([fs.rm(this.recordPath(this.layout.sites, site.id), { force: true }), fs.rm(this.recordPath(this.layout.virtualHosts, site.vhostId), { force: true })])
    await this.writeLocalhostWelcome(); return this.getState()
  }
  async setVirtualHostRewrite(id: string, enabled: boolean) {
    const state = await this.getState(); const host = state.virtualHosts.find(item => item.id === id)
    if (!host) throw new Error('Virtual-host definition not found.')
    await this.writeJson(this.recordPath(this.layout.virtualHosts, id), { ...host, rewriteEnabled: enabled })
    return this.getState()
  }
  /** Static previews are capped and read only for the browser image request—never retained in app state. */
  async readScreenshot(siteId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)) return null
    await this.initialize()
    try {
      const site = JSON.parse(await fs.readFile(this.recordPath(this.layout.sites, siteId), 'utf8')) as Site
      if (!site.screenshot || !/^[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/i.test(site.screenshot.cacheFile)) return null
      const file = path.join(this.layout.screenshots, site.screenshot.cacheFile); const details = await fs.stat(file)
      if (!details.isFile() || details.size > 6 * 1024 * 1024) return null
      const extension = path.extname(file).toLowerCase(); const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
      return { data: await fs.readFile(file), mime }
    } catch { return null }
  }
  async exportBundle(destination: string) {
    const state = await this.getState(); const bundle = { manifest: { format: 'vhostra/config-bundle', schemaVersion: 1, bundleId: randomUUID(), createdAt: new Date().toISOString(), appVersion: '1.0.0', scopes: ['all'], excludedByDefault: ['website-content', 'database-content', 'passwords-and-secrets', 'private-tls-keys'], includesPrivateKeys: false, includesSecrets: false, entries: [{ id: 'settings', type: 'settings', relativePath: 'settings.json', ownership: 'vhostra-source' }, { id: 'sites', type: 'site', relativePath: 'sites/', ownership: 'vhostra-source' }, { id: 'virtual-hosts', type: 'virtual-host', relativePath: 'virtual-hosts/', ownership: 'vhostra-source' }] }, configuration: state }
    await this.writeJson(destination, bundle); return destination
  }
  async previewBundle(source: string) {
    const raw = await fs.readFile(source, 'utf8'); const candidate = JSON.parse(raw) as { manifest?: unknown; configuration?: unknown }; const manifest = candidate.manifest as { format?: unknown; schemaVersion?: unknown; entries?: unknown } | undefined
    if (!manifest || manifest.format !== 'vhostra/config-bundle' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw new Error('This file is not a supported Vhostra configuration bundle.')
    return { manifest, source, warnings: ['Preview only: no configuration has been changed. Applying an import will require a local snapshot.'] }
  }
  private async initializeOnce() {
    await Promise.all(Object.values(this.directories()).map(directory => fs.mkdir(directory, { recursive: true })))
    await this.readSettings()
    await this.ensureLocalhostDefinition()
    await this.writeLocalhostWelcome()
  }
  private directories() {
    const { configuration, runtime, certificates } = this.layout
    return { root: this.layout.root, sites: this.layout.sites, virtualHosts: this.layout.virtualHosts, screenshots: this.layout.screenshots, exports: this.layout.exports, backups: this.layout.backups, logs: this.layout.logs, ...configuration, ...runtime, certificates: certificates.directory, publicCertificates: certificates.public, privateCertificates: certificates.private, mariaDbData: this.layout.persistentData.mariaDb }
  }
  private recordPath(directory: string, id: string) { return path.join(directory, `${id}.json`) }
  private async readSettings() { try { const value = JSON.parse(await fs.readFile(this.layout.settings, 'utf8')) as Partial<Settings>; const normalized = this.normalizeSettings(value); this.validateSettings(normalized); if (!value.ports || !value.php || !value.startup) await this.writeJson(this.layout.settings, normalized); return normalized } catch { await this.writeJson(this.layout.settings, defaults); return { ...defaults, optionalServices: { ...defaults.optionalServices }, php: { ...defaults.php, extensions: [...defaults.php.extensions] }, startup: { ...defaults.startup }, ports: { ...defaultServicePorts } } } }
  private async readRecords<T>(directory: string) { const files = await fs.readdir(directory); const records = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')) as T)); return records }
  private async writeJson(file: string, value: unknown) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }) }
  private async ensureLocalhostDefinition() {
    const documentRoot = path.join(this.layout.sites, 'localhost', 'public'); const now = new Date().toISOString()
    await fs.mkdir(documentRoot, { recursive: true })
    try { await fs.access(this.recordPath(this.layout.sites, localhostSiteId)) } catch { await this.writeJson(this.recordPath(this.layout.sites, localhostSiteId), { id: localhostSiteId, name: 'Vhostra Localhost', documentRoot, url: 'http://localhost/', vhostId: localhostVhostId, builtIn: 'localhost', createdAt: now, updatedAt: now } satisfies Site) }
    try { await fs.access(this.recordPath(this.layout.virtualHosts, localhostVhostId)) } catch { await this.writeJson(this.recordPath(this.layout.virtualHosts, localhostVhostId), { id: localhostVhostId, hostname: 'localhost', aliases: [], documentRoot, https: { enabled: false }, rewriteEnabled: true, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true }, builtIn: 'localhost' } satisfies VirtualHost) }
  }
  private async writeLocalhostWelcome(runtimeMessage = 'Runtime has not been created.') {
    const root = path.join(this.layout.sites, 'localhost', 'public'); const template = this.welcomeTemplateDirectory ? path.join(this.welcomeTemplateDirectory, 'index.html') : ''
    try {
      if (this.welcomeTemplateDirectory) await fs.cp(this.welcomeTemplateDirectory, root, { recursive: true, force: true })
      const [settings, sites] = await Promise.all([this.readSettings(), this.readRecords<Site>(this.layout.sites)])
      const source = template ? await fs.readFile(template, 'utf8') : fallbackWelcomeTemplate
      const siteLinks = sites.filter(site => site.builtIn !== 'localhost').map(site => `<a class="site-link" href="${escapeHtml(site.url)}">${escapeHtml(site.name)}<span>${escapeHtml(site.url)}</span></a>`).join('') || '<p class="empty">Add a site in the Vhostra desktop app to see it here.</p>'
      const server = settings.selectedWebServer === 'openlitespeed' ? 'OpenLiteSpeed' : settings.selectedWebServer === 'nginx' ? 'Nginx' : 'Apache'
      const serverIcon = settings.selectedWebServer === 'openlitespeed' ? 'openlitespeed.png' : `${settings.selectedWebServer}.svg`
      const html = source.replaceAll('{{server}}', escapeHtml(server)).replaceAll('{{server-icon}}', serverIcon).replaceAll('{{php}}', `PHP ${escapeHtml(settings.selectedPhpVersion)}`).replaceAll('{{runtime}}', escapeHtml(runtimeMessage)).replaceAll('{{redis}}', settings.optionalServices.redis ? 'Enabled when runtime is configured' : 'Disabled').replaceAll('{{memcached}}', settings.optionalServices.memcached ? 'Enabled when runtime is configured' : 'Disabled').replaceAll('{{sites}}', siteLinks)
      await fs.writeFile(path.join(root, 'index.html'), html, { mode: 0o600 })
    } catch { /* A missing development template must not prevent persistent settings/site setup. */ }
  }
  private async updateDefaultSiteUrls(httpPort: number) { const sites = await this.readRecords<Site>(this.layout.sites); await Promise.all(sites.filter(site => site.builtIn === 'localhost').map(site => this.writeJson(this.recordPath(this.layout.sites, site.id), { ...site, url: localUrl(httpPort), updatedAt: new Date().toISOString() }))) }
  private normalizeSettings(settings: Partial<Settings>) { return { ...defaults, ...settings, optionalServices: { ...defaults.optionalServices, ...settings.optionalServices }, php: { ...defaults.php, ...settings.php, extensions: [...(settings.php?.extensions ?? defaults.php.extensions)] }, startup: { ...defaults.startup, ...settings.startup }, ports: { ...defaultServicePorts, ...settings.ports } } as Settings }
  private validateSettings(settings: Settings) { if (settings.schemaVersion !== 1 || !validServers.has(settings.selectedWebServer) || !validPhp.has(settings.selectedPhpVersion) || typeof settings.optionalServices?.redis !== 'boolean' || typeof settings.optionalServices?.memcached !== 'boolean' || typeof settings.php?.opcacheEnabled !== 'boolean' || !Array.isArray(settings.php?.extensions) || settings.php.extensions.some(extension => !/^[a-z0-9_]+$/i.test(extension)) || typeof settings.startup?.launchAtLogin !== 'boolean' || typeof settings.startup?.startServicesOnLaunch !== 'boolean' || !Object.values(settings.ports ?? {}).every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('Invalid Vhostra settings.') }
  private validateSiteInput(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) { if (!input.name?.trim() || !input.documentRoot?.trim()) throw new Error('A site name and document root are required.'); this.validateUrl(input.url); this.validateAliases(input.aliases ?? []) }
  private validateAliases(aliases: string[]) {
    const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
    const normalized = [...new Set(aliases.map(alias => alias.trim().toLowerCase()).filter(Boolean))]
    if (normalized.some(alias => !hostname.test(alias) || alias === 'localhost')) throw new Error('Each server alias must be a valid hostname.')
    return normalized
  }
  static validateUrl(value: string) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Only credential-free HTTP or HTTPS site URLs can be opened.') }
  private validateUrl(value: string) { VhostraStore.validateUrl(value) }
}

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
export const localUrl = (port: number) => `http://localhost${port === 80 ? '' : `:${port}`}/`
const fallbackWelcomeTemplate = '<!doctype html><title>Vhostra localhost</title><h1>Vhostra localhost</h1><p>{{server}} · {{php}}</p><h2>Configured sites</h2><div>{{sites}}</div>'
