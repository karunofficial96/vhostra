// Read-only acceptance against the existing managed runtime; no generation/start/stop.
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const profile = process.env.VHOSTRA_USER_DATA ?? path.join(os.homedir(), 'Library', 'Application Support', 'vhostra')
const store = new VhostraStore(profile)
const records = async directory => Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'))))
const state = { settings: JSON.parse(await readFile(store.layout.settings, 'utf8')), sites: await records(store.layout.sites), virtualHosts: await records(store.layout.virtualHosts) }
const runtime = new DockerRuntimeController(store.layout, async () => state)
try {
  const status = await runtime.refresh()
  assert.equal(status.state, 'running')
  const ports = [state.settings.ports.http, state.settings.ports.phpMyAdmin, state.settings.ports.mariadb, state.settings.ports.https]
  for (const port of ports) assert.equal((await runtime.checkPort(port)).owner, 'Vhostra', `port ${port}`)
  await runtime.ensurePortsAvailable(ports, true)
  assert.doesNotMatch(status.message, /cannot bind|already in use/)
  console.log(`Current managed runtime refresh and owned ports ${ports.join('/')} accepted without any runtime mutation.`)
} finally { runtime.dispose() }
