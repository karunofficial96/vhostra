import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SystemStoragePaths } from './storage-paths.js'

export interface BuiltInModel {
  server: 'apache' | 'nginx' | 'openlitespeed'
  phpVersion: '8.1' | '8.2' | '8.3' | '8.4' | '8.5'
  theme: 'system' | 'light' | 'dark'
  runtimeMessage: string
  redis: boolean
  memcached: boolean
  redisPort: number
  memcachedPort: number
  sites: Array<{ name: string; url: string }>
}
export interface BuiltInPublishRequest { contentVersion: string; generationId: string }
interface Manifest { format: 'vhostra/built-in/v1'; contentVersion: string; generationId: string; hashes: Record<string, string> }

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const fail = (message: string): never => { throw new Error(`Built-in publication: ${message}`) }
const safeName = /^(?:index\.html|favicon-(?:16|32)\.png|(?:assets|services|fonts)\/[a-zA-Z0-9][a-zA-Z0-9_.-]*|(?:app-icon-(?:light|dark)|brand-source|vhostra-logo-(?:light|dark))\.png|vhostra-(?:health|extensions|cache-health|extension-state)\.php)$/
export const isManagedBuiltInName = (name: string): boolean => safeName.test(name)
const healthFiles = ['vhostra-health.php', 'vhostra-extensions.php', 'vhostra-cache-health.php', 'vhostra-extension-state.php'] as const
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** The future signed service supplies its own immutable app-bundle directory. */
export async function loadTrustedWelcomeBundle(bundleRoot: string): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {}
  const rootInfo = await fs.lstat(bundleRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('trusted bundle root is unsafe')
  let bytes = 0
  for (const entry of await fs.readdir(bundleRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && ['assets', 'services', 'fonts'].includes(entry.name)) {
      for (const child of await fs.readdir(path.join(bundleRoot, entry.name), { withFileTypes: true })) {
        const name = `${entry.name}/${child.name}`
        if (!child.isFile() || !safeName.test(name)) fail('trusted bundle has an unexpected file')
        const file = path.join(bundleRoot, name)
        const info = await fs.lstat(file)
        if (!info.isFile() || info.nlink !== 1 || info.size > 8 * 1024 * 1024) fail('trusted bundle file is unsafe')
        bytes += info.size
        if (bytes > 8 * 1024 * 1024 || Object.keys(result).length >= 128) fail('trusted bundle exceeds limits')
        result[name] = await fs.readFile(file)
      }
    } else {
      if (!entry.isFile() || !safeName.test(entry.name)) fail('trusted bundle has an unexpected file')
      const file = path.join(bundleRoot, entry.name)
      const info = await fs.lstat(file)
      if (!info.isFile() || info.nlink !== 1 || info.size > 8 * 1024 * 1024) fail('trusted bundle file is unsafe')
      bytes += info.size
      if (bytes > 8 * 1024 * 1024 || Object.keys(result).length >= 128) fail('trusted bundle exceeds limits')
      result[entry.name] = await fs.readFile(file)
    }
  }
  if (!result['index.html']) fail('trusted bundle has no welcome template')
  return result
}

function validateModel(model: BuiltInModel): void {
  if (!model || typeof model !== 'object' || Object.keys(model).sort().join(',') !== 'memcached,memcachedPort,phpVersion,redis,redisPort,runtimeMessage,server,sites,theme'
    || !['apache', 'nginx', 'openlitespeed'].includes(model.server) || !/^8\.[1-5]$/.test(model.phpVersion)
    || !['system', 'light', 'dark'].includes(model.theme) || typeof model.runtimeMessage !== 'string'
    || model.runtimeMessage.length > 1000 || typeof model.redis !== 'boolean' || typeof model.memcached !== 'boolean'
    || !Number.isInteger(model.redisPort) || model.redisPort < 1 || model.redisPort > 65535
    || !Number.isInteger(model.memcachedPort) || model.memcachedPort < 1 || model.memcachedPort > 65535
    || !Array.isArray(model.sites) || model.sites.length > 128) fail('invalid semantic model')
  for (const site of model.sites) {
    if (!site || Object.keys(site).sort().join(',') !== 'name,url' || typeof site.name !== 'string' || site.name.length > 200 || typeof site.url !== 'string' || site.url.length > 2048) fail('invalid Site summary')
    try {
      const url = new URL(site.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('invalid Site URL')
    } catch { fail('invalid Site URL') }
  }
}

function renderWelcome(template: string, model: BuiltInModel): string {
  const server = model.server === 'openlitespeed' ? 'OpenLiteSpeed' : model.server === 'nginx' ? 'Nginx' : 'Apache'
  const icon = model.server === 'openlitespeed' ? 'services/openlitespeed.png' : model.server === 'nginx' ? 'services/nginx.ico' : 'services/apache_feather_bullet.gif'
  const links = model.sites.map(site => `<a class="site-link" href="${escapeHtml(site.url)}">${escapeHtml(site.name)}<span>${escapeHtml(site.url)}</span></a>`).join('') || '<p class="empty">Add a site in the Vhostra desktop app to see it here.</p>'
  const values: Record<string, string> = {
    theme: model.theme, server, 'server-icon': icon, php: `PHP ${model.phpVersion}`,
    runtime: escapeHtml(model.runtimeMessage), redis: model.redis ? 'Enabled when runtime is configured' : 'Disabled',
    memcached: model.memcached ? 'Enabled when runtime is configured' : 'Disabled', sites: links,
  }
  return template.replace(/\{\{([a-z-]+)\}\}/g, (_, key: string) => values[key] ?? fail('unknown template field'))
}

function renderHealth(model: BuiltInModel): Record<string, Buffer> {
  return {
    'vhostra-health.php': Buffer.from('<?php echo (PHP_SAPI === "litespeed" ? "vhostra-lsphp:" : "vhostra-php-fpm:") . PHP_VERSION;\n'),
    'vhostra-extensions.php': Buffer.from('<?php foreach (["mysqli", "pdo_mysql", "redis", "memcached"] as $extension) { echo $extension . ":" . (extension_loaded($extension) ? "1" : "0") . "\\n"; } echo "opcache:" . ((function_exists("opcache_get_status") && ini_get("opcache.enable")) ? "1" : "0") . "\\n";\n'),
    'vhostra-extension-state.php': Buffer.from('<?php header("Content-Type: application/json"); echo json_encode(get_loaded_extensions());\n'),
    'vhostra-cache-health.php': Buffer.from(`<?php\nforeach (['localhost', '127.0.0.1'] as $host) {\n  if (${model.redis ? 'true' : 'false'}) { try { $r = new Redis(); if ($r->connect($host, ${model.redisPort}, 2) && $r->ping()) echo "redis:$host:ok\\n"; $r->close(); } catch (Throwable $e) {} }\n  if (${model.memcached ? 'true' : 'false'}) { try { $m = new Memcached(); $m->setOption(Memcached::OPT_CONNECT_TIMEOUT, 2000); $m->addServer($host, ${model.memcachedPort}); $v = $m->getVersion(); if ($v && !in_array('255.255.255', $v, true)) echo "memcached:$host:ok\\n"; $m->quit(); } catch (Throwable $e) {} }\n}\n`),
  }
}

/** Trusted backend primitive; request contains no destination or file bytes. */
export class BuiltInPublisher {
  private readonly base: string
  private readonly dataRoot: string
  constructor(roots: SystemStoragePaths, private readonly signedBundle: Readonly<Record<string, Buffer>>) {
    this.dataRoot = roots.data
    this.base = path.join(roots.data, 'service-data', 'localhost', 'generations')
  }

  private async checkPath(file: string, directory = false): Promise<void> {
    let cursor = path.parse(file).root
    for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part)
      const info = await fs.lstat(cursor).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
      if (info?.isSymbolicLink() || info && cursor === file && (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
        || info && cursor !== file && !info.isDirectory()) fail('unsafe publication path')
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await fs.open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }

  private async ensureDirectory(directory: string): Promise<void> {
    const missing: string[] = []
    let cursor = directory
    while (cursor !== this.dataRoot) {
      const info = await fs.lstat(cursor).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
      if (info) {
        if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe publication directory')
      } else missing.push(cursor)
      const parent = path.dirname(cursor)
      if (parent === cursor || !cursor.startsWith(`${this.dataRoot}${path.sep}`)) fail('publication directory escaped data root')
      cursor = parent
    }
    await this.checkPath(this.dataRoot, true)
    const dataInfo = await fs.lstat(this.dataRoot).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
    if (!dataInfo) {
      await fs.mkdir(this.dataRoot, { mode: 0o755 })
      await this.syncDirectory(path.dirname(this.dataRoot))
      await this.syncDirectory(this.dataRoot)
    }
    for (const item of missing.reverse()) {
      await fs.mkdir(item, { mode: 0o755 })
      await this.syncDirectory(path.dirname(item))
      await this.syncDirectory(item)
    }
  }

  private async replaceFile(target: string, contents: Buffer | string, mode: number): Promise<void> {
    const staged = `${target}.vhostra-${randomUUID()}.tmp`
    const handle = await fs.open(staged, 'wx', mode)
    try { await handle.writeFile(contents); await handle.sync() } finally { await handle.close() }
    try { await fs.rename(staged, target); await this.syncDirectory(path.dirname(target)) }
    finally { await fs.rm(staged, { force: true }) }
  }

  async publish(request: BuiltInPublishRequest, model: BuiltInModel): Promise<'published' | 'already-published'> {
    if (!request || Object.keys(request).sort().join(',') !== 'contentVersion,generationId'
      || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(request.contentVersion) || !/^[a-f0-9]{32}$/.test(request.generationId)) fail('invalid publication identity')
    validateModel(model)
    const root = path.join(this.base, request.generationId, 'public')
    const template = this.signedBundle['index.html']
    if (!template || template.length > 256 * 1024) fail('trusted bundle has no bounded welcome template')
    const files: Record<string, Buffer> = { ...renderHealth(model) }
    let bytes = 0
    for (const [name, contents] of Object.entries(this.signedBundle)) {
      if (!safeName.test(name) || healthFiles.includes(name as typeof healthFiles[number]) || !Buffer.isBuffer(contents)) fail('trusted bundle has an unexpected file')
      bytes += contents.length
      if (bytes > 8 * 1024 * 1024 || Object.keys(this.signedBundle).length > 128) fail('trusted bundle exceeds limits')
      files[name] = name === 'index.html' ? Buffer.from(renderWelcome(contents.toString('utf8'), model)) : contents
    }
    const hashes = Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, digest(contents)]))
    const manifestFile = path.join(root, '.vhostra-built-in.json')
    await this.checkPath(root, true)
    await this.checkPath(manifestFile)
    const currentText = await fs.readFile(manifestFile, 'utf8').catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
    let current: Manifest | null = null
    if (currentText !== null) {
      if (Buffer.byteLength(currentText) > 16 * 1024) fail('manifest exceeds limit')
      let parsed: Manifest
      try { parsed = JSON.parse(currentText) as Manifest } catch { return fail('invalid manifest') }
      if (!parsed || Object.keys(parsed).sort().join(',') !== 'contentVersion,format,generationId,hashes'
        || parsed.format !== 'vhostra/built-in/v1' || parsed.generationId !== request.generationId
        || !parsed.hashes || typeof parsed.hashes !== 'object' || Object.keys(parsed.hashes).length > 128
        || Object.keys(parsed.hashes).some(name => !safeName.test(name) || !/^[a-f0-9]{64}$/.test(parsed.hashes[name]))) fail('invalid manifest')
      if (parsed.contentVersion !== request.contentVersion) fail('generation content version changed')
      current = parsed
    }
    for (const name of Object.keys(files)) {
      const target = path.join(root, name)
      await this.checkPath(target)
      const info = await fs.stat(target).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
      if (info && info.size > 8 * 1024 * 1024) fail('built-in file exceeds limit')
      const existing = info ? await fs.readFile(target) : null
      if (existing && current?.hashes[name] !== digest(existing)) fail('unowned or changed built-in file')
    }
    if (current && JSON.stringify(current.hashes) !== JSON.stringify(hashes)) fail('generation content changed')
    if (current) return 'already-published'
    await this.ensureDirectory(root)
    const previous = new Map<string, Buffer | null>()
    const changed: string[] = []
    try {
      for (const [name, contents] of Object.entries(files)) {
        const target = path.join(root, name)
        if (path.dirname(target) !== root) await this.ensureDirectory(path.dirname(target))
        const before = await fs.readFile(target).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
        previous.set(name, before)
        if (before && digest(before) === hashes[name]) continue
        await this.replaceFile(target, contents, 0o644)
        changed.push(name)
      }
      const next: Manifest = { format: 'vhostra/built-in/v1', contentVersion: request.contentVersion, generationId: request.generationId, hashes }
      await this.replaceFile(manifestFile, JSON.stringify(next), 0o644)
      return 'published'
    } catch (error) {
      for (const name of changed.reverse()) {
        const target = path.join(root, name)
        const before = previous.get(name)
        if (before === null) await fs.rm(target, { force: true })
        else if (before) await fs.writeFile(target, before, { mode: 0o644 })
      }
      throw error
    }
  }
}
