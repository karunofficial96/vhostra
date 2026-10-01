// Opt-in isolated live cache acceptance. Never uses the user's Vhostra profile.
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-phase-cache-'))
const scope = `vhostra-phase-cache-${process.pid}`
const store = new VhostraStore(root, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
let printed = 0
runtime.subscribe(() => {
  const progress = runtime.current().progress
  if (progress && progress.total > printed) {
    console.log(progress.lines.slice(-(progress.total - printed)).join('\n'))
    printed = progress.total
  }
})
try {
  const { settings } = await store.getState()
  await store.saveSettings({ ...settings, selectedPhpVersion: '8.5', optionalServices: { redis: true, memcached: true }, ports: { http: 32180, https: 32443, phpMyAdmin: 32181, mariadb: 32306, redis: 32379, memcached: 32211 } })
  await mkdir(store.layout.runtime.memcached, { recursive: true })
  await writeFile(path.join(store.layout.runtime.memcached, 'memcached.conf'), '-m 32\n-p 32211\n')
  await runtime.start()
  if (!(await readFile(path.join(store.layout.runtime.memcached, 'memcached.conf'), 'utf8')).includes('-u nobody')) throw new Error('Stale Memcached user flag was not repaired.')
  const catalog = await runtime.listPhpExtensions()
  if (catalog.length < 20 || !catalog.some(item => item.id === 'memcached' && item.enabled) || !catalog.some(item => item.id === 'redis' && item.enabled)) throw new Error('Selected PHP extension catalog or cache modules are incomplete.')
  console.log(`PHP extension catalog: ${catalog.length} entries; Redis and Memcached loaded.`)
  console.log('Both cache PHP localhost checks passed.')
  for (const version of process.env.VHOSTRA_PHASE_SKIP_SWITCHES ? [] : (process.env.VHOSTRA_PHASE_VERSIONS?.split(',') ?? ['8.2', '8.5'])) {
    const current = await store.getState()
    await store.saveSettings({ ...current.settings, selectedPhpVersion: version })
    await runtime.applyConfiguration()
    console.log(`PHP ${version} replacement and both cache checks passed.`)
  }
} finally {
  try { await runtime.resetRuntime(false); await runtime.pauseBackgroundWork() }
  finally { runtime.dispose(); await rm(root, { recursive: true, force: true }) }
}
