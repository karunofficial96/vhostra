import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { inspectLegacySystemStorage, prepareSystemMigration, type MigrationEntry } from './system-migration.js'
import { executeProtectedTransaction } from './protected-transaction.js'
import { authoritativeMariaDbConfig, deriveMariaDbRuntimeConfig, mariaDbPolicyBody, parseAuthoritativeMariaDbConfig } from './mariadb-config.js'
import { authoritativeWebFile, renderWebPreviewFiles, renderWebRuntimeFiles, runtimeWebFile, type WebRuntimeModel } from './web-runtime-config.js'

export type MigrationPhase = 'legacy' | 'preparing' | 'copied' | 'verified' | 'ready-for-activation' | 'active' | 'failed' | 'rolled-back'
export interface MachineMigrationRequest {
  sourceRoot: string
  systemRoot: string
  attemptId: string
  sourceUid: number
  writerUid: number
  writerGid: number
}
export type MigrationFault = 'before-copy' | 'partial-copy' | 'after-copy' | 'verification' | 'permissions' | 'interrupt-before-activation'
interface Journal { format: 'vhostra/machine-migration/v1'; attemptId: string; phase: MigrationPhase; sourceDigest: string }
const attemptPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const journalName = '.vhostra-migration-state.json'
const generatedMarker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
const fail = (message: string): never => { throw new Error(`Machine migration: ${message}`) }
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const stageFor = (request: MachineMigrationRequest) => path.join(request.systemRoot, `.Vhostra-migration-stage-${request.attemptId}`)
const ownedPath = (candidate: string, root: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`)

async function statOrNull(file: string) {
  return fs.lstat(file).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
}
async function noLinks(file: string) {
  let cursor = path.parse(file).root
  for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part)
    if ((await statOrNull(cursor))?.isSymbolicLink()) fail('symbolic-link path component')
  }
}
async function hashFile(file: string) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1) fail('source file changed or linked')
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    return { bytes: stat.size, hash: hash.digest('hex') }
  } finally { await handle.close() }
}
async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}
async function writeJournal(stage: string, state: Journal) {
  const target = path.join(stage, journalName)
  const temporary = path.join(stage, `.vhostra-journal-${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
  try { await handle.writeFile(`${JSON.stringify(state)}\n`); await handle.sync() } finally { await handle.close() }
  await fs.chmod(temporary, 0o600)
  await fs.rename(temporary, target)
  await syncDirectory(stage)
}
async function readJournal(stage: string, attemptId: string): Promise<Journal> {
  const file = path.join(stage, journalName)
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) fail('migration journal is unsafe')
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as Journal
  if (value.format !== 'vhostra/machine-migration/v1' || value.attemptId !== attemptId
    || !['preparing', 'copied', 'verified', 'ready-for-activation', 'failed', 'rolled-back'].includes(value.phase)
    || !/^[a-f0-9]{64}$/.test(value.sourceDigest)) fail('migration journal is invalid')
  return value
}
function validateRequest(request: MachineMigrationRequest) {
  if (!request || Object.keys(request).some(key => !['sourceRoot', 'systemRoot', 'attemptId', 'sourceUid', 'writerUid', 'writerGid'].includes(key))
    || !path.isAbsolute(request.sourceRoot) || !path.isAbsolute(request.systemRoot)
    || path.basename(request.sourceRoot) !== 'Vhostra' || !attemptPattern.test(request.attemptId)
    || !Number.isInteger(request.sourceUid) || request.sourceUid < 1
    || !Number.isInteger(request.writerUid) || request.writerUid < 1
    || !Number.isInteger(request.writerGid) || request.writerGid < 1
    || ownedPath(request.sourceRoot, request.systemRoot) || ownedPath(request.systemRoot, request.sourceRoot))
    fail('request paths or identities are not allowlisted')
}
async function externalRoots(source: string): Promise<string[]> {
  const directory = path.join(source, 'sites')
  const roots: string[] = []
  for (const name of await fs.readdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]; throw error })) {
    if (!name.endsWith('.json')) continue
    const file = path.join(directory, name)
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) fail('Site record is unsafe')
    const record = JSON.parse(await fs.readFile(file, 'utf8')) as { builtIn?: unknown; documentRoot?: unknown; configuration?: { documentRoot?: unknown } }
    const documentRoot = record.documentRoot
    if (typeof documentRoot !== 'string' || !path.isAbsolute(documentRoot)
      || record.configuration?.documentRoot !== documentRoot) throw new Error('Machine migration: Site document root is invalid')
    if (record.builtIn === 'localhost') {
      if (documentRoot !== path.join(source, 'sites/localhost/public')) fail('built-in Site root is invalid')
    } else {
      if (ownedPath(documentRoot, source)) fail('external Site root overlaps legacy Store')
      roots.push(documentRoot)
    }
  }
  return roots
}
function copiedRelative(entry: MigrationEntry): string {
  const value = entry.relativePath.split(path.sep).join('/')
  if (entry.kind === 'logs') return entry.relativePath
  if (value.startsWith('sites/localhost/public/')) return path.join('service-data/localhost/public', value.slice('sites/localhost/public/'.length))
  if (/^runtime\/(?:apache|nginx|openlitespeed|php)\//.test(value) || value === 'runtime/mariadb/vhostra.cnf')
    return path.join('configuration', entry.relativePath)
  if (/^runtime\/(?:redis|memcached)\//.test(value)) return path.join('service-data', value.slice('runtime/'.length))
  return entry.relativePath
}
function isReproducible(entry: MigrationEntry): boolean {
  const value = entry.relativePath.split(path.sep).join('/')
  return /^runtime\/(?:apache|nginx|openlitespeed|php)\//.test(value)
    || value === 'runtime/mariadb/vhostra.cnf' || value.startsWith('configuration/generated/')
}
async function validateGeneratedSource(source: string, entries: MigrationEntry[]) {
  for (const entry of entries.filter(isReproducible)) {
    const file = path.join(source, entry.relativePath)
    const value = await fs.readFile(file, 'utf8')
    const key = entry.relativePath.split(path.sep).join('/')
    if (key === 'runtime/mariadb/vhostra.cnf') {
      if (value !== mariaDbPolicyBody) {
        try { parseAuthoritativeMariaDbConfig(value) } catch { fail('legacy MariaDB policy is unsupported') }
      }
    } else if (key === 'runtime/php/vhostra.ini') {
      if (!value.startsWith(generatedMarker) && value !== 'expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\nmysqli.default_socket=/run/mysqld/mysqld.sock\npdo_mysql.default_socket=/run/mysqld/mysqld.sock\n') fail('legacy PHP policy is unsupported')
    } else if (key.endsWith('runtime-selection.json')) {
      try { if (JSON.parse(value).owner !== 'vhostra') fail('legacy generated metadata is unowned') } catch { fail('legacy generated metadata is invalid') }
    } else if (!value.startsWith(generatedMarker)) fail('legacy generated configuration is unowned')
  }
}
async function webModel(payload: string): Promise<WebRuntimeModel> {
  const settings = JSON.parse(await fs.readFile(path.join(payload, 'settings.json'), 'utf8')) as { selectedWebServer?: unknown; selectedPhpVersion?: unknown }
  const certificate = await statOrNull(path.join(payload, 'certificates/public/localhost.pem'))
  const privateKey = await statOrNull(path.join(payload, 'certificates/private/localhost.key'))
  if (Boolean(certificate) !== Boolean(privateKey) || certificate && !certificate.isFile() || privateKey && !privateKey.isFile())
    fail('HTTPS certificate pair is incomplete')
  const sitesDirectory = path.join(payload, 'sites')
  const sites: WebRuntimeModel['sites'] = []
  for (const name of await fs.readdir(sitesDirectory)) {
    if (!name.endsWith('.json')) continue
    const record = JSON.parse(await fs.readFile(path.join(sitesDirectory, name), 'utf8')) as {
      vhostId?: string; builtIn?: string; configuration?: { id?: string; hostname?: string; aliases?: string[]; indexFiles?: string[]; rewriteEnabled?: boolean }
    }
    const host = record.configuration
    if (!host || record.vhostId !== host.id) throw new Error('Machine migration: Site record lacks canonical virtual-host configuration')
    sites.push({ id: host.id!, hostname: host.hostname!, aliases: host.aliases ?? [], builtIn: record.builtIn === 'localhost',
      indexFiles: host.indexFiles ?? ['index.php', 'index.html'], rewriteEnabled: host.rewriteEnabled !== false })
  }
  return { server: settings.selectedWebServer as WebRuntimeModel['server'], phpVersion: settings.selectedPhpVersion as string,
    httpsEnabled: Boolean(certificate && privateKey), sites }
}
async function regenerateServiceConfiguration(payload: string, entries: MigrationEntry[]) {
  for (const entry of entries.filter(isReproducible)) await fs.rm(path.join(payload, copiedRelative(entry)), { force: true })
  const roots = { configuration: payload, data: payload, logs: path.join(payload, 'logs') }
  await executeProtectedTransaction({ version: 1, operations: [
    { type: 'mariadb-runtime-config' }, { type: 'web-runtime-config', model: await webModel(payload) },
  ] }, roots, path.join(payload, 'hosts'))
}
type Identity = { uid: number; gid: number; mode: number }
function policy(relative: string, directory: boolean, request: MachineMigrationRequest, rootUid: number, rootGid: number): Identity {
  const normalized = relative.split(path.sep).join('/')
  const root = { uid: rootUid, gid: rootGid, mode: directory ? 0o700 : 0o600 }
  const writer = { uid: request.writerUid, gid: request.writerGid, mode: directory ? 0o700 : 0o600 }
  if (normalized === '' || normalized === '.vhostra-system-migration.json') return { ...root, mode: directory ? 0o755 : 0o600 }
  if (normalized === 'runtime-config' || normalized.startsWith('runtime-config/')) return { ...root, mode: directory ? 0o755 : 0o644 }
  if (normalized === 'configuration' || normalized.startsWith('configuration/') || normalized === 'sites' || normalized.startsWith('sites/')
    || normalized === 'virtual-hosts' || normalized.startsWith('virtual-hosts/') || normalized === 'settings.json' || normalized === 'onboarding.json') return root
  if (normalized === 'service-data/localhost' || normalized.startsWith('service-data/localhost/')) return { ...writer, mode: directory ? 0o755 : 0o644 }
  if (normalized === 'certificates/public' || normalized.startsWith('certificates/public/')) return { ...writer, mode: directory ? 0o755 : 0o644 }
  if (normalized === 'certificates' || normalized.startsWith('certificates/') || normalized === 'data/mariadb' || normalized.startsWith('data/mariadb/')
    || normalized === 'service-data' || normalized.startsWith('service-data/') || normalized === 'runtime' || normalized.startsWith('runtime/')
    || normalized === 'logs' || normalized.startsWith('logs/')) return writer
  if (normalized === 'data') return { ...root, mode: 0o755 }
  return root
}
async function walk(root: string): Promise<Array<{ relative: string; directory: boolean }>> {
  const entries: Array<{ relative: string; directory: boolean }> = [{ relative: '', directory: true }]
  const visit = async (relative: string) => {
    const directory = path.join(root, relative)
    for (const name of await fs.readdir(directory)) {
      const child = path.join(relative, name)
      const stat = await fs.lstat(path.join(root, child))
      if (stat.isSymbolicLink()) fail('linked destination in migrated payload')
      if (stat.isDirectory()) { entries.push({ relative: child, directory: true }); await visit(child) }
      else if (stat.isFile() && stat.nlink === 1) entries.push({ relative: child, directory: false })
      else fail('unsupported destination file type')
    }
  }
  await visit('')
  return entries
}
async function applyPolicy(payload: string, request: MachineMigrationRequest, rootUid: number, rootGid: number) {
  const entries = await walk(payload)
  for (const item of entries) {
    const target = path.join(payload, item.relative)
    const expected = policy(item.relative, item.directory, request, rootUid, rootGid)
    await fs.chown(target, expected.uid, expected.gid)
    await fs.chmod(target, expected.mode)
  }
}
async function verifyPayload(payload: string, source: string, inventory: MigrationEntry[], request: MachineMigrationRequest, rootUid: number, rootGid: number) {
  const expected = new Set<string>(['.vhostra-system-migration.json'])
  for (const entry of inventory.filter(item => !isReproducible(item))) {
    const relative = copiedRelative(entry)
    expected.add(relative)
    const target = path.join(payload, relative)
    if (entry.relativePath === path.join('sites', 'vhostra-localhost.json')) {
      const record = JSON.parse(await fs.readFile(target, 'utf8')) as { documentRoot?: string; configuration?: { documentRoot?: string } }
      const builtIn = path.join(payload, 'service-data/localhost/public')
      if (record.documentRoot !== builtIn || record.configuration?.documentRoot !== builtIn) fail('built-in Site record was not moved to service data')
    } else {
      const [before, after] = await Promise.all([hashFile(path.join(source, entry.relativePath)), hashFile(target)])
      if (before.bytes !== entry.bytes || before.bytes !== after.bytes || before.hash !== after.hash) fail('copied file differs from legacy source')
    }
  }
  const model = await webModel(payload)
  const webFiles = renderWebRuntimeFiles(model)
  const previews = renderWebPreviewFiles(model, webFiles)
  const expectedGenerated = new Map<string, string>([
    ['configuration/runtime/mariadb/vhostra.cnf', authoritativeMariaDbConfig],
    ['runtime-config/mariadb/vhostra.cnf', deriveMariaDbRuntimeConfig(authoritativeMariaDbConfig)],
    ...webFiles.flatMap(file => [
      [`configuration/${file.key}`, authoritativeWebFile(file.body)],
      [`runtime-config/web/${file.key.slice('runtime/'.length)}`, runtimeWebFile(authoritativeWebFile(file.body))],
    ] as [string, string][]),
    ...previews.map(file => [`configuration/${file.key}`, file.contents] as [string, string]),
  ])
  for (const [relative, contents] of expectedGenerated) {
    if (relative === 'configuration/generated/runtime-selection.json') {
      const selection = JSON.parse(await fs.readFile(path.join(payload, relative), 'utf8')) as { owner?: string; schemaVersion?: number; server?: string; phpVersion?: string }
      if (selection.owner !== 'vhostra' || selection.schemaVersion !== 1 || selection.server !== model.server || selection.phpVersion !== model.phpVersion) fail('generated runtime selection differs')
    } else if (await fs.readFile(path.join(payload, relative), 'utf8') !== contents) fail('generated configuration differs')
    expected.add(relative)
  }
  const generated = await walk(payload)
  for (const item of generated) {
    const relative = item.relative.split(path.sep).join('/')
    const stat = await fs.lstat(path.join(payload, item.relative))
    const approved = policy(item.relative, item.directory, request, rootUid, rootGid)
    if (stat.uid !== approved.uid || stat.gid !== approved.gid || (stat.mode & 0o777) !== approved.mode || (!item.directory && !expected.has(item.relative)))
      fail('migrated inventory, ownership or mode is unexpected')
    if (!item.directory && (stat.mode & 0o002)) fail('world-writable migrated file')
  }
  const actualFiles = new Set(generated.filter(item => !item.directory).map(item => item.relative))
  if (actualFiles.size !== expected.size || [...expected].some(file => !actualFiles.has(file))) fail('migrated file inventory is incomplete')
  if (await fs.readFile(path.join(payload, 'configuration/runtime/mariadb/vhostra.cnf'), 'utf8') !== authoritativeMariaDbConfig)
    fail('authoritative MariaDB configuration is not protected')
}
async function tombstone(root: string, journal: Journal, phase: MigrationPhase) {
  const file = path.join(root, `.Vhostra-migration-${journal.attemptId}.result.json`)
  await fs.writeFile(file, `${JSON.stringify({ ...journal, phase })}\n`, { flag: 'wx', mode: 0o600 })
  await fs.chmod(file, 0o600)
  await syncDirectory(root)
}
async function inactiveRootEntries(root: string, rootUid: number, allowedStage?: string) {
  for (const name of await fs.readdir(root)) {
    if (name === allowedStage) continue
    if (!/^\.Vhostra-migration-[a-f0-9-]{36}\.result\.json$/i.test(name)) fail('inactive machine root is occupied')
    const file = path.join(root, name)
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== rootUid || (stat.mode & 0o777) !== 0o600)
      fail('inactive machine root has an unsafe migration result')
    const result = JSON.parse(await fs.readFile(file, 'utf8')) as Journal
    if (result.format !== 'vhostra/machine-migration/v1' || result.phase !== 'rolled-back'
      || name !== `.Vhostra-migration-${result.attemptId}.result.json`) fail('inactive machine root has an invalid migration result')
  }
}

/** Bounded preparation only. There is deliberately no activation commit here. */
export async function prepareMachineMigration(request: MachineMigrationRequest, fault?: MigrationFault): Promise<{ phase: 'ready-for-activation'; inventoryFiles: number; stage: string }> {
  validateRequest(request)
  const rootUid = typeof process.getuid === 'function' ? process.getuid() : 0
  const rootGid = typeof process.getgid === 'function' ? process.getgid() : 0
  const source = path.resolve(request.sourceRoot)
  const root = path.resolve(request.systemRoot)
  const stage = stageFor(request)
  await noLinks(source); await noLinks(root)
  const [sourceStat, rootStat] = await Promise.all([fs.lstat(source), fs.lstat(root)])
  if (!sourceStat.isDirectory() || sourceStat.uid !== request.sourceUid || !rootStat.isDirectory() || rootStat.uid !== rootUid
    || (rootStat.mode & 0o022) !== 0) fail('legacy source or inactive machine root is unsafe or occupied')
  await inactiveRootEntries(root, rootUid)
  const external = await externalRoots(source)
  const inventory = await inspectLegacySystemStorage(source, external)
  if (!inventory.length) fail('legacy source inventory is empty')
  for (const entry of inventory) {
    const stat = await fs.lstat(path.join(source, entry.relativePath))
    if (stat.uid !== request.sourceUid) fail('legacy source ownership is inconsistent')
  }
  await validateGeneratedSource(source, inventory)
  const sourceDigest = digest(JSON.stringify(inventory))
  const journal: Journal = { format: 'vhostra/machine-migration/v1', attemptId: request.attemptId, phase: 'preparing', sourceDigest }
  await fs.mkdir(stage, { mode: 0o755 })
  await fs.chmod(stage, 0o755)
  await writeJournal(stage, journal)
  try {
    if (fault === 'before-copy') fail('injected before-copy failure')
    const payload = path.join(stage, 'payload')
    await prepareSystemMigration(source, { configuration: payload, data: payload, logs: path.join(payload, 'logs') }, external, undefined,
      fault === 'partial-copy' ? async () => fail('injected partial-copy failure') : undefined)
    journal.phase = 'copied'; await writeJournal(stage, journal)
    if (fault === 'after-copy') fail('injected after-copy failure')
    await regenerateServiceConfiguration(payload, inventory)
    await applyPolicy(payload, request, rootUid, rootGid)
    if (fault === 'permissions') { await fs.chmod(path.join(payload, 'settings.json'), 0o666); fail('injected permission failure') }
    if (fault === 'verification') { await fs.appendFile(path.join(payload, 'settings.json'), 'tamper'); fail('injected verification failure') }
    await verifyPayload(payload, source, inventory, request, rootUid, rootGid)
    journal.phase = 'verified'; await writeJournal(stage, journal)
    if (fault === 'interrupt-before-activation') fail('injected interruption before activation commit')
    journal.phase = 'ready-for-activation'; await writeJournal(stage, journal)
    return { phase: 'ready-for-activation', inventoryFiles: inventory.length, stage }
  } catch (error) {
    if (fault === 'interrupt-before-activation' && journal.phase === 'verified') throw error
    journal.phase = 'failed'; await writeJournal(stage, journal)
    await fs.rm(stage, { recursive: true, force: true })
    await tombstone(root, journal, 'rolled-back')
    throw error
  }
}

/** Crash recovery never selects machine storage. Only a verified ready stage survives. */
export async function recoverMachineMigration(request: MachineMigrationRequest): Promise<'legacy' | 'rolled-back' | 'ready-for-activation'> {
  validateRequest(request)
  await noLinks(request.systemRoot)
  const rootUid = typeof process.getuid === 'function' ? process.getuid() : 0
  const rootStat = await fs.lstat(request.systemRoot)
  if (!rootStat.isDirectory() || rootStat.uid !== rootUid || (rootStat.mode & 0o022) !== 0) fail('inactive machine root is unsafe')
  await inactiveRootEntries(request.systemRoot, rootUid, path.basename(stageFor(request)))
  const stage = stageFor(request)
  const stat = await statOrNull(stage)
  if (!stat) {
    const result = await statOrNull(path.join(request.systemRoot, `.Vhostra-migration-${request.attemptId}.result.json`))
    return result ? 'rolled-back' : 'legacy'
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== rootUid || (stat.mode & 0o777) !== 0o755) fail('migration stage is not owned')
  const journal = await readJournal(stage, request.attemptId)
  if (journal.phase === 'ready-for-activation') {
    try {
      const rootGid = typeof process.getgid === 'function' ? process.getgid() : 0
      const external = await externalRoots(request.sourceRoot)
      const inventory = await inspectLegacySystemStorage(request.sourceRoot, external)
      if (digest(JSON.stringify(inventory)) !== journal.sourceDigest) fail('legacy inventory changed during recovery')
      await verifyPayload(path.join(stage, 'payload'), request.sourceRoot, inventory, request, rootUid, rootGid)
      return 'ready-for-activation'
    } catch {
      await fs.rm(stage, { recursive: true, force: true })
      await tombstone(request.systemRoot, journal, 'rolled-back')
      return 'rolled-back'
    }
  }
  await fs.rm(stage, { recursive: true, force: true })
  await tombstone(request.systemRoot, journal, 'rolled-back')
  return 'rolled-back'
}

/** Exact attempt cleanup for fixture acceptance; never deletes the legacy source. */
export async function discardMachineMigrationFixture(request: MachineMigrationRequest) {
  validateRequest(request)
  const stage = stageFor(request)
  const journal = await readJournal(stage, request.attemptId)
  if (journal.phase !== 'ready-for-activation') fail('only a ready fixture stage can be discarded')
  await fs.rm(stage, { recursive: true, force: true })
}
