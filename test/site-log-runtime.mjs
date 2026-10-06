// Opt-in, one-server Docker acceptance. The caller supplies a unique scope and
// enforces a wall-clock timeout, then removes only that scope if interrupted.
import assert from 'node:assert/strict'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore, siteLogPaths } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const server = process.argv[2]
const scope = process.env.VHOSTRA_TEST_SCOPE
if (!['openlitespeed', 'apache', 'nginx'].includes(server) || !/^vhostra-log-proof-[a-z0-9-]+$/.test(scope ?? '')) throw new Error('Invalid isolated log fixture arguments')
const root = await mkdtemp(path.join(os.tmpdir(), `vhostra-log-${server}-`))
const project = await mkdtemp(path.join(os.tmpdir(), `vhostra-log-site-${server}-`))
const store = new VhostraStore(root)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 15000 }).trim()
const request = (port, host) => new Promise((resolve, reject) => {
  const req = http.get({ hostname: '127.0.0.1', port, path: '/index.php?local_probe=1', headers: { Host: host }, timeout: 10000 }, res => {
    let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, body }))
  }); req.on('timeout', () => req.destroy(new Error('Local request timed out'))); req.on('error', reject)
})
try {
  await store.initialize()
  await writeFile(path.join(project, 'index.php'), '<?php echo "local-log-proof";')
  const state = await store.addSite({ name: 'Log proof', documentRoot: project, url: `http://${server}.local.test` })
  const current = await store.getState()
  const port = { openlitespeed: 39180, apache: 39181, nginx: 39182 }[server]
  await store.saveSettings({ ...current.settings, selectedWebServer: server, selectedPhpVersion: '8.3', ports: { ...current.settings.ports, http: port, https: port + 1000, phpMyAdmin: port + 2000, mariadb: port + 3000 } })
  const host = state.virtualHosts.find(row => row.hostname === `${server}.local.test`)
  assert.ok(host)
  await runtime.start()
  const response = await request(port, host.hostname)
  assert.equal(response.status, 200)
  assert.equal(response.body, 'local-log-proof')
  const container = `${scope}-runtime-1`
  const expected = server === 'openlitespeed' ? { user: 'nobody', uid: 65534, group: 65534 } : { user: 'www-data', uid: 33, group: 33 }
  const identity = docker(['exec', container, 'id', expected.user])
  assert.match(identity, new RegExp(`uid=${expected.uid}\\(${expected.user}\\)`))
  const workers = docker(['exec', container, 'ps', '-eo', 'user=,comm=']).split('\n')
    .map(line => line.trim()).filter(line => /(?:apache2|nginx|litespeed|lsphp|php-fpm)/.test(line))
  assert.ok(workers.some(line => line.startsWith(`${expected.user} `)), `${server}: selected worker identity was not observed`)
  const paths = siteLogPaths(store.layout, host.id)
  const target = `/var/log/vhostra/sites/${host.id}/access.log`
  docker(['exec', '-u', expected.user, container, 'sh', '-c', `printf 'local-worker-proof\\n' >> '${target}'`])
  const inside = docker(['exec', container, 'stat', '-c', '%u:%g %a', target])
  assert.equal(inside, `${expected.uid}:${expected.group} 600`)
  const hostStat = await stat(paths.access)
  assert.equal(hostStat.mode & 0o777, 0o600)
  assert.ok((await readFile(paths.access, 'utf8')).includes('local-worker-proof'))
  assert.equal((await readFile(path.join(project, 'index.php'), 'utf8')), '<?php echo "local-log-proof";')
  console.log(`${server}: worker ${identity}; processes ${workers.join(', ')}; local request and 0600 log append passed`)
} finally {
  try { await runtime.resetRuntime(false) } catch {}
  try { await runtime.pauseBackgroundWork() } catch {}
  runtime.dispose()
  await rm(root, { recursive: true, force: true })
  await rm(project, { recursive: true, force: true })
}
