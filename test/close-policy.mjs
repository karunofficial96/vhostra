import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
for (const [mode, quit] of [['keep-services', false], ['stop-services', false], ['minimize-to-tray', false], ['keep-services', true], ['stop-services', true]]) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-close-native-')); const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
  try {
    execFileSync('node_modules/.bin/electron', ['test/close-policy.electron.mjs', `--profile=${profile}`, `--mode=${mode}`, ...(quit ? ['--quit'] : [])], { env: environment, stdio: 'inherit', timeout: 25000 })
    const proof = JSON.parse(await readFile(path.join(profile, 'close-proof.json'), 'utf8')); assert.equal(proof.stops, mode === 'stop-services' ? 1 : 0)
    console.log(`Native ${quit ? 'Quit IPC' : 'titlebar Close'} ${mode} passed.`)
  } finally { await rm(profile, { recursive: true, force: true }) }
}
