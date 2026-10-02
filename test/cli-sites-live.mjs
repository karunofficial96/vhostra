// Opt-in live Site/import CLI routes with a private Hosts file and Docker scope.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-live-'))
const siteRoot = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-site-'))
const scope = `vhostra-cli-live-${process.pid}`
const hostsPath = path.join(profile, 'hosts-fixture')
await writeFile(hostsPath, '127.0.0.1 localhost\n')
await chmod(siteRoot, 0o755)
await writeFile(path.join(siteRoot, 'index.php'), '<?php echo "cli-site-ok";')
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const env = { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope, VHOSTRA_TEST_HOSTS_PATH: hostsPath }
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true })
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
function cli(args, expected = 0, prompt) {
  const result = spawnSync(prompt ? 'python3' : process.execPath, prompt
    ? ['test/cli-prompt-pty.py', process.execPath, 'scripts/vhostra.mjs', ...args]
    : ['scripts/vhostra.mjs', ...args], { encoding: 'utf8', timeout: 900000, env: { ...env, ...(prompt ? { VHOSTRA_TEST_PROMPT: prompt.needle, VHOSTRA_TEST_ANSWER: prompt.answer } : {}) } })
  if (interrupted) throw new Error('CLI Site fixture interrupted; cleaning its exact Docker project.')
  assert.equal(result.status, expected, `${args.join(' ')}: ${result.error?.message ?? ''}\n${result.stdout?.slice(-900)}\n${result.stderr?.slice(-900)}`)
  console.log(`CLI ${expected === 0 ? 'PASS' : 'EXPECTED FAILURE'} ${args.join(' ')}`)
  return `${result.stdout}\n${result.stderr}`
}
try {
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, ports: { http: 29480, https: 29443, phpMyAdmin: 29481, mariadb: 29406, redis: 29479, memcached: 29411 } })
  cli(['runtime', 'start'])
  const source = path.join(profile, 'site.json')
  await writeFile(source, JSON.stringify({ name: 'CLI Site', url: 'http://cli-site.test:29480/', documentRoot: siteRoot }))
  cli(['sites', 'add', source])
  let state = await store.getState()
  const site = state.sites.find(item => item.name === 'CLI Site')
  assert.ok(site)
  assert.match(await readFile(hostsPath, 'utf8'), /cli-site\.test # Vhostra/)
  assert.match(cli(['vhost', 'list']), /cli-site\.test/)
  assert.match(cli(['hosts', 'status', 'cli-site.test']), /Mapped/i)
  cli(['hosts', 'repair', 'cli-site.test'])
  cli(['sites', 'repair', site.id])
  await writeFile(source, JSON.stringify({ name: 'CLI Site Edited', url: 'http://cli-site.test:29480/', documentRoot: siteRoot }))
  cli(['sites', 'edit', site.id, source])
  assert.equal((await store.getState()).sites.find(item => item.id === site.id)?.name, 'CLI Site Edited')
  const response = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: 29480, path: '/index.php', headers: { Host: 'cli-site.test' } }, stream => {
    let body = ''; stream.on('data', chunk => body += chunk); stream.on('end', () => resolve({ status: stream.statusCode, body }))
  }).on('error', reject))
  assert.equal(response.status, 200)
  assert.match(response.body, /cli-site-ok/)
  const bundle = path.join(profile, 'site-bundle.json')
  cli(['config', 'export', bundle]); cli(['config', 'preview', bundle]); cli(['config', 'import', bundle])
  const native = path.join(profile, 'import.conf')
  await writeFile(native, `<VirtualHost *:80>\nServerName cli-import.test\nDocumentRoot ${siteRoot}\n</VirtualHost>\n`)
  assert.match(cli(['import', 'preview', native, 'apache']), /cli-import\.test/)
  cli(['import', 'apply', native, 'apache'])
  state = await store.getState()
  assert.ok(state.sites.some(item => state.virtualHosts.find(host => host.id === item.vhostId)?.hostname === 'cli-import.test'))
  assert.match(await readFile(hostsPath, 'utf8'), /cli-import\.test # Vhostra/)
  cli(['sites', 'remove', site.id], 0, { needle: 'Type remove:', answer: 'remove' })
  assert.equal((await store.getState()).sites.some(item => item.id === site.id), false)
  assert.doesNotMatch(await readFile(hostsPath, 'utf8'), /cli-site\.test/)
  assert.equal(await readFile(path.join(siteRoot, 'index.php'), 'utf8'), '<?php echo "cli-site-ok";')
  console.log('Site add/edit/remove/repair, Hosts mapping, config import and native apply passed with private Hosts file.')
} finally {
  try { await runtime.resetRuntime(false) } finally { runtime.dispose(); await Promise.all([profile, siteRoot].map(directory => rm(directory, { recursive: true, force: true }))) }
  assert.deepEqual(inventory(), before, 'CLI Site fixture resources must be removed exactly')
}
