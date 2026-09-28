import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseNativeConfiguration, readNativeConfiguration } from '../dist-electron/config-import.js'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { cleanObsoleteGenerated, cleanObsoleteRuntime, generatedMarker } from '../dist-electron/generated-config.js'
import { directoryBytes, localStorageUsage } from '../dist-electron/resources.js'
const apache = `<VirtualHost *:80>\nServerName imported.test\nServerAlias www.imported.test shop.imported.test\nDocumentRoot "/tmp/project public"\nDirectoryIndex home.php index.html\n<Directory "/tmp/project public">\nRequire ip 10.0.0.0/8\n</Directory>\nRewriteEngine On\nRewriteRule ^legacy /new [R=301,L]\n</VirtualHost>`
const nginx = 'server { listen 443 ssl; server_name nginx.test www.nginx.test; root /tmp/nginx; index index.php index.html; location / { try_files $uri $uri/ /index.php?$query_string; } location ~ \\.php$ { fastcgi_pass unix:/tmp/php.sock; include fastcgi_params; } }'
const ols = 'vhDomain ols.test\nvhAliases www.ols.test,shop.ols.test\ndocRoot /tmp/ols/\nindex {\n indexFiles index.php,index.html\n}\nrewrite {\n enable 1\n autoLoadHtaccess 1\n}\nscripthandler {\n add lsapi:lsphp php\n}'
for (const [server, source, hostname] of [['apache', apache, 'imported.test'], ['nginx', nginx, 'nginx.test'], ['openlitespeed', ols, 'ols.test'], ['litespeed-enterprise', ols, 'ols.test'], ['litespeed-enterprise', apache, 'imported.test']]) test(`native ${server} imports retain unsupported settings and canonical fields`, () => {
  const result = parseNativeConfiguration(source, '/old-install/site.conf', server)
  assert.equal(result.status, 'Requires review'); assert.equal(result.hosts[0].hostname, hostname)
  assert.ok(result.hosts[0].aliases.length); assert.ok(result.preservedDirectives.length)
  assert.equal(result.sourceText, source)
})
test('native import rejects ambiguous, malformed, hostile and unresolved configuration', () => {
  assert.throws(() => parseNativeConfiguration('include other.conf;', '/source'), /ambiguous/)
  for (const value of ['server { server_name x.test; root /tmp;', 'server { server_name *.test; root /tmp; }', 'server { server_name x.test; root $base; }', 'server { server_name x.test; root /tmp }', 'server { server_name x.test; root "/tmp; }']) assert.equal(parseNativeConfiguration(value, '/source', 'nginx').status, 'Invalid')
  assert.throws(() => parseNativeConfiguration('a'.repeat(1024 * 1024 + 1), '/source'), /1 MiB/)
  const repeatedSource = '# ' + 'x'.repeat(900_000) + '\n' + Array.from({ length: 5 }, (_, i) => `server { server_name budget${i}.test; root /tmp/budget${i}; }`).join('\n')
  assert.equal(parseNativeConfiguration(repeatedSource, '/source', 'nginx').status, 'Invalid', 'Duplicated original source must stay within the preservation budget')
  assert.equal(parseNativeConfiguration('<virtualHost/>', '/source', 'litespeed-enterprise').status, 'Invalid')
})
test('canonical native import preserves source, indexes, aliases through generation and secret-free export', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-import-')); const store = new VhostraStore(root); let runtime
  try {
    const source = path.join(root, 'original.conf'); await writeFile(source, apache)
    const preview = await readNativeConfiguration(source)
    await store.importNative(preview)
    const state = await store.getState(); const host = state.virtualHosts.find(host => host.hostname === 'imported.test')
    assert.equal(host.source.raw, apache); assert.equal(host.documentRoot, '/tmp/project public'); assert.equal(host.indexFiles[0], 'home.php')
    runtime = new DockerRuntimeController(store.layout, () => store.getState())
    for (const server of ['apache', 'nginx', 'openlitespeed']) {
      state.settings.selectedWebServer = server; await runtime.generate(state)
      assert.equal((await store.getState()).virtualHosts.find(h => h.id === host.id).source.raw, apache)
      const native = await readFile(path.join(store.layout.configuration.generated, `${server}-vhosts.conf`), 'utf8')
      assert.ok(native.startsWith(generatedMarker)); assert.match(native, /home.php/); assert.match(native, /www.imported.test/)
    }
    assert.equal(await readFile(source, 'utf8'), apache)
    await assert.rejects(store.importNative(preview), /already belongs/)
    const exported = path.join(root, 'export.json'); await store.exportBundle(exported)
    const exportedHost = JSON.parse(await readFile(exported, 'utf8')).configuration.virtualHosts.find(h => h.id === host.id)
    assert.equal(exportedHost.source.raw, undefined); assert.equal(exportedHost.preservedDirectives, undefined)
  } finally { runtime?.dispose(); await rm(root, { recursive: true, force: true }) }
})
test('LiteSpeed directory import resolves only explicit regular files and listener domains', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-lstree-'))
  try {
    await mkdir(path.join(root, 'vhosts', 'demo'), { recursive: true })
    await writeFile(path.join(root, 'httpd_config.conf'), 'virtualHost demo {\n vhRoot /tmp/demo\n configFile $SERVER_ROOT/conf/vhosts/demo/vhconf.conf\n}\nlistener local {\n address *:80\n map demo demo.test,www.demo.test\n}')
    await writeFile(path.join(root, 'vhosts', 'demo', 'vhconf.conf'), 'docRoot $VH_ROOT/public\nindex {\n indexFiles index.php,index.html\n}')
    await symlink('/etc/hosts', path.join(root, 'ignored.conf'))
    const preview = await readNativeConfiguration(root)
    assert.equal(preview.status, 'Requires review'); assert.equal(preview.hosts[0].hostname, 'demo.test'); assert.equal(preview.hosts[0].documentRoot, '/tmp/demo/public')
    assert.doesNotMatch(preview.sourceText, /ignored.conf/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('new onboarding survives retries; valid legacy users skip setup; completion persists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-onboard-'))
  try {
    const store = new VhostraStore(root); await store.getState()
    const preferences = await store.getOnboarding(); assert.equal(preferences.completed, false); assert.equal(preferences.theme, 'system'); assert.equal(preferences.php, '8.5'); assert.equal(preferences.cache, 'none')
    await store.saveOnboarding({ ...preferences, server: 'nginx', cache: 'redis' })
    assert.equal((await new VhostraStore(root).getOnboarding()).completed, false)
    await store.saveOnboarding({ ...preferences, completed: true })
    assert.equal((await new VhostraStore(root).getOnboarding()).completed, true)
    await rm(path.join(store.layout.root, 'onboarding.json'))
    assert.equal((await new VhostraStore(root).getOnboarding()).completed, true)
    await store.addSite({ name: 'Existing site', documentRoot: '/tmp/existing', url: 'http://existing.test' })
    await rm(path.join(store.layout.root, 'onboarding.json')); await rm(store.layout.settings)
    assert.equal((await new VhostraStore(root).getOnboarding()).completed, true, 'Valid legacy site state also bypasses setup')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('owned generated cleanup protects foreign configuration and links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-owned-config-'))
  try {
    await writeFile(path.join(root, 'apache-vhosts.conf'), generatedMarker + 'owned')
    await writeFile(path.join(root, 'nginx-vhosts.conf'), 'foreign')
    await writeFile(path.join(root, 'untouched.conf'), 'user')
    await symlink(path.join(root, 'untouched.conf'), path.join(root, 'openlitespeed-vhosts.conf'))
    await cleanObsoleteGenerated(root, 'openlitespeed')
    assert.equal(await readFile(path.join(root, 'nginx-vhosts.conf'), 'utf8'), 'foreign'); assert.equal(await readFile(path.join(root, 'untouched.conf'), 'utf8'), 'user')
    assert.ok(!(await readdir(root)).includes('apache-vhosts.conf'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('storage attribution ignores symlinks and external roots; bounded scan reports partial', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-storage-')); const store = new VhostraStore(root)
  try {
    await store.getState(); await writeFile(path.join(root, 'external.dat'), 'unrelated')
    await symlink(path.join(root, 'external.dat'), path.join(store.layout.logs, 'external.log'))
    await writeFile(path.join(store.layout.logs, 'owned.log'), 'owned')
    assert.equal((await directoryBytes(store.layout.logs)).bytes, 5)
    assert.equal((await directoryBytes(store.layout.logs, 1)).partial, true)
    const usage = await localStorageUsage(store.layout, []); assert.equal(usage.categories.find(row => row.label === 'Logs').bytes, 5)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('tampered canonical fields reject generation before changing native files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-canonical-guard-')); const store = new VhostraStore(root); let runtime
  try {
    const state = await store.getState(); runtime = new DockerRuntimeController(store.layout, () => store.getState())
    await runtime.generate(state)
    const file = path.join(store.layout.configuration.generated, 'openlitespeed-vhosts.conf'); const previous = await readFile(file, 'utf8')
    for (const change of [{ id: 'injected{directive' }, { aliases: ['invalid; directive'] }, { indexFiles: ['index.php; injected'] }, { documentRoot: '/tmp/path\ninjected' }]) {
      const candidate = structuredClone(state); Object.assign(candidate.virtualHosts[0], change)
      await assert.rejects(runtime.generate(candidate), /Invalid canonical/)
      assert.equal(await readFile(file, 'utf8'), previous)
    }
  } finally { runtime?.dispose(); await rm(root, { recursive: true, force: true }) }
})
