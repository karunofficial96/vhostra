// Opt-in same-container Redis/Memcached incremental RAM sample, isolated scope.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cache-incremental-'))
const scope = `vhostra-cache-incremental-${process.pid}`
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const container = `${scope}-runtime-1`
const supervisor = (action, name) => docker(['exec', container, 'supervisorctl', action, name])
const sample = async (redis, memcached) => {
  await pause(10000)
  const stats = (await runtime.resourceUsage()).find(row => row.Name === container)
  const processes = docker(['exec', container, 'ps', '-eo', 'comm,rss'])
  assert.equal(/redis-server/.test(processes), redis)
  assert.equal(/memcached/.test(processes), memcached)
  console.log('CACHE_INCREMENTAL', JSON.stringify({ redis, memcached, stats, processes }))
}
try {
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, optionalServices: { redis: true, memcached: true }, ports: { http: 29180, https: 29143, phpMyAdmin: 29181, mariadb: 29106, redis: 29179, memcached: 29111 } })
  await runtime.start()
  supervisor('stop', 'redis'); supervisor('stop', 'memcached')
  await sample(false, false)
  supervisor('start', 'redis'); await sample(true, false)
  supervisor('stop', 'redis'); supervisor('start', 'memcached'); await sample(false, true)
  supervisor('start', 'redis'); await sample(true, true)
  console.log('Same-container optional-cache RAM/process samples passed.')
} finally {
  try { await runtime.resetRuntime(false) } finally { runtime.dispose(); await rm(profile, { recursive: true, force: true }) }
  assert.deepEqual(inventory(), before, 'Cache incremental fixture resources must be removed exactly')
}
