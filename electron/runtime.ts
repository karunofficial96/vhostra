import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { AppState, PhpVersion, StoreLayout, WebServer } from './store.js'

export type RuntimeState = 'unavailable' | 'not-created' | 'stopped' | 'starting' | 'stopping' | 'running' | 'error'
export interface RuntimeSnapshot { state: RuntimeState; message: string; services: string[]; updatedAt: string }

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
      return this.set({ state, message: running ? 'Vhostra services are running.' : 'Vhostra runtime is stopped.', services })
    } catch (error) {
      return this.set({ state: 'unavailable', message: dockerMessage(error), services: [] })
    }
  }
  async start() { return this.runExclusive('starting', 'Preparing Vhostra runtime…', async () => {
    await this.requireDocker()
    const state = await this.getState()
    await this.ensurePortsAvailable(requiredHostPorts(state))
    await this.checkOptionalHttpsPort()
    await this.generate(state)
    await this.compose(['config', '--quiet'])
    // --remove-orphans is limited by this project name and removes obsolete Vhostra service containers after a server/PHP switch.
    await this.compose(['up', '--detach', '--remove-orphans'])
    await this.healthCheck(state.settings.selectedWebServer)
    await this.refresh()
  }) }
  async stop() { return this.runExclusive('stopping', 'Stopping Vhostra services…', async () => {
    await this.requireDocker()
    if (existsSync(this.composeFile)) await this.compose(['stop'])
    await this.refresh()
  }) }
  async restart() { return this.runExclusive('stopping', 'Restarting Vhostra services…', async () => {
    await this.requireDocker()
    const state = await this.getState()
    await this.ensurePortsAvailable(requiredHostPorts(state), true)
    await this.checkOptionalHttpsPort(true)
    await this.generate(state)
    await this.compose(['config', '--quiet'])
    await this.compose(['up', '--detach', '--remove-orphans'])
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

  private get runtimeRoot() { return path.dirname(this.layout.runtime.apache) }
  private get composeFile() { return path.join(this.runtimeRoot, 'compose.yml') }
  private get environmentFile() { return path.join(this.runtimeRoot, '.env') }
  private set(next: Omit<RuntimeSnapshot, 'updatedAt'>) { const message = this.httpsWarning ? `${next.message} HTTPS is unavailable: ${this.httpsWarning}` : next.message; this.snapshot = { ...next, message, updatedAt: new Date().toISOString() }; void this.updateWelcome?.(this.snapshot.message); this.listeners.forEach(listener => listener()); return this.snapshot }
  private async runExclusive(state: RuntimeState, message: string, task: () => Promise<void>) {
    if (this.operation) throw new Error('A Vhostra service operation is already in progress.')
    this.set({ state, message, services: this.snapshot.services })
    this.operation = task().catch(error => { this.set({ state: 'error', message: error instanceof Error ? error.message : String(error), services: [] }); throw error }).finally(() => { this.operation = null })
    return this.operation
  }
  private async requireDocker() { await this.docker(['info']) }
  private async generate(state: AppState) {
    await fs.mkdir(this.runtimeRoot, { recursive: true })
    await Promise.all([this.layout.runtime.apache, this.layout.runtime.nginx, this.layout.runtime.openLiteSpeed, this.layout.runtime.php, this.layout.runtime.mariaDb, this.layout.runtime.phpMyAdmin, this.layout.runtime.redis, this.layout.runtime.memcached, this.layout.logs].map(directory => fs.mkdir(directory, { recursive: true })))
    await this.ensureEnvironment()
    await fs.writeFile(path.join(this.layout.sites, 'localhost', 'public', 'vhostra-health.php'), '<?php echo "vhostra-lsphp:" . PHP_VERSION;\n', { mode: 0o600 })
    const mounts = state.virtualHosts.map(host => ({ host, container: `/var/www/vhostra/${host.id}` }))
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
    await fs.writeFile(this.environmentFile, contents, { mode: 0o600 })
  }
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
      const main = openLiteSpeedConfig(mounts); const virtualHosts = openLiteSpeedVirtualHosts(mounts)
      await Promise.all([fs.writeFile(path.join(this.layout.runtime.openLiteSpeed, 'httpd_config.conf'), main, { mode: 0o600 }), fs.writeFile(path.join(this.layout.runtime.openLiteSpeed, 'vhostra-vhosts.conf'), virtualHosts, { mode: 0o600 }), fs.writeFile(path.join(generated, 'openlitespeed-vhosts.conf'), `${main}\n${virtualHosts}`, { mode: 0o600 })])
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
    if (!await ready(ports.phpMyAdmin, '/phpmyadmin/index.php')) throw new Error('phpMyAdmin did not pass its shared-runtime health check.')
  }
  private async docker(args: string[]) { return execute('docker', args) }
  private async compose(args: string[], allowFailure = true) { return execute('docker', ['compose', '--project-name', projectName, '--project-directory', this.runtimeRoot, '--env-file', this.environmentFile, '--file', this.composeFile, ...args], allowFailure) }
}

const execute = (command: string, args: string[], allowFailure = false) => new Promise<string>((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''
  child.stdout.on('data', data => { stdout += String(data) }); child.stderr.on('data', data => { stderr += String(data) })
  child.once('error', reject); child.once('close', code => code === 0 || allowFailure ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} ${args.join(' ')} exited with ${code}`)))
})
const parseJsonLines = (value: string) => value.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
const validatePort = (port: number) => { if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A port must be an integer from 1 to 65535.') }
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

function apacheConfig(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return `ServerTokens Prod\nServerSignature Off\nTraceEnable Off\n${mounts.map(({ host, container }) => `<VirtualHost *:80>\n  ServerName ${host.hostname}\n  ${host.aliases.map(alias => `ServerAlias ${alias}`).join('\n  ')}\n  DocumentRoot ${container}\n  <Directory ${container}>\n    Options FollowSymLinks\n    AllowOverride All\n    Require all granted\n  </Directory>\n  ErrorLog /var/log/apache2/${host.id}-error.log\n  CustomLog /var/log/apache2/${host.id}-access.log combined\n</VirtualHost>`).join('\n\n')}\n` }
function nginxConfig(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return `server_tokens off;\n${mounts.map(({ host, container }) => `server {\n  listen 80;\n  server_name ${[host.hostname, ...host.aliases].join(' ')};\n  root ${container};\n  index index.php index.html;\n  access_log /var/log/nginx/${host.id}-access.log;\n  error_log /var/log/nginx/${host.id}-error.log;\n  location / { try_files $uri $uri/ /index.php?$query_string; }\n  location ~ \\.php$ { include fastcgi_params; fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name; fastcgi_pass php:9000; }\n}\n`).join('\n')}` }
function openLiteSpeedConfig(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return `serverName Vhostra\nhttpdWorkers 1\nlistener Default {\n  address *:8088\n  secure 0\n${mounts.map(({ host }) => `  map ${host.hostname} ${host.id}\n${host.aliases.map(alias => `  map ${alias} ${host.id}`).join('\n')}`).join('\n')}\n}\n${mounts.map(({ host, container }) => `virtualhost ${host.id} {\n  vhRoot ${container}/\n  configFile /usr/local/lsws/conf/vhostra-vhosts.conf\n  allowSymbolLink 1\n  enableScript 1\n}\n`).join('')}` }
function openLiteSpeedVirtualHosts(mounts: Array<{ host: AppState['virtualHosts'][number]; container: string }>) { return mounts.map(({ host, container }) => `virtualhost ${host.id} {\n  docRoot ${container}/\n  indexFiles index.php,index.html\n  extprocessor php { type fcgi; address php:9000; maxConns 10; initTimeout 60; retryTimeout 0; }\n  scripthandler { add fcgi:php php }\n  accesslog /usr/local/lsws/logs/${host.id}-access.log { }\n  errorlog /usr/local/lsws/logs/${host.id}-error.log { }\n}\n`).join('\n') }

function singleRuntimeComposeYaml(state: AppState, layout: StoreLayout) {
  const php = state.settings.selectedPhpVersion.replace('.', '')
  return `name: ${projectName}\nservices:\n  runtime:\n    build:\n      context: ./image\n      args:\n        LSPHP_VERSION: ${q(php)}\n    image: ${q(`vhostra-runtime:ols-lsphp${php}`)}\n    labels:\n      ${managedLabel.split('=').map(q).join(': ')}\n    ports:\n      - ${q(`${state.settings.ports.http}:8088`)}\n      - ${q(`${state.settings.ports.phpMyAdmin}:8088`)}\n      - ${q(`${state.settings.ports.mariadb}:3306`)}\n    environment:\n      VHOSTRA_LSPHP_VERSION: ${q(php)}\n      VHOSTRA_REDIS: ${q(state.settings.optionalServices.redis)}\n      VHOSTRA_MEMCACHED: ${q(state.settings.optionalServices.memcached)}\n      VHOSTRA_PMA_BLOWFISH_SECRET: \${VHOSTRA_PMA_BLOWFISH_SECRET}\n    volumes:\n      - ${q(`${path.join(layout.sites, 'localhost', 'public')}:/var/www/html`)}\n      - ${q(`${layout.persistentData.mariaDb}:/var/lib/mysql`)}\n      - ${q(`${layout.logs}:/var/log/vhostra`)}\n    networks: [vhostra]\nnetworks:\n  vhostra:\n    name: vhostra-network\n    labels:\n      ${managedLabel.split('=').map(q).join(': ')}\n`
}
