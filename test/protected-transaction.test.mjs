import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { executeProtectedTransaction, validateProtectedTransaction } from '../dist-electron/protected-transaction.js'
import { authoritativeMariaDbConfig, deriveMariaDbRuntimeConfig, parseAuthoritativeMariaDbConfig } from '../dist-electron/mariadb-config.js'
import { renderWebRuntimeFiles, authoritativeWebFile, runtimeWebFile } from '../dist-electron/web-runtime-config.js'

const sha = value => createHash('sha256').update(value).digest('hex')
const site = id => ({ id, vhostId: randomUUID(), name: 'Fixture', url: 'http://fixture.test/', configuration: {} })
const tx = operations => ({ version: 1, operations })
const fixture = async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vhostra-protected-')))
  const roots = { configuration: path.join(dir, 'etc'), data: path.join(dir, 'lib'), logs: path.join(dir, 'log') }
  const hosts = path.join(dir, 'hosts')
  await mkdir(roots.configuration)
  await writeFile(hosts, '127.0.0.1 localhost\n')
  return { dir, roots, hosts }
}

test('one allowlisted transaction updates Vhostra configuration and Hosts', async () => {
  const f = await fixture()
  try {
    const id = randomUUID()
    const next = '127.0.0.1 localhost\n127.0.0.1 fixture.test\n'
    const result = await executeProtectedTransaction(tx([
      { type: 'system-json', object: 'site', id, value: site(id) },
      { type: 'hosts', expectedSha256: sha('127.0.0.1 localhost\n'), contents: next },
    ]), f.roots, f.hosts)
    assert.deepEqual(result, { completed: 2 })
    assert.equal(JSON.parse(await readFile(path.join(f.roots.configuration, 'sites', `${id}.json`), 'utf8')).id, id)
    assert.equal(await readFile(f.hosts, 'utf8'), next)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('unknown operations, arbitrary paths, traversal and malformed payloads fail before writes', async () => {
  const f = await fixture()
  try {
    const id = randomUUID()
    const valid = { type: 'system-json', object: 'site', id, value: site(id) }
    for (const bad of [
      { type: 'exec', command: 'true' },
      { type: 'system-json', object: 'site', id: '../../outside', value: site(id) },
      { ...valid, destination: path.join(f.dir, 'outside') },
      { ...valid, value: { ...site(id), name: 'x'.repeat(1024 * 1024) } },
      { type: 'hosts', expectedSha256: 'bad', contents: 'x' },
    ]) assert.throws(() => validateProtectedTransaction(tx([valid, bad]), f.roots, f.hosts), /Protected Vhostra transaction/)
    await assert.rejects(readFile(path.join(f.roots.configuration, 'sites', `${id}.json`)), { code: 'ENOENT' })
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('linked destination and stale Hosts precondition reject entire transaction', async () => {
  const f = await fixture()
  try {
    const outside = path.join(f.dir, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(f.roots.configuration, 'sites'))
    const id = randomUUID()
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'system-json', object: 'site', id, value: site(id) }]), f.roots, f.hosts), /symbolic link/)
    await rm(path.join(f.roots.configuration, 'sites'))
    await assert.rejects(executeProtectedTransaction(tx([
      { type: 'system-json', object: 'site', id, value: site(id) },
      { type: 'hosts', expectedSha256: sha('old'), contents: '127.0.0.1 fixture.test\n' },
    ]), f.roots, f.hosts), /Hosts file changed/)
    await assert.rejects(readFile(path.join(f.roots.configuration, 'sites', `${id}.json`)), { code: 'ENOENT' })
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('only an identified Site record can be deleted through the protected transaction', async () => {
  const f = await fixture()
  try {
    const id = randomUUID()
    const file = path.join(f.roots.configuration, 'sites', `${id}.json`)
    await executeProtectedTransaction(tx([{ type: 'system-json', object: 'site', id, value: site(id) }]), f.roots, f.hosts)
    assert.throws(() => validateProtectedTransaction(tx([{ type: 'delete-site', id: 'vhostra-localhost' }]), f.roots, f.hosts), /Site deletion/)
    assert.throws(() => validateProtectedTransaction(tx([{ type: 'delete-site', id, path: f.hosts }]), f.roots, f.hosts), /Site deletion/)
    assert.deepEqual(await executeProtectedTransaction(tx([{ type: 'delete-site', id }]), f.roots, f.hosts), { completed: 1 })
    await assert.rejects(readFile(file), { code: 'ENOENT' })
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('one owned web configuration batch writes vhosts and can share authorization with Hosts', async () => {
  const f = await fixture()
  const marker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
  try {
    const id = randomUUID()
    const files = [
      { key: 'runtime/apache/vhostra.conf', contents: `${marker}<VirtualHost *:8088>\n</VirtualHost>\n` },
      { key: `runtime/openlitespeed/sites/${id}.conf`, contents: `${marker}docRoot /var/www/vhostra/${id}\n` },
      { key: 'generated/apache-vhosts.conf', contents: `${marker}preview\n` },
      { key: 'generated/runtime-selection.json', contents: JSON.stringify({ owner: 'vhostra', schemaVersion: 1, server: 'apache', phpVersion: '8.5', generatedAt: '2026-10-04T00:00:00.000Z' }) },
    ]
    const nextHosts = '127.0.0.1 localhost\n127.0.0.1 fixture.test\n'
    assert.deepEqual(await executeProtectedTransaction(tx([
      { type: 'generated-web-config', files },
      { type: 'hosts', expectedSha256: sha('127.0.0.1 localhost\n'), contents: nextHosts },
    ]), f.roots, f.hosts), { completed: 2 })
    for (const file of files) assert.equal(await readFile(path.join(f.roots.configuration, 'configuration', file.key), 'utf8'), file.contents)
    assert.equal(await readFile(f.hosts, 'utf8'), nextHosts)
    await writeFile(path.join(f.roots.configuration, 'configuration', 'runtime', 'apache', 'vhostra.conf'), 'user content')
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'generated-web-config', files }]), f.roots, f.hosts), /not Vhostra-owned/)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('generated web batch rejects traversal, duplicate destinations and linked parents', async () => {
  const f = await fixture()
  const marker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
  try {
    const valid = { key: 'runtime/nginx/default.conf', contents: `${marker}server {}\n` }
    for (const file of [
      { key: 'runtime/nginx/../../outside', contents: valid.contents },
      { key: 'runtime/mariadb/secrets.env', contents: valid.contents },
      { key: valid.key, contents: 'server {}\n' },
    ]) assert.throws(() => validateProtectedTransaction(tx([{ type: 'generated-web-config', files: [file] }]), f.roots, f.hosts), /Protected Vhostra transaction/)
    assert.throws(() => validateProtectedTransaction(tx([{ type: 'generated-web-config', files: [valid, valid] }]), f.roots, f.hosts), /duplicate destination/)
    assert.throws(() => validateProtectedTransaction(tx([{ type: 'generated-web-config', files: [{
      key: 'generated/runtime-selection.json', contents: JSON.stringify({ owner: 'vhostra', schemaVersion: 1, server: 'nginx', phpVersion: '8.5', generatedAt: '2026-10-04T00:00:00Z', password: 'must never persist' }),
    }] }]), f.roots, f.hosts), /runtime selection is invalid/)
    await mkdir(path.join(f.roots.configuration, 'configuration'))
    await symlink(f.dir, path.join(f.roots.configuration, 'configuration', 'runtime'))
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'generated-web-config', files: [valid] }]), f.roots, f.hosts), /symbolic link/)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('generated PHP policy replaces only the known legacy policy in one batch', async () => {
  const f = await fixture()
  const marker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
  try {
    const php = path.join(f.roots.configuration, 'configuration/runtime/php')
    await mkdir(php, { recursive: true })
    const legacy = 'expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\nmysqli.default_socket=/run/mysqld/mysqld.sock\npdo_mysql.default_socket=/run/mysqld/mysqld.sock\n'
    await writeFile(path.join(php, 'vhostra.ini'), legacy)
    const contents = marker + legacy
    assert.deepEqual(await executeProtectedTransaction(tx([{ type: 'generated-web-config', files: [
      { key: 'runtime/php/vhostra.ini', contents },
      { key: 'runtime/php/site-logrotate.conf', contents: `${marker} {\n  size 5M\n  rotate 3\n  copytruncate\n  missingok\n  notifempty\n  su root root\n}\n` },
    ] }]), f.roots, f.hosts), { completed: 1 })
    assert.equal(await readFile(path.join(php, 'vhostra.ini'), 'utf8'), contents)
    await writeFile(path.join(php, 'vhostra.ini'), 'user policy')
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'generated-web-config', files: [{ key: 'runtime/php/vhostra.ini', contents }] }]), f.roots, f.hosts), /not Vhostra-owned/)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('generated cleanup removes only an owned exact file and preserves unowned files', async () => {
  const f = await fixture()
  const marker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
  try {
    const dir = path.join(f.roots.configuration, 'configuration/generated')
    await mkdir(dir, { recursive: true })
    const ownedFile = path.join(dir, 'nginx-vhosts.conf')
    const userFile = path.join(dir, 'apache-vhosts.conf')
    await writeFile(ownedFile, `${marker}server {}\n`)
    await writeFile(userFile, 'user content')
    assert.deepEqual(await executeProtectedTransaction(tx([{ type: 'generated-web-config', files: [
      { key: 'generated/nginx-vhosts.conf', contents: null },
    ] }]), f.roots, f.hosts), { completed: 1 })
    await assert.rejects(readFile(ownedFile), { code: 'ENOENT' })
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'generated-web-config', files: [
      { key: 'generated/apache-vhosts.conf', contents: null },
    ] }]), f.roots, f.hosts), /not Vhostra-owned/)
    assert.equal(await readFile(userFile, 'utf8'), 'user content')
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('MariaDB policy transaction publishes separate private and allowlisted container files', async () => {
  const f = await fixture()
  try {
    const authoritative = path.join(f.roots.configuration, 'configuration/runtime/mariadb/vhostra.cnf')
    const runtime = path.join(f.roots.data, 'runtime-config/mariadb/vhostra.cnf')
    assert.deepEqual(await executeProtectedTransaction(tx([{ type: 'mariadb-runtime-config' }]), f.roots, f.hosts), { completed: 1 })
    assert.equal(await readFile(authoritative, 'utf8'), authoritativeMariaDbConfig)
    assert.equal(await readFile(runtime, 'utf8'), deriveMariaDbRuntimeConfig(authoritativeMariaDbConfig))
    assert.equal((await stat(authoritative)).mode & 0o777, 0o600)
    assert.equal((await stat(runtime)).mode & 0o777, 0o644)
    assert.doesNotMatch(await readFile(runtime, 'utf8'), /password|secret|!include|\[client\]/i)
    assert.throws(() => validateProtectedTransaction(tx([{ type: 'generated-web-config', files: [
      { key: 'runtime/mariadb/vhostra.cnf', contents: authoritativeMariaDbConfig },
    ] }]), f.roots, f.hosts), /not allowlisted/)
    assert.throws(() => validateProtectedTransaction(tx([{ type: 'mariadb-runtime-config', path: '/tmp/other' }]), f.roots, f.hosts), /unsupported fields/)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('MariaDB config parser rejects directives, sections, duplicates and secret-bearing changes', () => {
  for (const changed of [
    authoritativeMariaDbConfig.replace('max_connections=50', 'max_connections=50\n!include /private/etc/hosts'),
    authoritativeMariaDbConfig.replace('[mariadb]', '[client]'),
    authoritativeMariaDbConfig.replace('max_connections=50', 'max_connections=50\nmax_connections=50'),
    authoritativeMariaDbConfig.replace('max_connections=50', 'max_connections=50;password=hidden'),
    authoritativeMariaDbConfig.replace('log_error=/var/log/vhostra/mariadb.log', 'log_error=/tmp/other'),
  ]) assert.throws(() => parseAuthoritativeMariaDbConfig(changed), /Protected MariaDB configuration/)
})

test('MariaDB runtime publish rejects linked destinations and unknown authoritative source', async () => {
  const f = await fixture()
  try {
    const outside = path.join(f.dir, 'outside')
    await mkdir(outside)
    await mkdir(f.roots.data)
    await symlink(outside, path.join(f.roots.data, 'runtime-config'))
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'mariadb-runtime-config' }]), f.roots, f.hosts), /symbolic link/)
    await assert.rejects(readFile(path.join(f.roots.configuration, 'configuration/runtime/mariadb/vhostra.cnf')), { code: 'ENOENT' })
    await rm(path.join(f.roots.data, 'runtime-config'))
    const authoritative = path.join(f.roots.configuration, 'configuration/runtime/mariadb/vhostra.cnf')
    await mkdir(path.dirname(authoritative), { recursive: true })
    await writeFile(authoritative, '[mariadb]\n!include /tmp/other\n')
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'mariadb-runtime-config' }]), f.roots, f.hosts), /existing authoritative MariaDB configuration is unsupported/)
    await assert.rejects(readFile(path.join(f.roots.data, 'runtime-config/mariadb/vhostra.cnf')), { code: 'ENOENT' })
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

const webModel = () => ({ server: 'nginx', phpVersion: '8.3', httpsEnabled: false, sites: [
  { id: 'vhostra-localhost-vhost', hostname: 'localhost', aliases: [], builtIn: true, indexFiles: ['index.html'], rewriteEnabled: true },
  { id: '11111111-2222-4333-8444-555555555555', hostname: 'stage.local.test', aliases: ['www.stage.local.test'], builtIn: false, indexFiles: ['index.php', 'index.html'], rewriteEnabled: true },
] })

test('web runtime publication renders minimum per-service files from validated Site fields', async () => {
  const f = await fixture()
  const model = webModel()
  try {
    assert.deepEqual(await executeProtectedTransaction(tx([{ type: 'web-runtime-config', model }]), f.roots, f.hosts), { completed: 1 })
    for (const { key, body } of renderWebRuntimeFiles(model)) {
      const privateFile = path.join(f.roots.configuration, 'configuration', key)
      const publicFile = path.join(f.roots.data, 'runtime-config/web', key.slice('runtime/'.length))
      const source = authoritativeWebFile(body)
      assert.equal(await readFile(privateFile, 'utf8'), source)
      assert.equal(await readFile(publicFile, 'utf8'), runtimeWebFile(source))
      assert.equal((await stat(privateFile)).mode & 0o777, 0o600)
      assert.equal((await stat(publicFile)).mode & 0o777, 0o644)
      assert.doesNotMatch(await readFile(publicFile, 'utf8'), /password|secret|!include|IncludeOptional/i)
    }
    assert.match(await readFile(path.join(f.roots.data, 'runtime-config/web/nginx/default.conf'), 'utf8'), /server_name stage\.local\.test www\.stage\.local\.test/)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('web runtime publication rejects injected directives, paths, duplicates and links', async () => {
  const f = await fixture()
  try {
    for (const change of [
      model => { model.sites[1].hostname = 'stage.local.test\ninclude /etc/passwd' },
      model => { model.sites[1].id = '../../etc' },
      model => { model.sites[1].aliases = ['localhost'] },
      model => { model.sites[1].indexFiles = ['index.php; include /etc/passwd'] },
      model => { model.sites[1].container = '/private/etc' },
    ]) {
      const model = webModel(); change(model)
      assert.throws(() => validateProtectedTransaction(tx([{ type: 'web-runtime-config', model }]), f.roots, f.hosts), /unsupported field or value/)
    }
    const outside = path.join(f.dir, 'outside')
    await mkdir(outside)
    await mkdir(f.roots.data)
    await symlink(outside, path.join(f.roots.data, 'runtime-config'))
    await assert.rejects(executeProtectedTransaction(tx([{ type: 'web-runtime-config', model: webModel() }]), f.roots, f.hosts), /symbolic link/)
    await assert.rejects(readFile(path.join(f.roots.configuration, 'configuration/runtime/nginx/default.conf')), { code: 'ENOENT' })
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('web runtime publication removes only obsolete owned Site snippets', async () => {
  const f = await fixture()
  try {
    const original = webModel()
    await executeProtectedTransaction(tx([{ type: 'web-runtime-config', model: original }]), f.roots, f.hosts)
    const oldFile = path.join(f.roots.data, 'runtime-config/web/openlitespeed/sites', `${original.sites[1].id}.conf`)
    const next = webModel()
    next.sites.pop()
    await executeProtectedTransaction(tx([{ type: 'web-runtime-config', model: next }]), f.roots, f.hosts)
    await assert.rejects(readFile(oldFile), { code: 'ENOENT' })
    assert.equal((await stat(path.join(f.roots.data, 'runtime-config/web/openlitespeed/localhost.conf'))).mode & 0o777, 0o644)
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})

test('web runtime publication exposes only the selected frontend', async () => {
  const f = await fixture()
  try {
    const apache = { ...webModel(), server: 'apache' }
    await executeProtectedTransaction(tx([{ type: 'web-runtime-config', model: apache }]), f.roots, f.hosts)
    const apacheFile = path.join(f.roots.data, 'runtime-config/web/apache/vhostra.conf')
    const nginxFile = path.join(f.roots.data, 'runtime-config/web/nginx/default.conf')
    assert.ok(await readFile(apacheFile, 'utf8'))
    await assert.rejects(readFile(nginxFile), { code: 'ENOENT' })
    await executeProtectedTransaction(tx([{ type: 'web-runtime-config', model: webModel() }]), f.roots, f.hosts)
    await assert.rejects(readFile(apacheFile), { code: 'ENOENT' })
    assert.ok(await readFile(nginxFile, 'utf8'))
  } finally { await rm(f.dir, { recursive: true, force: true }) }
})
