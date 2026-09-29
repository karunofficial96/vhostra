import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { fingerprint } from './reconciliation.js'
import type { RestoreChoices } from './reconciliation.js'
import type { VhostraStore } from './store.js'
import type { DockerRuntimeController } from './runtime.js'
type Accounts = Awaited<ReturnType<DockerRuntimeController['backupAccounts']>>
interface DatabaseEntry { name: string; file: string; sha256: string }
interface AccountEntry { key: string; user: string; host: string; role: boolean; fingerprint: string; summary: ReturnType<typeof accountSummary> }
interface FullManifest { format: 'vhostra/full-backup'; version: 1; appVersion: string; id: string; createdAt: string; configuration: { file: string; sha256: string }; databases: DatabaseEntry[]; accounts: AccountEntry[]; privateAccounts: { file: string; sha256: string }; includes: string[]; excludes: string[]; databaseVersion: string; cacheConfigurations?: Array<{ service: 'redis' | 'memcached'; file: string; sha256: string }> }
export interface DatabaseComparison { key: string; category: 'database' | 'account' | 'role' | 'configuration'; name: string; disposition: 'new' | 'equivalent' | 'conflict' | 'incompatible'; detail: string; local?: unknown; incoming?: unknown }
export interface FullBackupPlan { source: string; checksum: string; manifest: FullManifest; configuration: string; items: DatabaseComparison[]; localFingerprint: string; proven?: Record<string, string>; cacheFingerprint?: string }
export async function fileHash(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
const boundedJson = async (file: string) => { if ((await fs.lstat(file)).isSymbolicLink() || (await fs.stat(file)).size > 4 * 1024 * 1024) throw new Error('Backup metadata must be a regular file under 4 MiB.'); const raw = await fs.readFile(file, 'utf8'); if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('Backup metadata grew beyond 4 MiB.'); return JSON.parse(raw) }
/** Referenced files stay in this backup's private sibling directory, never external roots. */
async function member(source: string, relative: string) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(relative) || relative.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Invalid backup member path.')
  const base = path.dirname(source); const target = path.join(base, relative)
  for (const file of [path.dirname(target), target]) if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Backup members cannot be symbolic links.')
  if (!(await fs.stat(target)).isFile()) throw new Error('Backup member is not a regular file.')
  return target
}
const accountKey = (account: { user: string; host: string; role: boolean }) => `${account.role ? 'role' : 'account'}:${encodeURIComponent(account.user)}@${encodeURIComponent(account.host)}`
const accountSummary = (account: Accounts[number]) => ({ identity: accountKey(account), plugins: [...account.create.matchAll(/(?:IDENTIFIED VIA| OR) ([a-zA-Z0-9_]+)/g)].map(match => match[1]), privileges: account.grants.map(grant => grant.startsWith('SET DEFAULT ROLE ') ? grant : grant.split(/\s+TO\s+/i)[0]).sort() })
const accountFingerprint = (account: Accounts[number]) => fingerprint({ ...account, grants: [...account.grants].sort() })
export async function exportFullBackup(store: VhostraStore, runtime: DockerRuntimeController, destination: string, progress: (message: string) => void) {
  if (await runtime.databaseBackupStatus() !== 'running') throw new Error('Start MariaDB before exporting a complete backup.')
  const id = randomUUID(); const folderName = `vhostra-backup-${id}`; const folder = path.join(path.dirname(destination), folderName)
  await fs.mkdir(folder, { mode: 0o700 })
  const relative = (file: string) => `${folderName}/${file}`
  try {
    progress('Backing up canonical configuration…'); const configuration = path.join(folder, 'configuration.json'); await store.exportBundle(configuration, true)
    const databases: DatabaseEntry[] = []
    const names = await runtime.listDatabases(); if (names.length > 500) throw new Error('Full backups support at most 500 databases.');
    for (const name of names) {
      progress(`Backing up database ${name}…`); const filename = `${randomUUID()}.sql`; const file = path.join(folder, filename)
      await runtime.exportDatabase(name, file); databases.push({ name, file: relative(filename), sha256: await fileHash(file) })
    }
    progress('Backing up database users, roles and grants…'); const accounts = await runtime.backupAccounts(); const privateFile = path.join(folder, 'accounts.json')
    if (accounts.length > 500 || Buffer.byteLength(JSON.stringify(accounts)) > 4 * 1024 * 1024) throw new Error('Database account metadata exceeds backup limits.');
    await fs.writeFile(privateFile, JSON.stringify(accounts), { mode: 0o600 })
    const cacheConfigurations: NonNullable<FullManifest['cacheConfigurations']> = [];
    const cacheState = await runtime.backupCacheState();
    for (const service of ['redis', 'memcached'] as const) if (cacheState[service] !== null) { const file = path.join(folder, `${service}.conf`); await fs.writeFile(file, cacheState[service]!, { mode: 0o600 }); cacheConfigurations.push({ service, file: relative(`${service}.conf`), sha256: await fileHash(file) }) }
    const metadata = await runtime.backupDatabaseMetadata();
    const manifest: FullManifest = { format: 'vhostra/full-backup', version: 1, appVersion: '1.0.0', databaseVersion: metadata.version, cacheConfigurations, id, createdAt: new Date().toISOString(), configuration: { file: relative('configuration.json'), sha256: await fileHash(configuration) }, databases, accounts: accounts.map(account => ({ key: accountKey(account), user: account.user, host: account.host, role: account.role, fingerprint: accountFingerprint(account), summary: accountSummary(account) })), privateAccounts: { file: relative('accounts.json'), sha256: await fileHash(privateFile) }, includes: ['canonical-sites', 'settings', 'php-preferences', 'cache-preferences', 'cache-configuration', 'databases', 'users', 'roles', 'grants', 'authentication-metadata'], excludes: ['external-site-files', 'private-tls-keys', 'runtime-cache-contents', 'protected-system-accounts'] }
    const temporary = `${destination}.${id}.tmp`; try { await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 }); await fs.rename(temporary, destination) } finally { await fs.rm(temporary, { force: true }) }
    progress('Backup complete. Keep the manifest and private sibling folder together.'); return destination
  } catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error }
}
async function readManifest(source: string): Promise<FullManifest | null> {
  const manifest = await boundedJson(source)
  if (manifest?.format !== 'vhostra/full-backup') return null
  if (manifest.version !== 1 || manifest.appVersion !== '1.0.0' || !Array.isArray(manifest.databases) || !Array.isArray(manifest.accounts) || manifest.databases.length > 500 || manifest.accounts.length > 500) throw new Error('Incompatible full-backup manifest.')
  if (!Array.isArray(manifest.includes) || manifest.includes.some((component: string) => !['canonical-sites', 'settings', 'php-preferences', 'cache-preferences', 'cache-configuration', 'databases', 'users', 'roles', 'grants', 'authentication-metadata'].includes(component)) || typeof manifest.databaseVersion !== 'string') throw new Error('Unsupported backup components.');
  const identities = new Set<string>(); const files = new Set<string>()
  for (const entry of [...manifest.databases, ...(manifest.cacheConfigurations ?? []), manifest.configuration, manifest.privateAccounts]) {
    if (!entry || typeof entry.file !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || files.has(entry.file)) throw new Error('Invalid or duplicate backup member.')
    files.add(entry.file); await member(source, entry.file)
  }
  if (manifest.cacheConfigurations && (!Array.isArray(manifest.cacheConfigurations) || manifest.cacheConfigurations.length > 2 || new Set(manifest.cacheConfigurations.map((entry: { service: string }) => entry.service)).size !== manifest.cacheConfigurations.length || manifest.cacheConfigurations.some((entry: { service: string }) => !['redis', 'memcached'].includes(entry.service)))) throw new Error('Invalid cache configuration metadata.');
  for (const entry of manifest.databases) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(entry.name) || ['mysql', 'sys', 'information_schema', 'performance_schema'].includes(entry.name) || identities.has(`database:${entry.name}`)) throw new Error('Invalid or duplicate database identity.')
    identities.add(`database:${entry.name}`)
  }
  for (const account of manifest.accounts) {
    if (typeof account.user !== 'string' || typeof account.host !== 'string' || typeof account.role !== 'boolean' || account.key !== accountKey(account) || !/^[a-f0-9]{64}$/.test(account.fingerprint) || identities.has(account.key) || ['root', 'mysql', 'mariadb.sys', 'vhostra_phpmyadmin', 'vhostra_pma'].includes(account.user) || !account.user) throw new Error('Invalid, duplicate or protected database account identity.')
    identities.add(account.key)
  }
  return manifest
}
async function privateAccounts(source: string, manifest: FullManifest): Promise<Accounts> {
  const file = await member(source, manifest.privateAccounts.file);
  if (await fileHash(file) !== manifest.privateAccounts.sha256) throw new Error('Private account checksum failed.');
  const accounts = await boundedJson(file) as Accounts;
  if (!Array.isArray(accounts) || accounts.length !== manifest.accounts.length || new Set(accounts.map(accountKey)).size !== accounts.length || accounts.some(account => !Array.isArray(account.grants) || account.grants.some(grant => typeof grant !== 'string') || typeof account.create !== 'string' || !manifest.accounts.some(entry => entry.key === accountKey(account) && entry.fingerprint === accountFingerprint(account)))) throw new Error('Private account metadata does not match the manifest.');
  return accounts;
}
async function inventory(runtime: DockerRuntimeController) {
  const status = await runtime.databaseBackupStatus()
  if (status === 'stopped') throw new Error('Start existing MariaDB before comparing this full backup; database equality cannot be checked while it is stopped.')
  if (status !== 'running' && status !== 'absent') throw new Error('MariaDB is unavailable for backup comparison.');
  if (status === 'absent') return { databases: [] as string[], accounts: [] as Accounts }
  return { databases: await runtime.listDatabases(), accounts: await runtime.backupAccounts() }
}
export async function previewFullBackup(source: string, runtime: DockerRuntimeController, progress: (message: string) => void): Promise<FullBackupPlan | null> {
  progress('Reading backup manifest…'); const manifest = await readManifest(source); if (!manifest) return null
  const configuration = await member(source, manifest.configuration.file)
  if (await fileHash(configuration) !== manifest.configuration.sha256) throw new Error('Canonical configuration checksum failed.')
  const payloadAccounts = await privateAccounts(source, manifest);
  const local = await inventory(runtime); const metadata = await runtime.databaseBackupStatus() === "running" ? await runtime.backupDatabaseMetadata() : null; const incompatibleSeries = metadata && manifest.databaseVersion?.split(".").slice(0, 2).join(".") !== metadata.version.split(".").slice(0, 2).join("."); const items: DatabaseComparison[] = []
  for (const database of manifest.databases) {
    const exists = local.databases.includes(database.name)
    items.push({ key: `database:${database.name}`, category: 'database', name: database.name, disposition: incompatibleSeries ? 'incompatible' : exists ? 'conflict' : 'new', detail: incompatibleSeries ? `Source MariaDB ${manifest.databaseVersion} differs from current ${metadata?.version}; conversion requires review outside this restore.` : exists ? 'A database with this name exists. Data equality is unproven. Replacement removes its current tables and data; a recovery dump is retained.' : 'Database data, routines, triggers and events will be restored.' })
  }
  for (const account of manifest.accounts) {
    const current = local.accounts.find(item => accountKey(item) === account.key); const summary = accountSummary(payloadAccounts.find(item => accountKey(item) === account.key)!)
    items.push({ key: account.key, category: account.role ? 'role' : 'account', name: account.role ? account.user : `${account.user}@${account.host}`, disposition: metadata && summary.plugins.some(plugin => !metadata.plugins.includes(plugin)) ? 'incompatible' : !current ? 'new' : accountFingerprint(current) === account.fingerprint ? 'equivalent' : 'conflict', local: current ? accountSummary(current) : undefined, incoming: summary, detail: current ? 'Compare account scope, authentication, roles, default roles and grants. Replacement changes this identity and its privileges.' : 'Restore this identity with its backed-up roles and privileges.' })
  }
  const cacheState = await runtime.backupCacheState()
  for (const entry of manifest.cacheConfigurations ?? []) {
    const target = await member(source, entry.file); if ((await fs.stat(target)).size > 64 * 1024 || await fileHash(target) !== entry.sha256) throw new Error('Cache configuration checksum failed.')
    const incoming = await fs.readFile(target, 'utf8'); const current = cacheState[entry.service]
    items.push({ key: `configuration:${entry.service}`, category: 'configuration', name: `${entry.service} configuration`, disposition: current === null ? 'new' : current === incoming ? 'equivalent' : 'conflict', detail: 'Compare the persistent daemon configuration fingerprint. Replacement changes cache behavior; cache contents are ephemeral and excluded.' })
  }
  return { source, checksum: await fileHash(source), manifest, configuration, items, localFingerprint: fingerprint(local), cacheFingerprint: fingerprint(cacheState) }
}
/** Optional, explicit data comparison; never performed to render onboarding. */
export async function proveDatabaseEquality(plan: FullBackupPlan, runtime: DockerRuntimeController, key: string, directory: string) {
  const item = plan.items.find(item => item.key === key && item.category === 'database')
  const entry = plan.manifest.databases.find(database => `database:${database.name}` === key)
  if (!item || !entry) throw new Error('Unknown backup database.')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const file = path.join(directory, `${randomUUID()}.sql`)
  try { await runtime.exportDatabase(entry.name, file); const hash = await fileHash(file); if (hash === entry.sha256) { item.disposition = 'equivalent'; item.detail = 'Current database dump matches the backup checksum; skip.'; plan.proven = { ...plan.proven, [key]: hash } }; return item }
  finally { await fs.rm(file, { force: true }) }
}
export async function restoreFullDatabase(plan: FullBackupPlan, runtime: DockerRuntimeController, choices: RestoreChoices, recoveryDirectory: string, progress: (message: string) => void) {
  if (await fileHash(plan.source) !== plan.checksum) throw new Error('Backup changed after preview. Review it again.')
  const local = await inventory(runtime)
  const originalCache = await runtime.backupCacheState(); if (plan.cacheFingerprint && fingerprint(originalCache) !== plan.cacheFingerprint) throw new Error("Cache configuration changed after preview; review again.")
  if (fingerprint(local) !== plan.localFingerprint) throw new Error('Database/account inventory changed after preview. Review conflicts again.')
  const selected = plan.items.filter(item => {
    if (item.disposition === 'incompatible' && !['keep', 'skip'].includes(choices[item.key])) throw new Error(`${item.name}: incompatible state must be explicitly skipped.`)
    if (item.disposition === 'conflict' && !['keep', 'replace', 'skip'].includes(choices[item.key])) throw new Error(`${item.name}: conflict review required.`)
    return item.disposition !== 'incompatible' && (item.disposition === 'new' || choices[item.key] === 'replace')
  })
  for (const [key, hash] of Object.entries(plan.proven ?? {})) {
    const entry = plan.manifest.databases.find(database => `database:${database.name}` === key)!
    const directory = path.join(recoveryDirectory, 'compare'); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const file = path.join(directory, `${randomUUID()}.sql`)
    try { await runtime.exportDatabase(entry.name, file); if (await fileHash(file) !== hash) throw new Error(`Database ${entry.name} changed after comparison; review again.`) } finally { await fs.rm(file, { force: true }) }
  }
  // Verify all input before altering any database; streaming checksums run once on Restore.
  for (const entry of plan.manifest.databases) if (await fileHash(await member(plan.source, entry.file)) !== entry.sha256) throw new Error(`Database ${entry.name} checksum failed.`)
  const accounts = await privateAccounts(plan.source, plan.manifest);
  const metadata = await runtime.backupDatabaseMetadata();
  if (selected.some(item => item.category === 'database') && plan.manifest.databaseVersion.split('.').slice(0, 2).join('.') !== metadata.version.split('.').slice(0, 2).join('.')) throw new Error('MariaDB server series differs from this backup. Review compatibility before restoring.');
  for (const account of accounts.filter(account => selected.some(item => item.key === accountKey(account)))) if (accountSummary(account).plugins.some(plugin => !metadata.plugins.includes(plugin))) throw new Error('Backup authentication plugin is unavailable. Review compatibility before restoring.');
  await fs.mkdir(recoveryDirectory, { recursive: true, mode: 0o700 }); await retainCompletedRecoveries(recoveryDirectory);
  if ((await fs.readdir(recoveryDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^database-restore-[a-f0-9-]{36}$/.test(entry.name)).length >= 60) throw new Error('Restore recovery storage has reached 60 records. Review retained failed recoveries before restoring again; none were deleted.');
  const recovery = path.join(recoveryDirectory, `database-restore-${randomUUID()}`); await fs.mkdir(recovery, { recursive: true, mode: 0o700 })
  const saved: Array<{ name: string; file?: string; touched?: boolean }> = []; const selectedAccounts = accounts.filter(account => selected.some(item => item.key === accountKey(account)))
  const oldAccounts = local.accounts.filter(account => selectedAccounts.some(item => accountKey(item) === accountKey(account)))
  const journal = { owner: 'vhostra', kind: 'full-backup-restore', createdAt: new Date().toISOString(), state: 'active', source: plan.source, items: plan.items.map(item => ({ key: item.key, category: item.category, disposition: item.disposition, choice: choices[item.key] ?? (item.disposition === 'new' ? 'import' : 'skip'), outcome: selected.includes(item) ? 'pending' : 'skipped' })), imported: 0, skipped: plan.items.length - selected.length, replaced: 0, conflicted: 0, failed: 0, recoveryErrors: [] as string[] }
  const persist = async () => { const temporary = path.join(recovery, 'journal.tmp'); await fs.writeFile(temporary, JSON.stringify(journal), { mode: 0o600 }); await fs.rename(temporary, path.join(recovery, 'journal.json')) };
  const record = (key: string, outcome: string) => { const item = journal.items.find(item => item.key === key); if (item) item.outcome = outcome }
  await fs.writeFile(path.join(recovery, 'accounts.json'), JSON.stringify(oldAccounts), { mode: 0o600 }); await persist()
  let accountsTouched = false; let cacheTouched = false
  try {
    // Recovery dumps are prepared before any destructive choice is applied.
    for (const item of selected.filter(item => item.category === 'database')) {
      const name = item.name; const file = local.databases.includes(name) ? path.join(recovery, `${name}.sql`) : undefined
      if (file) { progress(`Saving recovery database ${name}…`); await runtime.exportDatabase(name, file) }
      saved.push({ name, file })
    }
    for (const item of plan.items.filter(item => !selected.includes(item))) progress(`${item.name} — skipping`)
    for (const entry of saved) {
      progress(`Restoring database ${entry.name}…`); entry.touched = true; record(`database:${entry.name}`, 'restoring'); await persist(); await runtime.prepareBackupDatabase(entry.name, Boolean(entry.file)); await runtime.importDatabase(entry.name, await member(plan.source, plan.manifest.databases.find(item => item.name === entry.name)!.file))
      if (entry.file) journal.replaced++; else journal.imported++; record(`database:${entry.name}`, entry.file ? 'replaced' : 'imported'); await persist()
    }
    if (selectedAccounts.length) { progress('Restoring database users, roles and grants…'); accountsTouched = true; await runtime.restoreBackupAccounts(selectedAccounts, true) }
    if (accountsTouched) await runtime.reapplyBackupGrants(local.accounts.filter(account => !selectedAccounts.some(item => accountKey(item) === accountKey(account))))
    for (const account of selectedAccounts) { const replaced = oldAccounts.some(item => accountKey(item) === accountKey(account)); if (replaced) journal.replaced++; else journal.imported++; record(accountKey(account), replaced ? 'replaced' : 'imported') }
    for (const entry of plan.manifest.cacheConfigurations ?? []) if (selected.some(item => item.key === `configuration:${entry.service}`)) {
      const file = await member(plan.source, entry.file); if (await fileHash(file) !== entry.sha256) throw new Error('Cache configuration checksum failed.')
      progress(`Restoring ${entry.service} configuration…`); cacheTouched = true; await runtime.restoreBackupCacheState({ [entry.service]: await fs.readFile(file, 'utf8') }); if (originalCache[entry.service] === null) journal.imported++; else journal.replaced++; record(`configuration:${entry.service}`, originalCache[entry.service] === null ? 'imported' : 'replaced')
    }
    journal.state = 'completed'; await persist(); await retainCompletedRecoveries(recoveryDirectory).catch(() => undefined); return { summary: journal, recovery }
  } catch (error) {
    try { if (cacheTouched) await runtime.restoreBackupCacheState(originalCache) } catch { journal.recoveryErrors.push('Cache configuration') }
    journal.failed++; journal.state = 'recovering'; await persist()
    for (const entry of saved.filter(entry => entry.touched)) try { if (entry.file) { await runtime.prepareBackupDatabase(entry.name, true); await runtime.importDatabase(entry.name, entry.file) } else if ((await runtime.listDatabases()).includes(entry.name)) await runtime.deleteDatabase(entry.name) } catch { journal.recoveryErrors.push(`Database ${entry.name}`) }
    if (accountsTouched) try { await runtime.removeBackupAccounts(selectedAccounts); await runtime.restoreBackupAccounts(oldAccounts, false); await runtime.reapplyBackupGrants(local.accounts.filter(account => !selectedAccounts.some(item => accountKey(item) === accountKey(account)))) } catch (failure) { journal.recoveryErrors.push(`Database identities and privileges: ${failure instanceof Error ? failure.message : 'Recovery failed'}`) }
    journal.state = journal.recoveryErrors.length ? 'requires-recovery' : 'rolled-back'; for (const item of journal.items) if (item.outcome !== 'skipped') item.outcome = journal.state; await persist()
    throw new Error(`Database restore failed. ${journal.state === 'rolled-back' ? 'Original data/accounts recovered.' : 'Recovery requires attention.'} Recovery: ${recovery}. ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/** Keep ten completed owned recoveries; failed/active records are never pruned. */
async function retainCompletedRecoveries(directory: string) {
  const completed: Array<{ directory: string; createdAt: string }> = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^database-restore-[a-f0-9-]{36}$/.test(entry.name)) continue;
    const target = path.join(directory, entry.name);
    try { const journal = await boundedJson(path.join(target, 'journal.json')); if (journal.owner === 'vhostra' && journal.kind === 'full-backup-restore' && journal.state === 'completed' && typeof journal.createdAt === 'string') completed.push({ directory: target, createdAt: journal.createdAt }) } catch { /* Retain unknown and unfinished records. */ }
  }
  completed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const entry of completed.slice(10)) await fs.rm(entry.directory, { recursive: true, force: true });
}
