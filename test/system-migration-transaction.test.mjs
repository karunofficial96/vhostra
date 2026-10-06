import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { prepareSystemMigration } from '../dist-electron/system-migration.js'

async function fixture() {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vhostra-migrate-')))
  const source = path.join(parent, 'legacy')
  const destinations = { configuration: path.join(parent, 'system', 'etc'), data: path.join(parent, 'system', 'lib'), logs: path.join(parent, 'system', 'log') }
  const website = path.join(parent, 'website')
  for (const dir of [source, website, path.join(source, 'data/mariadb'), path.join(source, 'certificates/private'), path.join(source, 'runtime/php'), path.join(source, 'runtime/redis'), path.join(source, 'logs'), path.join(source, 'sites'), path.join(source, 'backups'), path.join(source, 'cache/screenshots')]) await mkdir(dir, { recursive: true })
  for (const [file, value] of [['settings.json', '{"port":81}'], ['data/mariadb/ibdata1', 'database bytes'], ['certificates/private/key.pem', 'secret'], ['runtime/php/php.ini', 'memory_limit=128M'], ['runtime/php/roots.json', '{"obsolete":true}'], ['runtime/redis/redis.conf', 'bind 127.0.0.1'], ['logs/service.log', 'bounded'], ['sites/site.json', '{"documentRoot":"external"}'], ['backups/archive', 'backup'], ['cache/screenshots/preview.jpg', 'website content']]) await writeFile(path.join(source, file), value)
  await writeFile(path.join(website, 'index.php'), 'website')
  return { parent, source, destinations, website }
}

test('system copy prepares separated stores, preserves MariaDB and excludes user content', async () => {
  const f = await fixture()
  try {
    assert.equal(await prepareSystemMigration(f.source, f.destinations, [f.website]), 'prepared')
    assert.equal(await readFile(path.join(f.destinations.data, 'data/mariadb/ibdata1'), 'utf8'), 'database bytes')
    assert.equal(await readFile(path.join(f.destinations.data, 'certificates/private/key.pem'), 'utf8'), 'secret')
    assert.equal(await readFile(path.join(f.destinations.configuration, 'settings.json'), 'utf8'), '{"port":81}')
    assert.equal(await readFile(path.join(f.destinations.configuration, 'configuration/runtime/php/php.ini'), 'utf8'), 'memory_limit=128M')
    assert.equal(await readFile(path.join(f.destinations.data, 'service-data/redis/redis.conf'), 'utf8'), 'bind 127.0.0.1')
    await assert.rejects(readFile(path.join(f.destinations.configuration, 'configuration/runtime/php/roots.json')), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(f.source, 'runtime/php/roots.json'), 'utf8'), '{"obsolete":true}')
    assert.equal(await readFile(path.join(f.destinations.logs, 'service.log'), 'utf8'), 'bounded')
    assert.equal(await readFile(path.join(f.source, 'data/mariadb/ibdata1'), 'utf8'), 'database bytes')
    assert.equal(await readFile(path.join(f.website, 'index.php'), 'utf8'), 'website')
    assert.deepEqual(await readdir(f.destinations.configuration), ['.vhostra-system-migration.json', 'configuration', 'settings.json', 'sites'])
    assert.equal(await prepareSystemMigration(f.source, f.destinations, [f.website]), 'already-prepared')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('macOS nested system destination stages data and logs under one root', async () => {
  const f = await fixture()
  const root = path.join(f.parent, 'Application Support', 'Vhostra')
  const destinations = { configuration: root, data: root, logs: path.join(root, 'logs') }
  try {
    assert.equal(await prepareSystemMigration(f.source, destinations, [f.website]), 'prepared')
    assert.equal(await readFile(path.join(root, 'settings.json'), 'utf8'), '{"port":81}')
    assert.equal(await readFile(path.join(root, 'data/mariadb/ibdata1'), 'utf8'), 'database bytes')
    assert.equal(await readFile(path.join(root, 'logs/service.log'), 'utf8'), 'bounded')
    assert.equal(await prepareSystemMigration(f.source, destinations, [f.website]), 'already-prepared')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('migration places owned web server configuration under protected configuration', async () => {
  const f = await fixture()
  try {
    await mkdir(path.join(f.source, 'runtime/apache'), { recursive: true })
    await mkdir(path.join(f.source, 'runtime/mariadb'), { recursive: true })
    await writeFile(path.join(f.source, 'runtime/apache/vhostra.conf'), '# Vhostra generated configuration; owner=vhostra; schema=1\n')
    await writeFile(path.join(f.source, 'runtime/mariadb/vhostra.cnf'), '[mariadb]\n')
    assert.equal(await prepareSystemMigration(f.source, f.destinations, [f.website]), 'prepared')
    assert.match(await readFile(path.join(f.destinations.configuration, 'configuration/runtime/apache/vhostra.conf'), 'utf8'), /owner=vhostra/)
    assert.equal(await readFile(path.join(f.destinations.configuration, 'configuration/runtime/mariadb/vhostra.cnf'), 'utf8'), '[mariadb]\n')
    await assert.rejects(readFile(path.join(f.destinations.data, 'runtime/apache/vhostra.conf')), { code: 'ENOENT' })
    assert.equal(await prepareSystemMigration(f.source, f.destinations, [f.website]), 'already-prepared')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('migration moves built-in localhost content to service data and rewrites its Site record', async () => {
  const f = await fixture()
  const oldRoot = path.join(f.source, 'sites/localhost/public')
  const newRoot = path.join(f.destinations.data, 'service-data/localhost/public')
  const record = { id: 'vhostra-localhost', builtIn: 'localhost', vhostId: 'vhostra-localhost-vhost', documentRoot: oldRoot, configuration: { documentRoot: oldRoot } }
  try {
    await mkdir(oldRoot, { recursive: true })
    await writeFile(path.join(oldRoot, 'index.html'), '<h1>Localhost</h1>')
    await writeFile(path.join(f.source, 'sites/vhostra-localhost.json'), JSON.stringify(record))
    assert.equal(await prepareSystemMigration(f.source, f.destinations, [oldRoot, f.website]), 'prepared')
    assert.equal(await readFile(path.join(newRoot, 'index.html'), 'utf8'), '<h1>Localhost</h1>')
    const migrated = JSON.parse(await readFile(path.join(f.destinations.configuration, 'sites/vhostra-localhost.json'), 'utf8'))
    assert.equal(migrated.documentRoot, newRoot)
    assert.equal(migrated.configuration.documentRoot, newRoot)
    assert.equal(JSON.parse(await readFile(path.join(f.source, 'sites/vhostra-localhost.json'), 'utf8')).documentRoot, oldRoot)
    await assert.rejects(readFile(path.join(f.destinations.configuration, 'sites/localhost/public/index.html')), { code: 'ENOENT' })
    assert.equal(await prepareSystemMigration(f.source, f.destinations, [oldRoot, f.website]), 'already-prepared')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('migration rejects a built-in Site record with a mismatched document root', async () => {
  const f = await fixture()
  try {
    await writeFile(path.join(f.source, 'sites/vhostra-localhost.json'), JSON.stringify({
      id: 'vhostra-localhost', builtIn: 'localhost', vhostId: 'vhostra-localhost-vhost',
      documentRoot: f.website, configuration: { documentRoot: f.website },
    }))
    await assert.rejects(prepareSystemMigration(f.source, f.destinations, [f.website]), /Built-in Site record/)
    for (const root of Object.values(f.destinations)) await assert.rejects(readdir(root), { code: 'ENOENT' })
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('failed runtime verification rolls back every destination and keeps legacy data', async () => {
  const f = await fixture()
  try {
    await assert.rejects(prepareSystemMigration(f.source, f.destinations, [], async () => { throw new Error('runtime failed') }), /runtime failed/)
    for (const root of Object.values(f.destinations)) await assert.rejects(readdir(root), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(f.source, 'data/mariadb/ibdata1'), 'utf8'), 'database bytes')
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})

test('migration refuses occupied destinations and linked source components', async () => {
  const f = await fixture()
  try {
    await mkdir(f.destinations.configuration, { recursive: true })
    await writeFile(path.join(f.destinations.configuration, 'other'), 'keep')
    await assert.rejects(prepareSystemMigration(f.source, f.destinations), /occupied/)
    assert.equal(await readFile(path.join(f.destinations.configuration, 'other'), 'utf8'), 'keep')
    await rm(f.destinations.configuration, { recursive: true })
    await symlink(f.website, path.join(f.source, 'data/mariadb/link'))
    await assert.rejects(prepareSystemMigration(f.source, f.destinations), /symbolic link/)
  } finally { await rm(f.parent, { recursive: true, force: true }) }
})
