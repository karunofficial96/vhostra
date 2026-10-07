// Explicit macOS-only native permission acceptance. Never called by npm test.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeProtectedTransaction, validateProtectedTransaction } from '../dist-electron/protected-transaction.js'
import { systemStoragePaths } from '../dist-electron/storage-paths.js'
import { authorizeProtectedTransaction } from '../dist-electron/protected-launcher.js'
import { authoritativeMariaDbConfig, deriveMariaDbRuntimeConfig } from '../dist-electron/mariadb-config.js'

const stageParent = '/Library/Application Support'
const inactiveSystemRoot = '/Library/Application Support/Vhostra'
const image = 'vhostra-mariadb:build-9ff702f406620439713a98a0'
const script = fileURLToPath(import.meta.url)
const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`
const appleQuote = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const fail = message => { throw new Error(message) }
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? 15000, env: options.env, uid: options.uid, gid: options.gid, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) {
    const diagnostic = result.error?.code === 'ETIMEDOUT' ? 'deadline' : /mounts denied|not shared from the host/i.test(result.stderr ?? '') ? 'Docker Desktop file sharing' : /permission denied|operation not permitted/i.test(result.stderr ?? '') ? 'filesystem permission' : /no such image|unable to find image/i.test(result.stderr ?? '') ? 'image unavailable' : /name is already in use/i.test(result.stderr ?? '') ? 'container name conflict' : `exit ${result.status ?? 'unknown'}`
    const detail = options.diagnosticDetail ? `: ${String(result.stderr ?? '').trim().replace(/\/Users\/[^/\s]+/g, '/Users/<user>').replace(/\/Library\/Application Support\/Vhostra\/\.Vhostra-permission-stage-[0-9a-f-]+/g, '<stage>').slice(0, 400)}` : ''
    throw new Error(`${options.label ?? path.basename(command)} failed (${diagnostic})${detail}`)
  }
  return result.stdout.trim()
}
const permission = async (file, uid, mode) => {
  const stat = await fs.lstat(file)
  if (stat.uid !== uid || (stat.mode & 0o777) !== mode || stat.isSymbolicLink()) fail(`Staged ownership or mode is wrong: ${path.basename(file)}`)
}

async function prepareSystemShareRoot(uid) {
  if (process.getuid?.() !== 0 || !Number.isInteger(uid) || uid < 1) fail('Inactive root preparation requires administrator authorization')
  if (systemStoragePaths('darwin').configuration !== inactiveSystemRoot) fail('Inactive root differs from the fixed macOS system path')
  await permission('/Library', 0, 0o755)
  await permission(stageParent, 0, 0o755)
  const existing = await fs.lstat(inactiveSystemRoot).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing) fail('Inactive system root already exists; refusing to alter it')
  await fs.mkdir(inactiveSystemRoot, { mode: 0o755 })
  try {
    await fs.chmod(inactiveSystemRoot, 0o755)
    await permission(inactiveSystemRoot, 0, 0o755)
    if ((await fs.readdir(inactiveSystemRoot)).length !== 0) fail('Inactive system root unexpectedly contains data')
    return { result: 'PASS', inactiveSystemRootCreated: true, workerPid: process.pid }
  } catch (error) {
    await fs.rmdir(inactiveSystemRoot).catch(() => undefined)
    throw error
  }
}

const launcherStageContents = '# Vhostra generated configuration; owner=vhostra; schema=1\nexpose_php=Off\n'
const launcherStageName = /^\.Vhostra-permission-stage-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

async function launcherStageWorker(uid, gid, mode, stage) {
  if (process.getuid?.() !== 0 || !Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 1)
    fail('Launcher staging requires administrator authorization')
  await permission(inactiveSystemRoot, 0, 0o755)
  if (mode === 'create') {
    const created = path.join(inactiveSystemRoot, `.Vhostra-permission-stage-${randomUUID()}`)
    try {
      await fs.mkdir(created, { mode: 0o755 })
      await fs.mkdir(path.join(created, 'configuration/runtime/php'), { recursive: true, mode: 0o755 })
      await permission(created, 0, 0o755)
      await permission(path.join(created, 'configuration'), 0, 0o755)
      return { result: 'PASS', stage: created, workerPid: process.pid }
    } catch (error) {
      await fs.rm(created, { recursive: true, force: true })
      throw error
    }
  }
  if (mode !== 'cleanup' || typeof stage !== 'string' || path.dirname(stage) !== inactiveSystemRoot || !launcherStageName.test(path.basename(stage)))
    fail('Launcher cleanup target is invalid')
  await permission(stage, 0, 0o755)
  let verified = false
  try {
    const file = path.join(stage, 'configuration/runtime/php/vhostra.ini')
    await permission(file, 0, 0o600)
    if (await fs.readFile(file, 'utf8') !== launcherStageContents) fail('Production launcher wrote unexpected staged configuration')
    const after = spawnSync(process.execPath, ['-e', 'require("fs").appendFileSync(process.argv[1], "unauthorized")', file], { uid, gid, encoding: 'utf8', timeout: 5000, stdio: 'ignore' })
    if (after.status === 0) fail('Staged configuration became writable by the ordinary user')
    verified = true
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
  return { result: 'PASS', verified, workerPid: process.pid }
}

async function launcherStageTransaction(stage) {
  if (process.getuid?.() === 0) fail('Production launcher staging must be unprivileged')
  const file = path.join(stage, 'configuration/runtime/php/vhostra.ini')
  const direct = spawnSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1], "unauthorized")', file], { encoding: 'utf8', timeout: 5000, stdio: 'ignore' })
  if (direct.status === 0) fail('Ordinary staged configuration write unexpectedly succeeded')
  const transaction = { version: 1, operations: [{ type: 'generated-web-config', files: [{ key: 'runtime/php/vhostra.ini', contents: launcherStageContents }] }] }
  const invalid = { version: 1, operations: [{ type: 'generated-web-config', files: [{ key: '../outside', contents: launcherStageContents }] }] }
  try { await authorizeProtectedTransaction(invalid, stage); fail('Production launcher accepted an arbitrary target') }
  catch (error) { if (!/generated web configuration name is not allowlisted/.test(error.message)) throw error }
  const result = await authorizeProtectedTransaction(transaction, stage)
  if (result.completed !== 1) fail('Production launcher completion count is wrong')
}

async function launcherStageAuthorization(args) {
  const command = [process.execPath, script, '--worker-launcher-stage', ...args].map(shellQuote).join(' ')
  const output = await new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-e', `do shell script ${appleQuote(command)} with administrator privileges`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk).slice(0, 2048) })
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 512) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Launcher staging authorization failed (status ${code ?? 'unknown'}; ${stderr.trim().slice(0, 180)}).`)))
  })
  const result = JSON.parse(output.trim())
  if (result.result !== 'PASS' || !Number.isInteger(result.workerPid)) fail('Launcher staging returned an invalid result')
  try { process.kill(result.workerPid, 0); fail('Launcher staging helper remained running') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
  return result
}

async function runLauncherStage(uid, gid) {
  process.stdout.write('macOS will request authorization to create a disposable root-owned stage, then the production launcher will authorize one transaction, then staging cleanup will authorize. Approve on this Mac; do not enter a password in chat.\n')
  const prepared = await launcherStageAuthorization([String(uid), String(gid), 'create'])
  const stage = prepared.stage
  if (typeof stage !== 'string' || path.dirname(stage) !== inactiveSystemRoot || !launcherStageName.test(path.basename(stage))) fail('Launcher staging path is invalid')
  let transactionError = null
  try { await launcherStageTransaction(stage) }
  catch (error) { transactionError = error }
  let cleaned = null
  try { cleaned = await launcherStageAuthorization([String(uid), String(gid), 'cleanup', stage]) }
  catch (error) { if (!transactionError) transactionError = error }
  if (transactionError) throw transactionError
  if (cleaned.verified !== true) fail('Production launcher staging did not verify')
  process.stdout.write(`${JSON.stringify({ result: 'PASS', productionLauncher: true, logicalTransactions: 1, privilegeInvocations: 3, helperExited: true })}\n`)
}

async function worker(uid, gid, home, dockerPath, skipDocker, systemShare, recreate = false) {
  if (process.getuid?.() !== 0 || !Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 1) fail('Native staging worker requires a real administrator authorization')
  if (systemShare) await permission(inactiveSystemRoot, 0, 0o755)
  const stage = path.join(systemShare ? inactiveSystemRoot : stageParent, `.Vhostra-permission-stage-${randomUUID()}`)
  const scope = `vhostra-native-stage-${randomUUID()}`
  const bindScope = `vhostra-bind-stage-${randomUUID()}`
  const roots = { configuration: stage, data: stage, logs: path.join(stage, 'logs') }
  const database = path.join(stage, 'data/mariadb')
  const logDir = path.join(stage, 'logs/mariadb')
  const secret = path.join(stage, 'runtime/root-password')
  const file = path.join(stage, 'configuration/runtime/php/vhostra.ini')
  const privateMariaDbConfig = path.join(stage, 'configuration/runtime/mariadb/vhostra.cnf')
  const runtimeMariaDbConfig = path.join(stage, 'runtime-config/mariadb/vhostra.cnf')
  const marker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
  const milestones = {}
  const stamp = name => { milestones[name] = Date.now() }
  let containerStarted = false
  let dockerOperations = 0
  const userEnv = { ...process.env, HOME: home, DOCKER_HOST: `unix://${path.join(home, '.docker/run/docker.sock')}` }
  const docker = (args, timeout = 15000, diagnosticDetail = false, purpose = '') => { dockerOperations++; return run(dockerPath, args, { uid, gid, env: userEnv, timeout, diagnosticDetail, label: `isolated Docker ${purpose || `${args[0]} ${args[1] ?? ''}`}`.trim() }) }
  stamp('helper_started')
  try {
    await fs.mkdir(stage, { mode: 0o755 })
    await fs.mkdir(path.join(stage, 'configuration/runtime/php'), { recursive: true, mode: 0o755 })
    if (systemShare) await fs.mkdir(path.join(stage, 'configuration/runtime/mariadb'), { recursive: true, mode: 0o755 })
    await fs.mkdir(path.join(stage, 'sites'), { mode: 0o755 })
    await fs.mkdir(path.join(stage, 'data'), { mode: 0o755 })
    await fs.mkdir(database, { mode: 0o700 })
    await fs.mkdir(path.join(stage, 'runtime'), { mode: 0o700 })
    await fs.mkdir(roots.logs, { mode: 0o700 })
    await fs.mkdir(logDir, { mode: 0o700 })
    for (const target of [database, path.join(stage, 'runtime'), roots.logs, logDir]) await fs.chown(target, uid, gid)
    await permission(stage, 0, 0o755)
    await permission(path.join(stage, 'configuration'), 0, 0o755)
    if (systemShare) await permission(path.join(stage, 'configuration/runtime/mariadb'), 0, 0o755)
    await permission(database, uid, 0o700)
    await permission(path.join(stage, 'runtime'), uid, 0o700)
    await permission(roots.logs, uid, 0o700)
    stamp('stage_created')

    const contents = `${marker}expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\n`
    const transaction = { version: 1, operations: [{ type: 'generated-web-config', files: [
      { key: 'runtime/php/vhostra.ini', contents },
    ] }] }
    const direct = spawnSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1], "unauthorized")', file], { uid, gid, encoding: 'utf8', timeout: 5000, stdio: 'ignore' })
    if (direct.status === 0) fail('Ordinary configuration write unexpectedly succeeded')
    stamp('ordinary_write_rejected')
    const result = await executeProtectedTransaction(transaction, roots, path.join(stage, 'hosts'))
    if (result.completed !== 1) fail('Allowlisted transaction did not complete')
    await permission(file, 0, 0o600)
    if (systemShare) {
      const publication = await executeProtectedTransaction({ version: 1, operations: [{ type: 'mariadb-runtime-config' }] }, roots, path.join(stage, 'hosts'))
      if (publication.completed !== 1) fail('MariaDB runtime publication did not complete')
      await permission(privateMariaDbConfig, 0, 0o600)
      await permission(runtimeMariaDbConfig, 0, 0o644)
      if (await fs.readFile(privateMariaDbConfig, 'utf8') !== authoritativeMariaDbConfig
        || await fs.readFile(runtimeMariaDbConfig, 'utf8') !== deriveMariaDbRuntimeConfig(authoritativeMariaDbConfig))
        fail('MariaDB runtime config differs from the allowlisted source')
      const privateRead = spawnSync(process.execPath, ['-e', 'require("fs").readFileSync(process.argv[1])', privateMariaDbConfig], { uid, gid, encoding: 'utf8', timeout: 5000, stdio: 'ignore' })
      if (privateRead.status === 0) fail('Ordinary user could read authoritative MariaDB configuration')
    }
    if (await fs.readFile(file, 'utf8') !== contents) fail('Protected configuration content did not verify')
    const after = spawnSync(process.execPath, ['-e', 'require("fs").appendFileSync(process.argv[1], "unauthorized")', file], { uid, gid, encoding: 'utf8', timeout: 5000, stdio: 'ignore' })
    if (after.status === 0) fail('Protected configuration became writable after transaction')
    stamp('transaction_completed')

    const invalid = { version: 1, operations: [{ type: 'generated-web-config', files: [{ key: '../data/mariadb/probe', contents }] }] }
    try { validateProtectedTransaction(invalid, roots); fail('Arbitrary target was accepted') } catch (error) { if (error.message === 'Arbitrary target was accepted') throw error }
    const outside = path.join(stage, 'data')
    const link = path.join(stage, 'configuration/runtime/openlitespeed/sites')
    await fs.mkdir(path.dirname(link), { recursive: true, mode: 0o755 })
    await fs.symlink(outside, link)
    const linked = { version: 1, operations: [{ type: 'generated-web-config', files: [{ key: `runtime/openlitespeed/sites/${randomUUID()}.conf`, contents: `${marker}docRoot /var/www/html\n` }] }] }
    try { await executeProtectedTransaction(linked, roots, path.join(stage, 'hosts')); fail('Linked target was accepted') } catch (error) { if (error.message === 'Linked target was accepted') throw error }
    await fs.rm(link)
    stamp('allowlist_and_links_rejected')

    if (skipDocker) return { result: 'PASS', stage, workerPid: process.pid, protectedMode: 'root:0600', mariaDbMode: 'user:0700', dockerSkipped: true, milestones }

    await fs.writeFile(secret, `${randomBytes(24).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
    await fs.chown(secret, uid, gid)
    docker(['image', 'inspect', image], 15000)
    if (systemShare) {
      try {
        docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--name', bindScope,
          '--mount', `type=bind,source=${stage},target=/vhostra,readonly`,
          '--entrypoint', '/bin/true', image], 30000, true)
      } catch (error) {
        try { docker(['rm', '-f', bindScope], 20000) } catch {}
        throw error
      }
      stamp('bind_mount_accepted')
    }
    // Docker can create a container record before rejecting its bind mount.
    // Arm exact-name cleanup before the run call, including its failure path.
    const runArgs = ['run', '-d', '--pull', 'never', '--network', 'none', '--name', scope,
      '-v', `${database}:/var/lib/mysql`,
      '-v', `${logDir}:/var/log/vhostra`,
      '-v', `${secret}:/run/secrets/root-password:ro`,
      ...(systemShare ? ['-v', `${runtimeMariaDbConfig}:/etc/mysql/mariadb.conf.d/99-vhostra.cnf:ro`] : []),
      image]
    containerStarted = true
    docker(runArgs, 30000, systemShare)
    stamp('database_started')
    let mysqlIdentity = null
    if (systemShare) {
      const identity = docker(['exec', scope, 'sh', '-c', 'id -u mysql; id -g mysql'], 15000, true, 'mysql identity check').split('\n')
      if (identity[0] !== '999' || identity[1] !== '999') fail('MariaDB image mysql identity differs from inspected 999:999')
      mysqlIdentity = '999:999'
      const [inspected] = JSON.parse(docker(['inspect', scope], 15000))
      const configMount = inspected.Mounts?.find(mount => mount.Destination === '/etc/mysql/mariadb.conf.d/99-vhostra.cnf')
      if (!configMount || configMount.Source !== runtimeMariaDbConfig || configMount.RW !== false
        || inspected.Mounts.some(mount => mount.Source === privateMariaDbConfig || mount.Source.startsWith(`${path.join(stage, 'configuration')}${path.sep}`)))
        fail('MariaDB container mount exposes protected configuration or is writable')
      docker(['exec', scope, 'sh', '-c', 'test ! -e /vhostra'], 15000, true, 'protected config isolation check')
      const configWrite = spawnSync(dockerPath, ['exec', scope, 'sh', '-c', 'printf probe >> /etc/mysql/mariadb.conf.d/99-vhostra.cnf'], { uid, gid, env: userEnv, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
      dockerOperations++
      if (configWrite.status === 0) fail('Container could write its generated MariaDB configuration')
      await permission(privateMariaDbConfig, 0, 0o600)
      await permission(runtimeMariaDbConfig, 0, 0o644)
    }
    let sqlPassed = false
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      // First initialization has a temporary local server that is stopped
      // before the final server and TCP gateway start. Do not write test SQL
      // during that temporary phase.
      const gateway = spawnSync(dockerPath, ['exec', scope, 'pgrep', '-x', 'socat'],
        { uid, gid, env: userEnv, encoding: 'utf8', timeout: 5000, stdio: 'ignore' })
      dockerOperations++
      if (gateway.status !== 0) { await new Promise(resolve => setTimeout(resolve, 1000)); continue }
      const probe = spawnSync(dockerPath, ['exec', scope, 'mariadb', '--protocol=socket', '-uroot', '-N', '-e', 'CREATE DATABASE IF NOT EXISTS vhostra_stage_probe; CREATE TABLE IF NOT EXISTS vhostra_stage_probe.probe (id INT); INSERT INTO vhostra_stage_probe.probe VALUES (1); SELECT COUNT(*) FROM vhostra_stage_probe.probe'], { uid, gid, env: userEnv, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      dockerOperations++
      if (probe.status === 0 && probe.stdout.trim().split('\n').at(-1) === '1') { sqlPassed = true; break }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!sqlPassed) fail('Staged MariaDB SQL did not complete within 60 seconds')
    stamp('sql_completed')
    if (systemShare && docker(['exec', scope, 'mariadb', '--protocol=socket', '-uroot', '-N', '-e', "SHOW GLOBAL VARIABLES LIKE 'max_connections'"], 15000, true, 'generated setting check').trim() !== 'max_connections\t50')
      fail('MariaDB did not load the generated max_connections setting')
    if (systemShare) stamp('generated_setting_verified')
    if (recreate) {
      docker(['rm', '-f', scope], 20000)
      containerStarted = false
      containerStarted = true
      docker(runArgs, 30000, true, 'MariaDB recreation')
      let survived = false
      const recreationDeadline = Date.now() + 60000
      while (Date.now() < recreationDeadline) {
        const probe = spawnSync(dockerPath, ['exec', scope, 'mariadb', '--protocol=socket', '-uroot', '-N', '-e', 'SELECT COUNT(*) FROM vhostra_stage_probe.probe'],
          { uid, gid, env: userEnv, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
        dockerOperations++
        if (probe.status === 0 && probe.stdout.trim().split('\n').at(-1) === '1') { survived = true; break }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      if (!survived) fail('Staged MariaDB SQL did not survive container recreation')
      stamp('database_recreated_with_sql')
    }
    docker(['rm', '-f', scope], 20000)
    containerStarted = false
    const stack = [database]
    while (stack.length) {
      const dir = stack.pop()
      for (const name of await fs.readdir(dir)) {
        const item = path.join(dir, name)
        const stat = await fs.lstat(item)
        if (stat.mode & 0o002) fail('Staged MariaDB data is world-writable')
        if (stat.isDirectory()) stack.push(item)
      }
    }
    await permission(file, 0, 0o600)
    stamp('data_permissions_checked')
    return { result: 'PASS', stage, workerPid: process.pid, protectedMode: 'root:0600', runtimeConfigMode: systemShare ? 'root:0644' : null, mariaDbMode: 'user:0700', mysqlIdentity, dockerOperations, systemShare, recreatedWithSql: recreate, runtimeConfigReadOnly: systemShare, generatedSettingLoaded: systemShare, milestones }
  } finally {
    if (containerStarted) { try { docker(['rm', '-f', scope], 20000) } catch {} }
    await fs.rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[2] === '--worker-share-root') {
  prepareSystemShareRoot(Number(process.argv[3]))
    .then(value => { process.stdout.write(`${JSON.stringify(value)}\n`) })
    .catch(error => { process.stderr.write(`${error.message.slice(0, 160)}\n`); process.exitCode = 1 })
} else if (process.argv[2] === '--worker-launcher-stage') {
  launcherStageWorker(Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6])
    .then(value => { process.stdout.write(`${JSON.stringify(value)}\n`) })
    .catch(error => { process.stderr.write(`${error.message.slice(0, 380)}\n`); process.exitCode = 1 })
} else if (process.argv[2] === '--launcher-stage') {
  if (process.platform !== 'darwin' || process.getuid?.() === 0) fail('Run launcher staging as an ordinary macOS user')
  runLauncherStage(process.getuid(), process.getgid())
    .catch(error => { process.stderr.write(`${error.message.slice(0, 160)}\n`); process.exitCode = 1 })
} else if (process.argv[2] === '--worker') {
  worker(Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6], process.argv[7] === '--without-docker', ['--system-share-sql', '--system-share-recreation'].includes(process.argv[7]), process.argv[7] === '--system-share-recreation')
    .then(value => { process.stdout.write(`${JSON.stringify(value)}\n`) })
    .catch(error => { process.stderr.write(`${error.message.slice(0, error.message.startsWith('isolated Docker run ') ? 400 : 160)}\n`); process.exitCode = 1 })
} else {
  if (process.platform !== 'darwin') fail('Native staging requires macOS')
  if (process.getuid?.() === 0) fail('Run this command as the ordinary Vhostra user')
  const uid = process.getuid(); const gid = process.getgid()
  const home = os.homedir()
  const prepareShareRoot = process.argv[2] === '--prepare-system-share'
  if (!prepareShareRoot && process.argv[2] !== undefined && process.argv[2] !== '--without-docker' && process.argv[2] !== '--system-share-sql' && process.argv[2] !== '--system-share-recreation') fail('Unknown native staging option')
  const dockerPath = prepareShareRoot ? '' : run('/usr/bin/which', ['docker'], { label: 'Docker lookup' })
  const skipDocker = process.argv[2] === '--without-docker'
  const systemShare = ['--system-share-sql', '--system-share-recreation'].includes(process.argv[2])
  const command = (prepareShareRoot
    ? [process.execPath, script, '--worker-share-root', String(uid)]
    : [process.execPath, script, '--worker', String(uid), String(gid), home, dockerPath, ...(skipDocker ? ['--without-docker'] : []), ...(systemShare ? [process.argv[2]] : [])]).map(shellQuote).join(' ')
  process.stdout.write(prepareShareRoot
    ? 'macOS will request administrator authorization to create only the empty, inactive Vhostra system root. Approve it on this Mac; do not enter a password in chat.\n'
    : 'macOS will request administrator authorization for an isolated Vhostra staging test. Approve it on this Mac; do not enter a password in chat. The live Vhostra store is not selected.\n')
  const started = Date.now()
  const child = spawn('osascript', ['-e', `do shell script ${appleQuote(command)} with administrator privileges`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; let errors = ''
  child.stdout.on('data', chunk => { output += String(chunk).slice(0, 4096) })
  child.stderr.on('data', chunk => { errors += String(chunk).slice(0, 1024) })
  child.on('close', code => {
    if (code !== 0) { process.stderr.write(`Native staging did not complete (osascript status ${code}; ${errors.trim().slice(0, 400)}).\n`); process.exitCode = 1; return }
    try {
      const result = JSON.parse(output.trim())
      let workerAlive = false
      try { process.kill(result.workerPid, 0); workerAlive = true } catch (error) { if (error.code !== 'ESRCH') throw error }
      if (workerAlive) throw new Error('Privileged staging worker remained running')
      if (prepareShareRoot) {
        if (result.result !== 'PASS' || result.inactiveSystemRootCreated !== true) throw new Error('Inactive root preparation did not verify')
        process.stdout.write(`${JSON.stringify({ result: 'PASS', inactiveSystemRootCreated: true, helperExited: true })}\n`)
        return
      }
      const times = Object.fromEntries(Object.entries(result.milestones).map(([key, value]) => [key, Math.round((value - result.milestones.helper_started) / 1000)]))
      process.stdout.write(`${JSON.stringify({ result: result.result, authorizationWaitSeconds: Math.round((result.milestones.helper_started - started) / 1000), protectedMode: result.protectedMode, runtimeConfigMode: result.runtimeConfigMode ?? null, mariaDbMode: result.mariaDbMode, dockerSkipped: result.dockerSkipped === true, systemShare: result.systemShare === true, runtimeConfigReadOnly: result.runtimeConfigReadOnly === true, generatedSettingLoaded: result.generatedSettingLoaded === true, recreatedWithSql: result.recreatedWithSql === true, mysqlIdentity: result.mysqlIdentity ?? null, dockerOperations: result.dockerOperations ?? 0, helperExited: true, stageChecksSeconds: times })}\n`)
    } catch { process.stderr.write('Native staging returned an invalid bounded result.\n'); process.exitCode = 1 }
  })
}
