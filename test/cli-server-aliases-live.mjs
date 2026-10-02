// Opt-in active OpenLiteSpeed/Apache/Nginx CLI target aliases, isolated scope.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-aliases-'))
const scope = `vhostra-cli-aliases-${process.pid}`
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const env = { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope }
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true })
function cli(args) {
  const result = spawnSync(process.execPath, ['scripts/vhostra.mjs', ...args], { encoding: 'utf8', timeout: 900000, env })
  if (interrupted) throw new Error('CLI server alias fixture interrupted; cleaning its exact Docker project.')
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`)
  console.log(`CLI PASS ${args.join(' ')}`)
  return result.stdout
}
try {
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, ports: { http: 29280, https: 29243, phpMyAdmin: 29281, mariadb: 29206, redis: 29279, memcached: 29211 } })
  cli(['runtime', 'start'])
  for (const server of ['openlitespeed', 'apache', 'nginx']) {
    if (server !== 'openlitespeed') {
      const current = await store.getState()
      await store.saveSettings({ ...current.settings, selectedWebServer: server })
      await runtime.refresh()
      await runtime.applyConfiguration()
    }
    assert.match(cli(['status', server]), /Running/i)
    cli(['stop', server]); cli(['start', server]); cli(['restart', server])
    assert.match(cli(['status', server]), /Running/i)
    console.log(`Selected ${server} CLI lifecycle aliases passed.`)
  }
} finally {
  try { await runtime.resetRuntime(false) } finally { runtime.dispose(); await rm(profile, { recursive: true, force: true }) }
  assert.deepEqual(inventory(), before, 'CLI active-server fixture resources must be removed exactly')
}
