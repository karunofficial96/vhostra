import assert from 'node:assert/strict'
import test from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController, singleRuntimeComposeYaml } from '../dist-electron/runtime.js'
import { machineGenerationFixture, id } from './machine-generation-fixture.mjs'

const missing = async file => assert.rejects(stat(file), { code: 'ENOENT' })

test('legacy database secrets have one Compose source and stale phpMyAdmin copies fail closed', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-secret-boundary-'))
  const store = new VhostraStore(profile)
  const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, 'vhostra-secret-boundary')
  try {
    await runtime.generate(await store.getState())
    const canonical = path.join(store.layout.runtime.mariaDb, 'secrets.env')
    const legacy = path.join(store.layout.root, 'runtime/.env')
    const original = await readFile(canonical, 'utf8')
    assert.equal(runtime.environmentFile, canonical)
    assert.equal((await stat(canonical)).mode & 0o777, 0o600)
    await missing(legacy)
    assert.equal(runtime.composeArguments(['config'])[6], canonical)
    await writeFile(legacy, 'VHOSTRA_PMA_PASSWORD=stale-password\n', { mode: 0o600 })
    await assert.rejects(runtime.ensureEnvironment(), /conflicts with authoritative/)
    assert.equal(await readFile(canonical, 'utf8'), original)
    assert.equal(await readFile(legacy, 'utf8'), 'VHOSTRA_PMA_PASSWORD=stale-password\n')
    const password = original.match(/^VHOSTRA_PMA_PASSWORD=(.+)$/m)?.[1]
    await writeFile(legacy, `VHOSTRA_PMA_PASSWORD=${password}\n`, { mode: 0o600 })
    await runtime.ensureEnvironment()
    await missing(legacy)
    const rootProjection = path.join(store.layout.runtime.mariaDb, 'root-password')
    await writeFile(rootProjection, 'stale-projection')
    await assert.rejects(runtime.prepareDatabase(await store.getState()), /projection conflicts/)
  } finally {
    runtime.dispose()
    await rm(profile, { recursive: true, force: true })
  }
})

test('machine writer methods fail before service data, built-in content or recovery mutation', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vhostra-machine-writer-'))
  const roots = { configuration: path.join(parent, 'etc'), data: path.join(parent, 'lib'), logs: path.join(parent, 'log') }
  const user = path.join(parent, 'user')
  try {
    await mkdir(user)
    const store = new VhostraStore(user, undefined, undefined, roots)
    const runtime = Object.create(DockerRuntimeController.prototype)
    runtime.layout = store.layout
    await assert.rejects(runtime.generate({}), /protected secret, workspace and built-in/)
    await assert.rejects(runtime.ensureEnvironment(), /signed protected service/)
    await assert.rejects(runtime.prepareDatabase({}), /separate coordinator/)
    await assert.rejects(runtime.restart(), /protected generation and rollback/)
    await assert.rejects(runtime.runExclusive('starting', 'fixture', async () => {}), /signed protected secret/)
    await assert.rejects(runtime.databaseCompose(['config']), /signed protected secret delivery/)
    await assert.rejects(store.ensureLocalhostDefinition(), /bounded publisher/)
    await assert.rejects(store.writeLocalhostWelcome(), /bounded publisher/)
    await missing(roots.data)
    await missing(roots.logs)
    assert.deepEqual(await readdir(user), [])
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('future machine Compose keeps built-in content read-only and PHP source has no copied password', async () => {
  const fixture = await machineGenerationFixture()
  try {
  const root = fixture.roots.data
  const state = { settings: {
    selectedPhpVersion: '8.4', selectedWebServer: 'nginx',
    php: { extensions: [], disabledExtensions: [], cwebpEnabled: false, opcacheEnabled: true },
    ports: { http: 18088, phpMyAdmin: 18089, https: 18443 },
    optionalServices: { redis: false, memcached: false },
  }, virtualHosts: [], sites: [] }
  const layout = { root: '/synthetic/configuration', userRoot: '/synthetic/user', dataRoot: root,
    builtinPublic: `${root}/service-data/localhost/public`, certificates: { directory: `${root}/certificates` },
    runtime: { openLiteSpeed: `${root}/runtime/openlitespeed`, apache: `${root}/runtime/apache`,
      nginx: `${root}/runtime/nginx`, php: `${root}/runtime/php` }, logs: '/synthetic/logs' }
  const token = await fixture.commit(id())
  const compose = singleRuntimeComposeYaml(state, layout, 'synthetic', true, 'image', 'database', token)
  assert.match(compose, /VHOSTRA_BUILTIN_MODE: "image-copy"/)
  assert.match(compose, /service-data\/localhost\/generations\/[a-f0-9]{32}\/public:\/usr\/share\/vhostra\/builtin:ro/)
  assert.doesNotMatch(compose, /service-data\/localhost\/public:\/var\/www\/html/)
  const php = await readFile('runtime-image/phpmyadmin-config.inc.php', 'utf8')
  const entrypoint = await readFile('runtime-image/entrypoint.sh', 'utf8')
  assert.match(php, /getenv\('VHOSTRA_PMA_PASSWORD'\)/)
  assert.doesNotMatch(php, /__VHOSTRA_PMA_PASSWORD__/)
  assert.doesNotMatch(entrypoint, /sed .*__VHOSTRA_PMA_PASSWORD__/)
  } finally { await fixture.cleanup() }
})
