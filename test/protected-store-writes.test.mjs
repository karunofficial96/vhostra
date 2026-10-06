import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { systemStoragePaths } from '../dist-electron/storage-paths.js'

test('machine Store JSON mutations and Site deletion cannot bypass the protected transaction', async () => {
  const source = await readFile(new URL('../electron/store.ts', import.meta.url), 'utf8')
  const writeJson = source.slice(source.indexOf('  private async writeJson('), source.indexOf('  private async ensureLocalhostDefinition('))
  assert.match(writeJson, /if \(this\.machinePaths\)/)
  assert.match(writeJson, /authorizeProtectedTransaction\(/)
  assert.match(writeJson, /Machine configuration mutation is not allowlisted/)
  assert.ok(writeJson.indexOf('authorizeProtectedTransaction(') < writeJson.indexOf('await fs.mkdir('))
  const removeSite = source.slice(source.indexOf('  private async removeSiteRecord('), source.indexOf('  async setVirtualHostRewrite('))
  assert.match(removeSite, /if \(this\.machinePaths\) await authorizeProtectedTransaction\(/)
  assert.match(removeSite, /else await fs\.rm\(this\.recordPath/)
  const initialize = source.slice(source.indexOf('  private async initializeOnce('), source.indexOf('  private directories('))
  assert.match(initialize, /if \(this\.machinePaths\)/)
  assert.match(initialize, /\[this\.layout\.screenshots, this\.layout\.exports, this\.layout\.backups\]/)
})

test('production startup remains gated pending complete machine lifecycle and permissions', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const start = main.slice(main.indexOf('    store = new VhostraStore('), main.indexOf('    createRuntimeController();'))
  assert.doesNotMatch(start, /systemStoragePaths\(/)
  const runtime = await readFile(new URL('../electron/runtime.ts', import.meta.url), 'utf8')
  assert.match(runtime, /type: 'web-runtime-config', model/)
  assert.match(runtime, /'runtime-config', 'web'/)
  assert.match(runtime, /serviceConfig\('openlitespeed'\)/)
  assert.match(runtime, /serviceConfig\('php'\)/)
  assert.match(runtime, /serviceConfig\('apache'\)/)
  assert.match(runtime, /serviceConfig\('nginx'\)/)
  assert.match(runtime, /\.\.\.\(!this\.layout\.userRoot \? \[/)
  assert.match(runtime, /if \(!this\.layout\.userRoot\) await fs\.rm\(path\.join\(this\.layout\.runtime\.php, "roots\.json"\)/)
  const store = await readFile(new URL('../electron/store.ts', import.meta.url), 'utf8')
  assert.match(store, /path\.join\(data, 'service-data', 'redis'\)/)
})

test('runtime rejects the split machine layout before filesystem generation', () => {
  const store = new VhostraStore('/tmp/vhostra-runtime-gate-user', undefined, undefined,
    { configuration: '/tmp/vhostra-runtime-gate-system', data: '/tmp/vhostra-runtime-gate-data', logs: '/tmp/vhostra-runtime-gate-logs' })
  assert.throws(() => new DockerRuntimeController(store.layout, async () => { throw new Error('must not read state') }),
    /Machine storage runtime is blocked/)
})

test('production machine paths cannot initialize a Store while native activation is blocked', () => {
  assert.throws(() => new VhostraStore('/tmp/vhostra-native-gate-user', undefined, undefined,
    systemStoragePaths(process.platform)), /Native machine storage remains blocked/)
})
