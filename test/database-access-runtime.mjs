// Sequential, isolated acceptance. Never operates the real Vhostra profile.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, chmod, copyFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-persistent-'))
const project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-wp-localhost-'))
const scope = `vhostra-database-access-${process.pid}`
const store = new VhostraStore(profile, path.resolve('dist-welcome'))
let runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 })
const unrelated = () => docker(['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(line => line && !line.includes(scope)).sort()
const original = unrelated()
const cli = (...args) => execFileSync(process.execPath, ['scripts/vhostra.mjs', ...args], { env: { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope }, encoding: 'utf8', timeout: 180000 })
const sql = statement => runtime.databaseCompose(['exec', '-T', 'mariadb', 'mariadb', '-uroot', '-N', '-e', statement])
const request = (resource = '/probe.php') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: 32180, path: resource, headers: { Host: 'wordpress.test:32180' }, timeout: 15000 }, response => {
    let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve({ status: response.statusCode, text }));
  }).on('error', reject)
})
let succeeded = false
let last = ''
const subscribe = () => runtime.subscribe(() => { const message = runtime.current().message; if (message !== last) { console.log(message); last = message } })
subscribe()
try {
  console.log(`Fixture profile: ${profile}; scope: ${scope}`)
  const { settings } = await store.getState()
  settings.selectedPhpVersion = '8.4'; settings.selectedWebServer = 'nginx'
  settings.ports = { http: 32180, https: 32443, phpMyAdmin: 32181, mariadb: 32306, redis: 32379, memcached: 32211 }
  settings.php.extensions = ['apcu', 'intl']; settings.php.opcacheEnabled = false
  settings.optionalServices = { redis: true, memcached: true }
  await store.saveSettings(settings)
  await chmod(project, 0o755)
  await writeFile(path.join(project, 'sentinel'), 'external files retained')
  await store.addSite({ name: 'Imported WordPress', url: 'http://wordpress.test:32180/', documentRoot: project, aliases: ['www.wordpress.test'] })
  // Official WordPress source downloaded once into this disposable test fixture.
  if (process.env.VHOSTRA_TEST_WP_ARCHIVE) await copyFile(process.env.VHOSTRA_TEST_WP_ARCHIVE, path.join(profile,'wordpress.tgz'));
  else execFileSync('curl', ['-fsSL', '--max-time', '90', '--retry', '2', '-o', path.join(profile, 'wordpress.tgz'), 'https://wordpress.org/wordpress-6.8.3.tar.gz'], { timeout: 120000 })
  execFileSync('tar', ['-xzf', path.join(profile, 'wordpress.tgz'), '--strip-components=1', '-C', project])
  await writeFile(path.join(project, 'wp-config.php'), `<?php
  define('DB_NAME','wp_fixture'); define('DB_USER','wp_fixture_user'); define('DB_PASSWORD','isolated-fixture-password'); define('DB_HOST','localhost');
  define('DB_CHARSET','utf8mb4'); define('DB_COLLATE',''); define('WP_HOME','http://wordpress.test:32180'); define('WP_SITEURL','http://wordpress.test:32180');
  define('DISABLE_WP_CRON',true); define('WP_HTTP_BLOCK_EXTERNAL',true); $table_prefix='wp_';
  define('AUTH_KEY','isolated-test-auth-key'); define('SECURE_AUTH_KEY','isolated-test-secure-auth');
  define('LOGGED_IN_KEY','isolated-test-logged-in'); define('NONCE_KEY','isolated-test-nonce');
  define('ABSPATH', __DIR__ . '/'); require_once ABSPATH . 'wp-settings.php';`)
  await writeFile(path.join(project, 'probe.php'), `<?php
  define('DB_HOST','localhost');
  foreach (['localhost','127.0.0.1','localhost:3306'] as $host) {
    $parts=explode(':',$host); $db=new mysqli($parts[0],'wp_fixture_user','isolated-fixture-password','wp_fixture',3306);
    echo $host . ':mysqli:' . $db->query("SELECT value FROM identity_probe WHERE id=1")->fetch_row()[0] . "\\n";
  }
  foreach (['localhost','127.0.0.1'] as $host) {
    $db=new PDO("mysql:host=$host;port=3306;dbname=wp_fixture",'wp_fixture_user','isolated-fixture-password');
    echo $host . ':pdo:' . $db->query("SELECT value FROM identity_probe WHERE id=1")->fetchColumn() . "\\n";
  }
  echo 'redis:' . (new Redis())->connect('localhost',${settings.ports.redis}) . "\\n";
  $cache=new Memcached(); $cache->addServer('localhost',${settings.ports.memcached}); $cache->set('fixture','ok'); echo 'memcached:' . $cache->get('fixture');`)
  await runtime.controlManagedService('mariadb', 'start')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'mariadb').state, 'running')
  assert.equal((await runtime.listManagedServices()).find(row => row.id === 'web').state, 'stopped')
  await runtime.start()
  await runtime.createDatabase({ name: 'wp_fixture', charset: 'utf8mb4', username: 'wp_fixture_user', password: 'isolated-fixture-password' })
  assert.ok((await runtime.listDatabases()).includes('wp_fixture'))
  const originalAccount = (await runtime.backupAccounts()).find(row=>row.user==='wp_fixture_user')
  await assert.rejects(runtime.createDatabase({ name:'duplicate_attempt',charset:'utf8mb4',username:'wp_fixture_user',host:'localhost',password:'isolated-fixture-password' }),/already exists/)
  assert.ok(!(await runtime.listDatabases()).includes('duplicate_attempt'))
  await assert.rejects(runtime.createDatabase({name:'upper_host_duplicate',charset:'utf8mb4',username:'wp_fixture_user',host:'LOCALHOST',password:'isolated-fixture-password'}),/already exists/)
  await assert.rejects(runtime.createDatabase({ name:'wp_fixture',charset:'utf8mb4',username:'new_user',password:'isolated-fixture-password' }),/Database already exists/)
  await runtime.createDatabase({name:'selected_account_db',charset:'utf8mb4',username:'wp_fixture_user',host:'localhost',existingUser:true,password:'isolated-fixture-password'})
  assert.ok((await runtime.backupAccounts()).find(row=>row.user==='wp_fixture_user').create===originalAccount.create,'Existing password was changed')
  await sql("CREATE USER 'wp_fixture_user'@'%' IDENTIFIED BY 'isolated-wildcard-password';")
  const users=await runtime.listDatabaseUsers();assert.ok(users.some(row=>row.username==='wp_fixture_user'&&row.host==='localhost'));assert.ok(users.some(row=>row.username==='wp_fixture_user'&&row.host==='%'));assert.ok(!users.some(row=>['root','mysql','mariadb.sys','vhostra_pma'].includes(row.username)));assert.doesNotMatch(JSON.stringify(users),/isolated-fixture-password|authentication_string/)
  await assert.rejects(runtime.createDatabase({name:'shadow_account_db',charset:'utf8mb4',username:'wp_fixture_user',host:'%',existingUser:true,password:'isolated-wildcard-password'}),/could not connect/)
  await assert.rejects(runtime.checkDatabaseAccess({username:'wp_fixture_user',host:'localhost',password:'incorrect-password',database:'wp_fixture'}),/1045/)
  await assert.rejects(runtime.checkDatabaseAccess({username:'missing_user',host:'localhost',password:'incorrect-password',database:'wp_fixture'}),/1045/)
  await sql("CREATE USER 'no_grants'@'localhost' IDENTIFIED BY 'isolated-no-grant-password';")
  await assert.rejects(runtime.checkDatabaseAccess({username:'no_grants',host:'localhost',password:'isolated-no-grant-password',database:'wp_fixture'}),/1044/)
  await runtime.updateDatabaseAccess({username:'no_grants',host:'localhost',password:'isolated-no-grant-password',database:'selected_account_db'})
  await runtime.updateDatabaseAccess({username:'no_grants',host:'localhost',password:'explicit-reset-password',database:'selected_account_db',resetPassword:true})
  await assert.rejects(runtime.checkDatabaseAccess({username:'no_grants',host:'localhost',password:'isolated-no-grant-password',database:'selected_account_db'}),/1045/)
  // Prove database underscore grants do not include a similarly named database.
  await sql('CREATE DATABASE selectedXaccountXdb;')
  await assert.rejects(runtime.checkDatabaseAccess({username:'no_grants',host:'localhost',password:'explicit-reset-password',database:'selectedXaccountXdb'}),/1044/)
  const specialPassword="isolated-quote'back\\slash;secret"
  await runtime.createDatabase({name:'special_password_db',charset:'utf8mb4',username:'special_password_user',host:'localhost',password:specialPassword})
  await runtime.checkDatabaseAccess({username:'special_password_user',host:'localhost',password:specialPassword,database:'special_password_db'})
  console.log('PASS password containing quote/backslash authenticates without SQL injection or altered credential')
  // Failure after grants must preserve pre-existing privileges and authentication.
  await sql("GRANT SELECT ON `future\\_db`.* TO 'wp_fixture_user'@'localhost';")
  const savedAccounts=await runtime.backupAccounts()
  const check=runtime.checkDatabaseAccess.bind(runtime)
  runtime.checkDatabaseAccess=async input=>{if(input.verifyWrites)throw Error('Injected connectivity validation failure');return check(input)}
  await assert.rejects(runtime.createDatabase({name:'future_db',charset:'utf8mb4',username:'wp_fixture_user',host:'localhost',existingUser:true,password:'isolated-fixture-password'}),/Injected/)
  assert.ok(!(await runtime.listDatabases()).includes('future_db'))
  await assert.rejects(runtime.updateDatabaseAccess({username:'no_grants',host:'localhost',database:'wp_fixture',password:'reset-that-must-roll-back',resetPassword:true}),/Injected/)
  runtime.checkDatabaseAccess=check
  const recoveredAccounts=await runtime.backupAccounts()
  for(const username of ['wp_fixture_user','no_grants']) assert.ok(JSON.stringify(recoveredAccounts.find(row=>row.user===username&&row.host==='localhost'))===JSON.stringify(savedAccounts.find(row=>row.user===username&&row.host==='localhost')),'Account authentication or grants were not restored')
  await check({username:'no_grants',host:'localhost',database:'selected_account_db',password:'explicit-reset-password'})
  console.log('PASS actual failed validation restores only newly added grants/password and preserves existing future-database grants')
  console.log('PASS actual exact duplicate preflight, distinct hosts, existing-account/password preservation, missing grant, wrong credentials, explicit reset, escaped database grant scope')
  // Force localhost-only authentication: no network-host grant substitutions.
  await sql("CREATE ROLE fixture_reader; GRANT SELECT ON wp_fixture.* TO fixture_reader; GRANT fixture_reader TO 'wp_fixture_user'@'localhost'; SET DEFAULT ROLE fixture_reader FOR 'wp_fixture_user'@'localhost';")
  await runtime.start()
  const host = (await store.getState()).virtualHosts.find(host => host.hostname === 'wordpress.test')
  const wpInstall = `define('WP_INSTALLING', true); $_SERVER['HTTP_HOST']='wordpress.test:32180'; $_SERVER['REQUEST_METHOD']='GET'; require '/var/www/vhostra/${host.id}/wp-load.php'; require '/var/www/vhostra/${host.id}/wp-admin/includes/upgrade.php'; wp_install('Vhostra Localhost Import', 'fixture_admin', 'fixture@example.invalid', false, '', 'isolated-wp-admin-password'); echo 'wordpress-installed';`
  await writeFile(path.join(project, 'install-fixture.php'), '<?php ' + wpInstall);
  assert.match(docker(['exec', `${scope}-runtime-1`, '/usr/local/lsws/lsphp84/bin/lsphp', '-q', `/var/www/vhostra/${host.id}/install-fixture.php`]), /wordpress-installed/);
  await rm(path.join(project, 'install-fixture.php'))
  await sql("USE wp_fixture; CREATE TABLE identity_probe (id INT PRIMARY KEY, value VARCHAR(32)); INSERT INTO identity_probe VALUES (1,'preserved');")
  const dump = path.join(profile, 'wordpress.sql')
  await runtime.exportDatabase('wp_fixture', dump)
  await sql('DROP DATABASE wp_fixture; CREATE DATABASE wp_fixture;')
  assert.equal((await runtime.importDatabase('wp_fixture', dump)).database, 'wp_fixture')
  const invalid = path.join(profile, 'bad.sql'); await writeFile(invalid, 'THIS IS NOT VALID SQL;')
  await assert.rejects(runtime.importDatabase('wp_fixture', invalid), /ERROR|syntax/i); await runtime.refresh()
  const identity = await sql("SELECT user,host,is_role FROM mysql.user WHERE user IN ('wp_fixture_user','fixture_reader'); SHOW GRANTS FOR 'wp_fixture_user'@'localhost'; SHOW GRANTS FOR fixture_reader; SELECT value FROM wp_fixture.identity_probe;")
  const containerId = docker(['inspect', `${scope}-mariadb`, '--format', '{{.Id}}'])
  const dbConfig = await readFile(path.join(store.layout.runtime.mariaDb, 'vhostra.cnf'), 'utf8')
  const definitions = JSON.stringify((await store.getState()).virtualHosts)
  const verify = async label => {
    const response = await request(); assert.equal(response.status, 200, response.text)
    for (const token of ['localhost:mysqli:preserved', '127.0.0.1:mysqli:preserved', 'localhost:3306:mysqli:preserved', 'localhost:pdo:preserved', '127.0.0.1:pdo:preserved', 'redis:1', 'memcached:ok']) assert.ok(response.text.includes(token), `${label}: ${token}: ${response.text}`)
    const wordpress = await request('/'); assert.equal(wordpress.status, 200, wordpress.text.slice(0,500)); assert.match(wordpress.text, /Vhostra Localhost Import/); assert.doesNotMatch(wordpress.text, /Error establishing a database connection/)
    assert.ok(await sql("SELECT user,host,is_role FROM mysql.user WHERE user IN ('wp_fixture_user','fixture_reader'); SHOW GRANTS FOR 'wp_fixture_user'@'localhost'; SHOW GRANTS FOR fixture_reader; SELECT value FROM wp_fixture.identity_probe;") === identity, 'Account grants or identity changed')
    assert.equal(docker(['inspect', `${scope}-mariadb`, '--format', '{{.Id}}']), containerId)
    assert.equal(await readFile(path.join(store.layout.runtime.mariaDb, 'vhostra.cnf'), 'utf8'), dbConfig)
    assert.equal(JSON.stringify((await store.getState()).virtualHosts), definitions)
    assert.equal(await readFile(path.join(project,'sentinel'),'utf8'), 'external files retained')
    const pma = await fetch(`http://localhost:32181/phpmyadmin/index.php?route=/server/databases`); const html=await pma.text(); assert.equal(pma.status,200); assert.match(html,/wp_fixture/)
    assert.ok((await runtime.listPhpExtensions()).find(row=>row.id==='intl').enabled)
    console.log(`PASS ${label}: actual imported WordPress, mysqli/PDO both hosts, user/role/grants/data/container identity, phpMyAdmin, caches and extensions`)
  }
  await verify('initial imported database')
  succeeded=true
} finally {
  await runtime.resetRuntime(false).catch(error=>console.error('Scoped fixture cleanup:',error.message)); runtime.dispose()
  if (succeeded) { await rm(profile,{recursive:true,force:true}); await rm(project,{recursive:true,force:true}) }
  else console.error(`Retained failure fixture: ${profile}; external root: ${project}`)
  assert.deepEqual(unrelated(),original)
}
