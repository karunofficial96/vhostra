import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { prepareMachineMigration, recoverMachineMigration, discardMachineMigrationFixture } from '../dist-electron/machine-migration.js'

const siteId = '11111111-1111-4111-8111-111111111111'
async function fixture() {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vhostra-gate2-')))
  const sourceRoot = path.join(parent, 'legacy', 'Vhostra')
  const systemRoot = path.join(parent, 'system', 'Vhostra')
  const external = path.join(parent, 'external-site')
  for (const dir of [sourceRoot, systemRoot, external, ...[
    'sites/localhost/public', 'data/mariadb', 'runtime/redis', 'runtime/memcached', 'runtime/php',
    'runtime/mariadb', 'certificates/private', 'certificates/public', `logs/sites/${siteId}`,
  ].map(item => path.join(sourceRoot, item))]) await mkdir(dir, { recursive: true })
  const files = {
    'settings.json': JSON.stringify({ schemaVersion: 1, selectedWebServer: 'nginx', selectedPhpVersion: '8.3' }),
    'onboarding.json': JSON.stringify({ completed: true, server: 'nginx' }),
    'sites/vhostra-localhost.json': JSON.stringify({ id: 'vhostra-localhost', builtIn: 'localhost', vhostId: 'vhostra-localhost-vhost', name: 'Localhost', url: 'http://localhost', documentRoot: path.join(sourceRoot, 'sites/localhost/public'), configuration: { id: 'vhostra-localhost-vhost', hostname: 'localhost', documentRoot: path.join(sourceRoot, 'sites/localhost/public') } }),
    [`sites/${siteId}.json`]: JSON.stringify({ id: siteId, vhostId: siteId, name: 'External', url: 'http://example.test', documentRoot: external, configuration: { id: siteId, hostname: 'example.test', documentRoot: external } }),
    'sites/localhost/public/index.html': '<h1>fixture</h1>',
    'data/mariadb/ibdata1': 'disposable db bytes',
    'runtime/redis/dump.rdb': 'cache fixture',
    'runtime/memcached/state': 'state fixture',
    'runtime/php/vhostra.ini': 'expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\nmysqli.default_socket=/run/mysqld/mysqld.sock\npdo_mysql.default_socket=/run/mysqld/mysqld.sock\n',
    'certificates/private/localhost.key': 'fixture private key',
    'certificates/public/localhost.pem': 'fixture certificate',
    [`logs/sites/${siteId}/access.log`]: 'fixture log',
    'logs/service.log': 'fixture service log',
  }
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(sourceRoot, name), body)
  await writeFile(path.join(external, 'index.php'), 'external sentinel')
  const request = { sourceRoot, systemRoot, attemptId: randomUUID(), sourceUid: process.getuid(), writerUid: process.getuid(), writerGid: process.getgid() }
  return { parent, request, external }
}

test('machine migration reaches ready only after copy, generated config and ownership verification', async () => {
  const f = await fixture()
  try {
    const result = await prepareMachineMigration(f.request)
    assert.equal(result.phase, 'ready-for-activation')
    assert.equal(await recoverMachineMigration(f.request), 'ready-for-activation')
    const payload = path.join(result.stage, 'payload')
    assert.equal(await readFile(path.join(payload, 'data/mariadb/ibdata1'), 'utf8'), 'disposable db bytes')
    assert.equal((await lstat(path.join(payload, 'data/mariadb'))).mode & 0o777, 0o700)
    assert.equal((await lstat(path.join(payload, `logs/sites/${siteId}/access.log`))).mode & 0o777, 0o600)
    assert.equal((await lstat(path.join(payload, 'configuration/runtime/mariadb/vhostra.cnf'))).mode & 0o777, 0o600)
    assert.equal((await lstat(path.join(payload, 'runtime-config/mariadb/vhostra.cnf'))).mode & 0o777, 0o644)
    for (const service of ['redis', 'memcached']) {
      const file = path.join(payload, 'runtime-config/cache', `${service}.conf`)
      assert.equal((await lstat(file)).mode & 0o777, 0o644)
      assert.match(await readFile(file, 'utf8'), /^# Vhostra container cache configuration/)
    }
    assert.equal(await readFile(path.join(f.external, 'index.php'), 'utf8'), 'external sentinel')
    assert.equal((await readdir(payload)).includes('active'), false)
    await discardMachineMigrationFixture(f.request)
    assert.deepEqual(await readdir(f.request.systemRoot), [])
    assert.equal(await readFile(path.join(f.request.sourceRoot, 'data/mariadb/ibdata1'), 'utf8'), 'disposable db bytes')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

for (const fault of ['before-copy', 'partial-copy', 'after-copy', 'verification', 'permissions']) {
  test(`machine migration rolls back ${fault} and retains legacy`, async () => {
    const f = await fixture()
    try {
      await assert.rejects(prepareMachineMigration(f.request, fault))
      assert.equal(await recoverMachineMigration(f.request), 'rolled-back')
      assert.equal(await readFile(path.join(f.request.sourceRoot, 'data/mariadb/ibdata1'), 'utf8'), 'disposable db bytes')
      assert.equal(await readFile(path.join(f.external, 'index.php'), 'utf8'), 'external sentinel')
      assert.equal((await readdir(f.request.systemRoot)).filter(name => name.includes('stage')).length, 0)
    } finally { await rm(f.parent, { recursive: true, force: true }) }
  })
}

test('interrupted verified migration deterministically rolls back', async () => {
  const f = await fixture()
  try {
    await assert.rejects(prepareMachineMigration(f.request, 'interrupt-before-activation'))
    assert.equal(await recoverMachineMigration(f.request), 'rolled-back')
    assert.equal(await readFile(path.join(f.request.sourceRoot, 'data/mariadb/ibdata1'), 'utf8'), 'disposable db bytes')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('a rolled-back result does not activate the Store or block a new verified attempt', async () => {
  const f = await fixture()
  try {
    await assert.rejects(prepareMachineMigration(f.request, 'partial-copy'))
    const retry = { ...f.request, attemptId: randomUUID() }
    const result = await prepareMachineMigration(retry)
    assert.equal(result.phase, 'ready-for-activation')
    await discardMachineMigrationFixture(retry)
    assert.equal(await recoverMachineMigration(f.request), 'rolled-back')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('migration rejects linked managed data and occupied inactive roots', async () => {
  const f = await fixture()
  try {
    await symlink(f.external, path.join(f.request.sourceRoot, 'data/mariadb/link'))
    await assert.rejects(prepareMachineMigration(f.request), /symbolic.link/)
    await rm(path.join(f.request.sourceRoot, 'data/mariadb/link'))
    await writeFile(path.join(f.request.systemRoot, 'unrelated'), 'keep')
    await assert.rejects(prepareMachineMigration(f.request), /occupied/)
    assert.equal(await readFile(path.join(f.request.systemRoot, 'unrelated'), 'utf8'), 'keep')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})
