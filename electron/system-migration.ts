import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Only records owned by the shared environment may cross the privilege boundary. */
const ownedFiles = ['settings.json', 'onboarding.json'] as const
const ownedDirectories = [
  'sites', 'virtual-hosts', 'configuration', 'runtime', 'data', 'certificates',
] as const
const excludedDirectories = new Set(['backups', 'exports', 'cache', 'temporary'])

export interface MigrationEntry {
  relativePath: string
  bytes: number
  kind: 'configuration' | 'data' | 'logs'
}

const isInside = (candidate: string, directory: string) =>
  candidate === directory || candidate.startsWith(`${directory}${path.sep}`)

/**
 * Read-only migration preflight. Never follows links, never inventories external
 * Site roots, and never interprets a path supplied by a Site as a copy source.
 * The eventual elevated worker must repeat these checks after authorization.
 */
export async function inspectLegacySystemStorage(source: string, externalSiteRoots: string[] = []): Promise<MigrationEntry[]> {
  if (!path.isAbsolute(source) || source === path.parse(source).root) throw new Error('Invalid legacy Vhostra root.')
  const root = path.resolve(source)
  const rootStat = await fs.lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Legacy Vhostra root must be a real directory.')
  const rootReal = await fs.realpath(root)
  const selected = [...ownedFiles, ...ownedDirectories, 'logs']
  for (const project of externalSiteRoots) {
    if (!path.isAbsolute(project)) throw new Error('Site document root must be absolute.')
    const realProject = await fs.realpath(project).catch(() => path.resolve(project))
    if (realProject === path.join(rootReal, 'sites', 'localhost', 'public')) continue
    for (const name of selected) {
      const managed = path.join(rootReal, name)
      if (isInside(realProject, managed) || isInside(managed, realProject)) {
        throw new Error('A selected website root overlaps Vhostra managed storage; migration requires manual review.')
      }
    }
  }
  const entries: MigrationEntry[] = []
  const visit = async (relativePath: string, kind: MigrationEntry['kind']): Promise<void> => {
    // Obsolete CLI router state is regenerated nowhere in the current runtime.
    if (relativePath.split(path.sep).join('/') === 'runtime/php/roots.json') return
    const full = path.join(root, relativePath)
    const stat = await fs.lstat(full)
    if (stat.isSymbolicLink()) throw new Error('Migration refused a symbolic link in managed storage.')
    if (stat.isDirectory()) {
      for (const item of await fs.readdir(full)) {
        if (relativePath === '' && excludedDirectories.has(item)) continue
        await visit(path.join(relativePath, item), kind)
      }
    } else if (stat.isFile()) {
      if (stat.nlink !== 1) throw new Error('Migration refused a hard-linked managed file.')
      entries.push({ relativePath, bytes: stat.size, kind })
    } else throw new Error('Migration refused a special file in managed storage.')
  }
  for (const name of ownedFiles) {
    if (await fs.lstat(path.join(root, name)).catch(() => null)) await visit(name, 'configuration')
  }
  for (const name of ownedDirectories) {
    if (await fs.lstat(path.join(root, name)).catch(() => null)) await visit(name, name === 'data' || name === 'certificates' || name === 'sites' ? 'data' : 'configuration')
  }
  if (await fs.lstat(path.join(root, 'logs')).catch(() => null)) await visit('logs', 'logs')
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/**
 * Copy a legacy environment into fixed, initially empty machine directories.
 * This is a preparation primitive, not an elevation boundary. Callers must
 * stop the runtime and provide a secure, scoped privileged worker before using
 * protected OS destinations. No source is removed or active layout changed.
 */
export async function prepareSystemMigration(
  source: string,
  destinations: { configuration: string; data: string; logs: string },
  externalSiteRoots: string[] = [],
  verifyRuntime?: () => Promise<void>,
  onCopiedFile?: (relativePath: string) => Promise<void>,
): Promise<'prepared' | 'already-prepared'> {
  const { createHash, randomUUID } = await import('node:crypto')
  const { constants } = await import('node:fs')
  const destinationsResolved = [...new Set(Object.values(destinations).map(value => path.resolve(value)))]
  // macOS keeps configuration, data and logs under one fixed root. Stage the
  // outermost destination once, then place each logical category within it.
  const roots = destinationsResolved.filter(root => !destinationsResolved.some(other => other !== root && root.startsWith(`${other}${path.sep}`)))
  if (Object.values(destinations).some(value => !path.isAbsolute(value) || value === path.parse(value).root)) throw new Error('Invalid machine storage destination.')
  const sourceRoot = path.resolve(source)
  if (roots.some(root => root === sourceRoot || root.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${root}${path.sep}`))) throw new Error('Machine storage overlaps legacy storage.')
  const entries = await inspectLegacySystemStorage(sourceRoot, externalSiteRoots)
  const legacyBuiltinPublic = path.join(sourceRoot, 'sites', 'localhost', 'public')
  const migratedBuiltinPublic = path.join(destinations.data, 'service-data', 'localhost', 'public')
  const builtinRecord = path.join('sites', 'vhostra-localhost.json')
  const builtinContent = path.join('sites', 'localhost', 'public')
  const isBuiltinContent = (entry: MigrationEntry) => entry.relativePath.startsWith(`${builtinContent}${path.sep}`)
  const transformedRecord = async (original: string): Promise<Buffer> => {
    const stat = await fs.lstat(original)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Invalid built-in Site record for migration.')
    const record = JSON.parse(await fs.readFile(original, 'utf8')) as Record<string, unknown>
    const configuration = record.configuration as Record<string, unknown> | undefined
    if (record.id !== 'vhostra-localhost' || record.builtIn !== 'localhost' || record.vhostId !== 'vhostra-localhost-vhost' ||
        record.documentRoot !== legacyBuiltinPublic || configuration?.documentRoot !== legacyBuiltinPublic) {
      throw new Error('Built-in Site record does not match legacy storage.')
    }
    record.documentRoot = migratedBuiltinPublic
    configuration.documentRoot = migratedBuiltinPublic
    return Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
  }
  const webConfiguration = (entry: MigrationEntry) => /^runtime\/(?:apache|nginx|openlitespeed|php)\//.test(entry.relativePath.split(path.sep).join('/'))
    || entry.relativePath.split(path.sep).join('/') === 'runtime/mariadb/vhostra.cnf'
  const targetFor = (entry: MigrationEntry) => entry.kind === 'logs' ? destinations.logs : isBuiltinContent(entry) ? destinations.data : webConfiguration(entry) ? destinations.configuration :
    entry.relativePath.startsWith(`data${path.sep}`) || entry.relativePath.startsWith(`certificates${path.sep}`) || entry.relativePath.startsWith(`runtime${path.sep}`)
      ? destinations.data : destinations.configuration
  const relativeFor = (entry: MigrationEntry) => entry.kind === 'logs' ? path.relative('logs', entry.relativePath)
    : isBuiltinContent(entry) ? path.join('service-data', 'localhost', 'public', path.relative(builtinContent, entry.relativePath))
      : webConfiguration(entry) ? path.join('configuration', entry.relativePath)
      : /^runtime\/(?:redis|memcached)\//.test(entry.relativePath.split(path.sep).join('/'))
        ? path.join('service-data', path.relative('runtime', entry.relativePath)) : entry.relativePath
  const stagedPath = (target: string, relative: string) => {
    const resolved = path.resolve(target)
    const stage = stages.find(item => resolved === item.root || resolved.startsWith(`${item.root}${path.sep}`))
    if (!stage) throw new Error('Invalid machine storage destination.')
    return path.join(stage.stage, path.relative(stage.root, resolved), relative)
  }
  const marker = '.vhostra-system-migration.json'
  const existing = await Promise.all(roots.map(root => fs.lstat(root).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })))
  const stages: Array<{ root: string; stage: string; activated: boolean }> = []
  const assertNoLinks = async (file: string) => {
    let cursor = path.parse(file).root
    for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part)
      const stat = await fs.lstat(cursor).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (stat?.isSymbolicLink()) throw new Error('Migration refused a symbolic-link path component.')
    }
  }
  const hash = async (file: string) => {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Migration refused a changed managed file.')
      const digest = createHash('sha256')
      for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk)
      return { digest: digest.digest('hex'), size: stat.size }
    } finally { await handle.close() }
  }
  if (existing.every(stat => stat?.isDirectory())) {
    const records = await Promise.all(roots.map(root => fs.readFile(path.join(root, marker), 'utf8').then(JSON.parse, () => null)))
    if (records.every(record => record?.format === 'vhostra/system-migration/v1')) {
      for (const entry of entries) {
        const original = path.join(sourceRoot, entry.relativePath)
        const copied = path.join(targetFor(entry), relativeFor(entry))
        await assertNoLinks(original); await assertNoLinks(copied)
        const before = await hash(original); const after = await hash(copied)
        const expected = entry.relativePath === builtinRecord ? createHash('sha256').update(await transformedRecord(original)).digest('hex') : before.digest
        if (expected !== after.digest || (entry.relativePath !== builtinRecord && before.size !== after.size)) throw new Error('Prepared machine storage differs from legacy source.')
      }
      return 'already-prepared'
    }
  }
  if (existing.some(Boolean)) throw new Error('Machine storage destination is occupied; existing data was preserved.')
  try {
    for (const root of roots) {
      await assertNoLinks(path.dirname(root))
      await fs.mkdir(path.dirname(root), { recursive: true })
      const stage = path.join(path.dirname(root), `.vhostra-stage-${randomUUID()}`)
      await fs.mkdir(stage, { mode: 0o700 })
      stages.push({ root, stage, activated: false })
    }
    for (const entry of entries) {
      const target = targetFor(entry)
      const relative = relativeFor(entry)
      if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) throw new Error('Invalid managed migration path.')
      const original = path.join(sourceRoot, entry.relativePath)
      const copied = stagedPath(target, relative)
      await assertNoLinks(original)
      const before = await hash(original)
      if (before.size !== entry.bytes) throw new Error('Managed source changed during migration.')
      await fs.mkdir(path.dirname(copied), { recursive: true, mode: 0o700 })
      const transformed = entry.relativePath === builtinRecord ? await transformedRecord(original) : null
      const input = await fs.open(original, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const stat = await input.stat()
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.bytes) throw new Error('Managed source changed during migration.')
        const output = await fs.open(copied, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), entry.relativePath.startsWith(`certificates${path.sep}private${path.sep}`) ? 0o600 : 0o600)
        try {
          if (transformed) await output.writeFile(transformed)
          else {
            const buffer = Buffer.allocUnsafe(1024 * 1024)
            let position = 0
            while (position < stat.size) {
              const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, stat.size - position), position)
              if (!bytesRead) throw new Error('Managed source changed during migration.')
              let written = 0
              while (written < bytesRead) written += (await output.write(buffer, written, bytesRead - written)).bytesWritten
              position += bytesRead
            }
          }
          await output.sync()
        } finally { await output.close() }
      } finally { await input.close() }
      const after = await hash(original)
      const verified = await hash(copied)
      const expected = transformed ? createHash('sha256').update(transformed).digest('hex') : before.digest
      if (before.digest !== after.digest || expected !== verified.digest || verified.size !== (transformed?.length ?? entry.bytes)) throw new Error('Managed copy verification failed.')
      await onCopiedFile?.(entry.relativePath)
    }
    for (const item of stages) await fs.writeFile(path.join(item.stage, marker), JSON.stringify({ format: 'vhostra/system-migration/v1' }), { flag: 'wx', mode: 0o600 })
    for (const item of stages) {
      await assertNoLinks(path.dirname(item.root))
      await fs.rename(item.stage, item.root)
      item.activated = true
    }
    await verifyRuntime?.()
    return 'prepared'
  } catch (error) {
    const recovery: string[] = []
    for (const item of stages.reverse()) {
      if (item.activated) {
        try { await fs.rename(item.root, item.stage) }
        catch { recovery.push(item.root); continue }
      }
      try { await fs.rm(item.stage, { recursive: true, force: true }) }
      catch { recovery.push(item.stage) }
    }
    if (recovery.length) throw new Error('System migration rollback needs manual recovery; prepared data was preserved.', { cause: error })
    throw error
  }
}
