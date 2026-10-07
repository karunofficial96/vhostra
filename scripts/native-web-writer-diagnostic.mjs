// Docker-only, disposable Apache diagnostic. Never invokes Vhostra elevation.
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeProtectedTransaction } from '../dist-electron/protected-transaction.js'

const image = process.argv[2]
if (process.platform !== 'darwin' || !/^vhostra-runtime:build-[a-f0-9]{24}$/.test(image ?? '')) throw new Error('Pass one local Vhostra runtime image tag.')
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vhostra-apache-writer-')))
const name = `vhostra-apache-writer-${randomUUID()}`
const id = randomUUID()
const local = path.join(root, 'service-data/localhost/public')
const site = path.join(root, 'disposable-site')
const logs = path.join(root, 'logs')
const overrides = path.join(root, 'overrides')
const config = path.join(root, 'runtime-config/web')
let operations = 0
const docker = (args, allowFailure = false) => {
  operations++
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
  if ((result.error || result.status !== 0) && !allowFailure) throw new Error(`Disposable Docker ${args[0]} failed`)
  return result
}
const model = { server: 'apache', phpVersion: '8.3', httpsEnabled: false, sites: [
  { id: 'vhostra-localhost-vhost', hostname: 'localhost', aliases: [], builtIn: true, indexFiles: ['index.html'], rewriteEnabled: true },
  { id, hostname: 'web-stage.local.test', aliases: [], builtIn: false, indexFiles: ['index.php', 'index.html'], rewriteEnabled: true },
] }
try {
  for (const dir of [local, site, logs, overrides]) await fs.mkdir(dir, { recursive: true, mode: 0o755 })
  await fs.writeFile(path.join(local, 'index.html'), 'disposable localhost', { mode: 0o644 })
  await fs.writeFile(path.join(site, 'index.php'), '<?php echo "disposable";', { mode: 0o644 })
  await fs.copyFile(fileURLToPath(new URL('../runtime-image/entrypoint.sh', import.meta.url)), path.join(overrides, 'entrypoint.sh'))
  await fs.copyFile(fileURLToPath(new URL('../runtime-image/supervisor.conf', import.meta.url)), path.join(overrides, 'supervisor.conf'))
  await fs.chmod(path.join(overrides, 'entrypoint.sh'), 0o755)
  await executeProtectedTransaction({ version: 1, operations: [{ type: 'web-runtime-config', model }] },
    { configuration: root, data: root, logs }, path.join(root, 'hosts'))
  docker(['run', '-d', '--pull', 'never', '--name', name, '--network', 'none',
    '-e', 'VHOSTRA_WEB_SERVER=apache', '-e', 'VHOSTRA_LSPHP_VERSION=83', '-e', 'VHOSTRA_HTTPS=false',
    '-e', 'VHOSTRA_REDIS=false', '-e', 'VHOSTRA_MEMCACHED=false',
    '-e', `VHOSTRA_PMA_PASSWORD=${randomBytes(24).toString('hex')}`,
    '-v', `${local}:/var/www/html`, '-v', `${site}:/var/www/vhostra/${id}:ro`, '-v', `${logs}:/var/log/vhostra`,
    '-v', `${config}/openlitespeed:/etc/vhostra/openlitespeed:ro`, '-v', `${config}/php:/etc/vhostra/php:ro`,
    '-v', `${config}/apache:/etc/vhostra/apache:ro`,
    '-v', `${overrides}/entrypoint.sh:/usr/local/bin/vhostra-entrypoint:ro`,
    '-v', `${overrides}/supervisor.conf:/usr/local/share/vhostra/supervisor-base.conf:ro`, image])
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = docker(['exec', name, 'curl', '-fsS', '-H', 'Host: web-stage.local.test', 'http://127.0.0.1:8088/index.php'], true)
    if (probe.status === 0 && probe.stdout.trim() === 'disposable') { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const [container] = JSON.parse(docker(['inspect', name]).stdout)
  const output = docker(['logs', '--tail', '100', name], true)
  const lines = `${output.stdout}\n${output.stderr}`.split(/\r?\n/)
    .filter(line => /ERROR|FATAL|permission denied|Invalid Site|exited/i.test(line))
    .filter(line => !/password|secret|token|credential/i.test(line))
    .map(line => line.replaceAll(root, '<disposable-stage>').replace(/\b[a-f0-9]{40,}\b/ig, '<redacted>').slice(0, 220))
    .slice(-5)
  process.stdout.write(`${JSON.stringify({ state: container.State.Status, exitCode: container.State.ExitCode, ready,
    diagnosticLines: lines, dockerOperations: operations, vhostraPrivilegeInvocations: 0 })}\n`)
  if (!ready) process.exitCode = 1
} finally {
  docker(['rm', '-f', name], true)
  await fs.rm(root, { recursive: true, force: true })
}
