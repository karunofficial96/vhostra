import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { VhostraStore } from '../dist-electron/store.js'

test('persists site definitions and preserves document-root files on removal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-store-'))
  try {
    const store = new VhostraStore(directory)
    const first = await store.getState()
    assert.equal(first.settings.selectedWebServer, 'openlitespeed')
    assert.equal(first.settings.selectedPhpVersion, '8.5')
    const localhost = first.sites.find(site => site.builtIn === 'localhost')
    assert.ok(localhost)
    assert.equal(localhost.url, 'http://localhost/')
    await access(path.join(localhost.documentRoot, 'index.html'))
    await assert.rejects(() => store.removeSite(localhost.id), /protected/)
    const created = await store.addSite({ name: 'Example', documentRoot: '/projects/example/public', url: 'http://example.local', framework: 'Laravel' })
    assert.equal(created.sites.length, 2)
    assert.equal(created.virtualHosts.find(vhost => vhost.id === created.sites.find(site => site.name === 'Example').vhostId).hostname, 'example.local')
    await store.saveSettings({ schemaVersion: 1, selectedWebServer: 'apache', selectedPhpVersion: '8.5', optionalServices: { redis: true, memcached: false } })
    const reloaded = await new VhostraStore(directory).getState()
    assert.equal(reloaded.settings.selectedWebServer, 'apache')
    assert.equal(reloaded.sites.find(site => site.name === 'Example').documentRoot, '/projects/example/public')
    await store.removeSite(created.sites.find(site => site.name === 'Example').id)
    assert.equal((await store.getState()).sites.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('only accepts credential-free HTTP(S) URLs for external site opening', () => {
  assert.doesNotThrow(() => VhostraStore.validateUrl('https://project.local:8443'))
  assert.throws(() => VhostraStore.validateUrl('file:///etc/passwd'))
  assert.throws(() => VhostraStore.validateUrl('https://user:secret@project.local'))
})
