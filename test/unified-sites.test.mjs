import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { readNativeConfiguration } from '../dist-electron/config-import.js'

test('legacy imported Sites consolidate once without changing identity or external roots', async () => {
  for (const server of ['apache', 'nginx', 'openlitespeed', 'litespeed-enterprise']) {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-unified-'))
    const store = new VhostraStore(profile)
    await store.initialize()
    const root = path.join(profile, 'external-root')
    await mkdir(root)
    await writeFile(path.join(root, 'index.html'), server)
    const id = '11111111-1111-4111-8111-111111111111'
    const vhostId = '22222222-2222-4222-8222-222222222222'
    const site = { id, vhostId, name: 'example.test', documentRoot: root, url: 'http://example.test/', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
    const host = { id: vhostId, hostname: 'example.test', aliases: ['www.example.test', 'dev.example.test'], documentRoot: root, https: { enabled: false }, rewriteEnabled: true, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true }, source: { server, path: 'legacy.conf', importedAt: '2026-01-01', raw: 'legacy', status: 'Converted', warnings: [] } }
    await writeFile(path.join(store.layout.sites, `${id}.json`), JSON.stringify(site))
    await writeFile(path.join(store.layout.virtualHosts, `${vhostId}.json`), JSON.stringify(host))
    const migrated = new VhostraStore(profile)
    const state = await migrated.getState()
    assert.equal(migrated.didMigrateUnifiedSites, true)
    assert.equal(state.sites.filter(item => !item.builtIn).length, 1)
    assert.equal(state.virtualHosts.find(item => item.id === vhostId).source.server, server)
    assert.deepEqual(state.virtualHosts.find(item => item.id === vhostId).aliases, host.aliases)
    assert.equal((await readFile(path.join(root, 'index.html'), 'utf8')), server)
    assert.equal((await readdir(migrated.layout.virtualHosts)).filter(name => name.endsWith('.json')).length, 0)
    assert.equal((await JSON.parse(await readFile(path.join(migrated.layout.sites, `${id}.json`))).configuration).hostname, 'example.test')
    const restarted = new VhostraStore(profile)
    assert.equal((await restarted.getState()).sites.filter(item => !item.builtIn).length, 1)
    assert.equal(restarted.didMigrateUnifiedSites, false)
  }
})

test('one portable OpenLiteSpeed Site file imports name, aliases, root and supported settings', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-ols-file-'))
  const store = new VhostraStore(profile)
  const root = path.join(profile, 'external-root'); await mkdir(root)
  const host = { id: '22222222-2222-4222-8222-222222222222', hostname: 'example.test', aliases: ['www.example.test'], documentRoot: root, https: { enabled: true }, rewriteEnabled: false, redirects: [], rewrites: [], headers: [], logs: { access: false, error: true }, indexFiles: ['index.php'] }
  const site = { id: '11111111-1111-4111-8111-111111111111', vhostId: host.id, name: 'Portable example', framework: 'WordPress', documentRoot: root, url: 'https://example.test:8443/' }
  const file = path.join(profile, 'site.json')
  await writeFile(file, JSON.stringify({ format: 'vhostra/site', schemaVersion: 1, targetServer: 'openlitespeed', site, virtualHost: host }))
  const preview = await readNativeConfiguration(file)
  assert.equal(preview.hosts.length, 1)
  const result = await store.importNative(preview)
  assert.equal(result.imported.length, 1)
  const imported = (await store.getState()).virtualHosts.find(item => item.hostname === 'example.test')
  assert.deepEqual(imported.aliases, host.aliases)
  assert.equal(imported.documentRoot, root)
  assert.equal(imported.logs.access, false)
  assert.equal(imported.rewriteEnabled, false)
  const importedSite = (await store.getState()).sites.find(item => item.vhostId === imported.id)
  assert.equal(importedSite.name, site.name)
  assert.equal(importedSite.framework, site.framework)
  assert.equal(importedSite.url, site.url)
})

test('conflicting legacy records stop before migration and preserve both source files', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-unified-conflict-'))
  const store = new VhostraStore(profile); await store.initialize()
  const root = path.join(profile, 'external-root'); await mkdir(root)
  const id = '11111111-1111-4111-8111-111111111111', vhostId = '22222222-2222-4222-8222-222222222222'
  const siteFile = path.join(store.layout.sites, `${id}.json`), hostFile = path.join(store.layout.virtualHosts, `${vhostId}.json`)
  const siteText = JSON.stringify({ id, vhostId, name: 'example.test', documentRoot: root, url: 'http://example.test/' })
  const hostText = JSON.stringify({ id: vhostId, hostname: 'different.test', aliases: [], documentRoot: root })
  await writeFile(siteFile, siteText); await writeFile(hostFile, hostText)
  await assert.rejects(new VhostraStore(profile).getState(), /disagrees/)
  assert.equal(await readFile(siteFile, 'utf8'), siteText)
  assert.equal(await readFile(hostFile, 'utf8'), hostText)
})
