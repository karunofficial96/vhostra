// Opt-in isolated listener acceptance; never starts or changes a Docker project.
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-port-conflict-'))
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, `vhostra-port-conflict-${process.pid}`)
const listeners = []
try {
  for (let index = 0; index < 3; index++) {
    const server = net.createServer()
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    listeners.push(server)
  }
  const [http, admin, https] = listeners.map(server => server.address().port)
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, ports: { ...initial.settings.ports, http, phpMyAdmin: admin, https } })
  await assert.rejects(runtime.ensurePortsAvailable([http, admin], false), error => {
    assert.match(error.message, /required ports are already in use/)
    assert.match(error.message, new RegExp(`Port ${http}:`))
    assert.match(error.message, new RegExp(`Port ${admin}:`))
    assert.doesNotMatch(error.message, new RegExp(`Port ${https}:|continue with HTTP|HTTPS is unavailable`))
    assert.equal(error.message.match(/Vhostra did not stop or modify the owner/g)?.length, 1)
    return true
  })
  await runtime.checkOptionalHttpsPort(false)
  assert.match(runtime.httpsWarning, new RegExp(`Port ${https}:`))
  assert.equal(runtime.httpsWarning.match(/HTTPS is disabled/g)?.length, 1)
  console.log('Required HTTP/admin conflicts aggregate once; optional HTTPS has one separate, truthful warning.')
} finally {
  runtime.dispose()
  await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))))
  await rm(profile, { recursive: true, force: true })
}
