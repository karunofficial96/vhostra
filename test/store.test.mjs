import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { VhostraStore } from '../dist-electron/store.js'

test('persists site definitions and preserves document-root files on removal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-store-'))
  try {
    const store = new VhostraStore(directory)
    const first = await store.getState()
    assert.equal(first.sites.length, 0)
    assert.equal(first.settings.selectedWebServer, 'nginx')
    const created = await store.addSite({ name: 'Example', documentRoot: '/projects/example/public', url: 'http://example.local', framework: 'Laravel' })
    assert.equal(created.sites.length, 1)
    assert.equal(created.virtualHosts[0].hostname, 'example.local')
    await store.saveSettings({ schemaVersion: 1, selectedWebServer: 'apache', selectedPhpVersion: '8.5', optionalServices: { redis: true, memcached: false } })
    const reloaded = await new VhostraStore(directory).getState()
    assert.equal(reloaded.settings.selectedWebServer, 'apache')
    assert.equal(reloaded.sites[0].documentRoot, '/projects/example/public')
    await store.removeSite(created.sites[0].id)
    assert.equal((await store.getState()).sites.length, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('only accepts credential-free HTTP(S) URLs for external site opening', () => {
  assert.doesNotThrow(() => VhostraStore.validateUrl('https://project.local:8443'))
  assert.throws(() => VhostraStore.validateUrl('file:///etc/passwd'))
  assert.throws(() => VhostraStore.validateUrl('https://user:secret@project.local'))
})
