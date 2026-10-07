// Opt-in Docker-only test of generated cache policy on a disposable machine-shaped fixture.
// No Vhostra elevation, live Store selection, or external Site/database mount.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeProtectedTransaction } from '../dist-electron/protected-transaction.js'

const fail = message => { throw new Error(message) }
const image = process.argv[2]
if (process.platform !== 'darwin' || !/^vhostra-runtime:build-[a-f0-9]{24}$/.test(image ?? ''))
  fail('Pass one already inspected local Vhostra runtime image tag on macOS.')
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vhostra-cache-stage-')))
const roots = { configuration: root, data: root, logs: path.join(root, 'logs') }
const names = ['redis', 'memcached'].map(service => `vhostra-cache-${service}-${randomUUID()}`)
let operations = 0
const docker = (args, allowFailure = false) => {
  operations++
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0 && !allowFailure) fail(`Isolated Docker ${args[0]} failed`)
  return { ok: result.status === 0, output: result.stdout.trim() }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const ready = async (name, command) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (docker(['exec', name, 'sh', '-c', command], true).ok) return
    await pause(500)
  }
  fail('Disposable cache service did not become ready')
}
const start = (name, service) => {
  const source = path.join(root, 'runtime-config/cache', `${service}.conf`)
  const target = service === 'redis' ? '/etc/redis/vhostra.conf' : '/etc/vhostra/memcached.conf'
  const args = ['run', '-d', '--rm', '--pull', 'never', '--network', 'none', '--name', name,
    '--mount', `type=bind,source=${source},target=${target},readonly`,
    ...(service === 'redis' ? ['--user', '101:102', '--entrypoint', 'redis-server', image, target, '--daemonize', 'no']
      : ['--entrypoint', 'sh', image, '-c', `exec memcached $(grep -v "^[[:space:]]*#" ${target})`])]
  docker(args)
  const [container] = JSON.parse(docker(['inspect', name]).output)
  const mount = container.Mounts?.find(item => item.Destination === target)
  if (!mount || mount.RW !== false || mount.Source !== source || container.Mounts.length !== 1)
    fail('Cache container received an unexpected or writable mount')
}
try {
  const published = await executeProtectedTransaction({ version: 1, operations: [
    { type: 'cache-runtime-config', redisPort: 16379, memcachedPort: 11212 },
  ] }, roots, path.join(root, 'hosts'))
  if (published.completed !== 1) fail('Cache configuration publication did not complete')
  for (const service of ['redis', 'memcached']) {
    const stat = await fs.lstat(path.join(root, 'runtime-config/cache', `${service}.conf`))
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o644) fail('Generated cache mode is unsafe')
  }
  // Redis is deliberately nonpersistent. The service process must use the
  // inspected image account and a value must disappear after recreation.
  start(names[0], 'redis')
  await ready(names[0], 'redis-cli -p 16379 ping >/dev/null')
  const identity = docker(['exec', names[0], 'sh', '-c', 'ps -eo uid=,gid=,comm= | grep redis-server']).output
  if (!identity.split('\n').some(line => /^\s*101\s+102\s+redis-server\s*$/.test(line))) fail('Redis process did not run as 101:102')
  if (docker(['exec', names[0], 'redis-cli', '-p', '16379', 'SET', 'vhostra_stage_key', 'stage_value']).output !== 'OK') fail('Redis set failed')
  docker(['rm', '-f', names[0]])
  start(names[0], 'redis')
  await ready(names[0], 'redis-cli -p 16379 ping >/dev/null')
  if (docker(['exec', names[0], 'redis-cli', '-p', '16379', 'EXISTS', 'vhostra_stage_key']).output !== '0') fail('Redis unexpectedly persisted a cache value')
  docker(['rm', '-f', names[0]])

  // Memcached has no host data mount; a fresh container must lose its value.
  start(names[1], 'memcached')
  await ready(names[1], 'printf "version\\r\\n" | nc -w 2 127.0.0.1 11212 | grep -q VERSION')
  const set = docker(['exec', names[1], 'sh', '-c', 'printf "set vhostra_stage_key 0 0 11\\r\\nstage_value\\r\\n" | nc -w 2 127.0.0.1 11212']).output
  if (!set.includes('STORED')) fail('Memcached set failed')
  docker(['rm', '-f', names[1]])
  start(names[1], 'memcached')
  await ready(names[1], 'printf "version\\r\\n" | nc -w 2 127.0.0.1 11212 | grep -q VERSION')
  const get = docker(['exec', names[1], 'sh', '-c', 'printf "get vhostra_stage_key\\r\\n" | nc -w 2 127.0.0.1 11212']).output
  if (get !== 'END') fail('Memcached unexpectedly persisted a cache value')
  docker(['rm', '-f', names[1]])
  process.stdout.write(`${JSON.stringify({ result: 'PASS', redisUidGid: '101:102', redisPersistence: 'disabled', redisRecreation: true, memcachedPersistence: 'ephemeral', memcachedRecreation: true, dockerOperations: operations, vhostraPrivilegeInvocations: 0 })}\n`)
} finally {
  for (const name of names) docker(['rm', '-f', name], true)
  await fs.rm(root, { recursive: true, force: true })
}
