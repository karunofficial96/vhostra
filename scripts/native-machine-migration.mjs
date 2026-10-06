// Explicit Gate 2 macOS acceptance. Uses only a synthetic legacy fixture.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

if (process.platform !== 'darwin' || process.getuid?.() === 0) throw new Error('Run synthetic Gate 2 staging as the ordinary macOS user.')
const id = randomUUID()
const parent = `/private/tmp/vhostra-gate2-native-${id}`
const sourceRoot = path.join(parent, 'legacy/Vhostra')
const external = path.join(parent, 'external-site')
const siteId = '11111111-1111-4111-8111-111111111111'
const q = value => `'${value.replace(/'/g, `'\\''`)}'`
const aq = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const requestPath = path.join(parent, 'request.json')
await fs.mkdir(parent, { mode: 0o700 })
try {
  for (const directory of [external, sourceRoot, ...[
    'sites/localhost/public', 'data/mariadb', 'runtime/redis', 'runtime/memcached', 'runtime/php',
    'certificates/private', 'certificates/public', `logs/sites/${siteId}`,
  ].map(item => path.join(sourceRoot, item))]) await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const records = {
    'settings.json': JSON.stringify({ schemaVersion: 1, selectedWebServer: 'nginx', selectedPhpVersion: '8.3' }),
    'onboarding.json': JSON.stringify({ completed: true, server: 'nginx' }),
    'sites/vhostra-localhost.json': JSON.stringify({ id: 'vhostra-localhost', builtIn: 'localhost', vhostId: 'vhostra-localhost-vhost', name: 'Localhost', url: 'http://localhost', documentRoot: path.join(sourceRoot, 'sites/localhost/public'), configuration: { id: 'vhostra-localhost-vhost', hostname: 'localhost', documentRoot: path.join(sourceRoot, 'sites/localhost/public') } }),
    [`sites/${siteId}.json`]: JSON.stringify({ id: siteId, vhostId: siteId, name: 'External', url: 'http://example.test', documentRoot: external, configuration: { id: siteId, hostname: 'example.test', documentRoot: external } }),
    'sites/localhost/public/index.html': 'fixture built-in site',
    'data/mariadb/ibdata1': 'fixture database bytes',
    'runtime/redis/dump.rdb': 'fixture cache',
    'runtime/memcached/state': 'fixture state',
    'runtime/php/vhostra.ini': 'expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\nmysqli.default_socket=/run/mysqld/mysqld.sock\npdo_mysql.default_socket=/run/mysqld/mysqld.sock\n',
    'certificates/private/localhost.key': 'fixture private key',
    'certificates/public/localhost.pem': 'fixture certificate',
    [`logs/sites/${siteId}/access.log`]: 'fixture Site log',
    'logs/service.log': 'fixture service log',
  }
  for (const [file, contents] of Object.entries(records)) await fs.writeFile(path.join(sourceRoot, file), contents, { mode: 0o600 })
  await fs.writeFile(path.join(external, 'index.php'), 'external sentinel', { mode: 0o600 })
  await fs.writeFile(requestPath, JSON.stringify({ sourceRoot, userUid: process.getuid(), userGid: process.getgid() }), { flag: 'wx', mode: 0o600 })
  const worker = await fs.readFile(new URL('../dist-electron/machine-migration-worker.cjs', import.meta.url))
  if (worker.length > 256 * 1024) throw new Error('Gate 2 staging worker exceeds size bound.')
  const program = `eval(Buffer.from(${JSON.stringify(worker.toString('base64'))},'base64').toString('utf8'))`
  const command = `VHOSTRA_GATE2_REQUEST=${q(requestPath)} ELECTRON_RUN_AS_NODE=1 ${q(process.execPath)} -e ${q(program)}`
  const output = await new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-e', `do shell script ${aq(command)} with administrator privileges`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 8192) child.kill() })
    child.stderr.on('data', chunk => { stderr += String(chunk); if (stderr.length > 8192) child.kill() })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Gate 2 synthetic worker failed (status ${code ?? 'unknown'}; ${stderr.trim().replace(/\/Users\/[^/\s]+/g, '/Users/<user>').replaceAll(parent, '<fixture>').slice(0, 300)}).`)))
  })
  const result = JSON.parse(output.trim())
  if (result.result !== 'PASS' || result.writer !== '999:999' || !result.migration || !result.externalUnchanged || !result.legacyPreserved
    || Object.keys(result.faults ?? {}).length !== 6 || Object.values(result.faults).some(value => value !== true)) throw new Error('Gate 2 synthetic worker returned incomplete verification.')
  try { process.kill(result.workerPid, 0); throw new Error('Privileged Gate 2 worker remains running.') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
  process.stdout.write(`${JSON.stringify({ ...result, privilegeInvocations: 1, helperExited: true })}\n`)
} finally {
  await fs.rm(parent, { recursive: true, force: true })
}
