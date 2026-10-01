import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

test('an optional service stays transitional until its disable operation completes', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-optional-transition-'))
  const store = new VhostraStore(profile)
  const runtime = new DockerRuntimeController(store.layout, () => store.getState())
  runtime.databaseStatus = async () => 'stopped'
  try {
    runtime.beginOptionalServiceChange('redis', true)
    assert.equal((await runtime.listManagedServices()).find(row => row.id === 'redis').state, 'starting')
    const state = await store.getState()
    await store.saveSettings({ ...state.settings, optionalServices: { ...state.settings.optionalServices, redis: true } })
    runtime.beginOptionalServiceChange('redis', false)
    await store.saveSettings(state.settings)
    assert.equal((await runtime.listManagedServices()).find(row => row.id === 'redis').state, 'stopping')
    runtime.endOptionalServiceChange('redis')
    assert.equal((await runtime.listManagedServices()).find(row => row.id === 'redis').state, 'disabled')
  } finally { runtime.dispose(); await rm(profile, { recursive: true, force: true }) }
})
