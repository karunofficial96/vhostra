// Opt-in sequential selected-PHP × frontend acceptance. No user profile is used.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-php-versions-'))
const scope = `vhostra-php-versions-${process.pid}`
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
try {
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, selectedPhpVersion: '8.1', ports: { http: 29780, https: 29743, phpMyAdmin: 29781, mariadb: 29706, redis: 29779, memcached: 29711 } })
  await runtime.start()
  for (const version of ['8.1', '8.2', '8.3', '8.4', '8.5']) {
    if (version !== '8.1') {
      const state = await store.getState()
      await store.saveSettings({ ...state.settings, selectedPhpVersion: version })
      await runtime.restart()
    }
    for (const server of ['openlitespeed', 'apache', 'nginx']) {
      const current = await store.getState()
      if (current.settings.selectedWebServer !== server) {
        await store.saveSettings({ ...current.settings, selectedWebServer: server })
        await runtime.restart()
      }
      const response = await fetch('http://127.0.0.1:29780/vhostra-health.php', { headers: { Host: 'localhost' } })
      assert.equal(response.status, 200, `${server} PHP ${version}`)
      assert.match(await response.text(), new RegExp(`^vhostra-${server === 'openlitespeed' ? 'lsphp' : 'php-fpm'}:${version.replace('.', '\\.')}\\.`))
      assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb')?.state, 'running')
      console.log(`PASS ${server} PHP ${version} through actual HTTP; MariaDB still running.`)
    }
  }
} finally {
  try { await runtime.resetRuntime(false) } finally { runtime.dispose(); await rm(profile, { recursive: true, force: true }) }
  assert.deepEqual(inventory(), before, 'PHP version fixture containers/networks must be removed exactly')
}
