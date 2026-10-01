import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseNativeConfiguration, readNativeConfiguration } from '../dist-electron/config-import.js'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { siteUrlCandidates } from '../dist-electron/site-url.js'

const names = ['example.test', 'www.example.test', 'dev.example.test']
const sources = {
  apache: `<VirtualHost *:80>\nServerName ${names[0]}\nServerAlias ${names.slice(1).join(' ')}\nDocumentRoot /tmp/vhostra-identity\n</VirtualHost>`,
  nginx: `server { listen 8088; server_name ${names.join(' ')}; root /tmp/vhostra-identity; }`,
  openlitespeed: `docRoot /tmp/vhostra-identity\nvhDomain ${names[0]}\nvhAliases ${names.slice(1).join(',')}\n`,
  'litespeed-enterprise': `docRoot /tmp/vhostra-identity\nvhDomain ${names[0]}\nvhAliases ${names.slice(1).join(',')}\n`,
}
const identity = host => [host.hostname, ...host.aliases]

test('Add/Edit canonical identity persists; all import formats convert to each native target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-identity-'))
  const project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-identity-site-'))
  try {
    const store = new VhostraStore(root)
    const single = await store.addSite({ name: 'Single', documentRoot: project, url: 'http://single.test/' })
    assert.deepEqual(identity(single.virtualHosts.find(host => host.hostname === 'single.test')), ['single.test'])
    const site = single.sites.find(site => site.name === 'Single')
    await store.updateSite({ ...site, url: 'http://example.test/', aliases: names.slice(1) })
    const saved = await new VhostraStore(root).getState()
    const canonical = saved.virtualHosts.find(host => host.id === site.vhostId)
    assert.deepEqual(identity(canonical), names)
    assert.equal(new URL(siteUrlCandidates(saved, saved.sites.find(item => item.id === site.id), false)[0]).hostname, names[0])
    const runtime = new DockerRuntimeController(store.layout, () => store.getState())
    try {
      for (const [sourceServer, source] of Object.entries(sources)) {
        const imported = parseNativeConfiguration(source, '/tmp/identity.conf', sourceServer)
        assert.notEqual(imported.status, 'Invalid', `${sourceServer}: ${imported.warnings.join(' / ')}`)
        assert.deepEqual(identity(imported.hosts[0]), names)
        const host = { ...canonical, ...imported.hosts[0], id: canonical.id }
        const apache = runtime.exportSiteConfiguration(host, 'apache')
        assert.match(apache, /ServerName example\.test/)
        assert.deepEqual(identity(parseNativeConfiguration(apache, '/tmp/export.conf', 'apache').hosts[0]), names)
        const nginx = runtime.exportSiteConfiguration(host, 'nginx')
        assert.match(nginx, /server_name example\.test www\.example\.test dev\.example\.test;/)
        assert.deepEqual(identity(parseNativeConfiguration(nginx, '/tmp/export.conf', 'nginx').hosts[0]), names)
        const ols = runtime.exportOpenLiteSpeedFiles(host)
        assert.match(ols.main, /listener VhostraHTTP/)
        assert.match(ols.main, /map [^\n]+ dev\.example\.test/)
        const directory = path.join(root, `export-${sourceServer}`)
        await mkdir(path.join(directory, 'vhosts', host.id), { recursive: true })
        await writeFile(path.join(directory, 'httpd_config.conf'), ols.main)
        await writeFile(path.join(directory, 'vhosts', host.id, 'vhconf.conf'), ols.vhost)
        const roundTrip = await readNativeConfiguration(directory, 'openlitespeed')
        assert.deepEqual(identity(roundTrip.hosts[0]), names, `${sourceServer} to OpenLiteSpeed`)
      }
      assert.deepEqual(identity((await store.getState()).virtualHosts.find(host => host.id === canonical.id)), names, 'exports must not mutate canonical data')
    } finally { runtime.dispose() }
  } finally { await rm(root, { recursive: true, force: true }); await rm(project, { recursive: true, force: true }) }
})

test('OpenLiteSpeed listener names merge with declared vhconf aliases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-ols-import-'))
  try {
    await mkdir(path.join(root, 'vhosts', 'site'), { recursive: true })
    await writeFile(path.join(root, 'httpd_config.conf'), 'virtualHost site {\n vhRoot /tmp/site\n configFile $SERVER_ROOT/conf/vhosts/site/vhconf.conf\n}\nlistener local {\n address *:80\n secure 0\n map site example.test\n map site www.example.test\n map site dev.example.test\n}\n')
    await writeFile(path.join(root, 'vhosts', 'site', 'vhconf.conf'), 'docRoot /tmp/site\nvhDomain example.test\nvhAliases www.example.test\n')
    const imported = await readNativeConfiguration(root, 'openlitespeed')
    assert.deepEqual(identity(imported.hosts[0]), names)
  } finally { await rm(root, { recursive: true, force: true }) }
})
