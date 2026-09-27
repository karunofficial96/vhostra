import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

export type WebServer = 'apache' | 'nginx' | 'openlitespeed'
export type PhpVersion = '8.1' | '8.2' | '8.3' | '8.4' | '8.5'
export const supportedPhpVersions: PhpVersion[] = ['8.1', '8.2', '8.3', '8.4', '8.5']
export const resolveLatestSupportedPhpVersion = (): PhpVersion => supportedPhpVersions.at(-1)!

export interface ServicePorts { http: number; https: number; mariadb: number; redis: number; memcached: number; phpMyAdmin: number }
export type CloseBehavior = 'keep-services' | 'stop-services' | 'minimize-to-tray'
export interface Settings { schemaVersion: 1; selectedWebServer: WebServer; selectedPhpVersion: PhpVersion; optionalServices: { redis: boolean; memcached: boolean }; php: { extensions: string[]; disabledExtensions: string[]; opcacheEnabled: boolean; cwebpEnabled: boolean }; startup: { launchAtLogin: boolean; startServicesOnLaunch: boolean; closeBehavior: CloseBehavior }; ports: ServicePorts }
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
const defaults: Settings = { schemaVersion: 1, selectedWebServer: 'openlitespeed', selectedPhpVersion: resolveLatestSupportedPhpVersion(), optionalServices: { redis: false, memcached: false }, php: { extensions: [], disabledExtensions: [], opcacheEnabled: true, cwebpEnabled: true }, startup: { launchAtLogin: false, startServicesOnLaunch: false, closeBehavior: 'minimize-to-tray' }, ports: { ...defaultServicePorts } }
const localhostSiteId = 'vhostra-localhost'
const localhostVhostId = 'vhostra-localhost-vhost'
const validServers = new Set<WebServer>(['apache', 'nginx', 'openlitespeed'])
const validPhp = new Set<PhpVersion>(['8.1', '8.2', '8.3', '8.4', '8.5'])

export class VhostraStore {
  layout: StoreLayout
  private mutation: Promise<unknown> = Promise.resolve()
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(task, task)
    this.mutation = result.catch(() => undefined)
    return result
  }
  private initialized: Promise<void> | null = null
  private readonly locationFile: string
  constructor(private readonly userData: string, private readonly welcomeTemplateDirectory?: string, private readonly validateHostMappings?: (names: string[]) => Promise<void>) {
    this.locationFile = path.join(userData, 'vhostra-location.json')
    let root = path.join(userData, 'Vhostra')
    try { const saved = JSON.parse(readFileSync(this.locationFile, 'utf8')) as { root?: unknown }; if (typeof saved.root === 'string' && path.isAbsolute(saved.root)) root = saved.root } catch { /* default location */ }
    this.layout = this.layoutFor(root)
  }
  migrateConfiguration(destinationDirectory: string, validateDestination?: () => Promise<void>, progress?: (message: string) => void) { return this.serialize(() => this.migrateConfigurationRecords(destinationDirectory, validateDestination, progress)) }
  private async migrateConfigurationRecords(destinationDirectory: string, validateDestination?: () => Promise<void>, progress?: (message: string) => void) {
    await this.initialize()
    const oldLayout = this.layout; const root = path.resolve(destinationDirectory, 'Vhostra')
    if (root === oldLayout.root) return { root, message: 'Vhostra is already using this local configuration path.' }
    if (root.startsWith(`${oldLayout.root}${path.sep}`) || oldLayout.root.startsWith(`${root}${path.sep}`)) throw new Error('The new configuration location must not contain, or be inside, the current location.')
    if (root === this.userData || root === path.parse(root).root) throw new Error('Choose a dedicated directory for Vhostra configuration.')
    try { const entries = await fs.readdir(root); if (entries.length) throw new Error('The selected destination already contains files. Choose an empty directory to avoid overwriting data.') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await fs.mkdir(path.dirname(root), { recursive: true })
    progress?.('Copying Vhostra configuration and persistent data…')
    await fs.cp(oldLayout.root, root, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true })
    const copiedSettings = path.join(root, 'settings.json')
    const digest = async (file: string) => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
    const verifyCopy = async (source: string, destination: string): Promise<void> => {
      for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        const original = path.join(source, entry.name); const copied = path.join(destination, entry.name)
        if (entry.isDirectory()) await verifyCopy(original, copied)
        else if (entry.isSymbolicLink()) {
          if (await fs.readlink(original) !== await fs.readlink(copied)) throw new Error(`Copied link differs: ${entry.name}`)
        } else if (entry.isFile()) {
          if (await digest(original) !== await digest(copied)) throw new Error(`Copied file differs: ${entry.name}`)
        }
      }
    }
    progress?.('Verifying copied files and settings…')
    try { await verifyCopy(oldLayout.root, root); JSON.parse(await fs.readFile(copiedSettings, 'utf8')) } catch (error) { await fs.rm(root, { recursive: true, force: true }); throw new Error(`Vhostra could not verify the copied configuration: ${error instanceof Error ? error.message : String(error)}`) }
    progress?.('Switching to verified configuration location…')
    const temporaryPointer = `${this.locationFile}.new`
    await fs.writeFile(temporaryPointer, `${JSON.stringify({ root }, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporaryPointer, this.locationFile)
    this.layout = this.layoutFor(root); this.initialized = null
    try {
      await this.initialize()
      // Reconnect owned document roots to their copied paths; deliberately
      // leave externally selected project roots unchanged.
      for (const directory of [this.layout.sites, this.layout.virtualHosts]) {
        for (const entry of await fs.readdir(directory)) {
          if (!entry.endsWith('.json')) continue
          const file = path.join(directory, entry)
          const record = JSON.parse(await fs.readFile(file, 'utf8'))
          if (typeof record.documentRoot === 'string' && record.documentRoot.startsWith(`${oldLayout.sites}${path.sep}`)) {
            record.documentRoot = path.join(this.layout.sites, path.relative(oldLayout.sites, record.documentRoot))
            await this.writeJson(file, record)
          }
        }
      }
      progress?.('Validating runtime at the new configuration location…')
      await validateDestination?.()
    } catch (error) {
      progress?.('Rolling back configuration location; preserving original data…')
      // Source remains authoritative until both local reads and the caller's
      // runtime validation succeed. Restore the pointer before allowing retry.
      await fs.writeFile(temporaryPointer, `${JSON.stringify({ root: oldLayout.root }, null, 2)}\n`, { mode: 0o600 })
      await fs.rename(temporaryPointer, this.locationFile)
      this.layout = oldLayout; this.initialized = null
      await this.initialize()
      throw new Error(`Configuration migration rolled back; the original data is preserved. ${error instanceof Error ? error.message : String(error)}`)
    }
    // The verified copy is now authoritative. Remove only Vhostra's old root;
    // selected site document roots are separate paths and are never traversed.
    progress?.('Removing the verified previous Vhostra configuration copy…')
    await fs.rm(oldLayout.root, { recursive: true, force: true })
    return { root, message: 'Vhostra configuration was copied, verified, switched, and removed from the old Vhostra-only location.' }
  }
  private layoutFor(root: string): StoreLayout {
    const runtime = path.join(root, 'runtime')
    return {
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
  addSite(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) { return this.serialize(() => this.addSiteRecord(input)) }
  private async addSiteRecord(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) {
    this.validateSiteInput(input); await this.initialize()
    await this.assertAvailableHostnames([new URL(input.url).hostname, ...(input.aliases ?? [])])
    const now = new Date().toISOString(); const id = randomUUID(); const vhostId = randomUUID(); const hostname = new URL(input.url).hostname
    const site: Site = { id, vhostId, name: input.name.trim(), documentRoot: input.documentRoot, url: input.url, ...(input.framework?.trim() ? { framework: input.framework.trim() } : {}), createdAt: now, updatedAt: now }
    const vhost: VirtualHost = { id: vhostId, hostname, aliases: this.validateAliases(input.aliases ?? []), documentRoot: input.documentRoot, https: { enabled: new URL(input.url).protocol === 'https:' }, rewriteEnabled: true, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true } }
    await Promise.all([this.writeJson(this.recordPath(this.layout.sites, id), site), this.writeJson(this.recordPath(this.layout.virtualHosts, vhostId), vhost)])
    await this.writeLocalhostWelcome(); return this.getState()
  }
  updateSite(input: Pick<Site, 'id' | 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) { return this.serialize(() => this.updateSiteRecord(input)) }
  private async updateSiteRecord(input: Pick<Site, 'id' | 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) {
    this.validateSiteInput(input); const state = await this.getState(); const current = state.sites.find(site => site.id === input.id); if (!current) throw new Error('Site definition not found.')
    if (current.builtIn) throw new Error('The built-in localhost site is protected.')
    const existingHost = state.virtualHosts.find(host => host.id === current.vhostId)
    await this.assertAvailableHostnames([new URL(input.url).hostname, ...(input.aliases ?? existingHost?.aliases ?? [])], current.vhostId)
    const updated: Site = { ...current, name: input.name.trim(), documentRoot: input.documentRoot, url: input.url, ...(input.framework?.trim() ? { framework: input.framework.trim() } : { framework: undefined }), updatedAt: new Date().toISOString() }
    const vhost = state.virtualHosts.find(host => host.id === current.vhostId); if (!vhost) throw new Error('Related virtual-host definition not found.')
    await Promise.all([this.writeJson(this.recordPath(this.layout.sites, current.id), updated), this.writeJson(this.recordPath(this.layout.virtualHosts, vhost.id), { ...vhost, hostname: new URL(input.url).hostname, aliases: input.aliases === undefined ? vhost.aliases : this.validateAliases(input.aliases), documentRoot: input.documentRoot, https: { enabled: new URL(input.url).protocol === 'https:' } })])
    await this.writeLocalhostWelcome(); return this.getState()
  }
  removeSite(id: string) { return this.serialize(() => this.removeSiteRecord(id)) }
  private async removeSiteRecord(id: string) {
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
  /** Imports portable site definitions only. Website files, database data, and
   * secrets are intentionally outside configuration bundles and are never copied. */
  importBundle(source: string) { return this.serialize(() => this.importBundleRecords(source)) }
  private async importBundleRecords(source: string) {
    const raw = await fs.readFile(source, 'utf8')
    const candidate = JSON.parse(raw) as { manifest?: { format?: unknown; schemaVersion?: unknown }; configuration?: Partial<AppState> }
    if (candidate.manifest?.format !== 'vhostra/config-bundle' || candidate.manifest.schemaVersion !== 1 || !candidate.configuration || !Array.isArray(candidate.configuration.sites) || !Array.isArray(candidate.configuration.virtualHosts)) throw new Error('This file is not a supported Vhostra configuration bundle.')
    await this.initialize()
    const snapshot = path.join(this.layout.backups, `before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await this.exportBundle(snapshot)
    const imported: Array<{ name: string; hostname: string; aliases: string[] }> = []
    const existing = await this.getState()
    const knownHostnames = new Set(existing.virtualHosts.flatMap(host => [host.hostname, ...host.aliases]).map(name => name.toLowerCase()))
    const planned: Array<{ incoming: Site; host: VirtualHost }> = []
    for (const site of candidate.configuration.sites) {
      if (!site || typeof site !== 'object' || (site as Site).builtIn === 'localhost') continue
      const incoming = site as Site
      const host = candidate.configuration.virtualHosts.find(item => item && typeof item === 'object' && (item as VirtualHost).id === incoming.vhostId) as VirtualHost | undefined
      if (!host || [host.hostname, ...(host.aliases ?? [])].some(name => knownHostnames.has(name?.toLowerCase()))) continue
      if (new URL(incoming.url).hostname.toLowerCase() !== host.hostname.toLowerCase()) throw new Error('Imported site URL and virtual-host hostname disagree.')
      const input = { name: incoming.name, documentRoot: incoming.documentRoot, url: incoming.url, framework: incoming.framework, aliases: host.aliases }
      this.validateSiteInput(input)
      await this.assertAvailableHostnames([host.hostname, ...host.aliases])
      planned.push({ incoming, host })
      for (const name of [host.hostname, ...host.aliases]) knownHostnames.add(name.toLowerCase())
    }
    for (const { incoming, host } of planned) {
      await this.addSiteRecord({ name: incoming.name, documentRoot: incoming.documentRoot, url: incoming.url, framework: incoming.framework, aliases: host.aliases })
      imported.push({ name: incoming.name, hostname: host.hostname, aliases: host.aliases })
    }
    return { imported, backup: snapshot, message: imported.length ? `Imported ${imported.length} portable site definition${imported.length === 1 ? '' : 's'}.` : 'No new portable site definitions were found in this bundle.' }
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
  private async readSettings() { try { const value = JSON.parse(await fs.readFile(this.layout.settings, 'utf8')) as Partial<Settings>; const normalized = this.normalizeSettings(value); this.validateSettings(normalized); if (!value.ports || !value.php || !value.php.disabledExtensions || !value.startup || !value.startup.closeBehavior) await this.writeJson(this.layout.settings, normalized); return normalized } catch { await this.writeJson(this.layout.settings, defaults); return { ...defaults, optionalServices: { ...defaults.optionalServices }, php: { ...defaults.php, extensions: [...defaults.php.extensions], disabledExtensions: [...defaults.php.disabledExtensions] }, startup: { ...defaults.startup }, ports: { ...defaultServicePorts } } } }
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
      const serverIcon = settings.selectedWebServer === 'apache' ? 'services/apache_feather_bullet.gif' : settings.selectedWebServer === 'openlitespeed' ? 'services/openlitespeed.png' : 'services/nginx.ico'
      const html = source.replaceAll('{{server}}', escapeHtml(server)).replaceAll('{{server-icon}}', serverIcon).replaceAll('{{php}}', `PHP ${escapeHtml(settings.selectedPhpVersion)}`).replaceAll('{{runtime}}', escapeHtml(runtimeMessage)).replaceAll('{{redis}}', settings.optionalServices.redis ? 'Enabled when runtime is configured' : 'Disabled').replaceAll('{{memcached}}', settings.optionalServices.memcached ? 'Enabled when runtime is configured' : 'Disabled').replaceAll('{{sites}}', siteLinks)
      await fs.writeFile(path.join(root, 'index.html'), html, { mode: 0o600 })
    } catch { /* A missing development template must not prevent persistent settings/site setup. */ }
  }
  private async updateDefaultSiteUrls(httpPort: number) { const sites = await this.readRecords<Site>(this.layout.sites); await Promise.all(sites.filter(site => site.builtIn === 'localhost').map(site => this.writeJson(this.recordPath(this.layout.sites, site.id), { ...site, url: localUrl(httpPort), updatedAt: new Date().toISOString() }))) }
  private normalizeSettings(settings: Partial<Settings>) { return { ...defaults, ...settings, optionalServices: { ...defaults.optionalServices, ...settings.optionalServices }, php: { ...defaults.php, ...settings.php, extensions: [...(settings.php?.extensions ?? defaults.php.extensions)], disabledExtensions: [...(settings.php?.disabledExtensions ?? defaults.php.disabledExtensions)] }, startup: { ...defaults.startup, ...settings.startup }, ports: { ...defaultServicePorts, ...settings.ports } } as Settings }
  private validateSettings(settings: Settings) {
    if (new Set(Object.values(settings.ports)).size !== Object.values(settings.ports).length) throw new Error('Each Vhostra service must use a distinct host port.')
    if (settings.schemaVersion !== 1 || !validServers.has(settings.selectedWebServer) || !validPhp.has(settings.selectedPhpVersion) || typeof settings.optionalServices?.redis !== 'boolean' || typeof settings.optionalServices?.memcached !== 'boolean' || typeof settings.php?.opcacheEnabled !== 'boolean' || typeof settings.php?.cwebpEnabled !== 'boolean' || !Array.isArray(settings.php?.extensions) || !Array.isArray(settings.php?.disabledExtensions) || [...settings.php.extensions, ...settings.php.disabledExtensions].some(extension => !/^[a-z0-9-]+$/i.test(extension)) || settings.php.extensions.some(extension => settings.php.disabledExtensions.includes(extension)) || typeof settings.startup?.launchAtLogin !== 'boolean' || typeof settings.startup?.startServicesOnLaunch !== 'boolean' || !['keep-services', 'stop-services', 'minimize-to-tray'].includes(settings.startup?.closeBehavior) || !Object.values(settings.ports ?? {}).every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('Invalid Vhostra settings.') }
  private validateSiteInput(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }) { if (!input.name?.trim() || !input.documentRoot?.trim()) throw new Error('A site name and document root are required.'); this.validateUrl(input.url); this.validateAliases([new URL(input.url).hostname, ...(input.aliases ?? [])]) }
  private async assertAvailableHostnames(names: string[], excludeId?: string) {
    const normalized = names.map(name => name.trim().toLowerCase())
    if (new Set(normalized).size !== normalized.length) throw new Error('Duplicate hostname or alias in this virtual host.')
    const requested = new Set(normalized)
    const state = await this.getState()
    const conflict = state.virtualHosts.filter(host => host.id !== excludeId).flatMap(host => [host.hostname, ...host.aliases]).find(name => requested.has(name.toLowerCase()))
    if (conflict) throw new Error(`The hostname or alias “${conflict}” already belongs to another virtual host.`)
    await this.validateHostMappings?.(normalized)
  }
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
