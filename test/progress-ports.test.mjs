import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { redactProgress } from '../dist-electron/progress.js'

const controller = () => new DockerRuntimeController({ runtime: { apache: '/nonexistent/runtime/apache' } }, async () => ({ settings: { ports: {} } }))
test('occupied ports require exact managed project, service and structured binding', async () => {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const runtime = controller()
  let labels = { 'com.vhostra.managed': 'true', 'com.docker.compose.project': 'vhostra', 'com.docker.compose.service': 'runtime', 'com.docker.compose.project.working_dir': '/nonexistent/runtime' }
  runtime.docker = async args => args[0] === 'ps' ? 'container-id\n' : JSON.stringify([{ Config: { Labels: labels }, NetworkSettings: { Ports: { '8088/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] } } }])
  try {
    assert.deepEqual(await runtime.portConflicts([port], true), [])
    assert.equal((await runtime.portConflicts([port], false)).length, 1)
    assert.equal((await runtime.checkPort(port)).owner, 'Vhostra')
    for (const key of Object.keys(labels)) {
      const original = labels[key]; labels[key] = 'unrelated'
      assert.equal((await runtime.portConflicts([port], true)).length, 1)
      labels[key] = original
    }
    labels['com.docker.compose.project'] = 'vhostra-candidate-arbitrary'
    assert.equal(await runtime.vhostraOwnsPort(port), false)
    runtime.docker = async () => { throw Error('Docker unavailable') }
    assert.equal(await runtime.vhostraOwnsPort(port), false)
  } finally { runtime.dispose(); await new Promise(resolve => server.close(resolve)) }
})

test('progress exists only during real operation, bounded and sanitized before subscription', async () => {
  const runtime = controller(); const observed = []
  runtime.subscribe(() => observed.push(runtime.current()))
  runtime.secrets.add('generated-value')
  let release
  const pending = runtime.runExclusive('starting', 'Preparing runtime', async () => {
    runtime.appendProgress('-----BEGIN PRIVATE KEY-----')
    runtime.appendProgress('private-block-fragment')
    runtime.appendProgress('-----END PRIVATE KEY-----')
    runtime.appendProgress('MARIADB_ROOT_PASSWORD=generated-value\nAuthorization: Bearer sensitive\n✓ Ready')
    for (let index = 0; index < 400; index++) runtime.appendProgress(`stage ${index}`)
    await new Promise(resolve => { release = resolve })
    runtime.set({ state: 'running', message: 'Runtime ready', services: ['runtime'] })
  })
  while (!release) await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.current().progress.lines.length, 300)
  assert.doesNotMatch(JSON.stringify(observed), /generated-value|Bearer sensitive|private-block-fragment/)
  release(); await pending; await runtime.operation
  assert.equal(runtime.current().progress, undefined)
  assert.equal(runtime.current().state, 'running')
  await assert.rejects(runtime.runExclusive('starting', 'Checking', async () => { throw Error('password=private') }))
  await runtime.operation
  assert.equal(runtime.current().progress, undefined)
  assert.doesNotMatch(runtime.current().message, /private/)
  runtime.dispose()
})

test('redaction covers credentials, headers, URLs and private material', () => {
  const redacted = redactProgress('--password=secret token="abc def"\nAuthorization: Basic abc\nhttps://user:pw@host\n-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\nraw-secret', ['raw-secret'])
  assert.doesNotMatch(redacted, /secret|abc|user:pw|\nkey\n|raw-secret/)
})

test('running PHP catalog reports actual state rather than saved selections', async () => {
  const http = await import('node:http')
  const server = http.createServer((request, response) => { response.writeHead(200); response.end(request.url === '/vhostra-extension-state.php' ? JSON.stringify(['Zend OPcache', 'mysqli', 'pdo_mysql', 'ionCube Loader']) : 'opcache:0\n') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const state = { settings: { selectedPhpVersion: '8.3', ports: { http: server.address().port }, php: { extensions: ['apcu'], disabledExtensions: [], opcacheEnabled: true }, optionalServices: { redis: false, memcached: false } } }
  const runtime = new DockerRuntimeController({ runtime: { apache: '/nonexistent/runtime/apache' } }, async () => state)
  runtime.snapshot = { state: 'running', message: 'running', services: ['runtime'], updatedAt: '' }
  runtime.availablePhpPackages = async () => ['apcu', 'redis', 'memcached', 'opcache']
  runtime.installedPhpPackages = async () => ['opcache', 'redis', 'memcached']
  try {
    const catalog = await runtime.listPhpExtensions()
    const apcu = catalog.find(item => item.id === 'apcu')
    assert.equal(apcu.installed, false); assert.equal(apcu.enabled, false)
    const opcache = catalog.find(item => item.id === 'opcache')
    assert.equal(opcache.installed, true); assert.equal(opcache.enabled, false)
    assert.equal(catalog.find(item => item.id === 'redis').category, 'dependency-managed')
    assert.equal(catalog.find(item => item.id === 'mysql').required, true)
    assert.equal(catalog.find(item => item.id === 'mysql').enabled, true)
    assert.equal(catalog.find(item => item.id === 'pdo-mysql').required, true)
    assert.equal(catalog.find(item => item.id === 'pdo-mysql').enabled, true)
    assert.equal(catalog.some(item => item.id === 'pdo_mysql'), false)
    assert.equal(catalog.find(item => item.id === 'ioncube').enabled, true)
  } finally { runtime.dispose(); await new Promise(resolve => server.close(resolve)) }
})

test('extension removal refuses package plans that remove dependencies', async () => {
  const state = { settings: { selectedPhpVersion: '8.3' } }
  const runtime = new DockerRuntimeController({ runtime: { apache: '/nonexistent/runtime/apache' } }, async () => state)
  runtime.snapshot = { state: 'running', message: 'running', services: ['runtime'], updatedAt: '' }
  runtime.availablePhpPackages = async () => ['igbinary']
  let purged = false
  runtime.compose = async args => { if (args.at(-1).includes('--simulate')) return 'Remv lsphp83-igbinary\nRemv lsphp83-redis\n'; if (args.at(-1).includes('purge -y')) purged = true; return '' }
  await assert.rejects(runtime.managePhpExtension('igbinary', 'remove'), /other installed packages depend/)
  assert.equal(purged, false); await runtime.operation; runtime.dispose()
})
