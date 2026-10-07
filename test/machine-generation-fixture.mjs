import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BuiltInPublisher } from '../dist-electron/builtin-publisher.js'
import { MachineGenerationController } from '../dist-electron/machine-generation.js'
import { StagingGenerationFileStore } from '../dist-electron/machine-generation-staging.js'
import { resolveCommittedBuiltInGeneration } from '../dist-electron/machine-generation-content.js'

export const id = () => randomBytes(16).toString('hex')
export const digest = () => randomBytes(32).toString('hex')
export const model = () => ({ server: 'nginx', phpVersion: '8.4', theme: 'system', runtimeMessage: 'Ready', redis: false,
  memcached: false, redisPort: 6379, memcachedPort: 11211, sites: [] })

export async function machineGenerationFixture() {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vhostra-machine-generation-')))
  const roots = { configuration: path.join(parent, 'etc'), data: path.join(parent, 'data'), logs: path.join(parent, 'logs') }
  await mkdir(roots.configuration)
  await mkdir(roots.data)
  const store = new StagingGenerationFileStore(roots)
  await store.bootstrap()
  const controller = new MachineGenerationController(store)
  const publisher = new BuiltInPublisher(roots, { 'index.html': Buffer.from('<h1>{{server}}</h1><div>{{sites}}</div>') })
  const publish = async (generationId, value = model()) => publisher.publish({ contentVersion: 'fixture-v1', generationId }, value)
  const commit = async (generationId, value = model()) => {
    await controller.begin(generationId, digest())
    await publish(generationId, value)
    await controller.verified(generationId)
    await controller.commit(generationId)
    return resolveCommittedBuiltInGeneration(roots, store)
  }
  return { parent, roots, store, controller, publisher, publish, commit,
    cleanup: () => rm(parent, { recursive: true, force: true }) }
}
