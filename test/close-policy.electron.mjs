import assert from 'node:assert/strict'
import { app, Menu } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
const profile = process.argv.find(value => value.startsWith('--profile='))?.slice(10)
const mode = process.argv.find(value => value.startsWith('--mode='))?.slice(7)
const action = process.argv.includes('--quit') ? 'quit' : 'close'
app.setPath('userData', profile)
const timeout = setTimeout(() => { console.error('Close policy timed out'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  const { applicationSession } = await import('../dist-electron/main.js'); await new Promise(resolve => setTimeout(resolve, 700))
  const session = applicationSession(); const window = session.window; const runtime = session.runtime; runtime.scope = `vhostra-close-policy-${process.pid}`
  let stops = 0; let running = true
  runtime.refresh = async () => ({ state: running ? 'running' : 'stopped', services: ['runtime'], message: 'Native close fixture' })
  runtime.stop = async () => { stops++; running = false }
  const { VhostraStore } = await import('../dist-electron/store.js'); const store = new VhostraStore(profile)
  const state = await store.getState(); await store.saveSettings({ ...state.settings, startup: { ...state.settings.startup, closeBehavior: mode } })
  const record = () => { assert.equal(stops, mode === 'stop-services' ? 1 : 0); writeFileSync(path.join(profile, 'close-proof.json'), JSON.stringify({ mode, action, stops })) }
  if (mode !== 'minimize-to-tray') app.once('will-quit', record)
  if (action === 'close') window.close()
  else {
    const quit = Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Quit Vhostra')
    quit.click()
    const deadline = Date.now() + 5000
    while (!await window.webContents.executeJavaScript('!!document.querySelector("[aria-labelledby=quit-title]")')) { if (Date.now() > deadline) throw Error('Explicit Quit dialog missing'); await new Promise(resolve => setTimeout(resolve, 100)) }
    await window.webContents.executeJavaScript(`(()=>{const label=${JSON.stringify(mode === 'keep-services' ? 'Quit Vhostra and Keep Services Running' : 'Quit Vhostra and Stop Services')}; [...document.querySelectorAll('button')].find(button=>button.textContent===label).click()})()`)
  }
  if (mode === 'minimize-to-tray') {
    await new Promise(resolve => setTimeout(resolve, 700)); assert.equal(window.isVisible(), false); assert.equal(window.isDestroyed(), false); assert.ok(session.tray); record()
    clearTimeout(timeout); await runtime.pauseBackgroundWork(); runtime.dispose(); window.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); app.exit(0)
  }
}).catch(error => { console.error(error); app.exit(1) })
