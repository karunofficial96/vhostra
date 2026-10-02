// Opt-in selected-PHP CLI switch against an isolated profile and Docker project.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-php-switch-'))
const scope = `vhostra-cli-php-switch-${process.pid}`
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const env = { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope }
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true })
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
const health = () => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: 29380, path: '/vhostra-health.php', agent: false, headers: { Connection: 'close' } }, response => {
  let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, body }))
}).on('error', reject))
function cli(args) {
  const result = spawnSync(process.execPath, ['scripts/vhostra.mjs', ...args], { encoding: 'utf8', timeout: 900000, env })
  if (interrupted) throw new Error('CLI PHP switch fixture interrupted; cleaning its exact Docker project.')
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`)
  console.log(`CLI PASS ${args.join(' ')}`)
  return result.stdout
}
try {
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, selectedWebServer: 'nginx', selectedPhpVersion: '8.5', ports: { http: 29380, https: 29343, phpMyAdmin: 29381, mariadb: 29306, redis: 29379, memcached: 29311 } })
  cli(['runtime', 'start'])
  for (const version of ['8.5', '8.4', '8.5']) {
    if (version !== '8.5' || (await store.getState()).settings.selectedPhpVersion !== version) cli(['php', 'select', version])
    const response = await health()
    assert.equal(response.status, 200)
    assert.match(response.body, new RegExp(`^vhostra-php-fpm:${version.replace('.', '\.')}\.`))
    assert.match(cli(['php', 'status']), /Running/i)
    assert.equal((await store.getState()).settings.selectedWebServer, 'nginx')
    console.log(`Nginx actual HTTP selected PHP ${version} passed; selected server retained.`)
  }
} finally {
  try { await runtime.resetRuntime(false) } finally { runtime.dispose(); await rm(profile, { recursive: true, force: true }) }
  assert.deepEqual(inventory(), before, 'CLI PHP switch fixture resources must be removed exactly')
}
