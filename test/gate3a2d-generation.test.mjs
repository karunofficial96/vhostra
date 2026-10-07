import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { link, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { singleRuntimeComposeYaml } from '../dist-electron/runtime.js'
import { MachineGenerationController } from '../dist-electron/machine-generation.js'
import { StagingGenerationFileStore } from '../dist-electron/machine-generation-staging.js'
import { CommittedBuiltInGeneration, cleanupStagingBuiltInGenerations, resolveCommittedBuiltInGeneration } from '../dist-electron/machine-generation-content.js'
import { machineGenerationFixture, digest, id, model } from './machine-generation-fixture.mjs'

const state = sites => ({ settings: { selectedPhpVersion: '8.4', selectedWebServer: 'nginx',
  php: { extensions: [], disabledExtensions: [], cwebpEnabled: false, opcacheEnabled: true },
  ports: { http: 18088, phpMyAdmin: 18089, https: 18443 }, optionalServices: { redis: false, memcached: false },
}, virtualHosts: [], sites })
const layout = roots => ({ root: roots.configuration, userRoot: '/synthetic/user', dataRoot: roots.data,
  builtinPublic: path.join(roots.data, 'service-data/localhost/public'), certificates: { directory: path.join(roots.data, 'certificates') },
  runtime: { openLiteSpeed: '/synthetic/ols', apache: '/synthetic/apache', nginx: '/synthetic/nginx', php: '/synthetic/php' },
  logs: roots.logs })
const fresh = fixture => {
  const store = new StagingGenerationFileStore(fixture.roots)
  return { store, controller: new MachineGenerationController(store) }
}
const selected = async (fixture, sites = []) => {
  const { store } = fresh(fixture)
  const token = await resolveCommittedBuiltInGeneration(fixture.roots, store)
  return singleRuntimeComposeYaml(state(sites), layout(fixture.roots), 'synthetic', true, 'image', 'database', token)
}
const generation = (fixture, value) => path.join(fixture.roots.data, 'service-data/localhost/generations', value)
const ledgerFile = fixture => path.join(fixture.roots.configuration, 'generation-control/ledger.json')

test('fresh Compose selects only committed A then B; Site and phpMyAdmin stay container-local', async () => {
  const f = await machineGenerationFixture()
  try {
    const a = id(), b = id(), stray = id()
    const siteRoot = path.join(f.parent, 'user-site')
    await mkdir(siteRoot)
    const siteFile = path.join(siteRoot, 'index.html')
    await writeFile(siteFile, 'user-owned sentinel')
    const sites = [{ builtIn: false, documentRoot: siteRoot, vhostId: 'site-1' }]
    await assert.rejects(selected(f), /no committed generation/)
    assert.throws(() => singleRuntimeComposeYaml(state(sites), layout(f.roots), 'synthetic', true, 'image', 'database'), /validated committed generation/)
    assert.throws(() => new CommittedBuiltInGeneration(a, f.roots.data, generation(f, a), Symbol()), /resolver proof/)
    await f.commit(a)
    await mkdir(generation(f, stray), { recursive: true })
    let compose = await selected(f, sites)
    assert.match(compose, new RegExp(`generations/${a}/public:/usr/share/vhostra/builtin:ro`))
    assert.doesNotMatch(compose, /\/var\/www\/html:ro/)
    assert.match(compose, /VHOSTRA_BUILTIN_MODE: "image-copy"/)
    assert.match(compose, /VHOSTRA_PMA_PASSWORD: \$\{VHOSTRA_PMA_PASSWORD\}/)
    assert.match(compose, /create_host_path: false/)
    const { controller } = fresh(f)
    await controller.begin(b, digest())
    assert.match(await selected(f), new RegExp(`generations/${a}/public`))
    await f.publish(b, { ...model(), server: 'apache' })
    assert.match(await selected(f), new RegExp(`generations/${a}/public`))
    await controller.verified(b)
    assert.match(await selected(f), new RegExp(`generations/${a}/public`))
    await controller.commit(b)
    compose = await selected(f, sites)
    assert.match(compose, new RegExp(`generations/${b}/public`))
    assert.doesNotMatch(compose, new RegExp(`generations/${a}/public`))
    assert.equal(await readFile(siteFile, 'utf8'), 'user-owned sentinel')
    assert.equal((await fresh(f).store.read()).rollback, a)
    assert.equal((await stat(generation(f, a))).isDirectory(), true)
    const entrypoint = await readFile('runtime-image/entrypoint.sh', 'utf8')
    assert.match(entrypoint, /cp -a \/usr\/share\/vhostra\/builtin\/\. \/var\/www\/html\//)
    assert.match(entrypoint, /cp -a \/usr\/share\/phpmyadmin \/var\/www\/html\/phpmyadmin/)
  } finally { await f.cleanup() }
})

test('fresh recovery ignores interrupted preparation, publication and verification', async () => {
  const f = await machineGenerationFixture()
  try {
    const a = id(), b = id()
    await f.commit(a)
    assert.equal((await fresh(f).controller.recover()).id, a)
    await fresh(f).controller.begin(b, digest())
    const partial = path.join(generation(f, b), 'public')
    await mkdir(partial, { recursive: true })
    await writeFile(path.join(partial, 'index.html'), 'partial')
    assert.match(await selected(f), new RegExp(`generations/${a}/public`))
    await rm(generation(f, b), { recursive: true })
    await f.publish(b)
    assert.match(await selected(f), new RegExp(`generations/${a}/public`))
    await fresh(f).controller.verified(b)
    assert.match(await selected(f), new RegExp(`generations/${a}/public`))
    await fresh(f).controller.commit(b)
    assert.match(await selected(f), new RegExp(`generations/${b}/public`))
    assert.equal((await fresh(f).controller.recover()).id, b)
    assert.equal((await stat(generation(f, a))).isDirectory(), true)
  } finally { await f.cleanup() }
})

test('atomic ledger replacement resolves old or new state after injected interruption', async () => {
  for (const point of ['after-temp-sync', 'after-rename']) {
    const f = await machineGenerationFixture()
    try {
      const a = id(), b = id()
      await f.commit(a)
      await fresh(f).controller.begin(b, digest())
      await f.publish(b)
      await fresh(f).controller.verified(b)
      const faultStore = new StagingGenerationFileStore(f.roots, stage => { if (stage === point) throw Error('simulated interruption') })
      await assert.rejects(new MachineGenerationController(faultStore).commit(b), /simulated interruption/)
      const current = await fresh(f).controller.recover()
      assert.equal(current.id, point === 'after-temp-sync' ? a : b)
      assert.match(await selected(f), new RegExp(`generations/${current.id}/public`))
      assert.equal((await stat(generation(f, a))).isDirectory(), true)
      assert.equal((await readdir(path.dirname(ledgerFile(f)))).includes('.write-lock'), false)
    } finally { await f.cleanup() }
  }
})

test('malformed, truncated, missing or linked authoritative state fails closed', async () => {
  for (const damage of ['truncated', 'malformed', 'missing', 'symlink']) {
    const f = await machineGenerationFixture()
    try {
      const a = id()
      await f.commit(a)
      if (damage === 'truncated') await writeFile(ledgerFile(f), '{')
      if (damage === 'malformed') await writeFile(ledgerFile(f), '{"committed":"guess"}')
      if (damage === 'missing') await rm(generation(f, a), { recursive: true })
      if (damage === 'symlink') {
        const manifest = path.join(generation(f, a), 'public/.vhostra-built-in.json')
        await rm(manifest)
        await symlink(ledgerFile(f), manifest)
      }
      await assert.rejects(selected(f))
      if (damage !== 'missing') await assert.rejects(new StagingGenerationFileStore(f.roots).bootstrap(), /already exists/)
    } finally { await f.cleanup() }
  }
})

test('cleanup keeps current and rollback, deletes only bounded failed and older retired generations', async () => {
  const f = await machineGenerationFixture()
  try {
    const a = id(), b = id(), c = id(), failed = id(), unknown = id()
    await f.commit(a)
    await f.commit(b)
    await f.commit(c)
    await fresh(f).controller.begin(failed, digest())
    await f.publish(failed)
    await fresh(f).controller.fail(failed)
    await mkdir(generation(f, unknown), { recursive: true })
    const removed = await cleanupStagingBuiltInGenerations(f.roots, fresh(f).store)
    assert.deepEqual(new Set(removed), new Set([a, failed]))
    assert.equal((await stat(generation(f, b))).isDirectory(), true)
    assert.equal((await stat(generation(f, c))).isDirectory(), true)
    assert.equal((await stat(generation(f, unknown))).isDirectory(), true)
    assert.equal((await fresh(f).store.read()).rollback, b)
    assert.match(await selected(f), new RegExp(`generations/${c}/public`))
  } finally { await f.cleanup() }
})

test('cleanup rejects symlink and hard-link surprises without following outside targets', async () => {
  for (const kind of ['symlink', 'hardlink', 'unknown']) {
    const f = await machineGenerationFixture()
    try {
      const a = id(), b = id()
      await f.commit(a)
      await fresh(f).controller.begin(b, digest())
      await fresh(f).controller.fail(b)
      const outside = path.join(f.parent, 'outside-sentinel')
      await writeFile(outside, 'untouched')
      const candidate = generation(f, b)
      await mkdir(path.join(candidate, 'public'), { recursive: true })
      const target = path.join(candidate, 'public/index.html')
      if (kind === 'symlink') await symlink(outside, target)
      if (kind === 'hardlink') await link(outside, target)
      if (kind === 'unknown') await writeFile(path.join(candidate, 'public/unknown.txt'), 'foreign')
      await assert.rejects(cleanupStagingBuiltInGenerations(f.roots, fresh(f).store), /link|unknown/)
      assert.equal(await readFile(outside, 'utf8'), 'untouched')
      assert.equal((await stat(generation(f, a))).isDirectory(), true)
    } finally { await f.cleanup() }
  }
})

test('cleanup retains preparing content and rejects a linked managed-root ancestor', async () => {
  const f = await machineGenerationFixture()
  try {
    const a = id(), preparing = id(), failed = id()
    await f.commit(a)
    await fresh(f).controller.begin(preparing, digest())
    await f.publish(preparing)
    assert.deepEqual(await cleanupStagingBuiltInGenerations(f.roots, fresh(f).store), [])
    assert.equal((await stat(generation(f, preparing))).isDirectory(), true)
    await fresh(f).controller.fail(preparing)
    await fresh(f).controller.begin(failed, digest())
    await fresh(f).controller.fail(failed)
    const serviceData = path.join(f.roots.data, 'service-data')
    const relocated = path.join(f.roots.data, 'relocated-service-data')
    await rename(serviceData, relocated)
    await symlink(relocated, serviceData)
    await assert.rejects(cleanupStagingBuiltInGenerations(f.roots, fresh(f).store), /unsafe generation entry/)
    assert.equal((await stat(path.join(relocated, 'localhost/generations', a))).isDirectory(), true)
    assert.equal((await stat(path.join(relocated, 'localhost/generations', preparing))).isDirectory(), true)
  } finally { await f.cleanup() }
})
