import assert from 'node:assert/strict'
import test from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { systemStoragePaths } from '../dist-electron/storage-paths.js'
import { unavailableProductionMachineCoordinator } from '../dist-electron/machine-coordinator-contract.js'

test('machine directory and migration-ready marker do not select or initialize machine storage', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vhostra-machine-freeze-'))
  const userData = path.join(parent, 'user')
  const machine = path.join(parent, 'machine')
  const roots = { configuration: machine, data: machine, logs: path.join(machine, 'logs') }
  try {
    await mkdir(userData)
    await mkdir(machine)
    await writeFile(path.join(machine, 'settings.json'), '{"schemaVersion":1}')
    await writeFile(path.join(machine, '.Vhostra-migration-ready'), 'ready-for-activation')
    const before = await readdir(machine)
    const store = new VhostraStore(userData)
    assert.equal(store.layout.userRoot, undefined)
    assert.equal(store.layout.root, path.join(userData, 'Vhostra'))
    await store.getState()
    assert.deepEqual(await readdir(machine), before)
    assert.equal(await readFile(path.join(machine, '.Vhostra-migration-ready'), 'utf8'), 'ready-for-activation')
    assert.throws(() => new DockerRuntimeController(new VhostraStore(userData, undefined, undefined, roots).layout,
      () => store.getState()), /Machine storage runtime is blocked/)
    assert.throws(unavailableProductionMachineCoordinator, /service is unavailable/)
    assert.throws(() => new VhostraStore(userData, undefined, undefined, systemStoragePaths(process.platform)),
      /Native machine storage remains blocked/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('desktop and CLI production entrypoints cannot select synthetic roots or register a machine helper', async () => {
  const main = await readFile('electron/main.ts', 'utf8')
  const cli = await readFile('scripts/vhostra.mjs', 'utf8')
  const startup = await readFile('electron/startup.ts', 'utf8')
  assert.match(main, /store = new VhostraStore\(\s*app\.getPath\("userData"\)/)
  assert.match(cli, /new VhostraStore\(platformDataRoot\(\),/)
  for (const source of [main, cli, startup]) {
    assert.doesNotMatch(source, /machine-migration(?:-worker)?|machine-generation-staging|BuiltInPublisher|StagingGenerationFileStore|prepareMachineMigration/)
    assert.doesNotMatch(source, /SMAppService|launchctl\s+(?:bootstrap|load)|LaunchDaemon|xpc_connection_create/)
    assert.doesNotMatch(source, /VHOSTRA_(?:MACHINE|SYSTEM|SYNTHETIC)_(?:ROOT|PATHS|COORDINATOR)/)
  }
  assert.match(main, /if \(app\.isPackaged && process\.env\.VHOSTRA_TEST_SCOPE && process\.env\.VHOSTRA_USER_DATA\)/)
  assert.match(main, /Packaged acceptance profile must be temporary/)
  assert.doesNotMatch(cli, /--(?:enable|activate|migrate)[- ]machine|--system-storage/)
})
