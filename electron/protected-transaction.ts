import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { systemStoragePaths, type SystemStoragePaths } from './storage-paths.js'
import { authoritativeMariaDbConfig, deriveMariaDbRuntimeConfig, mariaDbPolicyBody, parseAuthoritativeMariaDbConfig } from './mariadb-config.js'
import { authoritativeWebFile, isOwnedWebRuntimeFile, renderWebPreviewFiles, renderWebRuntimeFiles, runtimeWebFile, validateWebRuntimeModel, type WebRuntimeModel } from './web-runtime-config.js'
import { cacheRuntimeMarker, renderCacheRuntimeConfig } from './cache-runtime-config.js'

/** The only machine resources accepted by the short-lived elevated worker. */
export type ProtectedOperation =
  | { type: 'system-json'; object: 'settings' | 'onboarding' | 'site'; id?: string; value: unknown }
  | { type: 'delete-site'; id: string }
  | { type: 'generated-web-config'; files: Array<{ key: string; contents: string | null }> }
  | { type: 'mariadb-runtime-config' }
  | { type: 'web-runtime-config'; model: WebRuntimeModel }
  | { type: 'cache-runtime-config'; redisPort: number; memcachedPort: number }
  | { type: 'hosts'; expectedSha256: string; contents: string }
export interface ProtectedTransaction { version: 1; operations: ProtectedOperation[] }
type ValidatedOperation =
  | { type: 'system-json' | 'delete-site' | 'generated-web-config'; destination: string; contents: string | null }
  | { type: 'hosts'; destination: string; contents: string; expectedSha256: string }
  | { type: 'mariadb-private' | 'mariadb-runtime-public'; destination: string; contents: string }
  | { type: 'web-private' | 'web-preview'; destination: string; contents: string }
  | { type: 'web-runtime-public'; destination: string; contents: string | null }
  | { type: 'cache-runtime-public'; destination: string; contents: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const fail = (message: string): never => { throw new Error(`Protected Vhostra transaction: ${message}`) }
const generatedMarker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
const legacyPhpPolicy = 'expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\nmysqli.default_socket=/run/mysqld/mysqld.sock\npdo_mysql.default_socket=/run/mysqld/mysqld.sock\n'
const legacyMariaDbPolicy = mariaDbPolicyBody
const legacySiteLogrotate = /^(?:\/var\/log\/vhostra\/sites\/[a-f0-9-]{36}\/(?:access|error)\.log(?: )?)* \{\n  size 5M\n  rotate 3\n  copytruncate\n  missingok\n  notifempty\n  su root root\n\}\n$/

function generatedWebDestination(key: string, roots: SystemStoragePaths): string {
  if (/^generated\/(?:apache|nginx|openlitespeed)-vhosts\.conf$/.test(key) || key === 'generated/runtime-selection.json')
    return path.join(roots.configuration, 'configuration', key)
  if (/^runtime\/(?:apache\/vhostra\.conf|nginx\/default\.conf|php\/(?:vhostra\.ini|site-logrotate\.conf)|openlitespeed\/(?:localhost|vhostra-maps|vhostra-vhosts)\.conf|openlitespeed\/sites\/[a-f0-9-]{36}\.conf)$/.test(key)) {
    const site = key.match(/\/sites\/([^/]+)\.conf$/)?.[1]
    if (site && !uuid.test(site)) fail('generated Site identifier is invalid')
    return path.join(roots.configuration, 'configuration', key)
  }
  return fail('generated web configuration name is not allowlisted')
}

function configDestination(op: Extract<ProtectedOperation, { type: 'system-json' }>, roots: SystemStoragePaths): string {
  if (op.object === 'settings') { if (op.id !== undefined) fail('settings identifier is invalid'); return path.join(roots.configuration, 'settings.json') }
  if (op.object === 'onboarding') { if (op.id !== undefined) fail('onboarding identifier is invalid'); return path.join(roots.configuration, 'onboarding.json') }
  if (op.object === 'site' && typeof op.id === 'string' && (uuid.test(op.id) || op.id === 'vhostra-localhost')) return path.join(roots.configuration, 'sites', `${op.id}.json`)
  return fail('configuration object is not allowlisted')
}

function validateJson(op: Extract<ProtectedOperation, { type: 'system-json' }>): string {
  const value = op.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('configuration payload must be an object')
  const record = value as Record<string, unknown>
  if (op.object === 'settings' && (record.schemaVersion !== 1 || typeof record.selectedWebServer !== 'string')) fail('settings payload is invalid')
  if (op.object === 'onboarding' && (typeof record.completed !== 'boolean' || typeof record.server !== 'string')) fail('onboarding payload is invalid')
  if (op.object === 'site' && (record.id !== op.id || typeof record.vhostId !== 'string' || !(uuid.test(record.vhostId) || (op.id === 'vhostra-localhost' && record.vhostId === 'vhostra-localhost-vhost')) || typeof record.name !== 'string' || typeof record.url !== 'string' || typeof record.configuration !== 'object')) fail('Site payload is invalid')
  const encoded = JSON.stringify(value)
  if (encoded === undefined || Buffer.byteLength(encoded) > 1024 * 1024) fail('configuration payload exceeds 1 MiB or is malformed')
  return `${encoded}\n`
}

export function validateProtectedTransaction(input: unknown, roots: SystemStoragePaths = systemStoragePaths(process.platform), hostsPath = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : process.platform === 'darwin' ? '/private/etc/hosts' : '/etc/hosts') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('request is malformed')
  const request = input as Record<string, unknown>
  if (Object.keys(request).some(key => !['version', 'operations'].includes(key))) fail('request contains unsupported fields')
  if (request.version !== 1 || !Array.isArray(request.operations) || request.operations.length < 1 || request.operations.length > 8) fail('version or operation count is invalid')
  const seen = new Set<string>()
  const operations = (request.operations as unknown[]).flatMap<ValidatedOperation>((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('operation is malformed')
    const op = entry as Record<string, unknown>
    if (op.type === 'system-json') {
      if (!['settings', 'onboarding', 'site'].includes(String(op.object)) || Object.keys(op).some(key => !['type', 'object', 'id', 'value'].includes(key))) fail('configuration operation is not allowlisted')
      const typed = op as Extract<ProtectedOperation, { type: 'system-json' }>
      const destination = configDestination(typed, roots)
      if (seen.has(destination)) fail('duplicate destination')
      seen.add(destination)
      return [{ type: 'system-json' as const, destination, contents: validateJson(typed) }]
    }
    if (op.type === 'delete-site') {
      if (Object.keys(op).some(key => !['type', 'id'].includes(key)) || typeof op.id !== 'string' || !uuid.test(op.id)) fail('Site deletion is not allowlisted')
      const destination = path.join(roots.configuration, 'sites', `${op.id}.json`)
      if (seen.has(destination)) fail('duplicate destination')
      seen.add(destination)
      return [{ type: 'delete-site' as const, destination, contents: null }]
    }
    if (op.type === 'generated-web-config') {
      if (Object.keys(op).some(key => !['type', 'files'].includes(key)) || !Array.isArray(op.files) || op.files.length < 1 || op.files.length > 128)
        fail('generated web configuration batch is invalid')
      let total = 0
      return (op.files as unknown[]).map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('generated web configuration file is invalid')
        const file = entry as Record<string, unknown>
        if (Object.keys(file).some(key => !['key', 'contents'].includes(key)) || typeof file.key !== 'string' || file.contents !== null && typeof file.contents !== 'string') fail('generated web configuration file is invalid')
        const destination = generatedWebDestination(file.key as string, roots)
        const contents = file.contents as string | null
        if (contents === null) { /* Exact owned file deletion; ownership is rechecked before commit. */ }
        else if (file.key === 'generated/runtime-selection.json') {
          let selection: Record<string, unknown>
          try { selection = JSON.parse(contents) as Record<string, unknown> } catch { return fail('generated runtime selection is invalid') }
          if (!selection || typeof selection !== 'object' || Array.isArray(selection)
            || Object.keys(selection).some(key => !['owner', 'schemaVersion', 'server', 'phpVersion', 'generatedAt'].includes(key))
            || selection.owner !== 'vhostra' || selection.schemaVersion !== 1
            || !['apache', 'nginx', 'openlitespeed'].includes(String(selection.server))
            || !/^8\.[1-5]$/.test(String(selection.phpVersion))
            || typeof selection.generatedAt !== 'string' || !Number.isFinite(Date.parse(selection.generatedAt))) fail('generated runtime selection is invalid')
        } else if (!contents.startsWith(generatedMarker) || /\0/.test(contents)) fail('generated web configuration ownership marker is missing')
        total += contents === null ? 0 : Buffer.byteLength(contents)
        if (total > 1536 * 1024 || contents !== null && Buffer.byteLength(contents) > 1024 * 1024) fail('generated web configuration exceeds its size limit')
        if (seen.has(destination)) fail('duplicate destination')
        seen.add(destination)
        return { type: 'generated-web-config' as const, destination, contents }
      })
    }
    if (op.type === 'mariadb-runtime-config') {
      if (Object.keys(op).length !== 1) fail('MariaDB runtime configuration operation has unsupported fields')
      const privateDestination = path.join(roots.configuration, 'configuration/runtime/mariadb/vhostra.cnf')
      const runtimeDestination = path.join(roots.data, 'runtime-config/mariadb/vhostra.cnf')
      if (seen.has(privateDestination) || seen.has(runtimeDestination)) fail('duplicate destination')
      seen.add(privateDestination); seen.add(runtimeDestination)
      return [
        { type: 'mariadb-private' as const, destination: privateDestination, contents: authoritativeMariaDbConfig },
        { type: 'mariadb-runtime-public' as const, destination: runtimeDestination, contents: deriveMariaDbRuntimeConfig(authoritativeMariaDbConfig) },
      ]
    }
    if (op.type === 'web-runtime-config') {
      if (Object.keys(op).some(key => !['type', 'model'].includes(key))) fail('web runtime configuration operation has unsupported fields')
      const model = validateWebRuntimeModel(op.model)
      const files = renderWebRuntimeFiles(model)
      const expanded: ValidatedOperation[] = []
      for (const file of files) {
        const privateDestination = generatedWebDestination(file.key, roots)
        const runtimeDestination = path.join(roots.data, 'runtime-config/web', file.key.slice('runtime/'.length))
        const source = authoritativeWebFile(file.body)
        for (const destination of [privateDestination, runtimeDestination]) {
          if (seen.has(destination)) fail('duplicate destination')
          seen.add(destination)
        }
        expanded.push({ type: 'web-private', destination: privateDestination, contents: source },
          { type: 'web-runtime-public', destination: runtimeDestination, contents: runtimeWebFile(source) })
      }
      for (const file of renderWebPreviewFiles(model, files)) {
        const destination = generatedWebDestination(file.key, roots)
        if (seen.has(destination)) fail('duplicate destination')
        seen.add(destination)
        expanded.push({ type: 'web-preview', destination, contents: file.contents })
      }
      return expanded
    }
    if (op.type === 'cache-runtime-config') {
      if (Object.keys(op).some(key => !['type', 'redisPort', 'memcachedPort'].includes(key))) fail('cache runtime configuration has unsupported fields')
      let rendered: ReturnType<typeof renderCacheRuntimeConfig>
      try { rendered = renderCacheRuntimeConfig(op.redisPort as number, op.memcachedPort as number) }
      catch { return fail('cache runtime ports are invalid') }
      return (['redis', 'memcached'] as const).map(service => {
        const destination = path.join(roots.data, 'runtime-config/cache', `${service}.conf`)
        if (seen.has(destination)) fail('duplicate destination')
        seen.add(destination)
        return { type: 'cache-runtime-public' as const, destination, contents: rendered[service] }
      })
    }
    if (op.type === 'hosts') {
      if (Object.keys(op).some(key => !['type', 'expectedSha256', 'contents'].includes(key)) || typeof op.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(op.expectedSha256) || typeof op.contents !== 'string' || Buffer.byteLength(op.contents) > 1024 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(op.contents)) fail('Hosts payload is malformed or exceeds 1 MiB')
      const hostsContents = op.contents as string
      const lines = hostsContents.split(/\r?\n/)
      if (lines.length > 16384 || /\r(?!\n)/.test(hostsContents)) fail('Hosts payload has invalid line endings or line count')
      for (const line of lines) {
        const text = line.replace(/#.*/, '').trim()
        if (!text) continue
        const [address, ...names] = text.split(/\s+/)
        if (!isIP(address) || !names.length || names.some(name => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name))) fail('Hosts payload contains an invalid entry')
      }
      if (seen.has(hostsPath)) fail('duplicate Hosts operation')
      seen.add(hostsPath)
      return [{ type: 'hosts' as const, destination: hostsPath, contents: op.contents as string, expectedSha256: op.expectedSha256 as string }]
    }
    return fail('operation type is not allowlisted')
  })
  return operations
}

async function assertSafeDestination(destination: string, root: string, requireRootOwner = false) {
  if (!path.isAbsolute(destination) || !path.isAbsolute(root) || !destination.startsWith(`${path.resolve(root)}${path.sep}`)) fail('destination is outside the approved system root')
  let cursor = path.parse(destination).root
  for (const part of path.relative(cursor, destination).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part)
    const stat = await fs.lstat(cursor).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (stat?.isSymbolicLink()) fail('symbolic link in destination')
    if (stat && typeof process.getuid === 'function' && process.getuid() === 0 && (requireRootOwner || root === systemStoragePaths(process.platform).configuration || root === path.dirname(process.platform === 'darwin' ? '/private/etc/hosts' : '/etc/hosts')) && (stat.uid !== 0 || (stat.mode & 0o022) !== 0)) fail('protected destination ownership or permissions are unsafe')
    if (stat && cursor !== destination && !stat.isDirectory()) fail('non-directory destination component')
    if (stat && cursor === destination && (!stat.isFile() || stat.nlink !== 1)) fail('destination is not a regular file')
  }
}

/** Revalidates the entire request before the first write. Never accepts a caller-supplied path. */
export async function executeProtectedTransaction(input: unknown, roots: SystemStoragePaths = systemStoragePaths(process.platform), hostsPath = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : process.platform === 'darwin' ? '/private/etc/hosts' : '/etc/hosts'): Promise<{ completed: number }> {
  const operations = validateProtectedTransaction(input, roots, hostsPath)
  if ((input as ProtectedTransaction).operations.some(op => op.type === 'web-runtime-config')) {
    const sitesDir = path.join(roots.data, 'runtime-config/web/openlitespeed/sites')
    await assertSafeDestination(path.join(sitesDir, '.vhostra-check'), roots.data, true)
    const names = await fs.readdir(sitesDir).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]
      throw error
    })
    for (const name of names) {
      if (!uuid.test(name.slice(0, -5)) || !name.endsWith('.conf')) fail('unexpected web runtime Site file')
      const destination = path.join(sitesDir, name)
      if (!operations.some(op => op.destination === destination)) operations.push({ type: 'web-runtime-public', destination, contents: null })
    }
    for (const key of ['apache/vhostra.conf', 'nginx/default.conf']) {
      const destination = path.join(roots.data, 'runtime-config/web', key)
      if (!operations.some(op => op.destination === destination)
        && await fs.lstat(destination).then(() => true, error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        })) operations.push({ type: 'web-runtime-public', destination, contents: null })
    }
  }
  const prepared: Array<{ destination: string; contents: string | null; previous: string | null; mode: number; root: string; directoryMode: number; requireRootOwner: boolean }> = []
  for (const op of operations) {
    const mariaDbConfig = op.type === 'mariadb-private' || op.type === 'mariadb-runtime-public'
    const webConfig = op.type === 'web-private' || op.type === 'web-runtime-public' || op.type === 'web-preview'
    const cacheConfig = op.type === 'cache-runtime-public'
    const root = op.type === 'hosts' ? path.dirname(hostsPath) : op.type === 'mariadb-runtime-public' || op.type === 'web-runtime-public' || cacheConfig ? roots.data : roots.configuration
    await assertSafeDestination(op.destination, root, mariaDbConfig || webConfig || cacheConfig)
    const previous = await fs.readFile(op.destination, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (op.type === 'hosts') {
      if (previous === null || digest(previous) !== op.expectedSha256) fail('Hosts file changed before authorization completed')
      if ((await fs.lstat(hostsPath)).size > 1024 * 1024) fail('Hosts file exceeds 1 MiB')
    }
    if (op.type === 'generated-web-config' && previous !== null) {
      const owned = op.destination.endsWith('runtime-selection.json')
        ? (() => { try { return JSON.parse(previous).owner === 'vhostra' } catch { return false } })()
        : previous.startsWith(generatedMarker) || op.destination.endsWith('/runtime/php/vhostra.ini') && previous === legacyPhpPolicy
          || op.destination.endsWith('/runtime/php/site-logrotate.conf') && legacySiteLogrotate.test(previous)
      if (!owned) fail('existing generated web configuration is not Vhostra-owned')
    }
    if (op.type === 'mariadb-private' && previous !== null && previous !== legacyMariaDbPolicy) {
      try { parseAuthoritativeMariaDbConfig(previous) } catch { fail('existing authoritative MariaDB configuration is unsupported') }
    }
    if (op.type === 'mariadb-runtime-public' && previous !== null && !previous.startsWith('# Vhostra container MariaDB configuration; owner=vhostra; schema=1\n'))
      fail('existing MariaDB runtime configuration is not Vhostra-owned')
    if (op.type === 'web-private' && previous !== null && !previous.startsWith(generatedMarker)
      && !(op.destination.endsWith('/runtime/php/vhostra.ini') && previous === legacyPhpPolicy)
      && !(op.destination.endsWith('/runtime/php/site-logrotate.conf') && legacySiteLogrotate.test(previous)))
      fail('existing authoritative web configuration is not Vhostra-owned')
    if (op.type === 'web-runtime-public' && previous !== null && !isOwnedWebRuntimeFile(previous))
      fail('existing web runtime configuration is not Vhostra-owned')
    if (cacheConfig && previous !== null && !previous.startsWith(cacheRuntimeMarker))
      fail('existing cache runtime configuration is not Vhostra-owned')
    if (op.type === 'web-preview' && previous !== null && !(op.destination.endsWith('runtime-selection.json')
      ? (() => { try { return JSON.parse(previous).owner === 'vhostra' } catch { return false } })()
      : previous.startsWith(generatedMarker))) fail('existing web preview is not Vhostra-owned')
    const stat = await fs.stat(op.destination).catch(() => null)
    const mode = op.type === 'mariadb-runtime-public' || op.type === 'web-runtime-public' || cacheConfig ? 0o644 : mariaDbConfig || webConfig ? 0o600 : stat?.mode ? stat.mode & 0o777 : 0o600
    if ((mariaDbConfig || webConfig || cacheConfig) && stat && (stat.mode & 0o777) !== mode) fail('existing service configuration has unsafe permissions')
    prepared.push({ destination: op.destination, contents: op.contents, previous, mode, root, directoryMode: mariaDbConfig || webConfig || cacheConfig ? 0o755 : 0o700, requireRootOwner: mariaDbConfig || webConfig || cacheConfig })
  }
  const completed: typeof prepared = []
  try {
    for (const item of prepared) {
      await assertSafeDestination(item.destination, item.root, item.requireRootOwner)
      const current = await fs.readFile(item.destination, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
      if (current !== item.previous) fail('destination changed while transaction was prepared')
      const parent = path.dirname(item.destination)
      if (item.destination !== hostsPath) await fs.mkdir(parent, { recursive: true, mode: item.directoryMode })
      await assertSafeDestination(item.destination, item.root, item.requireRootOwner)
      const staged = path.join(parent, `.vhostra-${randomUUID()}.tmp`)
      try {
        if (item.contents === null) await fs.rm(item.destination, { force: true })
        else { await fs.writeFile(staged, item.contents, { flag: 'wx', mode: item.mode }); await fs.chmod(staged, item.mode); await fs.rename(staged, item.destination) }
      } finally { await fs.rm(staged, { force: true }) }
      completed.push(item)
      const verified = await fs.readFile(item.destination, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
      if (verified !== item.contents) fail('write verification failed')
    }
    return { completed: (input as ProtectedTransaction).operations.length }
  } catch (error) {
    for (const item of completed.reverse()) {
      try {
        if (await fs.readFile(item.destination, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }) !== item.contents) continue
        if (item.previous === null) await fs.rm(item.destination)
        else {
          const staged = path.join(path.dirname(item.destination), `.vhostra-rollback-${randomUUID()}.tmp`)
          try { await fs.writeFile(staged, item.previous, { flag: 'wx', mode: item.mode }); await fs.chmod(staged, item.mode); await fs.rename(staged, item.destination) }
          finally { await fs.rm(staged, { force: true }) }
        }
      } catch { throw new Error('Protected Vhostra transaction failed and recovery requires manual review.', { cause: error }) }
    }
    throw error
  }
}
