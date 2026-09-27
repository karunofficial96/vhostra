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
    assert.equal(first.settings.startup.closeBehavior, 'minimize-to-tray')
    const localhost = first.sites.find(site => site.builtIn === 'localhost')
    assert.ok(localhost)
    assert.equal(localhost.url, 'http://localhost/')
    await access(path.join(localhost.documentRoot, 'index.html'))
    await assert.rejects(() => store.removeSite(localhost.id), /protected/)
    const created = await store.addSite({ name: 'Example', documentRoot: '/projects/example/public', url: 'http://example.local', framework: 'Laravel' })
    assert.equal(created.sites.length, 2)
    assert.equal(created.virtualHosts.find(vhost => vhost.id === created.sites.find(site => site.name === 'Example').vhostId).hostname, 'example.local')
    await store.saveSettings({ schemaVersion: 1, selectedWebServer: 'apache', selectedPhpVersion: '8.5', optionalServices: { redis: true, memcached: false }, startup: { launchAtLogin: false, startServicesOnLaunch: false, closeBehavior: 'keep-services' }, php: { extensions: [], opcacheEnabled: true, cwebpEnabled: true }, ports: { http: 80, https: 443, mariadb: 3306, redis: 6379, memcached: 11211, phpMyAdmin: 9080 } })
    const reloaded = await new VhostraStore(directory).getState()
    assert.equal(reloaded.settings.selectedWebServer, 'apache')
    assert.equal(reloaded.settings.startup.closeBehavior, 'keep-services')
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
    const localhost = (await reloaded.getState()).sites.find(site => site.builtIn === 'localhost')
    assert.ok(localhost.documentRoot.startsWith(result.root + path.sep))
    await access(path.join(localhost.documentRoot, 'index.html'))
  } finally { await rm(directory, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }) }
})

test('configuration migration retains source and restores pointer on runtime validation failure', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-rollback-'))
  const destination = await mkdtemp(path.join(os.tmpdir(), 'vhostra-rollback-destination-'))
  try {
    const store = new VhostraStore(directory)
    await store.getState(); const original = store.layout.root
    await assert.rejects(store.migrateConfiguration(destination, async () => { throw Error('Health check failed') }), /rolled back/)
    assert.equal(store.layout.root, original)
    assert.equal(new VhostraStore(directory).layout.root, original)
    await access(path.join(original, 'settings.json'))
    await store.getState()
  } finally { await rm(directory, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }) }
})


test('rejects duplicate service ports before saving settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-ports-'))
  try {
    const store = new VhostraStore(directory)
    const { settings } = await store.getState()
    await assert.rejects(store.saveSettings({ ...settings, ports: { ...settings.ports, phpMyAdmin: settings.ports.http } }), /distinct host port/)
    assert.equal((await store.getState()).settings.ports.phpMyAdmin, settings.ports.phpMyAdmin)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('site saves reject hostname and alias collisions and protect localhost updates', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hostname-'))
  try {
    const store = new VhostraStore(directory)
    const initial = await store.getState()
    const localhost = initial.sites.find(site => site.builtIn)
    await assert.rejects(store.updateSite({ ...localhost, url: 'http://renamed.test' }), /protected/)
    await store.addSite({ name: 'First', documentRoot: '/projects/first', url: 'http://first.test', aliases: ['shared.test'] })
    await assert.rejects(store.addSite({ name: 'Second', documentRoot: '/projects/second', url: 'http://shared.test' }), /already belongs/)
    await assert.rejects(store.addSite({ name: 'Second', documentRoot: '/projects/second', url: 'http://second.test', aliases: ['FIRST.TEST'] }), /already belongs/)
    const first = (await store.getState()).sites.find(site => site.name === 'First')
    await store.updateSite({ ...first, name: 'First renamed' })
    assert.deepEqual((await store.getState()).virtualHosts.find(host => host.id === first.vhostId).aliases, ['shared.test'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('duplicate aliases and external hosts conflicts reject saves before writing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-host-preflight-'))
  try {
    const store = new VhostraStore(directory, undefined, async names => { if (names.includes('external.test')) throw Error('Hosts-file conflict') })
    await store.getState()
    await assert.rejects(store.addSite({ name: 'Duplicate', documentRoot: '/projects/test', url: 'http://one.test', aliases: ['ONE.TEST'] }), /Duplicate/)
    await assert.rejects(store.addSite({ name: 'Conflict', documentRoot: '/projects/test', url: 'http://external.test' }), /Hosts-file conflict/)
    assert.equal((await store.getState()).sites.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('concurrent site creation cannot acquire the same hostname twice', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-concurrent-hosts-'))
  try {
    const store = new VhostraStore(directory)
    const input = { name: 'Concurrent', documentRoot: '/projects/example', url: 'http://same.test' }
    const results = await Promise.allSettled([store.addSite(input), store.addSite(input)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal((await store.getState()).virtualHosts.filter(host => host.hostname === 'same.test').length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('configuration import preflights every host before saving any definition', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-import-hosts-'))
  try {
    const store = new VhostraStore(directory, undefined, async names => { if (names.includes('conflict.test')) throw Error('Hosts-file conflict') })
    const sites = ['valid.test', 'conflict.test'].map((hostname, index) => ({ id: String(index), vhostId: String(index), name: hostname, url: `http://${hostname}`, documentRoot: '/projects/test' }))
    const source = path.join(directory, 'import.json')
    await writeFile(source, JSON.stringify({ manifest: { format: 'vhostra/config-bundle', schemaVersion: 1 }, configuration: { sites, virtualHosts: sites.map(site => ({ id: site.vhostId, hostname: site.name, aliases: [] })) } }))
    await assert.rejects(store.importBundle(source), /Hosts-file conflict/)
    assert.equal((await store.getState()).sites.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('migration emits real copy, verification, switch and rollback stages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vhostra-migration-stage-'))
  const destination = await mkdtemp(path.join(os.tmpdir(), 'vhostra-migration-stage-destination-'))
  try {
    const store = new VhostraStore(directory); const stages = []
    await assert.rejects(store.migrateConfiguration(destination, async () => { throw Error('health failure') }, message => stages.push(message)), /rolled back/)
    assert.match(stages.join('\n'), /Copying.*\nVerifying.*\nSwitching.*\nValidating.*\nRolling back/s)
  } finally { await rm(directory, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }) }
})
