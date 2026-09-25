import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { VhostraStore } from '../dist-electron/store.js'
import { parseHosts } from '../dist-electron/hosts.js'

test('persists site definitions and preserves document-root files on removal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-store-'))
  try {
    const store = new VhostraStore(directory)
    const first = await store.getState()
    assert.equal(first.settings.selectedWebServer, 'openlitespeed')
    assert.equal(first.settings.selectedPhpVersion, '8.5')
    assert.equal(first.settings.php.cwebpEnabled, true)
    const localhost = first.sites.find(site => site.builtIn === 'localhost')
    assert.ok(localhost)
    assert.equal(localhost.url, 'http://localhost/')
    await access(path.join(localhost.documentRoot, 'index.html'))
    await assert.rejects(() => store.removeSite(localhost.id), /protected/)
    const created = await store.addSite({ name: 'Example', documentRoot: '/projects/example/public', url: 'http://example.local', framework: 'Laravel' })
    assert.equal(created.sites.length, 2)
    assert.equal(created.virtualHosts.find(vhost => vhost.id === created.sites.find(site => site.name === 'Example').vhostId).hostname, 'example.local')
    await store.saveSettings({ schemaVersion: 1, selectedWebServer: 'apache', selectedPhpVersion: '8.5', optionalServices: { redis: true, memcached: false }, ports: { http: 80, https: 443, mariadb: 3306, redis: 6379, memcached: 11211, phpMyAdmin: 9080 } })
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

test('parses hosts entries without treating comments or unrelated aliases as mappings', () => {
  const entries = parseHosts('# keep this comment\n127.0.0.1 localhost project.test # Vhostra\n192.168.1.8 existing.test\n')
  assert.deepEqual([...entries.get('project.test')], ['127.0.0.1'])
  assert.deepEqual([...entries.get('existing.test')], ['192.168.1.8'])
  assert.equal(entries.has('vhostra'), false)
})

test('copies offline welcome fonts, logos and service assets into the localhost document root', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-welcome-'))
  try {
    const store = new VhostraStore(directory, path.resolve('dist-welcome'))
    const state = await store.getState()
    const localhost = state.sites.find(site => site.builtIn === 'localhost')
    assert.ok(localhost)
    const page = await readFile(path.join(localhost.documentRoot, 'index.html'), 'utf8')
    assert.match(page, /services\/openlitespeed\.png/)
    assert.match(page, /vhostra-logo-dark\.png/)
    await access(path.join(localhost.documentRoot, 'services', 'openlitespeed.png'))
    await access(path.join(localhost.documentRoot, 'fonts', 'roboto-400.ttf'))
    assert.ok((await readdir(localhost.documentRoot)).includes('vhostra-logo-dark.png'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('migrates only Vhostra-owned configuration after a verified copy', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-migrate-'))
  const destination = await mkdtemp(path.join(os.tmpdir(), 'vhostra-migrate-destination-'))
  try {
    const store = new VhostraStore(directory)
    await store.getState()
    const externalRoot = path.join(directory, 'external-site')
    await mkdir(externalRoot)
    await writeFile(path.join(externalRoot, 'keep.txt'), 'site files stay external')
    const result = await store.migrateConfiguration(destination)
    assert.equal(result.root, path.join(destination, 'Vhostra'))
    await access(path.join(result.root, 'settings.json'))
    assert.equal(await readFile(path.join(externalRoot, 'keep.txt'), 'utf8'), 'site files stay external')
    const reloaded = new VhostraStore(directory)
    assert.equal(reloaded.layout.root, result.root)
  } finally { await rm(directory, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }) }
})
