// Sequential, isolated acceptance. No default profile or unrelated Docker project is touched.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-required-lifecycle-'))
const scope = `vhostra-required-${process.pid}`
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 })
const inventory = () => docker(['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(line => line && !line.includes(scope)).sort()
const before = inventory()
const store = new VhostraStore(profile, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const events = []
const snapshots = []
const pending = []
let lastRevision = -1
runtime.subscribe(() => {
  snapshots.push({ at: Date.now(), state: runtime.current().state, transitions: runtime.current().serviceTransitions })
  const revision = runtime.current().serviceRevision ?? 0
  if (revision === lastRevision) return
  lastRevision = revision
  const at = Date.now()
  pending.push(runtime.listManagedServices().then(rows => events.push({ at, runtime: runtime.current().state, states: Object.fromEntries(rows.map(row => [row.id, row.state])) })))
})
let passed = false
try {
  const state = await store.getState()
  await store.saveSettings({ ...state.settings, selectedWebServer: 'nginx', ports: { http: 37180, https: 37443, phpMyAdmin: 37181, mariadb: 37306, redis: 37379, memcached: 37211 } })
  const root = path.join(profile, 'external-site'); await mkdir(root)
  const saved = await store.addSite({ name: 'Export Fixture', documentRoot: root, url: 'http://required.test/' })
  const site = saved.sites.find(item => item.name === 'Export Fixture')
  const host = saved.virtualHosts.find(item => item.id === site.vhostId)
  const canonicalBefore = JSON.stringify(await store.getState())
  for (const server of ['apache', 'nginx', 'openlitespeed']) {
    const config = runtime.exportSiteConfiguration(host, server)
    assert.match(config, /required\.test/)
    assert.match(config, server === 'apache' ? /<VirtualHost/ : server === 'nginx' ? /server \{/ : /docRoot/)
  }
  assert.equal(JSON.stringify(await store.getState()), canonicalBefore)
  const startAt = Date.now(); await runtime.start(); const startDone = Date.now()
  await Promise.all(pending)
  assert.ok(events.some(event => event.states.mariadb === 'starting'), 'MariaDB Starting missing')
  assert.ok(events.some(event => event.states.web === 'starting'), 'web Starting missing')
  assert.ok(!events.some(event => event.at >= startAt && event.at < startDone && event.states.web === 'stopped'), 'web reported Stopped during startup')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'running')
  const webStopAt = Date.now(); await runtime.controlManagedService('web', 'stop')
  await Promise.all(pending)
  assert.ok(events.some(event => event.at >= webStopAt && event.states.web === 'stopping'), 'individual web Stopping missing')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'web').state, 'stopped')
  assert.equal((await runtime.runtimeStatuses()).find(row => row.id === 'php').state, 'stopped')
  const webStartAt = Date.now(); await runtime.controlManagedService('web', 'start')
  await Promise.all(pending)
  assert.ok(events.some(event => event.at >= webStartAt && event.states.web === 'starting'), 'individual web Starting missing')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'web').state, 'running')
  const databaseInspect = () => JSON.parse(docker(['inspect', `${scope}-mariadb`]))[0].State
  const startedAt = databaseInspect().StartedAt
  const sql = query => runtime.databaseCompose(['exec', '-T', 'mariadb', 'mariadb', '-uroot', '-e', query])
  await sql("CREATE DATABASE export_fixture; CREATE TABLE export_fixture.page (id INT PRIMARY KEY, content TEXT); INSERT INTO export_fixture.page VALUES (1, 'http://local.test/serialized:12'), (2, '/local/root');")
  const destination = path.join(profile, 'production.sql')
  await runtime.exportDatabase('export_fixture', destination)
  const dump = await readFile(destination, 'utf8')
  assert.match(dump, /http:\/\/local\.test\/serialized:12/)
  assert.match(dump, /\/local\/root/)
  assert.match(dump, /CREATE TABLE/)
  assert.equal((await runtime.listDatabases()).includes('export_fixture'), true)
  const stopAt = Date.now(); await runtime.stop(); const stopDone = Date.now()
  await Promise.all(pending)
  assert.ok(events.some(event => event.at >= stopAt && event.states.mariadb === 'stopping'), 'MariaDB Stopping missing')
  assert.ok(events.some(event => event.at >= stopAt && event.states.web === 'stopping'), 'web Stopping missing')
  assert.ok(!events.some(event => event.at >= stopAt && event.at < stopDone && event.states.mariadb === 'running'), 'MariaDB reported Running during shutdown')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'stopped')
  const finishedAt = databaseInspect().FinishedAt
  const restartAt = Date.now(); await runtime.start(); const restartAllAt = Date.now(); await runtime.restartAll(); const restartDone = Date.now()
  await Promise.all(pending)
  assert.ok(events.some(event => event.at >= restartAt && event.states.mariadb === 'restarting'), 'MariaDB Restarting missing')
  assert.ok(events.some(event => event.at >= restartAt && event.states.web === 'restarting'), 'web Restarting missing')
  assert.ok(!snapshots.some(snapshot => snapshot.at >= restartAllAt && snapshot.at < restartDone && snapshot.state === 'running' && Object.keys(snapshot.transitions ?? {}).length), 'Runtime reported Running while services were still restarting')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'running')
  console.log('MEASUREMENT', JSON.stringify({ scope, startAt, startDone, stopAt, stopDone, restartAt, restartAllAt, restartDone, mariaStartedAt: startedAt, mariaFinishedAt: finishedAt, events }))
  passed = true
} finally {
  await runtime.resetRuntime(false).catch(error => console.error('Scoped cleanup failed:', error.message))
  runtime.dispose()
  assert.deepEqual(inventory(), before)
  if (passed) await rm(profile, { recursive: true, force: true })
  else console.error('Retained isolated fixture:', profile)
}
