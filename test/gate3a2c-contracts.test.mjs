import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { validateMachineCoordinatorRequest, unavailableProductionMachineCoordinator } from '../dist-electron/machine-coordinator-contract.js'
import { BuiltInPublisher, loadTrustedWelcomeBundle } from '../dist-electron/builtin-publisher.js'
import { committedBuiltInPublicPath, emptyGenerationLedger, MachineGenerationController, validateGenerationLedger } from '../dist-electron/machine-generation.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const id = () => randomBytes(16).toString('hex')
const hash = () => randomBytes(32).toString('hex')
const request = { type: 'prepare-mariadb-storage', version: 1, expectedSeries: '11.8' }

test('coordinator accepts only semantic operations and production has no synthetic backend', () => {
  assert.deepEqual(validateMachineCoordinatorRequest(request), request)
  for (const bad of [
    { ...request, path: '/tmp/other' }, { ...request, expectedSeries: '99.0' },
    { type: 'read-file', version: 1, path: '/private/etc/shadow' },
    { type: 'ensure-database-credentials', version: 1, password: 'leak' },
    { type: 'prepare-web-secret-delivery', version: 1, generationId: id(), environmentFile: '/tmp/secret' },
    { type: 'publish-local-certificate', version: 1, generationId: id(), dnsNames: ['localhost'], ipAddresses: ['127.0.0.1'], destination: '/tmp/cert' },
  ]) assert.throws(() => validateMachineCoordinatorRequest(bad), /not allowlisted/)
  assert.deepEqual(validateMachineCoordinatorRequest({ type: 'publish-local-certificate', version: 1,
    generationId: id(), dnsNames: ['localhost', 'example.test'], ipAddresses: ['127.0.0.1'] }).type, 'publish-local-certificate')
  assert.throws(unavailableProductionMachineCoordinator, /Signed machine coordinator service is unavailable/)
  const runtime = Object.create(DockerRuntimeController.prototype)
  assert.throws(() => runtime.machineCoordinator(), /Signed machine coordinator service is unavailable/)
})

test('fixed-root built-in publisher is bounded, repeatable and cannot overwrite Site content', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vhostra-builtin-contract-')))
  const roots = { configuration: path.join(parent, 'etc'), data: path.join(parent, 'data'), logs: path.join(parent, 'logs') }
  const external = path.join(parent, 'site-public')
  const publisher = new BuiltInPublisher(roots, { 'index.html': Buffer.from('<h1>{{server}}</h1><div>{{sites}}</div><p>{{runtime}}</p>'), 'favicon-16.png': Buffer.from('icon') })
  const model = { server: 'nginx', phpVersion: '8.4', theme: 'system', runtimeMessage: 'Ready', redis: false, memcached: false,
    redisPort: 6379, memcachedPort: 11211, sites: [{ name: 'Example', url: 'http://example.test/' }] }
  const publish = { contentVersion: 'welcome-v1', generationId: id() }
  const publicRoot = path.join(roots.data, 'service-data/localhost/generations', publish.generationId, 'public')
  try {
    await mkdir(external)
    await writeFile(path.join(external, 'index.html'), 'user-owned sentinel')
    assert.equal(await publisher.publish(publish, model), 'published')
    const first = await readFile(path.join(publicRoot, 'index.html'), 'utf8')
    assert.match(first, /<h1>Nginx<\/h1>/)
    assert.equal(await publisher.publish(publish, model), 'already-published')
    await assert.rejects(publisher.publish(publish, { ...model, runtimeMessage: 'Changed' }), /generation content changed/)
    assert.equal(await readFile(path.join(external, 'index.html'), 'utf8'), 'user-owned sentinel')
    const candidate = { contentVersion: 'welcome-v2', generationId: id() }
    assert.equal(await publisher.publish(candidate, { ...model, runtimeMessage: 'Candidate' }), 'published')
    assert.equal(await readFile(path.join(publicRoot, 'index.html'), 'utf8'), first)
    await writeFile(path.join(publicRoot, 'index.html'), 'external change')
    await assert.rejects(publisher.publish({ ...publish, contentVersion: 'welcome-v2' }, model), /generation content version changed/)
    await assert.rejects(publisher.publish(publish, model), /unowned or changed/)
    assert.equal(await readFile(path.join(external, 'index.html'), 'utf8'), 'user-owned sentinel')
    await assert.rejects(publisher.publish({ ...publish, contentVersion: '../escape' }, model), /invalid publication identity/)
    await assert.rejects(publisher.publish({ ...publish, destination: external }, model), /invalid publication identity/)
    await assert.rejects(publisher.publish(publish, { ...model, documentRoot: external }), /invalid semantic model/)
    await assert.rejects(publisher.publish({ contentVersion: 'private-url', generationId: id() },
      { ...model, sites: [{ name: 'Secret', url: 'http://user:password@example.test/' }] }), /invalid Site URL/)
    await assert.rejects(stat(path.join(parent, 'escape')), { code: 'ENOENT' })
    const badBundle = new BuiltInPublisher(roots, { 'index.html': Buffer.from('safe'), 'services/..': Buffer.from('escape') })
    await assert.rejects(badBundle.publish({ contentVersion: 'bad', generationId: id() }, model), /unexpected file/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('packaged welcome assets load through the bounded trusted-bundle reader', async () => {
  const bundle = await loadTrustedWelcomeBundle(path.resolve('dist-welcome'))
  assert.ok(bundle['index.html'].includes(Buffer.from('{{sites}}')))
  assert.ok(bundle['services/php.svg'].length > 0)
  assert.ok(Object.keys(bundle).length < 128)
})

test('generation ledger ignores incomplete work and keeps exactly one committed generation', async () => {
  let state = emptyGenerationLedger()
  const store = { read: async () => structuredClone(state), compareAndSwap: async (revision, next) => {
    if (state.revision !== revision) return false
    state = structuredClone(validateGenerationLedger(next))
    return true
  } }
  const first = id(), second = id(), third = id()
  const controller = new MachineGenerationController(store)
  const roots = { configuration: '/synthetic/etc', data: '/synthetic/data', logs: '/synthetic/logs' }
  await controller.begin(first, hash())
  assert.equal(await controller.current(), null)
  assert.throws(() => committedBuiltInPublicPath(roots, state), /no committed generation/)
  await controller.verified(first)
  assert.equal(await controller.current(), null)
  await controller.commit(first)
  assert.equal((await controller.current()).id, first)
  assert.equal(committedBuiltInPublicPath(roots, state), `/synthetic/data/service-data/localhost/generations/${first}/public`)
  await controller.begin(second, hash())
  const fresh = new MachineGenerationController(store)
  assert.equal((await fresh.recover()).id, first)
  await fresh.fail(second)
  assert.equal((await fresh.current()).id, first)
  await fresh.begin(third, hash())
  await fresh.verified(third)
  assert.equal((await fresh.recover()).id, first)
  await fresh.commit(third)
  assert.equal((await controller.current()).id, third)
  assert.equal(committedBuiltInPublicPath(roots, state), `/synthetic/data/service-data/localhost/generations/${third}/public`)
  assert.equal(state.generations.filter(item => item.phase === 'committed').length, 1)
  await controller.cleanup()
  assert.deepEqual(state.generations.map(item => item.id), [first, third])
  assert.equal(state.rollback, first)
  assert.equal((await fresh.current()).id, third)
  assert.throws(() => validateGenerationLedger({ ...state, secret: 'must never persist' }), /invalid ledger/)
  assert.throws(() => validateGenerationLedger({ ...state, committed: first }), /committed pointer is inconsistent/)
})
