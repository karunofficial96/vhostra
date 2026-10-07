import test from 'node:test'
import assert from 'node:assert/strict'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { validateProtectedTransaction } from '../dist-electron/protected-transaction.js'
import { systemStoragePaths } from '../dist-electron/storage-paths.js'

test('the current privileged transaction rejects generic and unimplemented protected reads', () => {
  for (const operation of [
    { type: 'readFileAsRoot', path: '/Library/Application Support/Vhostra/certificates/private/localhost.key' },
    { type: 'machine-settings-read' },
    { type: 'machine-sites-list' },
  ]) {
    assert.throws(() => validateProtectedTransaction({ version: 1, operations: [operation] }), /not allowlisted/)
  }
})

test('native machine Store and runtime activation guards remain closed', () => {
  const roots = systemStoragePaths(process.platform)
  assert.throws(() => new VhostraStore('/private/tmp/vhostra-gate3a-user', undefined, undefined, roots), /Native machine storage remains blocked/)
  assert.throws(() => new DockerRuntimeController({ root: roots.configuration, userRoot: '/private/tmp/vhostra-gate3a-user' }, async () => ({})), /Machine storage runtime is blocked/)
})
