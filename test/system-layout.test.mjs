import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'

test('system layout separates machine records from per-user state and refuses ordinary bootstrap', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vhostra-system-layout-'))
  const roots = { configuration: path.join(parent, 'etc'), data: path.join(parent, 'lib'), logs: path.join(parent, 'log') }
  const userData = path.join(parent, 'user')
  try {
    await mkdir(userData)
    const store = new VhostraStore(userData, undefined, undefined, roots)
    assert.equal(store.layout.settings, path.join(roots.configuration, 'settings.json'))
    assert.equal(store.layout.persistentData.mariaDb, path.join(roots.data, 'data/mariadb'))
    assert.equal(store.layout.runtime.apache, path.join(roots.configuration, 'configuration/runtime/apache'))
    assert.equal(store.layout.runtime.mariaDb, path.join(roots.data, 'runtime/mariadb'))
    assert.equal(store.layout.runtime.redis, path.join(roots.data, 'service-data/redis'))
    assert.equal(store.layout.runtime.memcached, path.join(roots.data, 'service-data/memcached'))
    assert.equal(store.layout.builtinPublic, path.join(roots.data, 'service-data/localhost/public'))
    assert.equal(store.layout.logs, roots.logs)
    assert.equal(store.layout.screenshots, path.join(userData, 'cache/screenshots'))
    await assert.rejects(readdir(roots.configuration), { code: 'ENOENT' })
    await assert.rejects(readdir(roots.data), { code: 'ENOENT' })
    await assert.rejects(store.migrateConfigurationRoot(path.join(parent, 'other')), /Machine storage cannot be moved/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('machine mode refuses an incomplete copied environment before any protected mutation', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vhostra-system-open-'))
  const roots = { configuration: path.join(parent, 'etc'), data: path.join(parent, 'lib'), logs: path.join(parent, 'log') }
  const userData = path.join(parent, 'user')
  try {
    await mkdir(path.join(roots.configuration, 'sites'), { recursive: true })
    await mkdir(userData)
    await writeFile(path.join(roots.configuration, 'onboarding.json'), JSON.stringify({ completed: true, theme: 'system', server: 'apache', php: '8.5', cache: 'none' }))
    await writeFile(path.join(roots.configuration, 'settings.json'), '{invalid')
    const store = new VhostraStore(userData, undefined, undefined, roots)
    await assert.rejects(store.getState(), /JSON|Unexpected/)
    assert.equal((await readdir(path.join(roots.configuration, 'sites'))).length, 0)
    assert.equal((await readFile(path.join(roots.configuration, 'onboarding.json'), 'utf8')).includes('apache'), true)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
