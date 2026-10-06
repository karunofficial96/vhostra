import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

test('cache profile restore writes only scoped service files with private permissions', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cache-profile-'))
  try {
    const store = new VhostraStore(userData)
    await store.initialize()
    const runtime = new DockerRuntimeController(store.layout, () => store.getState())
    await runtime.restoreBackupCacheState({ redis: 'bind 127.0.0.1\n', memcached: '-l 127.0.0.1\n' })
    for (const service of ['redis', 'memcached']) {
      const file = path.join(store.layout.runtime[service], `${service}.conf`)
      assert.match(await readFile(file, 'utf8'), /127\.0\.0\.1/)
      assert.equal((await stat(file)).mode & 0o777, 0o600)
    }
    await runtime.restoreBackupCacheState({ redis: null })
    assert.equal((await runtime.backupCacheState()).redis, null)
  } finally { await rm(userData, { recursive: true, force: true }) }
})
