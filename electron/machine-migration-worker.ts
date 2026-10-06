import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { discardMachineMigrationFixture, prepareMachineMigration, recoverMachineMigration, type MachineMigrationRequest, type MigrationFault } from './machine-migration.js'

const inactiveRoot = '/Library/Application Support/Vhostra'
const error = (message: string): never => { throw new Error(`Gate 2 staging: ${message}`) }
async function checked(file: string, uid: number, mode?: number) {
  const stat = await fs.lstat(file)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (mode !== undefined && (stat.mode & 0o777) !== mode)) error('staging directory identity is unsafe')
}
async function main() {
  const requestFile = process.env.VHOSTRA_GATE2_REQUEST
  if (process.platform !== 'darwin' || process.getuid?.() !== 0 || process.argv.length !== 1 || !requestFile)
    throw new Error('Gate 2 staging: native staging worker requires a bounded administrator request')
  const handle = await fs.open(requestFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let input: string
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 4096) error('request file is unsafe')
    input = await handle.readFile({ encoding: 'utf8' })
  } finally { await handle.close() }
  const value = JSON.parse(input) as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'sourceRoot,userGid,userUid' || typeof value.sourceRoot !== 'string'
    || !Number.isInteger(value.userUid) || Number(value.userUid) < 1 || !Number.isInteger(value.userGid) || Number(value.userGid) < 1
    || !/^\/private\/tmp\/vhostra-gate2-native-[a-f0-9-]{36}\/legacy\/Vhostra$/i.test(value.sourceRoot)) throw new Error('Gate 2 staging: request is outside the synthetic staging scope')
  const sourceRoot = value.sourceRoot as string
  const userUid = Number(value.userUid)
  await checked('/Library', 0, 0o755)
  await checked('/Library/Application Support', 0, 0o755)
  await checked(inactiveRoot, 0, 0o755)
  await checked(sourceRoot, userUid)
  if ((await fs.readdir(inactiveRoot)).length !== 0) error('inactive machine root is occupied')
  const request = (systemRoot: string): MachineMigrationRequest => ({ sourceRoot, systemRoot, attemptId: randomUUID(), sourceUid: userUid, writerUid: 999, writerGid: 999 })
  const mainRequest = request(inactiveRoot)
  const external = path.join(path.dirname(path.dirname(sourceRoot)), 'external-site', 'index.php')
  const externalBefore = await fs.readFile(external)
  let success = false
  const faultResults: Record<string, boolean> = {}
  try {
    const migrated = await prepareMachineMigration(mainRequest)
    const payload = path.join(migrated.stage, 'payload')
    const data = await fs.lstat(path.join(payload, 'data/mariadb/ibdata1'))
    const privateConfig = await fs.lstat(path.join(payload, 'configuration/runtime/mariadb/vhostra.cnf'))
    const runtimeConfig = await fs.lstat(path.join(payload, 'runtime-config/mariadb/vhostra.cnf'))
    const siteLog = await fs.lstat(path.join(payload, 'logs/sites/11111111-1111-4111-8111-111111111111/access.log'))
    if (data.uid !== 999 || data.gid !== 999 || (data.mode & 0o777) !== 0o600
      || privateConfig.uid !== 0 || (privateConfig.mode & 0o777) !== 0o600
      || runtimeConfig.uid !== 0 || (runtimeConfig.mode & 0o777) !== 0o644
      || (siteLog.mode & 0o777) !== 0o600
      || await recoverMachineMigration(mainRequest) !== 'ready-for-activation') error('migrated ownership, mode or recovery verification failed')
    await discardMachineMigrationFixture(mainRequest)
    success = true
    for (const fault of ['before-copy', 'partial-copy', 'after-copy', 'verification', 'permissions', 'interrupt-before-activation'] as MigrationFault[]) {
      const root = path.join(inactiveRoot, `.Vhostra-gate2-fault-${randomUUID()}`)
      await fs.mkdir(root, { mode: 0o755 })
      const attempt = request(root)
      try {
        let failed = false
        try { await prepareMachineMigration(attempt, fault) } catch { failed = true }
        if (!failed) error('fault injection unexpectedly reached readiness')
        if (fault === 'interrupt-before-activation' && await recoverMachineMigration(attempt) !== 'rolled-back') error('interrupted attempt did not roll back')
        if ((await fs.readdir(root)).some(name => name.includes('stage'))) error('failed attempt retained a payload')
        faultResults[fault] = true
      } finally { await fs.rm(root, { recursive: true, force: true }) }
    }
    if (!(await fs.readFile(external)).equals(externalBefore)
      || (await fs.readdir(inactiveRoot)).length !== 0
      || !(await fs.readFile(path.join(sourceRoot, 'data/mariadb/ibdata1'))).length)
      error('legacy, external root or inactive root changed')
    process.stdout.write(JSON.stringify({ result: 'PASS', workerPid: process.pid, migration: success, faults: faultResults,
      writer: '999:999', privateConfig: true, generatedConfig: true, siteLogs0600: true, externalUnchanged: true, legacyPreserved: true }))
  } finally {
    await fs.rm(path.join(inactiveRoot, `.Vhostra-migration-stage-${mainRequest.attemptId}`), { recursive: true, force: true })
    await fs.rm(path.join(inactiveRoot, `.Vhostra-migration-${mainRequest.attemptId}.result.json`), { force: true })
  }
}

main().catch(cause => {
  process.stderr.write(`${cause instanceof Error ? cause.message.replace(/\/Users\/[^/\s]+/g, '/Users/<user>').slice(0, 240) : 'Gate 2 staging failed'}\n`)
  process.exitCode = 1
})
