// Explicit opt-in integration test; uses only its own temporary Compose project.
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-live-migration-'))
const destination = await mkdtemp(path.join(os.tmpdir(), 'vhostra-live-destination-'))
const failureDestination = await mkdtemp(path.join(os.tmpdir(), 'vhostra-live-rollback-'))
const scope = `vhostra-migration-${process.pid}`
const store = new VhostraStore(directory)
const controller = () => new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
let runtime = controller()
const cleanup = () => runtime.resetRuntime(false)

try {
  const { settings } = await store.getState()
  settings.ports = { http: 28180, https: 28443, phpMyAdmin: 28181, mariadb: 28306, redis: 28379, memcached: 28211 }
  settings.selectedPhpVersion = '8.3'
  await store.saveSettings(settings)
  runtime.subscribe(() => console.log(runtime.current().message))
  await runtime.start()
  await runtime.createDatabase({ name: 'migration_probe', charset: 'utf8mb4', username: 'migration_user', password: 'migration-test-password' })
  const sql = path.join(directory, 'probe.sql')
  const dump = path.join(directory, 'export.sql')
  await writeFile(sql, "CREATE TABLE probe (id INT PRIMARY KEY, value VARCHAR(30)); INSERT INTO probe VALUES (1, 'preserved');")
  await runtime.importDatabase('migration_probe', sql)
  assert.match((await runtime.repairDatabase('migration_probe')).message, /probe: checked/)
  await runtime.exportDatabase('migration_probe', dump)
  assert.match(await readFile(dump, 'utf8'), /preserved/)
  const pma = await fetch(await runtime.phpMyAdminUrl())
  const html = await pma.text()
  assert.equal(pma.status, 200)
  assert.match(html, /migration_probe/)
  assert.doesNotMatch(html, /name="pma_username"/)
  for (const id of ['web', 'mariadb']) {
    assert.equal((await runtime.controlManagedService(id, 'stop')).find(service => service.id === id).state, 'stopped')
    assert.equal((await runtime.controlManagedService(id, 'start')).find(service => service.id === id).state, 'running')
    assert.equal((await runtime.controlManagedService(id, 'restart')).find(service => service.id === id).state, 'running')
  }
  await runtime.resetRuntime(false); await runtime.pauseBackgroundWork(); runtime.dispose()
  await store.migrateConfiguration(destination, async () => {
    runtime = controller(); await runtime.start()
    assert.ok((await runtime.listDatabases()).includes('migration_probe'))
  })
  const verifiedRoot = store.layout.root
  await runtime.resetRuntime(false); await runtime.pauseBackgroundWork(); runtime.dispose()
  await assert.rejects(store.migrateConfiguration(failureDestination, async () => {
    runtime = controller(); await runtime.start()
    // Fail the actual final PHP health check after successful startup.
    const state = await store.getState()
    state.settings.selectedPhpVersion = '8.4'
    await store.saveSettings(state.settings)
    await runtime.healthCheck('openlitespeed')
  }), /rolled back/)
  assert.equal(store.layout.root, verifiedRoot)
  assert.equal(new VhostraStore(directory).layout.root, verifiedRoot)
  await access(path.join(verifiedRoot, 'settings.json'))
  await runtime.resetRuntime(false); await runtime.pauseBackgroundWork(); runtime.dispose(); runtime = controller(); await runtime.start()
  assert.ok((await runtime.listDatabases()).includes('migration_probe'))
  await runtime.deleteDatabase('migration_probe')
  assert.ok(!(await runtime.listDatabases()).includes('migration_probe'))
  console.log('Live database operations, phpMyAdmin authentication, Supervisor actions, and migration, database preservation, final health rollback, and original runtime recovery passed.')
} finally {
  runtime.dispose()
  try { await cleanup() } finally {
    await Promise.all([directory, destination, failureDestination].map(root => rm(root, { recursive: true, force: true })))
  }
}
