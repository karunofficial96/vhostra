import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, watch, type FSWatcher } from 'node:fs'
import { promises as fs } from 'node:fs'
import { finished } from 'node:stream/promises'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { AppState, PhpVersion, StoreLayout, WebServer } from './store.js'

export type RuntimeState = 'unavailable' | 'not-created' | 'stopped' | 'starting' | 'stopping' | 'running' | 'error'
export interface RuntimeSnapshot { state: RuntimeState; message: string; services: string[]; updatedAt: string }
export interface ManagedServiceStatus { id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: 'running' | 'stopped' | 'starting' | 'failed' | 'disabled' | 'unavailable' }

const projectName = 'vhostra'
const managedLabel = 'com.vhostra.managed=true'
const requiredHostPorts = (state: AppState) => [state.settings.ports.http, state.settings.ports.phpMyAdmin, state.settings.ports.mariadb]
const q = (value: string | number | boolean) => JSON.stringify(value)

/** Only ever operates the generated, labeled Vhostra Compose project. */
export class DockerRuntimeController {
  private snapshot: RuntimeSnapshot = { state: 'not-created', message: 'Docker runtime has not been created.', services: [], updatedAt: new Date().toISOString() }
  private listeners = new Set<() => void>()
  private operation: Promise<void> | null = null
  private httpsWarning = ''
  private htaccessWatchers = new Map<string, FSWatcher>()
  private htaccessDebounce: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly layout: StoreLayout, private readonly getState: () => Promise<AppState>, private readonly updateWelcome?: (message: string) => Promise<void>) {}

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  current() { return this.snapshot }
  async refresh() {
    try {
      await this.docker(['info'])
      await this.checkOptionalHttpsPort()
      if (!existsSync(this.composeFile)) return this.set({ state: 'not-created', message: 'Docker is available. Start Services to create the Vhostra runtime.', services: [] })
      const output = await this.compose(['ps', '--format', 'json'], false)
      const rows = parseJsonLines(output)
      const services = rows.map((row: { Service?: string }) => row.Service).filter((value): value is string => Boolean(value))
      const running = rows.length > 0 && rows.every((row: { State?: string }) => row.State === 'running')
      const state: RuntimeState = running ? 'running' : 'stopped'
      const snapshot = this.set({ state, message: running ? 'Vhostra services are running.' : 'Vhostra runtime is stopped.', services })
      void this.reconcileHtaccessWatchers(running)
      return snapshot
    } catch (error) {
      return this.set({ state: 'unavailable', message: dockerMessage(error), services: [] })
    }
  }
  async start() { return this.runExclusive('starting', 'Preparing Vhostra runtime…', async () => {
    this.set({ state: 'starting', message: 'Checking Docker…', services: [] })
    await this.requireDocker()
    const state = await this.getState()
    this.set({ state: 'starting', message: 'Checking configured service ports…', services: [] })
    await this.ensurePortsAvailable(requiredHostPorts(state))
    await this.checkOptionalHttpsPort()
    this.set({ state: 'starting', message: 'Preparing persistent runtime configuration…', services: [] })
    await this.generate(state)
    await this.compose(['config', '--quiet'])
    this.set({ state: 'starting', message: 'Building and creating the Vhostra runtime container…', services: ['runtime'] })
    // Never use Compose orphan removal during startup: candidate/replacement
    // promotion must retain the prior Vhostra runtime until it has been proven
    // healthy, and unrelated Compose projects are never in scope.
    await this.compose(['up', '--detach', '--build'])
    this.set({ state: 'starting', message: 'Configuring secure local phpMyAdmin access…', services: ['runtime'] })
    await this.provisionPhpMyAdmin()
    this.set({ state: 'starting', message: 'Running OpenLiteSpeed, LSPHP, MariaDB, and phpMyAdmin health checks…', services: ['runtime'] })
    await this.healthCheck(state.settings.selectedWebServer)
    await this.refresh()
  }) }
  async stop() { return this.runExclusive('stopping', 'Stopping Vhostra services…', async () => {
    await this.requireDocker()
    if (existsSync(this.composeFile)) await this.compose(['stop'])
    await this.refresh()
  }) }
  async restart() { return this.runExclusive('stopping', 'Restarting Vhostra services…', async () => {
    this.set({ state: 'stopping', message: 'Checking Docker and configured ports before runtime replacement…', services: this.snapshot.services })
    await this.requireDocker()
    const state = await this.getState()
    await this.ensurePortsAvailable(requiredHostPorts(state), true)
    await this.checkOptionalHttpsPort(true)
    this.set({ state: 'starting', message: 'Preparing replacement runtime configuration…', services: this.snapshot.services })
    await this.generate(state)
    await this.compose(['config', '--quiet'])
    this.set({ state: 'starting', message: 'Building and starting replacement runtime container…', services: ['runtime'] })
    await this.compose(['up', '--detach', '--build'])
    this.set({ state: 'starting', message: 'Configuring secure local phpMyAdmin access…', services: ['runtime'] })
    await this.provisionPhpMyAdmin()
    this.set({ state: 'starting', message: 'Running replacement runtime health checks…', services: ['runtime'] })
    await this.healthCheck(state.settings.selectedWebServer)
    await this.refresh()
  }) }
  async applyConfiguration() {
    const before = this.snapshot.state
    if (before === 'running') return this.restart()
    return this.refresh()
  }
  async checkPort(port: number) {
    validatePort(port)
    if (!await isPortOccupied(port)) return { port, available: true, owner: null as string | null }
    if (await this.vhostraOwnsPort(port)) return { port, available: false, owner: 'Vhostra' }
    return { port, available: false, owner: await describePort(port) }
  }
  async findAvailablePort(start: number) {
    validatePort(start)
    for (let port = Math.max(1025, start + 1); port <= 65535; port += 1) if (!await isPortOccupied(port)) return port
    throw new Error('No available TCP port was found.')
  }
  async reloadWebServer() { return this.runExclusive('starting', 'Reloading OpenLiteSpeed rewrite configuration…', async () => {
    await this.requireDocker()
    const state = await this.getState()
    if (state.settings.selectedWebServer !== 'openlitespeed') throw new Error('A graceful reload is currently available for the OpenLiteSpeed runtime only.')
    await this.compose(['exec', '-T', 'runtime', '/usr/local/lsws/bin/lswsctrl', 'reload'])
    await this.healthCheck('openlitespeed')
    await this.refresh()
  }) }
  async setOpenLiteSpeedRewrite(enabled: boolean) { const wasRunning = this.snapshot.state === 'running'; return this.runExclusive('starting', `${enabled ? 'Enabling' : 'Disabling'} OpenLiteSpeed rewrite support…`, async () => {
    await this.requireDocker()
    const state = await this.getState()
    if (state.settings.selectedWebServer !== 'openlitespeed' || !wasRunning) { await this.refresh(); return }
    const value = enabled ? '1' : '0'
    const command = `/usr/bin/sed -Ei '/^rewrite[[:space:]]*\\{/,/^\\}/ s/^[[:space:]]*enable[[:space:]]+[01][[:space:]]*$/  enable ${value}/' /usr/local/lsws/conf/vhosts/Example/vhconf.conf && /usr/local/lsws/bin/lswsctrl reload`
    await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', command])
    await this.healthCheck('openlitespeed')
    await this.refresh()
  }) }
  async listDatabases() {
    await this.requireDocker()
    const output = await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-N', '-e', 'SHOW DATABASES'])
    return output.split('\n').map(name => name.trim()).filter(name => name && !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name))
  }
  async listManagedServices(): Promise<ManagedServiceStatus[]> {
    const state = await this.getState()
    if (this.snapshot.state !== 'running') return [
      { id: 'web', label: state.settings.selectedWebServer === 'openlitespeed' ? 'OpenLiteSpeed' : state.settings.selectedWebServer === 'apache' ? 'Apache' : 'Nginx', enabled: true, state: this.snapshot.state === 'unavailable' ? 'unavailable' : 'stopped' },
      { id: 'mariadb', label: 'MariaDB', enabled: true, state: this.snapshot.state === 'unavailable' ? 'unavailable' : 'stopped' },
      { id: 'redis', label: 'Redis', enabled: state.settings.optionalServices.redis, state: state.settings.optionalServices.redis ? 'stopped' : 'disabled' },
      { id: 'memcached', label: 'Memcached', enabled: state.settings.optionalServices.memcached, state: state.settings.optionalServices.memcached ? 'stopped' : 'disabled' },
    ]
    const output = await this.compose(['exec', '-T', 'runtime', 'supervisorctl', 'status'], true)
    const rows = new Map(output.split('\n').filter(Boolean).map(line => { const [name, status] = line.trim().split(/\s+/, 2); return [name, status] }))
    const supervisorState = (name: string): ManagedServiceStatus['state'] => {
      const value = rows.get(name) ?? ''
      if (value === 'RUNNING') return 'running'
      if (value === 'STARTING') return 'starting'
      if (value === 'STOPPED' || value === 'EXITED') return 'stopped'
      return 'failed'
    }
    return [
      { id: 'web', label: state.settings.selectedWebServer === 'openlitespeed' ? 'OpenLiteSpeed' : state.settings.selectedWebServer === 'apache' ? 'Apache' : 'Nginx', enabled: true, state: supervisorState('openlitespeed') },
      { id: 'mariadb', label: 'MariaDB', enabled: true, state: supervisorState('mariadb') },
      { id: 'redis', label: 'Redis', enabled: state.settings.optionalServices.redis, state: state.settings.optionalServices.redis ? supervisorState('redis') : 'disabled' },
      { id: 'memcached', label: 'Memcached', enabled: state.settings.optionalServices.memcached, state: state.settings.optionalServices.memcached ? supervisorState('memcached') : 'disabled' },
    ]
  }
  async controlManagedService(id: ManagedServiceStatus['id'], action: 'start' | 'stop' | 'restart') {
    const state = await this.getState()
    const name = id === 'web' ? 'openlitespeed' : id
    if ((id === 'redis' && !state.settings.optionalServices.redis) || (id === 'memcached' && !state.settings.optionalServices.memcached)) throw new Error(`${id === 'redis' ? 'Redis' : 'Memcached'} is disabled in Vhostra Settings.`)
    return this.runExclusive(action === 'stop' ? 'stopping' : 'starting', `${action[0].toUpperCase()}${action.slice(1)}ing ${id === 'web' ? 'the active web server' : id}…`, async () => {
      await this.requireDocker()
      if (this.snapshot.state !== 'running') throw new Error('Start the Vhostra runtime before controlling an individual service.')
      await this.compose(['exec', '-T', 'runtime', 'supervisorctl', action, name])
      if (id === 'web' && action !== 'stop') await this.healthCheck(state.settings.selectedWebServer)
      if (id === 'mariadb' && action !== 'stop') await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', 'SELECT 1'])
      if (id === 'redis' && action !== 'stop') await this.compose(['exec', '-T', 'runtime', 'redis-cli', 'PING'])
      if (id === 'memcached' && action !== 'stop') await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', "printf 'version\\r\\n' | nc -w 3 127.0.0.1 11211 | grep -q '^VERSION'"])
      await this.refresh()
      return this.listManagedServices()
    })
  }
  dispose() { this.clearHtaccessWatchers() }
  async listPhpExtensions() {
    const state = await this.getState()
    const selected = new Set(state.settings.php.extensions)
    const required = new Set(['mysqli', 'pdo_mysql'])
    const disabled = new Set(state.settings.php.disabledExtensions)
    const configured = new Set(['opcache', 'redis', 'memcached', ...selected, ...disabled])
    if (this.snapshot.state !== 'running') return [...configured].sort().map(id => ({ id, label: extensionLabel(id), required: required.has(id), enabled: id === 'opcache' ? state.settings.php.opcacheEnabled : selected.has(id) || (id === 'redis' && state.settings.optionalServices.redis) || (id === 'memcached' && state.settings.optionalServices.memcached), installed: false, category: required.has(id) ? 'required' : 'selected', status: 'Selected — start the runtime to discover its complete package catalog and actual module state.' }))
    const raw = await requestLocalHttp(state.settings.ports.http, '/vhostra-extension-state.php')
    const loaded = new Set(parseHttpJson<string[]>(raw) ?? [])
    const available: string[] = await this.availablePhpPackages().catch((): string[] => [])
    const packageInstalled = new Set(await this.installedPhpPackages().catch(() => []))
    const all = new Set([...available, ...loaded].map(normalizeExtensionId).filter(Boolean))
    for (const id of configured) all.add(id)
    for (const id of required) all.add(id)
    return [...all].sort((a, b) => extensionLabel(a).localeCompare(extensionLabel(b))).map(id => {
      const actual = id === 'opcache' ? loaded.has('Zend OPcache') : [...loaded].map(normalizeExtensionId).includes(id)
      const dependency = (id === 'redis' && state.settings.optionalServices.redis) || (id === 'memcached' && state.settings.optionalServices.memcached)
      const isRequired = required.has(id)
      const managedPackage = packageInstalled.has(id)
      const installed = managedPackage || isRequired || selected.has(id) || disabled.has(id) || dependency
      const enabled = isRequired || actual || dependency || (id === 'opcache' ? state.settings.php.opcacheEnabled : selected.has(id))
      const supported = available.includes(id) || actual || isRequired || dependency || id === 'opcache'
      const category = isRequired ? 'required' : dependency ? 'dependency-managed' : !supported ? 'unsupported' : actual && !managedPackage ? 'core' : actual ? 'installed-enabled' : installed ? 'installed-disabled' : 'available'
      return { id, label: extensionLabel(id), required: isRequired, enabled, installed, category, status: isRequired ? 'Required by Vhostra' : dependency ? 'Dependency-managed by the matching Vhostra service' : !supported ? 'Unsupported or unavailable for the selected LSPHP version' : actual && !managedPackage ? 'Built-in/Core' : actual ? 'Installed and enabled' : installed ? 'Installed but disabled' : 'Available to install' }
    })
  }
  /** Installs or removes one catalogued optional LSPHP package in the running
   * Vhostra container, then verifies the package/module state before returning.
   * Core, required, and dependency-managed entries are deliberately protected. */
  async managePhpExtension(id: string, action: 'install' | 'enable' | 'disable' | 'remove') {
    const extension = normalizeExtensionId(id)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(extension)) throw new Error('Invalid PHP extension identifier.')
    if (['mysqli', 'pdo-mysql', 'pdo_mysql', 'mysql', 'opcache', 'redis', 'memcached'].includes(extension)) throw new Error(`${extensionLabel(extension)} is required or dependency-managed and cannot be changed here.`)
    if (this.snapshot.state !== 'running') throw new Error('Start the Vhostra runtime before changing PHP extensions.')
    const available = new Set(await this.availablePhpPackages())
    if (!available.has(extension)) throw new Error(`${extensionLabel(extension)} is not an installable extension package for the selected LSPHP version.`)
    const state = await this.getState(); const php = state.settings.selectedPhpVersion.replace('.', '')
    const packageName = `lsphp${php}-${extension}`
    return this.runExclusive('starting', `${action[0].toUpperCase()}${action.slice(1)}ing PHP extension ${extensionLabel(extension)}…`, async () => {
      if (action === 'install' || action === 'enable') {
        await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${packageName}`])
        // Package-maintained extension INI files are normally enabled by default.
        // Where one is explicitly disabled, restore its exact package module line.
        await this.configureRuntimePhpExtension(php, extension, true)
      } else if (action === 'disable') {
        const output = await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', `find /usr/local/lsws/lsphp${php} -path '*/mods-available/*${extension}*.ini' -type f -print -quit`])
        if (!output.trim()) throw new Error(`${extensionLabel(extension)} has no independently disableable module configuration.`)
        await this.configureRuntimePhpExtension(php, extension, false)
      } else await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', `DEBIAN_FRONTEND=noninteractive apt-get purge -y ${packageName}`])
      await this.compose(['exec', '-T', 'runtime', 'supervisorctl', 'restart', 'openlitespeed'])
      // LSAPI workers survive a parent restart on some OLS builds. They are
      // Vhostra-owned children inside this container, so retire them to force
      // the selected LSPHP php.ini to be read on the next request.
      await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', 'pkill -u nobody -x lsphp || true'])
      const installed = (await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', `dpkg-query -W -f='${'${db:Status-Status}'}' ${packageName} 2>/dev/null || true`])).trim() === 'installed'
      if ((action === 'install' || action === 'enable') && !installed) throw new Error(`${extensionLabel(extension)} package installation could not be verified.`)
      if ((action === 'remove') && installed) throw new Error(`${extensionLabel(extension)} package removal could not be verified.`)
      const raw = await requestLocalHttp(state.settings.ports.http, '/vhostra-extension-state.php')
      const loaded = new Set((parseHttpJson<string[]>(raw) ?? []).map(normalizeExtensionId))
      if ((action === 'install' || action === 'enable') && !loaded.has(extension)) throw new Error(`${extensionLabel(extension)} package changed, but the selected LSPHP web runtime did not load it.`)
      if ((action === 'disable' || action === 'remove') && loaded.has(extension)) throw new Error(`${extensionLabel(extension)} is still loaded by the selected LSPHP web runtime.`)
      await this.refresh()
      return this.listPhpExtensions()
    })
  }
  async getCwebpStatus() {
    const enabled = (await this.getState()).settings.php.cwebpEnabled
    if (this.snapshot.state !== 'running') return { enabled, installed: false }
    const version = await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', 'command -v cwebp >/dev/null && cwebp -version'], true)
    return { enabled, installed: Boolean(version.trim()), ...(version.trim() ? { version: version.trim().split('\n')[0] } : {}) }
  }
  async configureCwebp(enabled: boolean) {
    if (this.snapshot.state !== 'running') throw new Error('Start the Vhostra runtime before changing cwebp.')
    return this.runExclusive('starting', `${enabled ? 'Installing' : 'Removing'} cwebp…`, async () => {
      await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', enabled ? 'DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y webp' : 'DEBIAN_FRONTEND=noninteractive apt-get purge -y webp'])
      const output = await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', 'command -v cwebp >/dev/null && cwebp -version'], true)
      const status = { enabled, installed: Boolean(output.trim()), ...(output.trim() ? { version: output.trim().split('\n')[0] } : {}) }
      if (enabled && !status.installed) throw new Error('cwebp installation could not be verified.')
      if (!enabled && status.installed) throw new Error('cwebp removal could not be verified.')
      await this.refresh()
      return status
    })
  }
  async createDatabase(input: { name: string; charset: string; username: string; password: string }) {
    const name = sqlIdentifier(input.name, 'database name'); const username = sqlIdentifier(input.username, 'username')
    if (!['utf8mb4', 'utf8', 'latin1'].includes(input.charset)) throw new Error('Unsupported MariaDB character set.')
    if (input.password.length < 12) throw new Error('Database passwords must contain at least 12 characters.')
    const password = sqlLiteral(input.password)
    const sql = `CREATE DATABASE \`${name}\` CHARACTER SET ${input.charset}; CREATE USER '${username}'@'%' IDENTIFIED BY ${password}; GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'%'; FLUSH PRIVILEGES;`
    await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', sql])
    const state = await this.getState()
    return { name, username, host: '127.0.0.1', port: state.settings.ports.mariadb, charset: input.charset }
  }
  async phpMyAdminUrl(database?: string) {
    const state = await this.getState()
    if (this.snapshot.state !== 'running') throw new Error('Start the Vhostra runtime before opening phpMyAdmin.')
    const query = database ? `?db=${encodeURIComponent(sqlIdentifier(database, 'database name'))}` : ''
    return `http://localhost:${state.settings.ports.phpMyAdmin}/phpmyadmin/index.php${query}`
  }
  async importDatabase(name: string, source: string) {
    const database = sqlIdentifier(name, 'database name')
    if (path.extname(source).toLowerCase() !== '.sql') throw new Error('Choose an uncompressed .sql database dump.')
    await fs.access(source)
    return this.runDatabaseOperation(`Importing ${database}…`, async () => {
      await executeWithInput('docker', this.composeArguments(['exec', '-T', 'runtime', 'mariadb', '-uroot', database]), source)
      return { database, message: `Imported ${path.basename(source)} into ${database}.` }
    })
  }
  async exportDatabase(name: string, destination: string) {
    const database = sqlIdentifier(name, 'database name')
    if (path.extname(destination).toLowerCase() !== '.sql') throw new Error('Database exports must use a .sql filename.')
    return this.runDatabaseOperation(`Exporting ${database}…`, async () => {
      await executeWithOutput('docker', this.composeArguments(['exec', '-T', 'runtime', 'mariadb-dump', '-uroot', '--single-transaction', '--routines', '--events', database]), destination)
      return { database, message: `Exported ${database} to ${path.basename(destination)}.` }
    })
  }
  async repairDatabase(name: string) {
    const database = sqlIdentifier(name, 'database name')
    return this.runDatabaseOperation(`Checking ${database} tables…`, async () => {
      const rows = (await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-N', '-e', `SELECT TABLE_NAME, COALESCE(ENGINE, '') FROM information_schema.TABLES WHERE TABLE_SCHEMA=${sqlLiteral(database)} AND TABLE_TYPE='BASE TABLE'`])).split('\n').filter(Boolean).map(line => line.split('\t'))
      const results: string[] = []
      for (const [table, engine] of rows) {
        if (engine === 'MyISAM' || engine === 'Aria') { await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', `REPAIR TABLE \`${database}\`.\`${table}\``]); results.push(`${table}: repaired (${engine})`) }
        else { await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', `CHECK TABLE \`${database}\`.\`${table}\``]); results.push(`${table}: checked (${engine || 'unknown engine'}; no table repair attempted)`) }
      }
      return { database, message: results.length ? results.join('; ') : 'No base tables to check.' }
    })
  }
  async deleteDatabase(name: string) {
    const database = sqlIdentifier(name, 'database name')
    return this.runDatabaseOperation(`Deleting ${database}…`, async () => {
      await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', `DROP DATABASE \`${database}\``])
      return { database, message: `Deleted ${database}. Database users were not changed.` }
    })
  }

  private get runtimeRoot() { return path.dirname(this.layout.runtime.apache) }
  private get composeFile() { return path.join(this.runtimeRoot, 'compose.yml') }
  private get environmentFile() { return path.join(this.runtimeRoot, '.env') }
  private set(next: Omit<RuntimeSnapshot, 'updatedAt'>) { const message = this.httpsWarning ? `${next.message} HTTPS is unavailable: ${this.httpsWarning}` : next.message; this.snapshot = { ...next, message, updatedAt: new Date().toISOString() }; void this.updateWelcome?.(this.snapshot.message); this.listeners.forEach(listener => listener()); return this.snapshot }
  private async runExclusive<T>(state: RuntimeState, message: string, task: () => Promise<T>): Promise<T> {
    if (this.operation) throw new Error('A Vhostra service operation is already in progress.')
    this.set({ state, message, services: this.snapshot.services })
    const result = task().catch(error => { this.set({ state: 'error', message: error instanceof Error ? error.message : String(error), services: [] }); throw error })
    this.operation = result.then(() => undefined, () => undefined).finally(() => { this.operation = null })
    return result
  }
  private async requireDocker() { await this.docker(['info']) }
  private async generate(state: AppState) {
    await fs.mkdir(this.runtimeRoot, { recursive: true })
    await Promise.all([this.layout.runtime.apache, this.layout.runtime.nginx, this.layout.runtime.openLiteSpeed, this.layout.runtime.php, this.layout.runtime.mariaDb, this.layout.runtime.phpMyAdmin, this.layout.runtime.redis, this.layout.runtime.memcached, this.layout.logs].map(directory => fs.mkdir(directory, { recursive: true })))
    await this.ensureEnvironment()
    await Promise.all([
      fs.writeFile(path.join(this.layout.sites, 'localhost', 'public', 'vhostra-health.php'), '<?php echo "vhostra-lsphp:" . PHP_VERSION;\n', { mode: 0o600 }),
      fs.writeFile(path.join(this.layout.sites, 'localhost', 'public', 'vhostra-extensions.php'), '<?php foreach (["mysqli", "pdo_mysql", "redis", "memcached"] as $extension) { echo $extension . ":" . (extension_loaded($extension) ? "1" : "0") . "\\n"; } echo "opcache:" . ((function_exists("opcache_get_status") && ini_get("opcache.enable")) ? "1" : "0") . "\\n";\n', { mode: 0o600 }),
      fs.writeFile(path.join(this.layout.sites, 'localhost', 'public', 'vhostra-extension-state.php'), '<?php header("Content-Type: application/json"); echo json_encode(get_loaded_extensions());\n', { mode: 0o600 }),
    ])
    const mounts = state.virtualHosts.map(host => ({ host, container: host.builtIn === 'localhost' ? '/var/www/html' : `/var/www/vhostra/${host.id}` }))
    await Promise.all([
      fs.writeFile(path.join(this.layout.runtime.php, 'vhostra.ini'), 'expose_php=Off\nlog_errors=On\nerror_log=/var/log/php/error.log\n', { mode: 0o600 }),
      fs.writeFile(path.join(this.layout.runtime.mariaDb, 'vhostra.cnf'), '[mariadb]\nskip-name-resolve\n', { mode: 0o600 }),
      fs.writeFile(path.join(this.layout.runtime.phpMyAdmin, 'README.txt'), 'phpMyAdmin is configured by the generated Vhostra Compose project.\n', { mode: 0o600 }),
      fs.writeFile(path.join(this.layout.runtime.redis, 'redis.conf'), 'appendonly yes\n', { mode: 0o600 }),
      fs.writeFile(path.join(this.layout.runtime.memcached, 'memcached.conf'), '-m 64\n', { mode: 0o600 }),
    ])
    await this.writeServerConfiguration(state.settings.selectedWebServer, state.settings.selectedPhpVersion, mounts)
    await fs.cp(path.resolve(process.cwd(), 'runtime-image'), path.join(this.runtimeRoot, 'image'), { recursive: true, force: true })
    await fs.writeFile(this.composeFile, singleRuntimeComposeYaml(state, this.layout), { mode: 0o600 })
  }
  private async ensureEnvironment() {
    let contents = ''
    try { contents = await fs.readFile(this.environmentFile, 'utf8') } catch { /* generated on first use */ }
    const missing = (name: string) => !new RegExp(`^${name}=`, 'm').test(contents)
    if (missing('MARIADB_ROOT_PASSWORD')) contents += `MARIADB_ROOT_PASSWORD=${randomBytes(24).toString('base64url')}\n`
    if (missing('VHOSTRA_PMA_BLOWFISH_SECRET')) contents += `VHOSTRA_PMA_BLOWFISH_SECRET=${randomBytes(32).toString('base64url')}\n`
    if (missing('VHOSTRA_PMA_PASSWORD')) contents += `VHOSTRA_PMA_PASSWORD=${randomBytes(32).toString('base64url')}\n`
    await fs.writeFile(this.environmentFile, contents, { mode: 0o600 })
  }
  private async provisionPhpMyAdmin() {
    const contents = await fs.readFile(this.environmentFile, 'utf8')
    const password = contents.match(/^VHOSTRA_PMA_PASSWORD=(.+)$/m)?.[1]?.trim()
    if (!password) throw new Error('Vhostra could not prepare secure phpMyAdmin credentials.')
    const secret = sqlLiteral(password)
    const statement = `CREATE USER IF NOT EXISTS 'vhostra_pma'@'localhost' IDENTIFIED BY ${secret}; CREATE USER IF NOT EXISTS 'vhostra_pma'@'127.0.0.1' IDENTIFIED BY ${secret}; ALTER USER 'vhostra_pma'@'localhost' IDENTIFIED BY ${secret}; ALTER USER 'vhostra_pma'@'127.0.0.1' IDENTIFIED BY ${secret}; GRANT ALL PRIVILEGES ON *.* TO 'vhostra_pma'@'localhost' WITH GRANT OPTION; GRANT ALL PRIVILEGES ON *.* TO 'vhostra_pma'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;`
    let lastError: unknown
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', statement]); return } catch (error) { lastError = error; await wait(1_000) }
    }
    throw lastError instanceof Error ? lastError : new Error('MariaDB did not become ready for phpMyAdmin.')
  }
  private async runDatabaseOperation<T>(message: string, action: () => Promise<T>) { return this.runExclusive('starting', message, async () => { await this.requireDocker(); const result = await action(); await this.refresh(); return result }) }
  private async writeServerConfiguration(server: WebServer, phpVersion: PhpVersion, mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) {
    const generated = this.layout.configuration.generated
    await fs.mkdir(generated, { recursive: true })
    if (server === 'apache') {
      const config = apacheConfig(mounts)
      await Promise.all([fs.writeFile(path.join(this.layout.runtime.apache, 'vhostra.conf'), config, { mode: 0o600 }), fs.writeFile(path.join(generated, 'apache-vhosts.conf'), config, { mode: 0o600 })])
    } else if (server === 'nginx') {
      const config = nginxConfig(mounts)
      await Promise.all([fs.writeFile(path.join(this.layout.runtime.nginx, 'default.conf'), config, { mode: 0o600 }), fs.writeFile(path.join(generated, 'nginx-vhosts.conf'), config, { mode: 0o600 })])
    } else {
      // The stock Example vhost remains the protected localhost vhost. Only
      // user-created portable definitions are injected as additional OLS vhosts.
      const managedMounts = mounts.filter(({ host }) => host.builtIn !== 'localhost')
      const main = openLiteSpeedConfig(managedMounts); const virtualHosts = openLiteSpeedVirtualHosts(managedMounts)
      await fs.mkdir(path.join(this.layout.runtime.openLiteSpeed, 'sites'), { recursive: true })
      await Promise.all([
        fs.writeFile(path.join(this.layout.runtime.openLiteSpeed, 'vhostra-maps.conf'), main, { mode: 0o600 }),
        fs.writeFile(path.join(this.layout.runtime.openLiteSpeed, 'vhostra-vhosts.conf'), virtualHosts, { mode: 0o600 }),
        ...managedMounts.map(({ host, container }) => fs.writeFile(path.join(this.layout.runtime.openLiteSpeed, 'sites', `${host.id}.conf`), openLiteSpeedSiteConfig(host, container), { mode: 0o600 })),
        fs.writeFile(path.join(generated, 'openlitespeed-vhosts.conf'), `${main}\n${virtualHosts}`, { mode: 0o600 }),
      ])
    }
    // Keeps the PHP policy explicit in generated config metadata without exposing it over HTTP.
    await fs.writeFile(path.join(generated, 'runtime-selection.json'), JSON.stringify({ server, phpVersion, generatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  }
  private async ensurePortsAvailable(ports: number[], allowProjectPorts = false) {
    const conflicts = await this.portConflicts(ports, allowProjectPorts)
    if (conflicts.length) throw new Error(`Vhostra cannot bind required host ports:\n${conflicts.join('\n')}\nStop or reconfigure the owning application yourself; Vhostra will not stop unrelated processes or containers.`)
  }
  private async checkOptionalHttpsPort(allowProjectPorts = false) {
    const state = await this.getState(); const conflicts = await this.portConflicts([state.settings.ports.https], allowProjectPorts)
    this.httpsWarning = conflicts.length ? `${conflicts.join('; ')}. Vhostra will continue with HTTP on port ${state.settings.ports.http} and will not alter the owner.` : ''
  }
  private async portConflicts(ports: number[], allowProjectPorts: boolean) {
    const conflicts: string[] = []
    for (const port of ports) {
      const occupied = await isPortOccupied(port)
      if (!occupied) continue
      const ownedByVhostra = allowProjectPorts && await this.vhostraOwnsPort(port)
      if (!ownedByVhostra) conflicts.push(await describePort(port))
    }
    return conflicts
  }
  private async vhostraOwnsPort(port: number) {
    try { return (await this.docker(['ps', '--filter', `label=${managedLabel}`, '--format', '{{.Ports}}'])).split('\n').some(line => line.includes(`:${port}->`)) } catch { return false }
  }
  private async healthCheck(server: WebServer) {
    const ready = async (port: number, requestPath = '/') => { for (let attempt = 0; attempt < 20; attempt += 1) { const response = await requestLocalHttp(port, requestPath); if (response.includes('200')) return response; await wait(1_000) } return '' }
    const ports = (await this.getState()).settings.ports
    if (!await ready(ports.http)) throw new Error(`The ${server} runtime did not pass its localhost health check.`)
    const php = await ready(ports.http, '/vhostra-health.php')
    if (!php.includes(`vhostra-lsphp:${(await this.getState()).settings.selectedPhpVersion}`)) throw new Error('OpenLiteSpeed did not invoke the selected LSPHP runtime.')
    await this.compose(['exec', '-T', 'runtime', 'mariadb', '-uroot', '-e', 'SELECT 1'])
    const state = await this.getState()
    const extensionHealth = await ready(ports.http, '/vhostra-extensions.php')
    const expectExtension = (extension: string, enabled: boolean) => { if (enabled && !extensionHealth.includes(`${extension}:1`)) throw new Error(`The required PHP extension “${extension}” is not enabled in the selected LSPHP runtime.`) }
    expectExtension('mysqli', true); expectExtension('pdo_mysql', true); expectExtension('opcache', state.settings.php.opcacheEnabled); expectExtension('redis', state.settings.optionalServices.redis || state.settings.php.extensions.includes('redis')); expectExtension('memcached', state.settings.optionalServices.memcached || state.settings.php.extensions.includes('memcached'))
    const modules = new Set(parseHttpJson<string[]>(await ready(ports.http, '/vhostra-extension-state.php')) ?? [])
    for (const extension of state.settings.php.extensions) if (!modules.has(extension)) throw new Error(`The selected PHP extension “${extension}” is not enabled in the replacement LSPHP runtime.`)
    if (state.settings.optionalServices.redis) await this.compose(['exec', '-T', 'runtime', 'redis-cli', 'PING'])
    if (state.settings.optionalServices.memcached) await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', "printf 'version\\r\\n' | nc -w 3 127.0.0.1 11211 | grep -q '^VERSION'"])
    if (!await ready(ports.phpMyAdmin, '/phpmyadmin/index.php')) throw new Error('phpMyAdmin did not pass its shared-runtime health check.')
    if (state.settings.php.cwebpEnabled) {
      const output = await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', 'command -v cwebp >/dev/null && cwebp -version'])
      if (!output.trim()) throw new Error('The requested cwebp binary is unavailable in the Vhostra runtime.')
    }
  }
  private async availablePhpPackages() {
    const state = await this.getState(); const php = state.settings.selectedPhpVersion.replace('.', '')
    // Discover directly from the selected LiteSpeed repository. Repository
    // descriptions identify development/runtime/meta artifacts generically;
    // all remaining versioned packages are module candidates and are still
    // verified against the loaded PHP runtime after every mutation.
    const output = await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', `apt-cache search '^lsphp${php}-' | awk -F ' - ' '$1 ~ /^lsphp${php}-/ && $2 !~ /(Common files|Debug symbols|development|runtime|PEAR|source package)/ { sub(/^lsphp${php}-/, "", $1); print $1 }' | sort -u`])
    return output.split('\n').map(value => value.trim()).filter(value => /^[a-z0-9][a-z0-9-]*$/.test(value))
  }
  private async installedPhpPackages() {
    const state = await this.getState(); const php = state.settings.selectedPhpVersion.replace('.', '')
    const output = await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', `dpkg-query -W -f='${'${binary:Package}'}\\n' 'lsphp${php}-*' 2>/dev/null | sed 's/^lsphp${php}-//' | sed 's/:.*$//' | sort -u`], true)
    return output.split('\n').map(value => value.trim()).filter(value => /^[a-z0-9][a-z0-9-]*$/.test(value))
  }
  private async configureRuntimePhpExtension(php: string, extension: string, enabled: boolean) {
    // LiteSpeed scans mods-available directly. Toggle the exact package INI
    // atomically so a disabled extension cannot stay loaded through that scan.
    const command = `dir=/usr/local/lsws/lsphp${php}/etc/php/${php.slice(0, 1)}.${php.slice(1)}/mods-available; source=$(find "$dir" -maxdepth 1 -type f -name '*${extension}*.ini' -print -quit); disabled=$(find "$dir" -maxdepth 1 -type f -name '*${extension}*.ini.disabled' -print -quit); if [ ${enabled ? 'true' : 'false'} = true ]; then if [ -n "$disabled" ]; then mv "$disabled" "${'${disabled%.disabled}'}"; elif [ -z "$source" ]; then exit 65; fi; else if [ -n "$source" ]; then mv "$source" "$source.disabled"; elif [ -z "$disabled" ]; then exit 65; fi; fi`
    await this.compose(['exec', '-T', 'runtime', '/bin/sh', '-lc', command])
  }
  private async reconcileHtaccessWatchers(running: boolean) {
    const state = await this.getState()
    if (!running || state.settings.selectedWebServer !== 'openlitespeed') { this.clearHtaccessWatchers(); return }
    const desired = new Map(state.virtualHosts.filter(host => host.rewriteEnabled !== false).map(host => [host.id, host.documentRoot]))
    for (const [id, watcher] of this.htaccessWatchers) if (!desired.has(id)) { watcher.close(); this.htaccessWatchers.delete(id) }
    for (const [id, root] of desired) {
      if (this.htaccessWatchers.has(id)) continue
      try {
        const watcher = watch(root, { persistent: false }, (_event, filename) => {
          if (String(filename) !== '.htaccess') return
          if (this.htaccessDebounce) clearTimeout(this.htaccessDebounce)
          this.htaccessDebounce = setTimeout(() => {
            this.htaccessDebounce = null
            void this.reloadWebServer().catch(error => this.set({ state: 'error', message: `OpenLiteSpeed could not reload after a .htaccess change: ${error instanceof Error ? error.message : String(error)}`, services: ['runtime'] }))
          }, 600)
        })
        watcher.on('error', error => this.set({ state: 'error', message: `Vhostra could not watch ${root}/.htaccess: ${error.message}`, services: ['runtime'] }))
        this.htaccessWatchers.set(id, watcher)
      } catch (error) { this.set({ state: 'error', message: `Vhostra could not watch ${root}/.htaccess: ${error instanceof Error ? error.message : String(error)}`, services: ['runtime'] }) }
    }
  }
  private clearHtaccessWatchers() { for (const watcher of this.htaccessWatchers.values()) watcher.close(); this.htaccessWatchers.clear(); if (this.htaccessDebounce) clearTimeout(this.htaccessDebounce); this.htaccessDebounce = null }
  private async docker(args: string[]) { return execute('docker', args) }
  private async compose(args: string[], allowFailure = false) { return execute('docker', this.composeArguments(args), allowFailure) }
  private composeArguments(args: string[]) { return ['compose', '--project-name', projectName, '--project-directory', this.runtimeRoot, '--env-file', this.environmentFile, '--file', this.composeFile, ...args] }
}

const execute = (command: string, args: string[], allowFailure = false) => new Promise<string>((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''
  child.stdout.on('data', data => { stdout += String(data) }); child.stderr.on('data', data => { stderr += String(data) })
  child.once('error', reject); child.once('close', code => code === 0 || allowFailure ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} ${args.join(' ')} exited with ${code}`)))
})
const executeWithInput = async (command: string, args: string[], input: string) => {
  const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] }); let stderr = ''
  child.stderr.on('data', data => { stderr += String(data) }); const source = createReadStream(input); source.pipe(child.stdin)
  await Promise.all([finished(source), new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} import failed with ${code}`))) })])
}
const executeWithOutput = async (command: string, args: string[], output: string) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; child.stderr.on('data', data => { stderr += String(data) }); const destination = createWriteStream(output, { mode: 0o600 }); child.stdout.pipe(destination)
  await Promise.all([finished(destination), new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} export failed with ${code}`))) })])
}
const parseJsonLines = (value: string) => value.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
const parseHttpJson = <T>(value: string): T | null => {
  const body = value.slice(value.indexOf('\r\n\r\n') + 4).trim()
  try { return JSON.parse(body) as T } catch { return null }
}
const normalizeExtensionId = (value: string) => value.trim().toLowerCase().replace(/^zend[ _-]?/, '').replace(/[ _]/g, '-').replace(/[^a-z0-9-]/g, '')
const extensionLabel = (id: string) => id === 'opcache' ? 'Zend OPcache' : id.replace(/(^|[-_])(.)/g, (_match, prefix: string, letter: string) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`)
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
const validatePort = (port: number) => { if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A port must be an integer from 1 to 65535.') }
const sqlIdentifier = (value: string, label: string) => { const normalized = value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(normalized)) throw new Error(`Invalid ${label}. Use letters, digits, and underscores only.`); return normalized }
const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`
/**
 * macOS denies an unprivileged Node process a test bind below 1024 with EACCES.
 * That is not evidence of a listener: verify the actual TCP endpoint before
 * declaring a conflict. Docker Desktop can publish privileged ports separately.
 */
const isPortOccupied = (port: number) => new Promise<boolean>(resolve => {
  const server = net.createServer()
  server.once('error', error => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') return resolve(true)
    if (code === 'EACCES') return resolve(connectsToPort(port))
    resolve(false)
  })
  server.once('listening', () => server.close(() => resolve(false)))
  server.listen(port, '127.0.0.1')
})
const connectsToPort = (port: number) => new Promise<boolean>(resolve => { const socket = net.connect({ port, host: '127.0.0.1' }); socket.setTimeout(750); socket.once('connect', () => { socket.destroy(); resolve(true) }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false) }) })
const requestLocalHttp = (port: number, requestPath = '/') => new Promise<string>(resolve => { const socket = net.connect({ port, host: '127.0.0.1' }); let output = ''; socket.setTimeout(8_000); socket.on('connect', () => socket.write(`GET ${requestPath} HTTP/1.0\r\nHost: localhost\r\n\r\n`)); socket.on('data', data => { output += String(data) }); socket.on('error', () => resolve('')); socket.on('timeout', () => { socket.destroy(); resolve('') }); socket.on('close', () => resolve(output)) })
async function describePort(port: number) {
  const owners: string[] = []
  try { const output = await execute('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], true); const lines = output.trim().split('\n'); if (lines.length > 1) owners.push(`process ${lines.slice(1).join('; ')}`) } catch { /* Windows/Linux fall back below. */ }
  try { const output = await execute('docker', ['ps', '--format', '{{.Names}} {{.Ports}}'], true); const line = output.split('\n').find(value => value.includes(`:${port}->`)); if (line) owners.push(`Docker container ${line}`) } catch { /* Docker may be unavailable. */ }
  return `localhost:${port} is already in use${owners.length ? ` by ${owners.join(' and ')}` : ' (owner could not be identified)'}`
}
const dockerMessage = (error: unknown) => `Docker is unavailable: ${error instanceof Error ? error.message : String(error)}`

function apacheConfig(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return `ServerTokens Prod\nServerSignature Off\nTraceEnable Off\nLoadModule rewrite_module modules/mod_rewrite.so\n${mounts.map(({ host, container }) => `<VirtualHost *:80>\n  ServerName ${host.hostname}\n  ${host.aliases.map(alias => `ServerAlias ${alias}`).join('\n  ')}\n  DocumentRoot ${container}\n  <Directory ${container}>\n    Options FollowSymLinks\n    AllowOverride ${host.rewriteEnabled === false ? 'None' : 'FileInfo'}\n    Require all granted\n  </Directory>\n  ${host.rewriteEnabled === false ? 'RewriteEngine Off' : 'RewriteEngine On'}\n  ErrorLog /var/log/apache2/${host.id}-error.log\n  CustomLog /var/log/apache2/${host.id}-access.log combined\n</VirtualHost>`).join('\n\n')}\n` }
function nginxConfig(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return `server_tokens off;\n${mounts.map(({ host, container }) => `server {\n  listen 80;\n  server_name ${[host.hostname, ...host.aliases].join(' ')};\n  root ${container};\n  index index.php index.html;\n  access_log /var/log/nginx/${host.id}-access.log;\n  error_log /var/log/nginx/${host.id}-error.log;\n  # Vhostra managed WordPress-compatible front controller. Unsupported .htaccess directives remain reported in the neutral model.\n  location / { try_files $uri $uri/ ${host.rewriteEnabled === false ? '=404' : '/index.php?$query_string'}; }\n  location ~ \\.php$ { include fastcgi_params; fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name; fastcgi_pass php:9000; }\n}\n`).join('\n')}` }
function openLiteSpeedConfig(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return `${mounts.flatMap(({ host }) => [`map ${host.hostname} ${host.id}`, ...host.aliases.map(alias => `map ${alias} ${host.id}`)]).join('\n')}\n` }
function openLiteSpeedVirtualHosts(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return mounts.map(({ host, container }) => `virtualHost ${host.id}{\n    vhRoot                   ${container}/\n    allowSymbolLink          1\n    enableScript             1\n    configFile               /etc/vhostra/openlitespeed/sites/${host.id}.conf\n}\n`).join('\n') }
function openLiteSpeedSiteConfig(host: AppState['virtualHosts'][number], container: string) { return `docRoot ${container}/\nindex {\n  indexFiles index.php,index.html\n}\nrewrite {\n  enable ${host.rewriteEnabled === false ? '0' : '1'}\n  autoLoadHtaccess ${host.rewriteEnabled === false ? '0' : '1'}\n}\ncontext / {\n  allowBrowse 1\n  location $DOC_ROOT/\n}\naccessControl {\n  deny\n  allow *\n}\n` }

function singleRuntimeComposeYaml(state: AppState, layout: StoreLayout) {
  const php = state.settings.selectedPhpVersion.replace('.', '')
  return `name: ${projectName}
services:
  runtime:
    build:
      context: ./image
      args:
        LSPHP_VERSION: ${q(php)}
        LSPHP_EXTENSIONS: ${q([...new Set([...state.settings.php.extensions, ...state.settings.php.disabledExtensions])].join(','))}
        VHOSTRA_CWEBP: ${q(state.settings.php.cwebpEnabled)}
    image: ${q(`vhostra-runtime:ols-lsphp${php}`)}
    labels:
      ${managedLabel.split('=').map(q).join(': ')}
    ports:
      - ${q(`127.0.0.1:${state.settings.ports.http}:8088`)}
      - ${q(`127.0.0.1:${state.settings.ports.phpMyAdmin}:8088`)}
      - ${q(`127.0.0.1:${state.settings.ports.mariadb}:3306`)}
    environment:
      VHOSTRA_LSPHP_VERSION: ${q(php)}
      VHOSTRA_REDIS: ${q(state.settings.optionalServices.redis)}
      VHOSTRA_MEMCACHED: ${q(state.settings.optionalServices.memcached)}
      VHOSTRA_PHP_EXTENSIONS: ${q(state.settings.php.extensions.join(','))}
      VHOSTRA_PHP_DISABLED_EXTENSIONS: ${q(state.settings.php.disabledExtensions.join(','))}
      VHOSTRA_OPCACHE: ${q(state.settings.php.opcacheEnabled)}
      VHOSTRA_PMA_BLOWFISH_SECRET: \${VHOSTRA_PMA_BLOWFISH_SECRET}
      VHOSTRA_PMA_PASSWORD: \${VHOSTRA_PMA_PASSWORD}
    volumes:
      - ${q(`${path.join(layout.sites, 'localhost', 'public')}:/var/www/html`)}
      - ${q(`${layout.runtime.openLiteSpeed}:/etc/vhostra/openlitespeed:ro`)}
      ${state.sites.filter(site => !site.builtIn).map(site => `- ${q(`${site.documentRoot}:/var/www/vhostra/${site.vhostId}:ro`)}`).join('\n      ')}
      - ${q(`${layout.persistentData.mariaDb}:/var/lib/mysql`)}
      - ${q(`${layout.logs}:/var/log/vhostra`)}
    networks: [vhostra]
networks:
  vhostra:
    name: vhostra-network
    labels:
      ${managedLabel.split('=').map(q).join(': ')}
`
}
