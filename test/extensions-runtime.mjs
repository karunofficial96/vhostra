// Opt-in real extension/OPcache acceptance; dedicated temporary Compose scope only.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-extensions-'))
const scope = `vhostra-extensions-${process.pid}`
const store = new VhostraStore(root, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
let lastMessage = ''
runtime.subscribe(() => { const message = runtime.current().message; if (message !== lastMessage) { lastMessage = message; console.log(message) } })
const catalogItem = async id => (await runtime.listPhpExtensions()).find(item => item.id === id)
const persist = async (extensions, disabledExtensions) => { const { settings } = await store.getState(); await store.saveSettings({ ...settings, php: { ...settings.php, extensions, disabledExtensions } }) }
try {
  const { settings } = await store.getState()
  await store.saveSettings({ ...settings, selectedPhpVersion: '8.3', ports: { http: 30180, https: 30443, phpMyAdmin: 30181, mariadb: 30306, redis: 30379, memcached: 30211 } })
  await runtime.start()
  assert.equal((await catalogItem('opcache')).enabled, true)
  assert.ok((await runtime.listPhpExtensions()).length > 20)
  assert.ok((await runtime.getCwebpStatus()).installed)
  await runtime.managePhpExtension('apcu', 'install'); await persist(['apcu'], [])
  assert.equal((await catalogItem('apcu')).enabled, true)
  await runtime.stop(); await runtime.start()
  assert.equal((await catalogItem('apcu')).enabled, true)
  console.log('APCu installed and restored from persisted selection.')
  await runtime.managePhpExtension('apcu', 'disable'); await persist([], ['apcu'])
  await runtime.stop(); await runtime.start()
  assert.equal((await catalogItem('apcu')).installed, true)
  assert.equal((await catalogItem('apcu')).enabled, false)
  await runtime.managePhpExtension('apcu', 'enable'); await persist(['apcu'], [])
  assert.equal((await catalogItem('apcu')).enabled, true)
  for (const enabled of [false, true]) {
    const current = await store.getState()
    await store.saveSettings({ ...current.settings, php: { ...current.settings.php, opcacheEnabled: enabled } })
    await runtime.restart()
    assert.equal((await catalogItem('opcache')).enabled, enabled)
    console.log(`OPcache ${enabled ? 'enabled' : 'disabled'} and actual PHP state verified.`)
  }
  await runtime.managePhpExtension('apcu', 'remove'); await persist([], [])
  assert.equal((await catalogItem('apcu')).installed, false)
  await runtime.stop(); await runtime.start()
  assert.equal((await catalogItem('apcu')).installed, false)
  for (const server of ['apache', 'nginx']) {
    const current = await store.getState()
    await store.saveSettings({ ...current.settings, selectedWebServer: server })
    await runtime.restart()
    await runtime.managePhpExtension('apcu', 'install'); await persist(['apcu'], [])
    assert.equal((await catalogItem('apcu')).enabled, true, `${server} PHP-FPM APCu install`)
    await runtime.managePhpExtension('apcu', 'disable'); await persist([], ['apcu'])
    assert.equal((await catalogItem('apcu')).enabled, false, `${server} PHP-FPM APCu disable`)
    await runtime.managePhpExtension('apcu', 'enable'); await persist(['apcu'], [])
    assert.equal((await catalogItem('apcu')).enabled, true, `${server} PHP-FPM APCu enable`)
    await runtime.managePhpExtension('apcu', 'remove'); await persist([], [])
    assert.equal((await catalogItem('apcu')).installed, false, `${server} PHP-FPM APCu remove`)
    console.log(`${server} PHP-FPM APCu install/disable/enable/remove passed through actual HTTP inventory.`)
  }
  console.log('APCu install/disable/enable/remove, persisted restoration, dynamic catalog and cwebp passed.')
} finally {
  runtime.dispose()
  try { await runtime.resetRuntime(false); await runtime.pauseBackgroundWork() }
  finally { await rm(root, { recursive: true, force: true }) }
  assert.deepEqual(inventory(), before, 'Extension fixture containers/networks must be removed exactly')
}
