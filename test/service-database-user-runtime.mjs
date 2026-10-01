// Isolated exact User@Host acceptance. Never touches the default Vhostra profile.
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { execFileSync, spawnSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-user-actions-'))
const scope = `vhostra-user-actions-${process.pid}`
const inventory = () => execFileSync('docker', ['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}'], { encoding: 'utf8' }).split('\n').filter(line => line && !line.includes(scope)).sort()
const original = inventory()
const store = new VhostraStore(profile, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const cli = args => spawnSync(process.execPath, ['scripts/vhostra.mjs', ...args], { encoding: 'utf8', timeout: 15000, env: { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope } })
let passed = false
const observed = []
const checks = []
let lastRevision = -1
runtime.subscribe(() => { const revision = runtime.current().serviceRevision ?? 0; if (revision === lastRevision) return; lastRevision = revision; checks.push(runtime.listManagedServices().then(rows => observed.push(rows.find(row => row.id === 'mariadb')?.state))) })
try {
  const state = await store.getState()
  await store.saveSettings({ ...state.settings, ports: { ...state.settings.ports, mariadb: 35306 } })
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'not-created')
  await runtime.controlManagedService('mariadb', 'start')
  await Promise.all(checks); assert.ok(observed.includes('starting'), `MariaDB did not publish Starting: ${observed.join(', ')}`)
  const independent = await runtime.listManagedServices()
  assert.equal(independent.find(row => row.id === 'mariadb').state, 'running')
  assert.equal(independent.find(row => row.id === 'web').state, 'not-created')
  const sql = statement => runtime.databaseCompose(['exec', '-T', 'mariadb', 'mariadb', '-uroot', '-N', '-e', statement])
  await sql("CREATE DATABASE export_fixture; CREATE TABLE export_fixture.payload (id INT PRIMARY KEY AUTO_INCREMENT, body MEDIUMTEXT); INSERT INTO export_fixture.payload(body) VALUES ('a:1:{s:4:\"home\";s:17:\"http://local.test\";}'); INSERT INTO export_fixture.payload(body) SELECT REPEAT('X', 10000) FROM information_schema.COLUMNS LIMIT 150")
  let running
  for (let attempt = 0; attempt < 35; attempt++) {
    running = cli(['status', 'mariadb'])
    if (/MariaDB: Running/.test(running.stdout)) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal(running.status, 0, running.stderr); assert.match(running.stdout, /MariaDB: Running/)
  const listed = cli(['database', 'list']); assert.equal(listed.status, 0, listed.stderr); assert.match(listed.stdout, /export_fixture/); assert.doesNotMatch(listed.stdout, /[{}]|serviceRevision/)
  const dump = path.join(profile, 'large-export.sql')
  await runtime.exportDatabase('export_fixture', dump)
  assert.ok((await stat(dump)).size > 1000000, 'Large-enough streamed dump fixture missing')
  assert.match(await readFile(dump, 'utf8'), /http:\/\/local\.test/)
  await assert.rejects(runtime.exportDatabase('export_fixture', path.join(profile, 'missing-directory', 'invalid.sql')))
  await sql("CREATE USER 'exact_user'@'localhost' IDENTIFIED BY 'fixture-original-pass'; CREATE USER 'exact_user'@'%' IDENTIFIED BY 'fixture-other-pass'")
  const accounts = await runtime.listDatabaseUsers()
  assert.ok(accounts.some(row => row.username === 'exact_user' && row.host === 'localhost'))
  assert.ok(accounts.some(row => row.username === 'exact_user' && row.host === '%'))
  await runtime.changeDatabaseUserPassword({ username: 'exact_user', host: 'localhost', password: 'fixture-new-password' })
  assert.equal((await sql("SELECT COUNT(*) FROM mysql.user WHERE User='exact_user' AND Host='%' ")).trim(), '1')
  await assert.rejects(runtime.deleteDatabaseUser({ username: 'root', host: 'localhost' }), /reserved/)
  await runtime.deleteDatabaseUser({ username: 'exact_user', host: 'localhost' })
  assert.equal((await sql("SELECT COUNT(*) FROM mysql.user WHERE User='exact_user' AND Host='localhost'")).trim(), '0')
  assert.equal((await sql("SELECT COUNT(*) FROM mysql.user WHERE User='exact_user' AND Host='%'")).trim(), '1')
  await runtime.controlManagedService('mariadb', 'stop')
  await Promise.all(checks); assert.ok(observed.includes('stopping'), `MariaDB did not publish Stopping: ${observed.join(', ')}`)
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'stopped')
  const stopped = cli(['database', 'list']); assert.equal(stopped.status, 1); assert.match(stopped.stderr, /MariaDB is Stopped.*npm run cli -- mariadb start/); assert.doesNotMatch(stopped.stderr, /SQL value omitted|at .*\.mjs:\d+/)
  const occupiedPort = net.createServer()
  await new Promise((resolve, reject) => occupiedPort.once('error', reject).listen(35306, '127.0.0.1', resolve))
  try {
    await assert.rejects(runtime.controlManagedService('mariadb', 'start'))
    assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'failed')
  } finally { await new Promise(resolve => occupiedPort.close(resolve)) }
  await runtime.controlManagedService('mariadb', 'stop')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'stopped')
  console.log('PASS independent MariaDB stopped/running/stopped, real failed start, and exact User@Host password/delete with preserved host variant')
  passed = true
} finally {
  await runtime.resetRuntime(false).catch(error => console.error(error.message))
  runtime.dispose()
  if (passed) await rm(profile, { recursive: true, force: true })
  else console.error(`Retained fixture: ${profile}`)
  assert.deepEqual(inventory(), original)
}
