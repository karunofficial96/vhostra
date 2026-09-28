import assert from 'node:assert/strict'
import { app } from 'electron'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const profile = process.argv.find(value => value.startsWith('--profile='))?.slice('--profile='.length)
if (!profile) throw Error('Isolated profile required')
app.setPath('userData', profile)
setTimeout(() => { console.error('Native migration acceptance timed out'); app.exit(1) }, 30000)
app.whenReady().then(async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), 'vhostra-native-migration-'))
  let resultCode = 0
  let session
  try {
    const { applicationSession } = await import('../dist-electron/main.js'); session = applicationSession
    await new Promise(resolve => setTimeout(resolve, 500))
    const window = applicationSession().window
    if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve))
    const result = await window.webContents.executeJavaScript(`(async () => {
      const state = await window.vhostra.getState(); window.acceptanceStatuses = [];
      const unsubscribe = window.vhostra.onRuntimeStatus(status => window.acceptanceStatuses.push(status));
      const results = await Promise.allSettled([window.vhostra.migrateConfigurationLocation(${JSON.stringify(destination)}), window.vhostra.saveSettings(state.settings)]);
      const final = await window.vhostra.getRuntimeStatus(); unsubscribe();
      return { results, final, statuses: window.acceptanceStatuses };
    })()`)
    assert.equal(result.results[0].status, 'fulfilled')
    assert.equal(result.results[1].status, 'rejected')
    const active = result.statuses.filter(status => status.progress)
    assert.ok(active.length > 3)
    assert.equal(new Set(active.map(status => status.progress.id)).size, 1)
    const text = active.at(-1).progress.lines.join('\n')
    assert.match(text, /Copying/); assert.match(text, /Verifying/); assert.match(text, /Switching/); assert.match(text, /Removing/)
    assert.equal(result.final.progress, undefined)
    const pointer = JSON.parse(await readFile(path.join(profile, 'vhostra-location.json'), 'utf8'))
    assert.equal(pointer.root, path.join(destination, 'Vhostra'))
    console.log('Actual desktop migration IPC: real stages, one progress session across controllers, concurrent write protection, completion cleanup and verified pointer passed.')
  } catch (error) { console.error(error); resultCode = 1 } finally {
    app.releaseSingleInstanceLock()
    session?.().window?.destroy()
    const runtime = session?.().runtime; runtime?.dispose(); await runtime?.pauseBackgroundWork()
    await rm(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); app.exit(resultCode)
  }
}).catch(error => { console.error(error); app.exit(1) })
