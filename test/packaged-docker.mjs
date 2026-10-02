// Opt-in packaged macOS acceptance: node test/packaged-docker.mjs /absolute/Vhostra.app
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { saveDockerExecutable } from '../dist-electron/docker-prerequisite.js'

const app = process.argv[2]
if (!app || !path.isAbsolute(app) || !app.endsWith('.app')) throw new Error('Pass an absolute packaged Vhostra.app path.')
const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-packaged-docker-'))
const stopped = process.argv.includes('--stopped')
if (stopped) {
  const store = new VhostraStore(profile)
  const fakeDocker = path.join(profile, 'docker-stopped')
  await writeFile(fakeDocker, '#!/bin/sh\nif [ "$1" = --version ]; then echo Docker version 28.0.0; else echo "Cannot connect to the Docker daemon" >&2; exit 1; fi\n')
  await chmod(fakeDocker, 0o755)
  await store.getState()
  saveDockerExecutable(store.layout.root, fakeDocker)
  await store.saveOnboarding({ ...await store.getOnboarding(), completed: true, themeSaved: true })
  const state = await store.getState()
  await store.saveSettings({ ...state.settings, startup: { ...state.settings.startup, serviceStartMode: 'manual' } })
}
const server = net.createServer()
const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
await new Promise(resolve => server.close(resolve))
const child = spawn(path.join(app, 'Contents', 'MacOS', 'Vhostra'), [`--remote-debugging-port=${port}`], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PATH: '/usr/bin:/bin', VHOSTRA_USER_DATA: profile, VHOSTRA_TEST_SCOPE: `vhostra-packaged-docker-${process.pid}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stderr = ''
child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000) })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  let target
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited: ${stderr}`)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row => row.type === 'page' && row.webSocketDebuggerUrl) } catch { /* App still starting. */ }
    if (target) break
    await pause(250)
  }
  assert.ok(target, `Packaged renderer did not appear: ${stderr}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9)
    const timer = setTimeout(() => reject(new Error('Packaged renderer query timed out.')), 15000)
    const receive = event => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', receive); clearTimeout(timer)
      if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text))
      else resolve(message.result?.result?.value)
    }
    ws.addEventListener('message', receive)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  let state
  for (let i = 0; i < 40; i++) {
    state = await evaluate('window.vhostra?.dockerPrerequisite()')
    if (state?.state === (stopped ? 'stopped' : 'ready')) break
    await pause(250)
  }
  assert.equal(state?.state, stopped ? 'stopped' : 'ready', JSON.stringify(state))
  const runtime = await evaluate('window.vhostra.getRuntimeStatus()')
  if (stopped) {
    assert.equal(runtime.state, 'unavailable', JSON.stringify(runtime))
    let card = false
    for (let i = 0; i < 40; i++) { card = await evaluate('document.body.textContent.includes("Docker is installed but is not running")'); if (card) break; await pause(250) }
    assert.ok(card, 'Stopped Docker setup card was not shown.')
    assert.ok(await evaluate('document.body.textContent.includes("Start Docker")'))
    assert.ok(!await evaluate('document.body.textContent.includes("Docker was not found on this computer")'))
    console.log('Packaged GUI distinguished installed-but-stopped Docker from missing Docker and showed Start Docker.')
  } else {
    assert.notEqual(runtime.state, 'unavailable', JSON.stringify(runtime))
    assert.ok(await evaluate('document.body.textContent.includes("Welcome to Vhostra")'))
    console.log('Packaged GUI detected running Docker with PATH=/usr/bin:/bin; isolated welcome opened without Docker setup state.')
  }
  ws.close()
} finally {
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 2000)
  await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve) })
  clearTimeout(force)
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
