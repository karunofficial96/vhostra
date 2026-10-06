import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore, siteLogPaths, runtimeDocumentRoot } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { HostsFileManager } from '../dist-electron/hosts.js'
const fixture = async task => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-storage-phase-'))
  const project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-external-site-'))
  const store = new VhostraStore(profile, path.resolve('dist-welcome'))
  try { await store.initialize(); await writeFile(path.join(project, 'index.php'), '<?php echo "untouched";'); await task({ store, profile, project }) }
  finally { await rm(profile, { recursive: true, force: true }); await rm(project, { recursive: true, force: true }) }
}
test('all generated servers use stable host-mounted per-site access/error logs; host roots remain canonical', () => fixture(async ({ store, project }) => {
  const state = await store.addSite({ name: 'Example', documentRoot: project, url: 'http://example.test', aliases: ['www.example.test'] })
  const host = state.virtualHosts.find(host => host.hostname === 'example.test')
  assert.equal(host.documentRoot, project); assert.equal(runtimeDocumentRoot(host), `/var/www/vhostra/${host.id}`)
  const paths = siteLogPaths(store.layout, host.id)
  await mkdir(path.dirname(paths.access), { recursive: true })
  await writeFile(paths.access, 'local request path', { mode: 0o666 })
  const { chmod } = await import('node:fs/promises')
  await chmod(paths.access, 0o666)
  const runtime = new DockerRuntimeController(store.layout, () => store.getState())
  try {
    for (const server of ['apache', 'nginx', 'openlitespeed']) {
      state.settings.selectedWebServer = server; await runtime.generate(state)
      const config = await readFile(path.join(store.layout.configuration.generated, `${server}-vhosts.conf`), 'utf8')
      assert.ok(config.includes(`/var/log/vhostra/sites/${host.id}/access.log`)); assert.ok(config.includes(`/var/log/vhostra/sites/${host.id}/error.log`))
      const compose = await readFile(path.join(store.layout.root, 'runtime', 'compose.yml'), 'utf8')
      assert.ok(compose.includes(project)); assert.match(compose, /create_host_path: false/)
      assert.equal((await stat(path.dirname(paths.access))).mode & 0o777, 0o700)
      assert.equal((await stat(paths.access)).mode & 0o777, 0o600)
      await assert.rejects(stat(paths.error), /ENOENT/)
    }
    await store.removeSite(state.sites.find(site => site.vhostId === host.id).id)
    assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /untouched/)
  } finally { runtime.dispose() }
}))
for (const keep of [true, false]) test(`reset ${keep ? 'keeps' : 'removes'} definitions, ${keep ? 'preserves' : 'deletes'} databases and preserves external roots across restart`, () => fixture(async ({ store, profile, project }) => {
  await store.addSite({ name: 'Example', documentRoot: project, url: 'http://example.test' })
  await writeFile(path.join(store.layout.persistentData.mariaDb, 'database-fixture'), 'db')
  await store.saveOnboarding({ ...(await store.getOnboarding()), theme: 'dark', completed: true })
  await store.resetConfiguration(keep)
  const reopened = new VhostraStore(profile); const state = await reopened.getState()
  assert.equal(state.sites.length, keep ? 2 : 1); assert.equal((await reopened.getOnboarding()).completed, false)
  assert.equal((await reopened.getOnboarding()).theme, 'system'); assert.deepEqual(state.settings.optionalServices, { redis: false, memcached: false })
  if (keep) assert.equal(await readFile(path.join(store.layout.persistentData.mariaDb, 'database-fixture'), 'utf8'), 'db')
  else await assert.rejects(stat(path.join(store.layout.persistentData.mariaDb, 'database-fixture')), /ENOENT/)
  assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /untouched/)
}))
test('reset refuses external data-directory links and leaves data unchanged', () => fixture(async ({ store, project }) => {
  await rm(store.layout.persistentData.mariaDb, { recursive: true }); await symlink(project, store.layout.persistentData.mariaDb)
  await assert.rejects(store.resetConfiguration(false), /outside Vhostra/)
  assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /untouched/)
}))
test('legacy external roots inside managed runtime cause reset and migration refusal', () => fixture(async ({ store, profile }) => {
  const state = await store.addSite({ name: 'Example', documentRoot: '/tmp/legacy-external-project', url: 'http://example.test' })
  const site = state.sites.find(site => !site.builtIn); const host = state.virtualHosts.find(host => !host.builtIn)
  const root = path.join(store.layout.runtime.php, 'legacy-user-root'); await mkdir(root); await writeFile(path.join(root, 'user-data'), 'untouched')
  for (const [directory, record] of [[store.layout.sites, site], [store.layout.virtualHosts, host]]) await writeFile(path.join(directory, `${record.id}.json`), JSON.stringify({ ...record, documentRoot: root }))
  await assert.rejects(store.resetConfiguration(false), /preserve site files/)
  await assert.rejects(store.migrateConfiguration(path.join(profile, 'migrated')), /preserve site files/)
  assert.equal(await readFile(path.join(root, 'user-data'), 'utf8'), 'untouched')
}))
test('onboarding backup preview restores settings/theme/both caches, skips equivalent sites, preserves conflicting current configuration', () => fixture(async ({ store, profile, project }) => {
  const state = await store.addSite({ name: 'Example', documentRoot: project, url: 'http://example.test' })
  await store.saveSettings({ ...state.settings, selectedWebServer: 'nginx', selectedPhpVersion: '8.3', optionalServices: { redis: true, memcached: true } })
  await store.saveOnboarding({ ...(await store.getOnboarding()), theme: 'dark' })
  const bundle = path.join(profile, 'bundle.json'); await store.exportBundle(bundle)
  const preview = await store.previewBundle(bundle); assert.deepEqual(preview.missing, []); assert.equal(preview.sites[0].disposition, 'equivalent')
  const restored = await store.restoreOnboardingBundle(bundle, preview.checksum)
  assert.equal(restored.imported.length, 0); assert.equal(restored.preferences.theme, 'dark'); assert.deepEqual(restored.preferences.restoredServices, { redis: true, memcached: true })
  assert.equal((await store.getState()).settings.selectedWebServer, 'nginx')
  const edited = JSON.parse(await readFile(bundle, 'utf8')); edited.configuration.sites.find(site => !site.builtIn).documentRoot = '/tmp/different'; edited.configuration.virtualHosts.find(host => !host.builtIn).documentRoot = '/tmp/different'
  await writeFile(bundle, JSON.stringify(edited)); assert.equal((await store.previewBundle(bundle)).sites[0].disposition, 'conflict')
  await assert.rejects(store.importBundle(bundle), /conflict review required/); const result = await store.importBundle(bundle, {}, undefined, {}, { 'example.test': 'keep' }); assert.equal(result.imported.length, 0); assert.ok(result.warnings.some(warning => warning.includes('differs')))
  assert.equal((await store.getState()).sites.find(site => !site.builtIn).documentRoot, project)
}))
test('backup version, bounded size, changed source and completed-profile overwrite are rejected', () => fixture(async ({ store, profile }) => {
  const bundle = path.join(profile, 'bundle.json'); await store.exportBundle(bundle); const preview = await store.previewBundle(bundle)
  await writeFile(bundle, (await readFile(bundle, 'utf8')) + '\n'); await assert.rejects(store.restoreOnboardingBundle(bundle, preview.checksum), /changed after preview/)
  await writeFile(bundle, JSON.stringify({ manifest: { format: 'vhostra/config-bundle', schemaVersion: 2, entries: [] } })); await assert.rejects(store.previewBundle(bundle), /not a supported/)
  await writeFile(bundle, ' '.repeat(4 * 1024 * 1024 + 1)); await assert.rejects(store.previewBundle(bundle), /4 MiB/)
  await store.saveOnboarding({ ...(await store.getOnboarding()), completed: true }); await assert.rejects(store.restoreOnboardingBundle(bundle, ''), /cannot overwrite/)
}))
test('partial backups ask only for absent required settings and preserve website files', () => fixture(async ({ store, profile, project }) => {
  const bundle = path.join(profile, 'bundle.json'); await store.addSite({ name: 'Example', documentRoot: project, url: 'http://example.test' }); await store.exportBundle(bundle)
  const data = JSON.parse(await readFile(bundle, 'utf8')); data.configuration.settings = { schemaVersion: 1, selectedWebServer: 'apache' }; await writeFile(bundle, JSON.stringify(data))
  const preview = await store.previewBundle(bundle); assert.deepEqual(preview.missing, ['php', 'cache'])
  const result = await store.restoreOnboardingBundle(bundle, preview.checksum, {}, {}, { settings: 'replace' }); assert.deepEqual(result.missing, ['php', 'cache']); assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /untouched/)
}))
test('Hosts manual editor preserves unrelated CRLF/comment formatting, validates content and uses scoped write concurrency protection', () => fixture(async ({ profile }) => {
  const hostsFile = path.join(profile, 'hosts'); const original = '127.0.0.1 localhost\r\n# Keep this comment\r\n127.0.0.1 old.test # Vhostra 12345678-1234-1234-1234-123456789abc\r\n'
  await writeFile(hostsFile, original); const manager = new HostsFileManager(path.join(profile, 'tmp')); Object.defineProperty(manager, 'hostsPath', { value: hostsFile })
  let writes = 0; manager.replaceWithElevation = async (contents, expected) => { assert.equal(await readFile(hostsFile, 'utf8'), expected); writes++; await writeFile(hostsFile, contents) }
  assert.equal((await manager.inspect()).contents, original); assert.equal(writes, 0)
  const manual = await manager.previewEdit(original.replace('localhost', 'changed.test'), original); assert.match(manual.diff, /changed.test/); assert.equal(writes, 0)
  await assert.rejects(manager.edit(original + 'invalid-address broken.test\r\n', original), /Invalid Hosts/)
  const draft = original.replace('old.test', 'new.test').replaceAll('\r\n', '\n'); const review = await manager.previewEdit(draft, original); await manager.edit(draft, original, review.id)
  assert.equal(writes, 1); assert.equal(await readFile(hostsFile, 'utf8'), original.replace('old.test', 'new.test'))
}))
test('portable backup paths can be remapped to selected local roots without changing source files', () => fixture(async ({ store, profile, project }) => {
  await store.addSite({ name: 'Portable', documentRoot: project, url: 'http://portable.test' }); const bundle = path.join(profile, 'portable.json'); await store.exportBundle(bundle)
  const data = JSON.parse(await readFile(bundle, 'utf8')); const site = data.configuration.sites.find(site => !site.builtIn); const host = data.configuration.virtualHosts.find(host => !host.builtIn)
  site.documentRoot = host.documentRoot = 'C:\\Users\\example\\Sites\\portable'; await writeFile(bundle, JSON.stringify(data)); await store.removeSite(site.id)
  const source = await readFile(bundle, 'utf8'); const preview = await store.previewBundle(bundle); assert.equal(preview.sites[0].disposition, 'new')
  await assert.rejects(store.restoreOnboardingBundle(bundle, preview.checksum), /Choose an existing/)
  const restored = await store.restoreOnboardingBundle(bundle, preview.checksum, { 'portable.test': project }); assert.equal(restored.imported.length, 1); assert.equal((await store.getState()).sites.find(site => !site.builtIn).documentRoot, project)
  assert.equal(await readFile(bundle, 'utf8'), source); assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /untouched/)
}))

test('real status treats shared PHP/phpMyAdmin as stopped when their selected frontend is intentionally stopped', () => fixture(async ({ store }) => {
  const runtime = new DockerRuntimeController(store.layout, () => store.getState())
  try {
    runtime.set({ state: 'running', services: ['runtime'], message: 'Isolated status fixture' }); runtime.refresh = async () => runtime.current()
    runtime.listManagedServices = async () => [{ id: 'web', label: 'OpenLiteSpeed', enabled: true, state: 'stopped' }, { id: 'mariadb', label: 'MariaDB', enabled: true, state: 'running' }]
    const rows = await runtime.runtimeStatuses(); assert.equal(rows.find(row => row.id === 'php').state, 'stopped'); assert.equal(rows.find(row => row.id === 'phpmyadmin').state, 'stopped')
  } finally { runtime.dispose() }
}))
