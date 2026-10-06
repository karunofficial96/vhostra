import test from 'node:test'
import assert from 'node:assert/strict'
import { systemStoragePaths } from '../dist-electron/storage-paths.js'

test('OS system locations are fixed and separate Linux configuration, data and logs', () => {
  assert.deepEqual(systemStoragePaths('darwin'), {
    configuration: '/Library/Application Support/Vhostra',
    data: '/Library/Application Support/Vhostra',
    logs: '/Library/Application Support/Vhostra/logs',
  })
  assert.deepEqual(systemStoragePaths('win32'), {
    configuration: 'C:\\ProgramData\\Vhostra',
    data: 'C:\\ProgramData\\Vhostra',
    logs: 'C:\\ProgramData\\Vhostra\\logs',
  })
  assert.deepEqual(systemStoragePaths('linux'), {
    configuration: '/etc/vhostra', data: '/var/lib/vhostra', logs: '/var/log/vhostra',
  })
})
