// Isolated phpMyAdmin HTTP acceptance. Never uses the default Vhostra profile.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-pma-admin-'))
const scope = `vhostra-pma-admin-${process.pid}`
const inventory = () => execFileSync('docker', ['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}'], { encoding: 'utf8' }).split('\n').filter(row => row && !row.includes(scope)).sort()
const before = inventory()
const store = new VhostraStore(profile, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const database = `vhostra_pma_acceptance_${process.pid}`
let passed = false
try {
  const state = await store.getState()
  const ports = { ...state.settings.ports }
  for (const [index, key] of Object.keys(ports).entries()) ports[key] = await runtime.findAvailablePort(36180 + index * 100)
  await store.saveSettings({ ...state.settings, selectedWebServer: 'nginx', selectedPhpVersion: '8.4', ports })
  await runtime.start()
  const origin = `http://localhost:${ports.phpMyAdmin}/phpmyadmin/`
  const adminPassword = (await readFile(path.join(store.layout.runtime.mariaDb, 'secrets.env'), 'utf8')).match(/^VHOSTRA_PMA_PASSWORD=(.+)$/m)?.[1]
  assert.ok(adminPassword, 'dedicated phpMyAdmin secret exists locally')
  let cookie = ''
  const request = async (route, options = {}) => {
    const response = await fetch(new URL(`index.php?route=${encodeURIComponent(route.split('&')[0])}${route.includes('&') ? "&" + route.split('&').slice(1).join('&') : ""}&lang=en`, origin), { ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers }, redirect: 'manual' })
    const next = response.headers.get('set-cookie')?.split(';')[0]
    if (next) cookie = next
    return { response, body: await response.text() }
  }
  const token = html => { const value = html.match(/name="token" value="([^"]+)"/); assert.ok(value, 'CSRF token present'); return value[1].replaceAll('&amp;', '&') }
  const submit = async (route, body) => request(route, { method: 'POST', body })
  const home = await request('/server/databases')
  assert.equal(home.response.status, 200)
  assert.doesNotMatch(home.body, /name="pma_username"/)
  assert.ok(!home.body.includes(adminPassword) && !origin.includes(adminPassword), 'admin password does not appear in the phpMyAdmin page or URL')
  const creation = new URLSearchParams({ token: token(home.body), new_db: database, ajax_request: '1', reload: '1', db_collation: 'utf8mb4_general_ci', lang: 'en' })
  const created = await submit('/server/databases/create', creation)
  assert.ok([200, 302, 303].includes(created.response.status), 'phpMyAdmin create response')
  if (!(await runtime.listDatabases()).includes(database)) console.error('Create response:', created.response.status, created.response.headers.get('location'), created.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,100}(?:error|denied|invalid|create database|database exists|vhostra_pma_acceptance).{0,160}/gi)?.slice(0, 12))
  assert.ok((await runtime.listDatabases()).includes(database), 'phpMyAdmin created a real database')
  const sql = statement => runtime.databaseCompose(['exec', '-T', 'mariadb', 'mariadb', '-uroot', '-N', '-e', statement])
  const uploadSql = async statement => {
    const importedPage = await request(`/database/import&db=${database}`)
    assert.equal(importedPage.response.status, 200)
    assert.match(importedPage.body, /name="MAX_FILE_SIZE" value="67108864"/, 'phpMyAdmin advertises the 64 MiB SQL upload limit')
    const upload = new FormData()
    upload.set('token', token(importedPage.body))
    upload.set('import_type', 'database')
    upload.set('db', database)
    upload.set('lang', 'en')
    upload.set('format', 'sql')
    upload.set('charset_of_file', 'utf-8')
    upload.set('import_file', new File([statement], 'probe.sql', { type: 'application/sql' }))
    const result = await submit('/import', upload)
    assert.ok([200, 302, 303].includes(result.response.status), 'phpMyAdmin SQL upload response')
  }
  await uploadSql("CREATE TABLE imported_probe (id INT PRIMARY KEY, note VARCHAR(20)); INSERT INTO imported_probe VALUES (1, 'ready');")
  assert.equal((await sql(`SELECT note FROM \`${database}\`.imported_probe WHERE id=1`)).trim(), 'ready')
  const browse = await request(`/database/structure&db=${database}`)
  assert.equal(browse.response.status, 200)
  assert.match(browse.body, /imported_probe/)
  await uploadSql('ALTER TABLE imported_probe ADD COLUMN more INT DEFAULT 2;')
  assert.equal((await sql(`SELECT more FROM \`${database}\`.imported_probe WHERE id=1`)).trim(), '2')
  const exportPage = await request(`/database/export&db=${database}`)
  assert.equal(exportPage.response.status, 200)
  const exported = await submit('/export', new URLSearchParams({
    token: token(exportPage.body), db: database, export_type: 'database',
    quick_or_custom: 'quick', what: 'sql', output_format: 'sendit',
    filename_template: '@DATABASE@', 'table_select[]': 'imported_probe',
    'table_structure[]': 'imported_probe', 'table_data[]': 'imported_probe',
    sql_structure_or_data: 'structure_and_data', sql_create_table: '1',
  }))
  assert.equal(exported.response.status, 200, 'phpMyAdmin SQL export response')
  assert.ok(/CREATE TABLE[^;]*imported_probe/i.test(exported.body), 'export contains the imported table')
  assert.ok(/ready/.test(exported.body), 'export contains the imported row')
  assert.ok(!exported.body.includes(adminPassword), 'admin password does not appear in SQL export')
  const user = `pma_acceptance_${process.pid}`
  await uploadSql(`CREATE USER '${user}'@'localhost' IDENTIFIED BY 'isolated-pma-test-password'; GRANT SELECT ON \`${database}\`.* TO '${user}'@'localhost';`)
  assert.equal((await sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${user}' AND Host='localhost'`)).trim(), '1')
  assert.equal((await sql(`SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE="'${user}'@'localhost'" AND TABLE_SCHEMA='${database}' AND PRIVILEGE_TYPE='SELECT'`)).trim(), '1')
  await uploadSql(`GRANT INSERT ON \`${database}\`.* TO '${user}'@'localhost';`)
  assert.equal((await sql(`SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE="'${user}'@'localhost'" AND TABLE_SCHEMA='${database}' AND PRIVILEGE_TYPE='INSERT'`)).trim(), '1')
  await uploadSql(`DROP USER '${user}'@'localhost'; DROP TABLE imported_probe;`)
  assert.equal((await sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${user}' AND Host='localhost'`)).trim(), '0')
  assert.equal((await sql(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='imported_probe'`)).trim(), '0')
  const dropPage = await request('/server/databases')
  const drop = await submit('/server/databases/destroy', new URLSearchParams({ token: token(dropPage.body), ajax_request: '1', 'selected_dbs[0]': database }))
  assert.equal(drop.response.status, 200)
  assert.ok(!(await runtime.listDatabases()).includes(database), 'phpMyAdmin dropped only the isolated database')
  console.log('PASS phpMyAdmin auto-auth, create/import/export/browse/alter/drop tables, isolated user grants and deletion, database drop')
  passed = true
} finally {
  await runtime.resetRuntime(false).catch(error => console.error('Scoped cleanup failed:', error.message))
  runtime.dispose()
  assert.deepEqual(inventory(), before)
  if (passed) await rm(profile, { recursive: true, force: true })
  else console.error('Retained isolated fixture:', profile)
}
