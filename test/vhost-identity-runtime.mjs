// Opt-in, isolated native routing acceptance. Run sequentially after building.
import assert from 'node:assert/strict'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-identity-runtime-'))
const project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-identity-project-'))
const scope = `vhostra-identity-${process.pid}`
let store = new VhostraStore(profile, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 })
const inventory = () => docker(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).split('\n').filter(line => line && !line.includes(scope)).sort()
const before = inventory()
const names = ['example.test', 'www.example.test', 'dev.example.test']
const request = hostname => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: 39580, path: '/', headers: { Host: hostname } }, response => {
    let body = ''; response.on('data', chunk => { body += chunk }); response.on('end', () => resolve({ status: response.statusCode, body, site: response.headers['x-vhostra-site'] }))
  }).on('error', reject)
})
try {
  await chmod(project, 0o755)
  await writeFile(path.join(project, 'index.html'), 'Vhostra identity routing fixture')
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, selectedPhpVersion: '8.3', ports: { http: 39580, https: 39543, phpMyAdmin: 39581, mariadb: 39506, redis: 39579, memcached: 39511 } })
  const created = await store.addSite({ name: 'Identity fixture', documentRoot: project, url: `http://${names[0]}/`, aliases: names.slice(1) })
  const id = created.virtualHosts.find(host => host.hostname === names[0]).id
  const legacySite = created.sites.find(site => site.vhostId === id)
  const legacyHost = { ...created.virtualHosts.find(host => host.id === id), source: { server: 'openlitespeed', path: 'legacy-vhconf.conf', importedAt: '2026-01-01', raw: 'legacy', status: 'Converted', warnings: [] } }
  await writeFile(path.join(store.layout.sites, `${legacySite.id}.json`), JSON.stringify(legacySite))
  await writeFile(path.join(store.layout.virtualHosts, `${id}.json`), JSON.stringify(legacyHost))
  store = new VhostraStore(profile, path.resolve('dist-welcome'))
  assert.equal((await store.getState()).virtualHosts.find(host => host.id === id).source.server, 'openlitespeed')
  assert.equal(store.didMigrateUnifiedSites, true)
  for (const server of ['openlitespeed', 'apache', 'nginx']) {
    const state = await store.getState()
    await store.saveSettings({ ...state.settings, selectedWebServer: server })
    if (server === 'openlitespeed') await runtime.start()
    else await runtime.restart()
    for (const hostname of names) {
      const response = await request(hostname)
      assert.equal(response.status, 200, `${server}: ${hostname} returned ${response.status}`)
      assert.match(response.body, /Vhostra identity routing fixture/)
      assert.equal(response.site, id, `${server}: ${hostname} routed to another Site`)
    }
    const current = await store.getState()
    assert.deepEqual([current.virtualHosts.find(host => host.id === id).hostname, ...current.virtualHosts.find(host => host.id === id).aliases], names)
    const generated = await readFile(path.join(store.layout.configuration.generated, `${server}-vhosts.conf`), 'utf8')
    for (const hostname of names) assert.ok(generated.includes(hostname), `${server}: missing ${hostname}`)
    console.log(`${server}: canonical and both aliases routed to the same Site`)
  }
  await runtime.stop()
} finally {
  runtime.dispose()
  try { await runtime.resetRuntime(false); await runtime.pauseBackgroundWork() } finally { await rm(profile, { recursive: true, force: true }); await rm(project, { recursive: true, force: true }) }
  assert.deepEqual(inventory(), before, 'Unrelated Docker projects changed')
}
