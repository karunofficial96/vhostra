import test from 'node:test'
import assert from 'node:assert/strict'
import { createShutdownManager } from '../dist-electron/shutdown.js'

test('keep-services and minimize never stop runtime', async () => {
  const calls = []
  const shutdown = createShutdownManager({ refresh: async () => { throw Error('Unexpected Docker access') }, stop: async () => calls.push('stop'), hide: () => calls.push('hide'), quit: () => calls.push('quit') })
  await shutdown('minimize-to-tray'); await shutdown('keep-services')
  assert.deepEqual(calls, ['hide', 'quit'])
})
test('stop-services verifies before quit and coalesces concurrent requests', async () => {
  const calls = []; let running = true
  const shutdown = createShutdownManager({ refresh: async () => ({ state: running ? 'running' : 'stopped' }), stop: async () => { calls.push('stop'); running = false }, hide: () => {}, quit: () => calls.push('quit') })
  await Promise.all([shutdown('stop-services'), shutdown('stop-services')])
  assert.deepEqual(calls, ['stop', 'quit'])
})
test('unavailable Docker or failed verification keeps app open and allows retry', async () => {
  for (const state of ['unavailable', 'failed']) {
    let quits = 0
    const shutdown = createShutdownManager({ refresh: async () => ({ state }), stop: async () => {}, hide: () => {}, quit: () => quits++ })
    await assert.rejects(shutdown('stop-services'))
    assert.equal(quits, 0)
    await shutdown('keep-services'); assert.equal(quits, 1)
  }
})
