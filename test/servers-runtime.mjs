// Opt-in selected-server acceptance test; never uses the live Vhostra project.
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import https from 'node:https'
const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
const close = server => new Promise(resolve => server.close(resolve))
const tlsProbe = port => new Promise((resolve, reject) => {
  https.get({ host: '127.0.0.1', port, path: '/vhostra-health.php', headers: { Host: 'localhost' }, rejectUnauthorized: false }, response => {
    let body = ''; response.on('data', chunk => { body += chunk }); response.on('end', () => resolve({ status: response.statusCode, body }));
  }).on('error', reject);
})
const fetchHost = (url, options) => new Promise((resolve, reject) => {
  const request = http.get(url, options, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: async () => body }));
  }); request.on('error', reject);
})
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-servers-'))
const siteRoot = await mkdtemp(path.join(os.tmpdir(), 'vhostra-permalinks-'))
const scope = `vhostra-servers-${process.pid}`
const store = new VhostraStore(root)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
let lastMessage = ''
let streamedLines = 0
runtime.subscribe(() => {
  const snapshot = runtime.current()
  if (snapshot.message !== lastMessage) { lastMessage = snapshot.message; console.log(snapshot.message) }
  if (snapshot.progress) {
    streamedLines = Math.max(streamedLines, snapshot.progress.total)
    assert.doesNotMatch(snapshot.progress.lines.join('\n'), /(?:MARIADB_ROOT_PASSWORD|VHOSTRA_PMA_PASSWORD|VHOSTRA_PMA_BLOWFISH_SECRET)=[^*\s]/)
  }
})
let httpsOwner
try {
  const { settings } = await store.getState()
  settings.selectedPhpVersion = '8.3'
  settings.ports = { http: 29180, https: 29443, phpMyAdmin: 29181, mariadb: 29306, redis: 29379, memcached: 29211 }
  await store.saveSettings(settings)
  await chmod(siteRoot, 0o755)
  await writeFile(path.join(siteRoot, 'index.php'), '<?php echo "permalink:" . $_SERVER["REQUEST_URI"] . ":php:" . PHP_VERSION;')
  await writeFile(path.join(siteRoot, '.htaccess'), 'RewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteRule . /index.php [L]\n')
  await store.addSite({ name: 'Permalink probe', documentRoot: siteRoot, url: 'http://permalink.test:29180/' })
  const requiredOwner = net.createServer(socket => socket.destroy())
  await listen(requiredOwner, settings.ports.http)
  try { await assert.rejects(runtime.start(), /cannot bind required host ports/) }
  finally { await close(requiredOwner) }
  httpsOwner = net.createServer(socket => socket.destroy())
  await listen(httpsOwner, settings.ports.https)
  for (const server of ['openlitespeed', 'apache', 'nginx']) {
    const current = await store.getState()
    await store.saveSettings({ ...current.settings, selectedWebServer: server })
    if (server === 'openlitespeed') {
      await runtime.start()
      await runtime.start() // Already-running owned ports must remain valid for Start.
      assert.equal(runtime.current().progress, undefined)
      assert.ok(streamedLines > 5, 'Actual Docker/stage output must have streamed')
      assert.match(runtime.current().message, /HTTPS is unavailable/)
      assert.ok(httpsOwner.listening, 'HTTPS owner must be preserved')
      await close(httpsOwner)
      await runtime.restart()
      await runtime.createDatabase({ name: 'server_probe', charset: 'utf8mb4', username: 'server_probe_user', password: 'server-probe-test-password' })
    } else await runtime.restart()
    const tls = await tlsProbe(settings.ports.https)
    assert.equal(tls.status, 200)
    assert.match(tls.body, /vhostra-lsphp:8\.3/)
    assert.doesNotMatch(runtime.current().message, /HTTPS is unavailable/)
    const response = await fetchHost('http://127.0.0.1:29180/article/example?probe=1', { headers: { Host: 'permalink.test' } })
    const html = await response.text()
    if (response.status !== 200) {
      console.log('Direct PHP:', await (await fetchHost('http://127.0.0.1:29180/index.php', { headers: { Host: 'permalink.test' } })).text())
      console.log(execFileSync('docker', ['exec', `${scope}-runtime-1`, 'sh', '-lc', 'cat /etc/vhostra/openlitespeed/vhostra-maps.conf; cat /etc/vhostra/openlitespeed/sites/*.conf; head -90 /usr/local/lsws/logs/error.log; grep -A10 listener /usr/local/lsws/conf/httpd_config.conf; ls -ld /var/www/vhostra/*; cat /var/www/vhostra/*/index.php']).toString())
    }
    assert.equal(response.status, 200, `${server}: ${html}`)
    assert.match(html, /permalink:.*php:8\.3/)
    const processName = server === 'openlitespeed' ? 'openlitespeed' : server === 'apache' ? 'apache2' : 'nginx'
    execFileSync('docker', ['exec', `${scope}-runtime-1`, 'pgrep', '-x', processName])
    console.log(`${server} selected listener, PHP, phpMyAdmin, and permalink routing passed.`)
  }
  const phpBefore = await store.getState()
  await store.saveSettings({ ...phpBefore.settings, selectedPhpVersion: '8.4' })
  await runtime.restart()
  const phpResponse = await fetchHost('http://127.0.0.1:29180/vhostra-health.php', { headers: { Host: 'localhost' } })
  assert.match(await phpResponse.text(), /vhostra-lsphp:8\.4/)
  assert.ok((await runtime.listDatabases()).includes('server_probe'))
  console.log('PHP 8.3 to 8.4 candidate promotion preserved the existing database.')
  const cliEnvironment = { ...process.env, VHOSTRA_USER_DATA: root, VHOSTRA_RUNTIME_PROJECT: scope }
  for (const id of ['redis', 'memcached']) {
    execFileSync(process.execPath, ['scripts/vhostra.mjs', 'service', id, 'enable'], { env: cliEnvironment })
    await runtime.refresh()
    assert.equal((await runtime.listManagedServices()).find(service => service.id === id).state, 'running')
    assert.equal((await runtime.controlManagedService(id, 'stop')).find(service => service.id === id).state, 'stopped')
    assert.equal((await runtime.controlManagedService(id, 'start')).find(service => service.id === id).state, 'running')
    execFileSync(process.execPath, ['scripts/vhostra.mjs', 'service', id, 'restart'], { env: cliEnvironment })
    execFileSync(process.execPath, ['scripts/vhostra.mjs', 'service', id, 'disable'], { env: cliEnvironment })
    assert.equal((await store.getState()).settings.optionalServices[id], false)
    console.log(`${id} CLI enable/restart/disable and shared controller stop/start passed.`)
  }
  const before = await store.getState()
  const health = runtime.healthCheck.bind(runtime)
  runtime.healthCheck = async (server, verified) => {
    if (server === 'apache' && !verified) throw new Error('Injected final promotion health failure')
    return health(server, verified)
  }
  await store.saveSettings({ ...before.settings, selectedWebServer: 'apache' })
  await assert.rejects(runtime.restart(), /rolled back/)
  await store.saveSettings(before.settings)
  runtime.healthCheck = health
  assert.equal((await fetchHost('http://127.0.0.1:29180/vhostra-health.php', { headers: { Host: 'localhost' } })).status, 200)
  execFileSync('docker', ['exec', `${scope}-runtime-1`, 'pgrep', '-x', 'nginx'])
  console.log('Candidate promotion health failure restored the prior Nginx runtime.')
} finally {
  runtime.dispose()
  if (httpsOwner?.listening) await close(httpsOwner)
  const runtimeRoot = path.dirname(store.layout.runtime.apache)
  try { execFileSync('docker', ['compose', '-p', scope, '--project-directory', runtimeRoot, '--env-file', path.join(runtimeRoot, '.env'), '-f', path.join(runtimeRoot, 'compose.yml'), 'down'], { stdio: 'inherit' }) }
  finally { await Promise.all([root, siteRoot].map(directory => rm(directory, { recursive: true, force: true }))) }
}
