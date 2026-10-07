import { previewMatches } from './site-url.js'
import { fingerprint, siteDefinition, differences, type RestoreChoices } from './reconciliation.js'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { importedMetadata, type NativeImportPreview } from './config-import.js'
import { systemStoragePaths, type SystemStoragePaths } from './storage-paths.js'
import { authorizeProtectedTransaction } from './protected-launcher.js'

export type WebServer = 'apache' | 'nginx' | 'openlitespeed'
export type PhpVersion = '8.1' | '8.2' | '8.3' | '8.4' | '8.5'
export const supportedPhpVersions: PhpVersion[] = ['8.1', '8.2', '8.3', '8.4', '8.5']
export const resolveLatestSupportedPhpVersion = (): PhpVersion => supportedPhpVersions.at(-1)!

export interface ServicePorts { http: number; https: number; mariadb: number; redis: number; memcached: number; phpMyAdmin: number }
export type ServiceStartMode = 'on-open' | 'after-login' | 'manual'
export type CloseBehavior = 'keep-services' | 'stop-services' | 'minimize-to-tray'
export interface Settings { schemaVersion: 1; selectedWebServer: WebServer; selectedPhpVersion: PhpVersion; optionalServices: { redis: boolean; memcached: boolean }; php: { extensions: string[]; disabledExtensions: string[]; opcacheEnabled: boolean; cwebpEnabled: boolean }; startup: { launchAtLogin: boolean; serviceStartMode: ServiceStartMode; closeBehavior: CloseBehavior }; ports: ServicePorts }
export interface OnboardingState { themeSaved?: boolean; secondary?: boolean; restoredServices?: { redis: boolean; memcached: boolean }; ready?: boolean; completed: boolean; theme: 'light' | 'dark' | 'system'; server: WebServer; php: PhpVersion; cache: 'none' | 'redis' | 'memcached' }
export interface Screenshot { url?: string; identity?: string; cacheFile: string; capturedAt: string; source: 'automatic' | 'manual' }
export const runtimeDocumentRoot = (host: Pick<VirtualHost, 'id' | 'builtIn'>) => host.builtIn === 'localhost' ? '/var/www/html' : `/var/www/vhostra/${host.id}`
export const siteLogPaths = (layout: StoreLayout, id: string) => ({ access: path.join(layout.logs, 'sites', id, 'access.log'), error: path.join(layout.logs, 'sites', id, 'error.log') })
export interface Site { id: string; name: string; documentRoot: string; url: string; vhostId: string; configuration?: VirtualHost; framework?: string; database?: { name: string; importExpected: boolean; ready: boolean }; screenshot?: Screenshot; builtIn?: 'localhost'; createdAt: string; updatedAt: string }
export interface VirtualHost { id: string; hostname: string; aliases: string[]; /** Absolute HOST document root; never container storage. */ documentRoot: string; runtimeDocumentRoot?: string; https: { enabled: boolean }; rewriteEnabled: boolean; redirects: []; rewrites: []; headers: []; logs: { access: boolean; error: boolean; paths?: { access: string; error: string } }; indexFiles?: string[]; source?: { server: WebServer | 'litespeed-enterprise'; path: string; importedAt: string; raw?: string; status: string; warnings: string[] }; preservedDirectives?: string[]; builtIn?: 'localhost' }
export interface AppState { settings: Settings; sites: Site[]; virtualHosts: VirtualHost[] }

export interface StoreLayout {
  root: string; userRoot?: string; dataRoot?: string; builtinPublic: string; settings: string; sites: string; virtualHosts: string; screenshots: string; exports: string; backups: string
  configuration: { source: string; custom: string; imported: string; generated: string }
  runtime: { apache: string; nginx: string; openLiteSpeed: string; php: string; mariaDb: string; phpMyAdmin: string; redis: string; memcached: string }
  certificates: { directory: string; public: string; private: string }; persistentData: { mariaDb: string }; logs: string
}

export const defaultServicePorts: ServicePorts = { http: 80, https: 443, mariadb: 3306, redis: 6379, memcached: 11211, phpMyAdmin: 9080 }
const defaults: Settings = { schemaVersion: 1, selectedWebServer: 'openlitespeed', selectedPhpVersion: resolveLatestSupportedPhpVersion(), optionalServices: { redis: false, memcached: false }, php: { extensions: [], disabledExtensions: [], opcacheEnabled: true, cwebpEnabled: true }, startup: { launchAtLogin: false, serviceStartMode: 'on-open', closeBehavior: 'minimize-to-tray' }, ports: { ...defaultServicePorts } }
const localhostSiteId = 'vhostra-localhost'
const localhostVhostId = 'vhostra-localhost-vhost'
const validServers = new Set<WebServer>(['apache', 'nginx', 'openlitespeed'])
const validPhp = new Set<PhpVersion>(['8.1', '8.2', '8.3', '8.4', '8.5'])

export class VhostraStore {
  layout: StoreLayout
  didMigrateUnifiedSites = false
  private mutation: Promise<unknown> = Promise.resolve()
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(task, task)
    this.mutation = result.catch(() => undefined)
    return result
  }
  private initialized: Promise<void> | null = null
  private readonly locationFile: string
  private readonly userSettingsFile: string
  constructor(private readonly userData: string, private readonly welcomeTemplateDirectory?: string, private readonly validateHostMappings?: (names: string[]) => Promise<void>, private readonly machinePaths?: SystemStoragePaths) {
    if (machinePaths) {
      const native = systemStoragePaths(process.platform)
      if (Object.keys(native).every(key => path.resolve(machinePaths[key as keyof SystemStoragePaths]) === path.resolve(native[key as keyof SystemStoragePaths])))
        throw new Error('Native machine storage remains blocked until protected runtime writes and scoped data/log permissions are verified.')
    }
    this.locationFile = path.join(userData, 'vhostra-location.json')
    this.userSettingsFile = path.join(userData, 'vhostra-user-settings.json')
    let root = path.join(userData, 'Vhostra')
    try { const saved = JSON.parse(readFileSync(this.locationFile, 'utf8')) as { root?: unknown }; if (typeof saved.root === 'string' && path.isAbsolute(saved.root)) root = saved.root } catch { /* default location */ }
    this.layout = machinePaths ? this.systemLayoutFor(machinePaths) : this.layoutFor(root)
  }
  migrateConfiguration(destinationDirectory: string, validateDestination?: () => Promise<void>, progress?: (message: string) => void) { return this.serialize(() => this.migrateConfigurationRecords(destinationDirectory, validateDestination, progress)) }
  migrateConfigurationRoot(destinationRoot: string, validateDestination?: () => Promise<void>, progress?: (message: string) => void) { return this.serialize(() => this.migrateConfigurationRecords(destinationRoot, validateDestination, progress, true)) }
  private async migrateConfigurationRecords(destinationDirectory: string, validateDestination?: () => Promise<void>, progress?: (message: string) => void, exactRoot = false) {
    if (this.machinePaths) throw new Error('Machine storage cannot be moved through the per-user configuration migration.')
    await this.initialize()
    const oldLayout = this.layout; const root = exactRoot ? path.resolve(destinationDirectory) : path.resolve(destinationDirectory, 'Vhostra')
    if (root === oldLayout.root) return { root, message: 'Vhostra is already using this local configuration path.' }
    for (const site of (await this.getState()).sites.filter(site => !site.builtIn)) {
      const actual = await fs.realpath(site.documentRoot).catch(() => path.resolve(site.documentRoot))
      const managed = await fs.realpath(oldLayout.root)
      if (actual === managed || actual.startsWith(`${managed}${path.sep}`)) throw new Error(`Migration refused to preserve site files: ${site.name} is inside managed storage. Move its document root outside Vhostra storage first.`)
    }
    if (root.startsWith(`${oldLayout.root}${path.sep}`) || oldLayout.root.startsWith(`${root}${path.sep}`)) throw new Error('The new configuration location must not contain, or be inside, the current location.')
    if (root === this.userData || root === path.parse(root).root) throw new Error('Choose a dedicated directory for Vhostra configuration.')
    const existing = await fs.lstat(root).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (existing && !existing.isDirectory()) throw new Error('The selected destination must be a directory, not a file or link.')
    if (existing && (await fs.readdir(root)).length) throw new Error('The selected destination already contains files. Choose an empty directory to avoid overwriting data.')
    await fs.mkdir(path.dirname(root), { recursive: true })
    const staging = path.join(path.dirname(root), `.${path.basename(root)}.vhostra-stage-${randomUUID()}`)
    progress?.('Copying Vhostra configuration and persistent data…')
    try { await fs.cp(oldLayout.root, staging, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true }) }
    catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error }
    const copiedSettings = path.join(staging, 'settings.json')
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
    try { await verifyCopy(oldLayout.root, staging); JSON.parse(await fs.readFile(copiedSettings, 'utf8')) } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw new Error(`Vhostra could not verify the copied configuration: ${error instanceof Error ? error.message : String(error)}`) }
    progress?.('Switching to verified configuration location…')
    try {
      if (existing) await fs.rmdir(root) // A new file makes this fail without deleting it.
      await fs.rename(staging, root)
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true })
      if (existing && !existsSync(root)) await fs.mkdir(root, { recursive: false })
      throw error
    }
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
            if (record.configuration) record.configuration.documentRoot = record.documentRoot
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
  private systemLayoutFor(roots: SystemStoragePaths): StoreLayout {
    const configuration = path.resolve(roots.configuration)
    const data = path.resolve(roots.data)
    const logs = path.resolve(roots.logs)
    const runtime = path.join(data, 'runtime')
    const protectedRuntime = path.join(configuration, 'configuration', 'runtime')
    const certs = path.join(data, 'certificates')
    return {
      root: configuration, userRoot: this.userData, dataRoot: data, builtinPublic: path.join(data, 'service-data', 'localhost', 'public'),
      settings: path.join(configuration, 'settings.json'), sites: path.join(configuration, 'sites'), virtualHosts: path.join(configuration, 'virtual-hosts'),
      screenshots: path.join(this.userData, 'cache', 'screenshots'), exports: path.join(this.userData, 'exports'), backups: path.join(this.userData, 'backups'),
      configuration: { source: path.join(configuration, 'configuration', 'source'), custom: path.join(configuration, 'configuration', 'custom'), imported: path.join(configuration, 'configuration', 'imported'), generated: path.join(configuration, 'configuration', 'generated') },
      runtime: { apache: path.join(protectedRuntime, 'apache'), nginx: path.join(protectedRuntime, 'nginx'), openLiteSpeed: path.join(protectedRuntime, 'openlitespeed'), php: path.join(protectedRuntime, 'php'), mariaDb: path.join(runtime, 'mariadb'), phpMyAdmin: path.join(runtime, 'phpmyadmin'), redis: path.join(data, 'service-data', 'redis'), memcached: path.join(data, 'service-data', 'memcached') },
      certificates: { directory: certs, public: path.join(certs, 'public'), private: path.join(certs, 'private') },
      persistentData: { mariaDb: path.join(data, 'data', 'mariadb') }, logs,
    }
  }
  private layoutFor(root: string): StoreLayout {
    const runtime = path.join(root, 'runtime')
    return {
      root, builtinPublic: path.join(root, 'sites', 'localhost', 'public'), settings: path.join(root, 'settings.json'), sites: path.join(root, 'sites'), virtualHosts: path.join(root, 'virtual-hosts'), screenshots: path.join(root, 'cache', 'screenshots'), exports: path.join(root, 'exports'), backups: path.join(root, 'backups'),
      configuration: { source: path.join(root, 'configuration', 'source'), custom: path.join(root, 'configuration', 'custom'), imported: path.join(root, 'configuration', 'imported'), generated: path.join(root, 'configuration', 'generated') },
      runtime: { apache: path.join(runtime, 'apache'), nginx: path.join(runtime, 'nginx'), openLiteSpeed: path.join(runtime, 'openlitespeed'), php: path.join(runtime, 'php'), mariaDb: path.join(runtime, 'mariadb'), phpMyAdmin: path.join(runtime, 'phpmyadmin'), redis: path.join(runtime, 'redis'), memcached: path.join(runtime, 'memcached') },
      certificates: { directory: path.join(root, 'certificates'), public: path.join(root, 'certificates', 'public'), private: path.join(root, 'certificates', 'private') }, persistentData: { mariaDb: path.join(root, 'data', 'mariadb') }, logs: path.join(root, 'logs'),
    }
  }

  async initialize() { this.initialized ??= this.initializeOnce(); await this.initialized }
  private async readPersonalSettings(): Promise<{ startup?: Settings['startup']; theme?: OnboardingState['theme']; onboardingCompleted?: boolean }> {
    try { return JSON.parse(await fs.readFile(this.userSettingsFile, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }
  async getOnboarding(): Promise<OnboardingState> {
    await this.initialize()
    const machine = JSON.parse(await fs.readFile(path.join(this.layout.root, 'onboarding.json'), 'utf8')) as OnboardingState
    let personal = await this.readPersonalSettings()
    if (machine.completed && personal.onboardingCompleted === undefined && this.layout.root.startsWith(`${path.resolve(this.userData)}${path.sep}`)) {
      // Upgrade of the account that owned the old environment.
      personal = { ...personal, theme: personal.theme ?? machine.theme, onboardingCompleted: true }
      await this.writeJson(this.userSettingsFile, personal)
    }
    const secondary = machine.completed && personal.onboardingCompleted !== true
    return { ...machine, theme: personal.theme ?? (secondary ? 'system' : machine.theme), themeSaved: Boolean(personal.theme), completed: machine.completed && !secondary, secondary }
  }
  async saveOnboarding(input: OnboardingState) {
    if (input.restoredServices && (typeof input.restoredServices.redis !== 'boolean' || typeof input.restoredServices.memcached !== 'boolean')) throw new Error('Invalid restored cache preferences.'); if (input.ready !== undefined && typeof input.ready !== 'boolean') throw new Error('Invalid setup readiness.'); if (!['light', 'dark', 'system'].includes(input.theme) || !validServers.has(input.server) || !validPhp.has(input.php) || !['none', 'redis', 'memcached'].includes(input.cache) || typeof input.completed !== 'boolean') throw new Error('Invalid setup preferences.')
    const previous = await this.getOnboarding()
    const personal = await this.readPersonalSettings()
    await this.writeJson(this.userSettingsFile, { ...personal, theme: input.theme })
    if (previous.secondary || previous.completed) return { ...previous, theme: input.theme, themeSaved: true }
    input = { ...input, themeSaved: true, secondary: false }
    await this.writeJson(path.join(this.layout.root, 'onboarding.json'), { ...input, theme: 'system', themeSaved: false })
    await this.writeLocalhostWelcome()
    return input
  }
  async finishOnboarding() {
    const preferences = await this.getOnboarding()
    if (!preferences.secondary) {
      if (!preferences.ready) throw new Error('Complete runtime setup before entering Vhostra.')
      await this.saveOnboarding({ ...preferences, completed: true })
    }
    await this.writeJson(this.userSettingsFile, { ...await this.readPersonalSettings(), onboardingCompleted: true })
    return { ...preferences, completed: true, secondary: false }
  }
  async resetUserPreferences() {
    const personal = await this.readPersonalSettings()
    await this.writeJson(this.userSettingsFile, { ...personal, startup: defaults.startup, theme: 'system' })
    return { message: 'This OS user’s theme and startup preferences were reset. Services, databases, certificates and Sites in this profile were not changed.' }
  }
  async updateLocalhostWelcome(runtimeMessage: string) { await this.initialize(); await this.writeLocalhostWelcome(runtimeMessage) }
  async getState(): Promise<AppState> { await this.initialize(); const sites = await this.readRecords<Site>(this.layout.sites); return { settings: await this.readSettings(), sites: sites.map(({ configuration: _configuration, ...site }) => site), virtualHosts: sites.map(site => site.configuration).filter((host): host is VirtualHost => Boolean(host)) } }
  private async writeSite(site: Site, host?: VirtualHost) {
    const file = this.recordPath(this.layout.sites, site.id)
    const previous = await fs.readFile(file, 'utf8').then(value => JSON.parse(value) as Site, () => null)
    const configuration = host ?? previous?.configuration
    if (!configuration || configuration.id !== site.vhostId || configuration.documentRoot !== site.documentRoot) throw new Error('Site and canonical configuration disagree.')
    await this.writeJson(file, { ...site, configuration })
  }
  private async writeHost(host: VirtualHost) {
    const sites = await this.readRecords<Site>(this.layout.sites)
    const site = sites.find(item => item.vhostId === host.id)
    if (!site) throw new Error('Canonical Site not found.')
    await this.writeSite(site, host)
  }
  restoreBackupConfiguration(original: AppState, preferences: OnboardingState) { return this.serialize(async () => {
    for (const site of (await this.getState()).sites.filter(site => !site.builtIn && !original.sites.some(item => item.id === site.id))) await this.removeSiteRecord(site.id)
    for (const site of original.sites) await this.writeSite(site, original.virtualHosts.find(host => host.id === site.vhostId))
    await this.saveSettings(original.settings); await this.saveOnboarding(preferences)
  }) }
  async getLocalhostUrl() { return localUrl((await this.readSettings()).ports.http) }
  markDatabaseImported(name: string) { return this.serialize(async () => {
    const sites = (await this.getState()).sites.filter(site => site.database?.name === name && site.database.importExpected && !site.database.ready)
    for (const site of sites) await this.writeSite({ ...site, database: { ...site.database!, ready: true } })
    return sites.map(site => site.id)
  }) }
  async saveSettings(settings: Settings) {
    const normalized = this.normalizeSettings(settings); this.validateSettings(normalized); await this.initialize()
    const previous = await this.readSettings()
    // Startup belongs to this OS account. A startup-only change does not touch
    // the shared environment or invalidate site previews.
    const shared = ({ startup: _startup, ...rest }: Settings) => rest
    const changed = JSON.stringify(shared(previous)) !== JSON.stringify(shared(normalized))
    if (changed) await this.writeJson(this.layout.settings, shared(normalized))
    try { await this.writeJson(this.userSettingsFile, { ...await this.readPersonalSettings(), startup: normalized.startup }) }
    catch (error) {
      if (changed) await this.writeJson(this.layout.settings, shared(previous))
      throw error
    }
    if (changed) {
      await this.updateDefaultSiteUrls(normalized.ports.http)
      await this.invalidatePreviews()
      await this.writeLocalhostWelcome()
    }
    return normalized
  }
  addSite(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { database?: { name: string; importExpected: boolean }; aliases?: string[]; vhostId?: string }) { return this.serialize(() => this.addSiteRecord(input)) }
  private async addSiteRecord(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { database?: { name: string; importExpected: boolean }; aliases?: string[]; vhostId?: string }) {
    this.validateSiteInput(input); await this.assertExternalRoot(input.documentRoot); await this.initialize()
    await this.assertAvailableHostnames([new URL(input.url).hostname, ...(input.aliases ?? [])])
    if (input.vhostId && (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.vhostId) || (await this.getState()).virtualHosts.some(host => host.id === input.vhostId))) throw new Error('Invalid or already allocated Site log identifier.')
    const now = new Date().toISOString(); const id = randomUUID(); const vhostId = input.vhostId ?? randomUUID(); const hostname = new URL(input.url).hostname
    const site: Site = { id, vhostId, name: input.name.trim(), documentRoot: input.documentRoot, url: input.url, ...(input.framework?.trim() ? { framework: input.framework.trim() } : {}), ...(input.database?.name ? { database: { name: input.database.name, importExpected: input.database.importExpected, ready: !input.database.importExpected } } : {}), createdAt: now, updatedAt: now }
    const vhost: VirtualHost = { id: vhostId, hostname, aliases: this.validateAliases(input.aliases ?? []), documentRoot: input.documentRoot, https: { enabled: new URL(input.url).protocol === 'https:' }, rewriteEnabled: true, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true, paths: siteLogPaths(this.layout, vhostId) }, runtimeDocumentRoot: `/var/www/vhostra/${vhostId}` }
    await this.writeSite(site, vhost)
    await this.writeLocalhostWelcome(); return this.getState()
  }
  updateSite(input: Pick<Site, 'id' | 'name' | 'documentRoot' | 'url' | 'framework'> & { database?: { name: string; importExpected: boolean }; aliases?: string[] }) { return this.serialize(() => this.updateSiteRecord(input)) }
  private async updateSiteRecord(input: Pick<Site, 'id' | 'name' | 'documentRoot' | 'url' | 'framework'> & { database?: { name: string; importExpected: boolean }; aliases?: string[] }) {
    const state = await this.getState(); const current = state.sites.find(site => site.id === input.id); if (!current) throw new Error('Site definition not found.')
    if (current.builtIn) throw new Error('The built-in localhost site is protected.'); this.validateSiteInput(input); await this.assertExternalRoot(input.documentRoot)
    const existingHost = state.virtualHosts.find(host => host.id === current.vhostId)
    await this.assertAvailableHostnames([new URL(input.url).hostname, ...(input.aliases ?? existingHost?.aliases ?? [])], current.vhostId)
    const database = input.database?.name ? { name: input.database.name, importExpected: input.database.importExpected, ready: !input.database.importExpected || Boolean(current.database?.ready && current.database.name === input.database.name && current.database.importExpected) } : undefined
    const updated: Site = { ...current, name: input.name.trim(), documentRoot: input.documentRoot, url: input.url, database, ...(input.framework?.trim() ? { framework: input.framework.trim() } : { framework: undefined }), updatedAt: new Date().toISOString(), ...(input.url !== current.url || input.documentRoot !== current.documentRoot || JSON.stringify(database) !== JSON.stringify(current.database) ? { screenshot: undefined } : {}) }
    const vhost = state.virtualHosts.find(host => host.id === current.vhostId); if (!vhost) throw new Error('Related virtual-host definition not found.')
    await this.writeSite(updated, { ...vhost, hostname: new URL(input.url).hostname, aliases: input.aliases === undefined ? vhost.aliases : this.validateAliases(input.aliases), documentRoot: input.documentRoot, https: { enabled: new URL(input.url).protocol === 'https:' } })
    await this.invalidatePreviews();
    if (!updated.screenshot) await fs.rm(path.join(this.layout.screenshots, `${current.id}.jpg`), { force: true })
    await this.writeLocalhostWelcome(); return this.getState()
  }
  restoreSiteDefinition(site: Site, host: VirtualHost) { return this.serialize(async () => {
    const current = (await this.getState()).sites.find(item => item.id === site.id)
    if (!current || current.builtIn || current.vhostId !== host.id || site.vhostId !== host.id) throw new Error('Invalid Site recovery records.')
    await this.writeSite(site, host)
    await this.writeLocalhostWelcome()
  }) }
  private async assertExternalRoot(directory: string) {
    const actual = await fs.realpath(directory).catch(() => path.resolve(directory))
    for (const root of new Set([this.layout.root, this.layout.dataRoot ?? this.layout.root, this.layout.logs, this.layout.userRoot ?? this.layout.root])) {
      const managed = await fs.realpath(root).catch(() => path.resolve(root))
      const within = path.relative(managed, actual); const enclosing = path.relative(actual, managed)
      if ((!within.startsWith('..') && !path.isAbsolute(within)) || (!enclosing.startsWith('..') && !path.isAbsolute(enclosing))) throw new Error('Keep external Site document roots separate from Vhostra managed storage, including symbolic links.')
    }
  }
  removeSite(id: string) { return this.serialize(() => this.removeSiteRecord(id)) }
  private async removeSiteRecord(id: string) {
    const state = await this.getState(); const site = state.sites.find(item => item.id === id); if (!site) throw new Error('Site definition not found.'); if (site.builtIn === 'localhost') throw new Error('The built-in localhost vhost is protected. Its document root and configuration remain inspectable.')
    if (this.machinePaths) await authorizeProtectedTransaction({ version: 1, operations: [{ type: 'delete-site', id: site.id }] })
    else await fs.rm(this.recordPath(this.layout.sites, site.id), { force: true })
    await fs.rm(path.join(this.layout.screenshots, `${site.id}.jpg`), { force: true })
    await this.writeLocalhostWelcome(); return this.getState()
  }
  async setVirtualHostRewrite(id: string, enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid rewrite setting.')
    const state = await this.getState(); const host = state.virtualHosts.find(item => item.id === id)
    if (!host) throw new Error('Virtual-host definition not found.')
    await this.writeHost({ ...host, rewriteEnabled: enabled })
    return this.getState()
  }
  importNative(preview: NativeImportPreview, plans: Record<string, string> = {}) { return this.serialize(async () => {
    if (preview.status === 'Invalid' || !preview.hosts.length) throw new Error('Invalid configuration cannot be imported.')
    for (const host of preview.hosts) {
      this.validateSiteInput({ name: host.portableSite?.name ?? host.hostname, documentRoot: host.documentRoot, url: host.portableSite?.url ?? `http://${host.hostname}`, aliases: host.aliases }); await this.assertExternalRoot(host.documentRoot)
      await this.assertAvailableHostnames([host.hostname, ...host.aliases])
    }
    const snapshot = path.join(this.layout.backups, `before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await this.exportBundle(snapshot, true)
    const recovery = JSON.parse(await fs.readFile(snapshot, 'utf8')); recovery.manifest.automaticRecovery = { owner: 'vhostra', state: 'active', createdAt: new Date().toISOString() }; await this.writeJson(snapshot, recovery)
    const created: Site[] = []
    try {
      const ports = (await this.getState()).settings.ports
      for (const host of preview.hosts) {
        const protocol = host.https.enabled ? 'https' : 'http'; const port = host.https.enabled ? ports.https : ports.http
        const state = await this.addSiteRecord({ name: host.portableSite?.name ?? host.hostname, documentRoot: host.documentRoot, url: host.portableSite?.url ?? `${protocol}://${host.hostname}${port === (host.https.enabled ? 443 : 80) ? '' : `:${port}`}/`, aliases: host.aliases, framework: host.portableSite?.framework, database: host.portableSite?.database ? { name: host.portableSite.database.name, importExpected: true } : undefined, vhostId: plans[host.hostname] })
        const site = state.sites.find(site => new URL(site.url).hostname === host.hostname)!; created.push(site)
        const canonical = state.virtualHosts.find(item => item.id === site.vhostId)!
        const imported = host.canonical
        await this.writeHost({ ...canonical, ...(imported ? { ...imported, id: canonical.id, documentRoot: host.documentRoot, runtimeDocumentRoot: runtimeDocumentRoot(canonical), logs: { ...imported.logs, paths: siteLogPaths(this.layout, canonical.id) } } : { rewriteEnabled: host.rewriteEnabled, indexFiles: host.indexFiles, ...importedMetadata(preview) }) })
      }
      recovery.manifest.automaticRecovery.state = 'completed'; await this.writeJson(snapshot, recovery)
      await this.retainCompletedImportSnapshots().catch(error => console.error('Import snapshot cleanup deferred:', error.message))
      return { imported: created, backup: snapshot, message: `Imported ${created.length} canonical virtual host(s). ${preview.warnings.join(' ')}` }
    } catch (error) {
      for (const site of created) await this.removeSiteRecord(site.id)
      throw error
    }
  }) }
  private async invalidatePreviews() {
    const state = await this.getState()
    for (const site of state.sites) if (site.screenshot && !previewMatches(state, site)) {
      await this.writeSite({ ...site, screenshot: undefined })
      await fs.rm(path.join(this.layout.screenshots, `${site.id}.jpg`), { force: true })
    }
  }
  /** Static previews are capped and read only for the browser image request—never retained in app state. */
  async readScreenshot(siteId: string) {
    if (siteId !== localhostSiteId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)) return null
    await this.initialize()
    try {
      const site = JSON.parse(await fs.readFile(this.recordPath(this.layout.sites, siteId), 'utf8')) as Site
      if (!site.screenshot || !/^[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/i.test(site.screenshot.cacheFile)) return null
      const file = path.join(this.layout.screenshots, site.screenshot.cacheFile);
      const actual = await fs.realpath(file); const cacheRoot = await fs.realpath(this.layout.screenshots)
      if (!actual.startsWith(cacheRoot + path.sep)) return null
      const details = await fs.stat(file)
      if (!details.isFile() || details.size > 6 * 1024 * 1024) return null
      const extension = path.extname(file).toLowerCase(); const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
      return { data: await fs.readFile(file), mime }
    } catch { return null }
  }
  saveScreenshot(id: string, expectedUrl: string, bytes: Buffer, source: Screenshot['source'], expected?: Pick<Site, 'documentRoot' | 'updatedAt'>, resolved?: { url: string; identity: string }) { return this.serialize(async () => {
    await this.initialize()
    const current = await this.getState(); const site = current.sites.find(site => site.id === id)
    if (!site || resolved && !previewMatches(current, { ...site, screenshot: { cacheFile: `${id}.jpg`, capturedAt: '', source, ...resolved } }) || site.url !== expectedUrl || expected && (site.documentRoot !== expected.documentRoot || site.updatedAt !== expected.updatedAt)) throw new Error('Site changed during capture; preview discarded.')
    if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('Preview exceeds the local cache limit.')
    const cacheFile = `${id}.jpg`
    await fs.mkdir(this.layout.screenshots, { recursive: true })
    const cacheRoot = await fs.realpath(this.layout.screenshots); const managedRoot = await fs.realpath(this.layout.userRoot ?? this.layout.root)
    if (!cacheRoot.startsWith(managedRoot + path.sep)) throw new Error('Preview cache must stay in Vhostra managed storage.')
    const temporary = path.join(cacheRoot, `${id}.${randomUUID()}.tmp`)
    try { await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, path.join(cacheRoot, cacheFile)) }
    finally { await fs.rm(temporary, { force: true }) }
    await this.writeSite({ ...site, screenshot: { cacheFile, capturedAt: new Date().toISOString(), source, ...resolved } })
    // Only exact Vhostra UUID preview files lacking a live Site are obsolete.
    const ids = new Set((await this.getState()).sites.map(site => `${site.id}.jpg`))
    for (const file of await fs.readdir(this.layout.screenshots)) if ((/^[a-f0-9-]{36}\.jpg$/i.test(file) || file === `${localhostSiteId}.jpg`) && !ids.has(file)) await fs.rm(path.join(this.layout.screenshots, file), { force: true })
  }) }
  async exportBundle(destination: string, includePrivateSource = false) {
    const state = await this.getState();
    // Native source can contain arbitrary secrets. Keep it locally, but do not
    // put unclassified raw directives in the default secret-free portable export.
    const portable = includePrivateSource ? state : { ...state, virtualHosts: state.virtualHosts.map(host => host.source ? { ...host, source: { ...host.source, raw: undefined, warnings: [...host.source.warnings, 'Raw native source and preserved directives excluded from this secret-free export; retained in the original local canonical record.'] }, preservedDirectives: undefined } : host) };
    const bundle = { manifest: { format: 'vhostra/config-bundle', schemaVersion: 1, bundleId: randomUUID(), createdAt: new Date().toISOString(), appVersion: '1.0.0', scopes: ['all'], excludedByDefault: ['website-content', 'database-content', 'passwords-and-secrets', 'private-tls-keys'], includesPrivateKeys: false, includesSecrets: includePrivateSource, settingsFingerprint: fingerprint(portable.settings), siteIdentities: portable.sites.filter(site => !site.builtIn).map(site => { const host = portable.virtualHosts.find(host => host.id === site.vhostId)!; return { siteId: site.id, canonicalId: host.id, hostname: host.hostname, fingerprint: fingerprint(siteDefinition(site, host as VirtualHost)) } }), entries: [{ id: 'settings', type: 'settings', relativePath: 'settings.json', ownership: 'vhostra-source' }, { id: 'sites', type: 'site', relativePath: 'sites/', ownership: 'vhostra-source' }, { id: 'virtual-hosts', type: 'virtual-host', relativePath: 'virtual-hosts/', ownership: 'vhostra-source' }] }, configuration: portable, preferences: { theme: (await this.getOnboarding()).theme } }
    if (Buffer.byteLength(JSON.stringify(bundle)) > 4 * 1024 * 1024) throw new Error('Configuration exceeds the 4 MiB portable backup limit. Export smaller Site sets before a complete backup.');
    await this.writeJson(destination, bundle); return destination
  }
  async previewBundle(source: string) {
    const candidate = await this.readBundle(source)
    const existing = await this.getState()
    const warnings = ['This configuration bundle excludes website files, database data/accounts, secrets and private keys. Site root contents are never overwritten.']
    const sites = candidate.configuration.sites.filter((site: Site) => !site.builtIn).map((site: Site) => {
      const host = candidate.configuration.virtualHosts.find((host: VirtualHost) => host.id === site.vhostId)!
      const names = [host.hostname, ...host.aliases].map(name => name.toLowerCase())
      const collisions = existing.virtualHosts.filter(current => current.id === host.id || existing.sites.some(localSite => localSite.id === site.id && localSite.vhostId === current.id) || [current.hostname, ...current.aliases].some(name => names.includes(name.toLowerCase())))
      const local = collisions.length === 1 ? existing.sites.find(current => current.vhostId === collisions[0].id && !current.builtIn) : undefined
      const localHost = local ? collisions[0] : undefined
      const definition = siteDefinition(site, host)
      const localDefinition = local && localHost ? siteDefinition(local, localHost) : undefined
      const disposition = !collisions.length ? 'new' : !localDefinition ? 'incompatible' : fingerprint(localDefinition) === fingerprint(definition) ? 'equivalent' : 'conflict'
      if (disposition === 'conflict') warnings.push(`${host.hostname}: existing configuration differs; choose Keep Existing, Replace with Backup or Skip.`)
      if (disposition === 'incompatible') warnings.push(`${host.hostname}: collides with multiple Sites or protected localhost; replacement is unavailable.`)
      if ([host.redirects, host.rewrites, host.headers].some(rules => rules?.length)) warnings.push(`${host.hostname}: Requires review — custom redirect, rewrite and header rules are preserved as canonical metadata but are not activated by this generator.`);
      if (host.source?.status === 'Requires review' || host.preservedDirectives?.length) warnings.push(`${host.hostname}: Requires review — unsupported source directives are retained but not activated on another server.`)
      return { canonicalId: host.id, name: site.name, hostname: host.hostname, documentRoot: site.documentRoot, disposition, localId: local?.id, differences: localDefinition ? differences(localDefinition, definition) : [], local: localDefinition, incoming: definition }
    })
    for (const site of sites) if (!(await fs.stat(site.documentRoot).catch(() => null))?.isDirectory()) warnings.push(`${site.hostname}: host document root is unavailable on this computer. Edit the Site path before starting Services.`)
    const settings = candidate.configuration.settings
    const localPreferences = await this.getOnboarding()
    const settingsDisposition = !settings ? null : !existing.sites.some(site => !site.builtIn) && !localPreferences.completed && !localPreferences.ready ? 'new' : fingerprint(existing.settings) === fingerprint(this.normalizeSettings(settings)) ? 'equivalent' : 'conflict'
    const configurationItems = settingsDisposition ? [{ key: 'settings', category: 'settings' as const, name: 'Vhostra settings', disposition: settingsDisposition, detail: settingsDisposition === 'conflict' ? 'The saved server/PHP, ports, cache and extension preferences differ. Replace applies backup preferences; Keep Existing preserves current settings. Login/service autostart are never enabled solely from a backup.' : 'Restore the included environment preferences.', local: existing.settings, incoming: this.normalizeSettings(settings) }] : []
    return { configurationItems, manifest: candidate.manifest, source, checksum: candidate.checksum, sites, settings: settings ? { server: settings.selectedWebServer, php: settings.selectedPhpVersion, optionalServices: settings.optionalServices } : null,
      missing: [!settings?.selectedWebServer && 'server', !settings?.selectedPhpVersion && 'php', !settings?.optionalServices && 'cache'].filter(Boolean) as string[], warnings }
  }
  private async readBundle(source: string) {
    const details = await fs.stat(source)
    if (!details.isFile() || details.size > 4 * 1024 * 1024) throw new Error('Choose a Vhostra JSON configuration backup no larger than 4 MiB.')
    const raw = await fs.readFile(source, 'utf8')
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('Backup grew beyond the supported size.')
    const candidate = JSON.parse(raw)
    if (candidate.manifest?.format !== 'vhostra/config-bundle' || candidate.manifest.schemaVersion !== 1 || !Array.isArray(candidate.manifest.entries) || !Array.isArray(candidate.configuration?.sites) || !Array.isArray(candidate.configuration?.virtualHosts)) throw new Error('This file is not a supported Vhostra configuration bundle.')
    if (candidate.manifest.entries.some((entry: { type: string; ownership?: string }) => !['settings', 'site', 'virtual-host'].includes(entry.type) && entry.ownership !== 'generated-runtime-reference')) throw new Error('Configuration bundle contains unsupported components; no state was silently omitted.');
    if (candidate.databases || candidate.accounts || candidate.databaseBackup || candidate.manifest.includesSecrets && !candidate.manifest.excludedByDefault?.includes('database-content')) throw new Error('Use a supported full-backup manifest for database/account restoration; unknown database payload cannot be omitted.');
    if (candidate.configuration.sites.length > 500 || candidate.configuration.virtualHosts.length > 500) throw new Error('A backup can contain at most 500 Site definitions.')
    const names = new Set<string>(); const siteIds = new Set<string>(); const hostIds = new Set<string>()
    for (const site of candidate.configuration.sites as Site[]) {
      if (site.builtIn === 'localhost') continue
      if (siteIds.has(site.id) || hostIds.has(site.vhostId)) throw new Error('Duplicate canonical identity in backup.'); siteIds.add(site.id); hostIds.add(site.vhostId)
      const host = candidate.configuration.virtualHosts.find((host: VirtualHost) => host.id === site.vhostId)
      if (!host || host.documentRoot !== site.documentRoot || new URL(site.url).hostname !== host.hostname) throw new Error('Backup Site and canonical configuration disagree.')
      this.validateSiteInput({ ...site, aliases: host.aliases }, true)
      if (!Array.isArray(host.aliases) || typeof host.https?.enabled !== 'boolean') throw new Error('Invalid canonical configuration in backup.')
      for (const name of [host.hostname, ...host.aliases]) { if (names.has(name.toLowerCase())) throw new Error('Duplicate hostname in backup.'); names.add(name.toLowerCase()) }
      if (host.indexFiles && (!Array.isArray(host.indexFiles) || !host.indexFiles.length || host.indexFiles.length > 16 || host.indexFiles.some((index: unknown) => typeof index !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(index)))) throw new Error('Invalid backup index filename.')
    }
    if (candidate.configuration.settings) this.validateSettings(this.normalizeSettings(candidate.configuration.settings))
    return { ...candidate, checksum: createHash('sha256').update(raw).digest('hex') }
  }
  async restoreOnboardingBundle(source: string, checksum: string, roots: Record<string, string> = {}, plans: Record<string, string> = {}, choices: RestoreChoices = {}, progress: (message: string) => void = () => {}) {
    if ((await this.getOnboarding()).completed) throw new Error('Use Sites import for an existing profile; setup restoration cannot overwrite current settings.')
    const candidate = await this.readBundle(source)
    if (candidate.checksum !== checksum) throw new Error('Backup changed after preview. Select and review it again.')
    const preview = await this.previewBundle(source)
    for (const site of preview.sites.filter((site: { disposition: string; hostname: string; documentRoot: string }) => site.disposition === 'new' || choices[site.hostname] === 'replace')) {
      const root = roots[site.hostname] ?? site.documentRoot
      if (typeof root !== 'string' || !path.isAbsolute(root) || !(await fs.stat(root).catch(() => null))?.isDirectory()) throw new Error(`Choose an existing host document root for ${site.hostname} before restoring.`)
    }
    if (preview.configurationItems[0]?.disposition === 'conflict' && !['keep', 'replace', 'skip'].includes(choices.settings)) throw new Error('Settings conflict review required before restore.');
    const result = await this.importBundle(source, roots, checksum, plans, choices, progress)
    const previous = await this.getOnboarding()
    const settingsItem = preview.configurationItems[0]
    if (settingsItem?.disposition === 'conflict' && !['keep', 'replace', 'skip'].includes(choices.settings)) throw new Error('Settings conflict review required before restore.')
    if (candidate.configuration.settings) {
      const keep = choices.settings === 'keep' || choices.settings === 'skip' || settingsItem?.disposition === 'equivalent'
      const settings = keep ? (await this.getState()).settings : this.normalizeSettings(candidate.configuration.settings)
      // Login integration is a native action, not merely a restored JSON flag.
      if (!keep) { settings.startup.launchAtLogin = false; settings.startup.serviceStartMode = 'manual'; await this.saveSettings(settings) }
      const theme = ['light', 'dark', 'system'].includes(candidate.preferences?.theme) ? candidate.preferences.theme : previous.theme
      await this.saveOnboarding({ ...previous, theme, server: settings.selectedWebServer, php: settings.selectedPhpVersion,
        cache: settings.optionalServices.redis ? 'redis' : settings.optionalServices.memcached ? 'memcached' : 'none', restoredServices: settings.optionalServices })
    }
    if (candidate.configuration.settings) { if (choices.settings === 'keep' || choices.settings === 'skip' || settingsItem?.disposition === 'equivalent') result.summary.skipped++; else result.summary.imported++ }
    return { ...result, warnings: preview.warnings.filter(warning => !Object.keys(roots).some(hostname => warning.startsWith(`${hostname}: host document root is unavailable`))), missing: preview.missing, preferences: await this.getOnboarding() }
  }
  /** Imports portable site definitions only. Website files, database data, and
   * secrets are intentionally outside configuration bundles and are never copied. */
  importBundle(source: string, roots: Record<string, string> = {}, checksum?: string, plans: Record<string, string> = {}, choices: RestoreChoices = {}, progress: (message: string) => void = () => {}) { return this.serialize(() => this.importBundleRecords(source, roots, checksum, plans, choices, progress)) }
  private async importBundleRecords(source: string, roots: Record<string, string>, checksum: string | undefined, plans: Record<string, string>, choices: RestoreChoices, progress: (message: string) => void) {
    const candidate = await this.readBundle(source) as { configuration: AppState; checksum: string }
    if (checksum && candidate.checksum !== checksum) throw new Error('Backup changed after preview. Select and review it again.')
    const preview = await this.previewBundle(source)
    await this.initialize()
    const snapshot = path.join(this.layout.backups, `before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await this.exportBundle(snapshot, true)
    const recovery = JSON.parse(await fs.readFile(snapshot, 'utf8'))
    recovery.manifest.automaticRecovery = { owner: 'vhostra', state: 'active', createdAt: new Date().toISOString() }
    await this.writeJson(snapshot, recovery)
    const imported: Array<{ name: string; hostname: string; aliases: string[] }> = []
    const existing = await this.getState()
    const summary = { imported: 0, skipped: 0, replaced: 0, conflicted: 0, failed: 0 }
    const planned: Array<{ incoming: Site; host: VirtualHost; localId?: string }> = []
    for (const item of preview.sites) {
      const choice = choices[item.hostname]
      if (choice !== undefined && !['keep', 'replace', 'skip'].includes(choice)) throw new Error('Invalid conflict choice.')
      if (item.disposition === 'incompatible') { if (choice !== 'skip' && choice !== 'keep') throw new Error(`${item.hostname}: incompatible hostname collision; explicitly skip this item.`); summary.skipped++; continue }
      if (item.disposition === 'conflict' && !choice) throw new Error(`${item.hostname}: conflict review required before restore.`)
      if (item.disposition === 'equivalent' || choice === 'skip' || choice === 'keep') { summary.skipped++; progress(`${item.hostname} — skipping`); continue }
      const site = candidate.configuration.sites.find(site => !site.builtIn && new URL(site.url).hostname === item.hostname)!
      const host = candidate.configuration.virtualHosts.find(host => host.id === site.vhostId)!
      const incoming = { ...site, documentRoot: roots[item.hostname] ?? site.documentRoot }
      this.validateSiteInput({ ...incoming, aliases: host.aliases }); await this.assertExternalRoot(incoming.documentRoot)
      planned.push({ incoming, host, localId: item.disposition === 'conflict' ? item.localId : undefined })
    }
    const created: string[] = []
    try { for (const { incoming, host, localId } of planned) {
      progress(`${localId ? 'Replacing' : 'Importing'} ${host.hostname}…`)
      const localSite = localId ? existing.sites.find(site => site.id === localId)! : undefined
      if (this.validateHostMappings) await this.validateHostMappings([host.hostname, ...host.aliases])
      let saved: VirtualHost
      if (localSite) saved = existing.virtualHosts.find(item => item.id === localSite.vhostId)!
      else {
        const added = await this.addSiteRecord({ name: incoming.name, documentRoot: incoming.documentRoot, url: incoming.url, framework: incoming.framework, aliases: host.aliases, vhostId: plans[host.hostname] ?? (/^[a-f0-9-]{36}$/i.test(host.id) ? host.id : undefined) })
        const addedSite = added.sites.find(item => item.url === incoming.url)!
        created.push(addedSite.id)
        saved = added.virtualHosts.find(item => item.id === addedSite.vhostId)!
      }
      const siteId = localSite?.id ?? created.at(-1)!
      const currentSite = (await this.getState()).sites.find(site => site.id === siteId)!
      await this.writeSite({ ...currentSite, name: incoming.name, framework: incoming.framework, documentRoot: incoming.documentRoot, url: incoming.url, screenshot: undefined, updatedAt: new Date().toISOString() }, { ...host, id: saved.id, documentRoot: incoming.documentRoot, runtimeDocumentRoot: runtimeDocumentRoot(saved), logs: { ...host.logs, paths: siteLogPaths(this.layout, saved.id) } })
      imported.push({ name: incoming.name, hostname: host.hostname, aliases: host.aliases })
      if (localSite) summary.replaced++; else summary.imported++
    }
      await this.writeLocalhostWelcome()
    } catch (error) {
      for (const id of created) await this.removeSiteRecord(id)
      for (const site of existing.sites) await this.writeSite(site, existing.virtualHosts.find(host => host.id === site.vhostId))
      recovery.manifest.automaticRecovery.state = 'failed'; await this.writeJson(snapshot, recovery)
      await this.writeLocalhostWelcome()
      throw new Error(`Restore failed; original Site definitions recovered. Recovery snapshot: ${snapshot}. ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    recovery.manifest.automaticRecovery.state = 'completed'
    await this.writeJson(snapshot, recovery)
    await this.retainCompletedImportSnapshots().catch(error => console.error('Vhostra snapshot retention deferred:', error.message))
    return { imported, summary, warnings: preview.warnings, backup: snapshot, message: imported.length ? `Imported ${imported.length} portable site definition${imported.length === 1 ? '' : 's'}.` : 'No new portable site definitions were found in this bundle.' }
  }
  async assertResetSafe() {
    const state = await this.getState()
    const targets = [path.dirname(this.layout.runtime.apache), this.layout.persistentData.mariaDb, this.layout.certificates.directory, this.layout.configuration.generated]
    for (const target of targets) {
      const resolved = await fs.realpath(target).catch(() => path.resolve(target))
      const realRoot = await fs.realpath(this.layout.root)
      if (!resolved.startsWith(`${realRoot}${path.sep}`)) throw new Error('Reset refused: a managed data directory points outside Vhostra storage.')
      for (const site of state.sites.filter(site => !site.builtIn)) {
        const documentRoot = await fs.realpath(site.documentRoot).catch(() => path.resolve(site.documentRoot))
        if (documentRoot === resolved || documentRoot.startsWith(`${resolved}${path.sep}`) || resolved.startsWith(`${documentRoot}${path.sep}`)) throw new Error(`Reset refused to preserve site files: ${site.name} overlaps managed runtime/database storage. Move its document root before reset.`)
      }
    }
  }
  resetConfiguration(keepSites: boolean) { return this.serialize(async () => {
    if (this.machinePaths) throw new Error('Machine storage reset requires a scoped privileged reset transaction.')
    if (typeof keepSites !== 'boolean') throw new Error('Choose whether to keep Site configurations.')
    await this.assertResetSafe()
    await this.exportBundle(path.join(this.layout.backups, `before-reset-${Date.now()}.json`))
    const previousPorts = (await this.getState()).settings.ports
    // Records only. Never remove the sites directory or document roots.
    if (!keepSites) {
      for (const site of (await this.getState()).sites.filter(site => !site.builtIn)) await this.removeSiteRecord(site.id)
      // Canonical virtual hosts are embedded in Site records.
    }
    const runtimeRoot = path.dirname(this.layout.runtime.apache)
    for (const entry of await fs.readdir(runtimeRoot, { withFileTypes: true })) {
      if (keepSites && entry.name === path.basename(this.layout.runtime.mariaDb)) continue
      await fs.rm(path.join(runtimeRoot, entry.name), { recursive: true, force: true })
    }
    if (!keepSites) for (const target of [this.layout.persistentData.mariaDb, this.layout.certificates.directory]) await fs.rm(target, { recursive: true, force: true })
    await this.writeJson(this.layout.settings, keepSites ? { ...defaults, ports: previousPorts } : defaults)
    await this.writeJson(this.userSettingsFile, { startup: defaults.startup, theme: 'system', onboardingCompleted: false })
    await this.writeJson(path.join(this.layout.root, 'onboarding.json'), { completed: false, theme: 'system', server: defaults.selectedWebServer, php: defaults.selectedPhpVersion, cache: 'none' })
    // Generated native configuration is reproducible; delete positively owned files only.
    const generated = await import('./generated-config.js')
    for (const server of ['apache', 'nginx', 'openlitespeed'] as WebServer[]) await generated.cleanObsoleteGenerated(this.layout.configuration.generated, server)
    await fs.rm(path.join(this.layout.configuration.generated, 'runtime-selection.json'), { force: true })
    this.initialized = null; await this.initialize()
    return { message: `Vhostra reset. MariaDB databases/users/roles/grants ${keepSites ? 'preserved' : 'removed'}; Site configurations ${keepSites ? 'kept' : 'removed'}. External site files untouched.` }
  }) }
  /** Keep ten completed automatic configuration snapshots. Active/failed imports,
   * exported user backups, website/database content, and unknown files are untouched. */
  private async retainCompletedImportSnapshots() {
    const completed: Array<{ file: string; createdAt: string }> = []
    for (const entry of await fs.readdir(this.layout.backups, { withFileTypes: true })) {
      if (!entry.isFile() || !/^before-import-[0-9TZ-]+\.json$/.test(entry.name)) continue
      const file = path.join(this.layout.backups, entry.name)
      try {
        const { manifest } = JSON.parse(await fs.readFile(file, 'utf8'))
        const recovery = manifest?.automaticRecovery
        if (manifest?.format === 'vhostra/config-bundle' && recovery?.owner === 'vhostra' && recovery.state === 'completed'
          && Number.isFinite(Date.parse(recovery.createdAt))) completed.push({ file, createdAt: recovery.createdAt })
      } catch { /* Unknown or incomplete artifacts are preserved. */ }
    }
    completed.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    for (const snapshot of completed.slice(10)) await fs.rm(snapshot.file)
  }
  private async initializeOnce() {
    if (this.machinePaths) {
      await Promise.all([this.layout.screenshots, this.layout.exports, this.layout.backups].map(directory => fs.mkdir(directory, { recursive: true })))
    } else await Promise.all(Object.values(this.directories()).map(directory => fs.mkdir(directory, { recursive: true })))
    const onboardingFile = path.join(this.layout.root, 'onboarding.json')
    if (!existsSync(onboardingFile)) {
      let existing = false
      try { this.validateSettings(this.normalizeSettings(JSON.parse(await fs.readFile(this.layout.settings, 'utf8')))); existing = true } catch { /* check legacy site/runtime evidence below */ }
      if (!existing) {
        try { const healthy = JSON.parse(await fs.readFile(path.join(path.dirname(this.layout.runtime.apache), 'healthy-state.json'), 'utf8')); this.validateSettings(this.normalizeSettings(healthy.settings)); existing = true } catch { /* no verified prior runtime */ }
        for (const filename of await fs.readdir(this.layout.sites)) {
          if (existing || !filename.endsWith('.json')) continue
          try { const site = JSON.parse(await fs.readFile(path.join(this.layout.sites, filename), 'utf8')); if (!site.builtIn && typeof site.vhostId === 'string' && /^[a-f0-9-]{36}$/i.test(site.vhostId)) { this.validateSiteInput(site); existing = true } } catch { /* invalid legacy records are not onboarding evidence */ }
        }
      }
      await this.writeJson(onboardingFile, { completed: existing, theme: 'system', server: defaults.selectedWebServer, php: defaults.selectedPhpVersion, cache: 'none' })
    }
    await this.readSettings()
    await this.migrateUnifiedSites()
    await this.ensureLocalhostDefinition()
    for (const host of (await this.readRecords<Site>(this.layout.sites)).map(site => site.configuration).filter((host): host is VirtualHost => Boolean(host))) {
      const paths = siteLogPaths(this.layout, host.id)
      if (JSON.stringify(host.logs?.paths) !== JSON.stringify(paths) || host.runtimeDocumentRoot !== runtimeDocumentRoot(host)) await this.writeHost({ ...host, logs: { ...host.logs, access: host.logs?.access ?? true, error: host.logs?.error ?? true, paths }, runtimeDocumentRoot: runtimeDocumentRoot(host) })
    }
    await this.writeLocalhostWelcome()
  }
  private directories() {
    const { configuration, runtime, certificates } = this.layout
    return { root: this.layout.root, sites: this.layout.sites, virtualHosts: this.layout.virtualHosts, screenshots: this.layout.screenshots, exports: this.layout.exports, backups: this.layout.backups, logs: this.layout.logs, ...configuration, ...runtime, certificates: certificates.directory, publicCertificates: certificates.public, privateCertificates: certificates.private, mariaDbData: this.layout.persistentData.mariaDb }
  }
  private async migrateUnifiedSites() {
    const legacyFiles = (await fs.readdir(this.layout.virtualHosts).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]; throw error })).filter(name => name.endsWith('.json'))
    const sites = await this.readRecords<Site>(this.layout.sites)
    if (!legacyFiles.length && sites.every(site => Boolean(site.configuration))) return
    if (this.machinePaths) throw new Error('Legacy Site consolidation requires a scoped privileged transaction before machine storage can be used.')
    const legacy = await this.readRecords<VirtualHost>(this.layout.virtualHosts)
    const hosts = new Map(legacy.map(host => [host.id, host]))
    const merged = sites.map(site => {
      const host = site.configuration ?? hosts.get(site.vhostId)
      if (!host || host.id !== site.vhostId || host.documentRoot !== site.documentRoot || new URL(site.url).hostname !== host.hostname) throw new Error(`Cannot safely consolidate Site ${site.id}: its configuration disagrees.`)
      return { ...site, configuration: host }
    })
    if (new Set(merged.map(site => site.id)).size !== merged.length || new Set(merged.map(site => site.vhostId)).size !== merged.length) throw new Error('Duplicate Site identity prevents safe consolidation.')
    const names = merged.flatMap(site => [site.configuration.hostname, ...site.configuration.aliases].map(name => name.toLowerCase()))
    if (new Set(names).size !== names.length) throw new Error('Duplicate Site hostname or alias prevents safe consolidation.')
    const backup = path.join(this.layout.backups, `before-unified-sites-${randomUUID()}`)
    await fs.mkdir(backup, { recursive: true })
    try {
      for (const directory of [this.layout.sites, this.layout.virtualHosts]) {
        const destination = path.join(backup, path.basename(directory))
        await fs.mkdir(destination)
        for (const name of (await fs.readdir(directory)).filter(name => name.endsWith('.json'))) {
          const file = path.join(directory, name)
          if (!(await fs.lstat(file)).isFile()) throw new Error('Site migration requires regular configuration files.')
          await fs.copyFile(file, path.join(destination, name))
        }
      }
    }
    catch (error) { await fs.rm(backup, { recursive: true, force: true }); throw error }
    try {
      for (const site of merged) await this.writeJson(this.recordPath(this.layout.sites, site.id), site)
      for (const site of merged) {
        const saved = JSON.parse(await fs.readFile(this.recordPath(this.layout.sites, site.id), 'utf8')) as Site
        if (!saved.configuration || saved.configuration.id !== site.vhostId || saved.configuration.hostname !== site.configuration.hostname) throw new Error('Unified Site verification failed.')
      }
      for (const filename of legacyFiles) await fs.rm(path.join(this.layout.virtualHosts, filename))
      const completed = (await fs.readdir(this.layout.backups)).filter(name => /^before-unified-sites-[a-f0-9-]{36}$/.test(name)).sort()
      for (const old of completed.slice(0, -2)) await fs.rm(path.join(this.layout.backups, old), { recursive: true, force: true })
      this.didMigrateUnifiedSites = true
    } catch (error) {
      await fs.cp(path.join(backup, 'sites'), this.layout.sites, { recursive: true, force: true })
      await fs.cp(path.join(backup, 'virtual-hosts'), this.layout.virtualHosts, { recursive: true, force: true })
      throw error
    }
  }
  private recordPath(directory: string, id: string) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) && ![localhostSiteId, localhostVhostId].includes(id)) throw new Error('Invalid Site identifier.'); return path.join(directory, `${id}.json`) }
  private async readSettings() {
    let value: Partial<Settings>
    try { value = JSON.parse(await fs.readFile(this.layout.settings, 'utf8')) as Partial<Settings> }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      value = { ...defaults }; await this.writeJson(this.layout.settings, value)
    }
    // Only the legacy root owned by this account can supply a startup preference.
    // Another account opening a shared store starts with its own defaults.
    const legacyStartup = this.layout.root.startsWith(`${path.resolve(this.userData)}${path.sep}`) ? value.startup : undefined
    const personal = await this.readPersonalSettings()
    const normalized = this.normalizeSettings({ ...value, startup: personal.startup ?? legacyStartup ?? defaults.startup })
    this.validateSettings(normalized)
    if (!personal.startup) await this.writeJson(this.userSettingsFile, { ...personal, startup: normalized.startup })
    if (value.startup) {
      const { startup: _startup, ...shared } = value
      await this.writeJson(this.layout.settings, shared)
    }
    return normalized
  }
  private async readRecords<T>(directory: string) { const files = await fs.readdir(directory); const records = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')) as T)); return records }
  private async writeJson(file: string, value: unknown) {
    if (this.machinePaths) {
      const object = file === this.layout.settings ? 'settings' : file === path.join(this.layout.root, 'onboarding.json') ? 'onboarding' : null
      if (object) { await authorizeProtectedTransaction({ version: 1, operations: [{ type: 'system-json', object, value }] }); return }
      if (path.dirname(file) === this.layout.sites && file.endsWith('.json')) {
        const id = path.basename(file, '.json')
        await authorizeProtectedTransaction({ version: 1, operations: [{ type: 'system-json', object: 'site', id, value }] }); return
      }
      for (const root of [this.layout.root, this.layout.dataRoot!, this.layout.logs]) {
        if (file === root || file.startsWith(`${root}${path.sep}`)) throw new Error('Machine configuration mutation is not allowlisted.')
      }
    }
    await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`; try { await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await fs.rename(temporary, file) } finally { await fs.rm(temporary, { force: true }) }
  }
  private async ensureLocalhostDefinition() {
    if (this.machinePaths) throw new Error('Machine built-in content requires a bounded publisher before Store startup.')
    const documentRoot = this.layout.builtinPublic; const now = new Date().toISOString()
    await fs.mkdir(documentRoot, { recursive: true })
    try { await fs.access(this.recordPath(this.layout.sites, localhostSiteId)) } catch { await this.writeSite({ id: localhostSiteId, name: 'Vhostra Localhost', documentRoot, url: 'http://localhost/', vhostId: localhostVhostId, builtIn: 'localhost', createdAt: now, updatedAt: now }, { id: localhostVhostId, hostname: 'localhost', aliases: [], documentRoot, https: { enabled: false }, rewriteEnabled: true, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true }, builtIn: 'localhost' }) }
  }
  private async writeLocalhostWelcome(runtimeMessage = 'Runtime has not been created.') {
    if (this.machinePaths) throw new Error('Machine welcome content requires a bounded publisher before Store startup.')
    const root = this.layout.builtinPublic; const template = this.welcomeTemplateDirectory ? path.join(this.welcomeTemplateDirectory, 'index.html') : ''
    try {
      if (this.welcomeTemplateDirectory) await fs.cp(this.welcomeTemplateDirectory, root, { recursive: true, force: true })
      const [settings, sites] = await Promise.all([this.readSettings(), this.readRecords<Site>(this.layout.sites)])
      const source = template ? await fs.readFile(template, 'utf8') : fallbackWelcomeTemplate
      const siteLinks = sites.filter(site => site.builtIn !== 'localhost').map(site => `<a class="site-link" href="${escapeHtml(site.url)}">${escapeHtml(site.name)}<span>${escapeHtml(site.url)}</span></a>`).join('') || '<p class="empty">Add a site in the Vhostra desktop app to see it here.</p>'
      const server = settings.selectedWebServer === 'openlitespeed' ? 'OpenLiteSpeed' : settings.selectedWebServer === 'nginx' ? 'Nginx' : 'Apache'
      const serverIcon = settings.selectedWebServer === 'apache' ? 'services/apache_feather_bullet.gif' : settings.selectedWebServer === 'openlitespeed' ? 'services/openlitespeed.png' : 'services/nginx.ico'
      const theme = JSON.parse(await fs.readFile(path.join(this.layout.root, 'onboarding.json'), 'utf8')).theme ?? 'system'
      const html = source.replaceAll('{{theme}}', theme).replaceAll('{{server}}', escapeHtml(server)).replaceAll('{{server-icon}}', serverIcon).replaceAll('{{php}}', `PHP ${escapeHtml(settings.selectedPhpVersion)}`).replaceAll('{{runtime}}', escapeHtml(runtimeMessage)).replaceAll('{{redis}}', settings.optionalServices.redis ? 'Enabled when runtime is configured' : 'Disabled').replaceAll('{{memcached}}', settings.optionalServices.memcached ? 'Enabled when runtime is configured' : 'Disabled').replaceAll('{{sites}}', siteLinks)
      await fs.writeFile(path.join(root, 'index.html'), html, { mode: 0o600 })
    } catch { /* A missing development template must not prevent persistent settings/site setup. */ }
  }
  private async updateDefaultSiteUrls(httpPort: number) { const sites = await this.readRecords<Site>(this.layout.sites); await Promise.all(sites.filter(site => site.builtIn === 'localhost').map(site => this.writeSite({ ...site, url: localUrl(httpPort), updatedAt: new Date().toISOString() }))) }
  private normalizeSettings(settings: Partial<Settings>) {
    const legacy = settings.startup as (Partial<Settings['startup']> & { startServicesOnLaunch?: boolean; startServicesAfterLogin?: boolean }) | undefined
    const mode: ServiceStartMode = legacy?.serviceStartMode ?? (legacy?.startServicesAfterLogin ? 'after-login' : legacy?.startServicesOnLaunch === false ? 'manual' : 'on-open')
    const startup = { launchAtLogin: mode === 'after-login' ? true : legacy?.launchAtLogin ?? defaults.startup.launchAtLogin, serviceStartMode: mode, closeBehavior: legacy?.closeBehavior ?? defaults.startup.closeBehavior }
    return { ...defaults, ...settings, optionalServices: { ...defaults.optionalServices, ...settings.optionalServices }, php: { ...defaults.php, ...settings.php, extensions: [...(settings.php?.extensions ?? defaults.php.extensions)], disabledExtensions: [...(settings.php?.disabledExtensions ?? defaults.php.disabledExtensions)] }, startup, ports: { ...defaultServicePorts, ...settings.ports } } as Settings
  }
  private validateSettings(settings: Settings) {
    if (new Set(Object.values(settings.ports)).size !== Object.values(settings.ports).length) throw new Error('Each Vhostra service must use a distinct host port.')
    if (settings.schemaVersion !== 1 || !validServers.has(settings.selectedWebServer) || !validPhp.has(settings.selectedPhpVersion) || typeof settings.optionalServices?.redis !== 'boolean' || typeof settings.optionalServices?.memcached !== 'boolean' || typeof settings.php?.opcacheEnabled !== 'boolean' || typeof settings.php?.cwebpEnabled !== 'boolean' || !Array.isArray(settings.php?.extensions) || !Array.isArray(settings.php?.disabledExtensions) || [...settings.php.extensions, ...settings.php.disabledExtensions].some(extension => !/^[a-z0-9-]+$/i.test(extension)) || settings.php.extensions.some(extension => settings.php.disabledExtensions.includes(extension)) || typeof settings.startup?.launchAtLogin !== 'boolean' || !['on-open', 'after-login', 'manual'].includes(settings.startup?.serviceStartMode) || !['keep-services', 'stop-services', 'minimize-to-tray'].includes(settings.startup?.closeBehavior) || !Object.values(settings.ports ?? {}).every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('Invalid Vhostra settings.') }
  private validateSiteInput(input: Pick<Site, 'name' | 'documentRoot' | 'url' | 'framework'> & { database?: { name: string; importExpected: boolean }; aliases?: string[] }, portable = false) {
    if (!input.name?.trim() || !input.documentRoot?.trim()) throw new Error('A site name and document root are required.')
    if (input.database && (!/^[A-Za-z0-9_]{1,64}$/.test(input.database.name) || typeof input.database.importExpected !== 'boolean')) throw new Error('Enter a valid associated database name.')
    if ((portable ? !(path.posix.isAbsolute(input.documentRoot) || path.win32.isAbsolute(input.documentRoot)) : !path.isAbsolute(input.documentRoot)) || /[\r\n\0]/.test(input.documentRoot)) throw new Error('Choose an absolute host document-root path.')
    if (!portable) {
      const relative = path.relative(this.layout.root, path.resolve(input.documentRoot)); const enclosing = path.relative(path.resolve(input.documentRoot), this.layout.root)
      if ((!relative.startsWith('..') && !path.isAbsolute(relative)) || (!enclosing.startsWith('..') && !path.isAbsolute(enclosing))) throw new Error('Keep external Site document roots separate from Vhostra managed storage.')
    }
    this.validateUrl(input.url); this.validateAliases([new URL(input.url).hostname, ...(input.aliases ?? [])])
  }
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
