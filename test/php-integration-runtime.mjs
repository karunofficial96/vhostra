// Opt-in sequential live PHP integration acceptance; all data is temporary.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-php-integration-'))
const scope = `vhostra-php-integration-${process.pid}`
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
let passed = false
try {
  const state = await store.getState()
  await store.saveSettings({ ...state.settings, selectedPhpVersion: '8.3', optionalServices: { redis: true, memcached: true }, ports: { http: 29680, https: 29643, phpMyAdmin: 29681, mariadb: 29606, redis: 29679, memcached: 29611 } })
  await runtime.start()
  await runtime.createDatabase({ name: 'php_integration', charset: 'utf8mb4', username: 'php_probe', password: 'isolated-probe-password' })
  const script = `<?php
header('Content-Type: text/plain');
echo 'sapi:' . PHP_SAPI . ':version:' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . "\\n";
foreach (['localhost','127.0.0.1'] as $host) {
  $mysqli = new mysqli($host, 'php_probe', 'isolated-probe-password', 'php_integration', 3306);
  echo 'mysqli:' . $host . ':' . $mysqli->query('SELECT 1')->fetch_row()[0] . "\\n";
  $pdo = new PDO('mysql:host=' . $host . ';port=3306;dbname=php_integration', 'php_probe', 'isolated-probe-password');
  echo 'pdo:' . $host . ':' . $pdo->query('SELECT 1')->fetchColumn() . "\\n";
  $redis = new Redis(); $redis->connect($host, 29679, 2); echo 'redis:' . $host . ':' . ($redis->ping() ? 'ok' : 'failed') . "\\n"; $redis->close();
  $memcached = new Memcached(); $memcached->setOption(Memcached::OPT_CONNECT_TIMEOUT, 2000); $memcached->addServer($host, 29611);
  echo 'memcached:' . $host . ':' . ($memcached->getVersion() ? 'ok' : 'failed') . "\\n"; $memcached->quit();
}
`;
  await writeFile(path.join(store.layout.sites, 'localhost', 'public', 'integration.php'), script)
  for (const server of ['openlitespeed', 'apache', 'nginx']) {
    if (server !== 'openlitespeed') {
      const next = await store.getState()
      await store.saveSettings({ ...next.settings, selectedWebServer: server })
      await runtime.restart()
    }
    const response = await fetch('http://127.0.0.1:29680/integration.php', { headers: { Host: 'localhost' } })
    assert.equal(response.status, 200, server)
    const body = await response.text()
    assert.match(body, new RegExp(`sapi:${server === 'openlitespeed' ? 'litespeed' : 'fpm-fcgi'}:version:8\\.3`), `${server}: ${body}`)
    for (const driver of ['mysqli', 'pdo', 'redis', 'memcached']) for (const host of ['localhost', '127.0.0.1'])
      assert.match(body, new RegExp(`${driver}:${host.replaceAll('.', '\\.')}:(?:1|ok)`), `${server} ${driver} ${host}: ${body}`)
    console.log(`${server}: HTTP PHP 8.3, mysqli/PDO, Redis/Memcached via localhost and 127.0.0.1 passed.`)
  }
  passed = true
} finally {
  try { await runtime.resetRuntime(false) } catch (error) { console.error('Exact fixture cleanup failed:', error); passed = false }
  runtime.dispose()
  await rm(profile, { recursive: true, force: true })
}
