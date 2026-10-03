import assert from 'node:assert/strict'
import { app, ipcMain } from 'electron'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-services-action-'))
app.setPath('userData', profile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = setTimeout(() => app.exit(1), 90000)
app.whenReady().then(async () => {
  let window, runtime, passed = false
  try {
    const { VhostraStore } = await import('../dist-electron/store.js')
    const store = new VhostraStore(profile, path.resolve('dist-welcome'))
    await store.saveOnboarding({ ...await store.getOnboarding(), completed: true })
    const initial = await store.getState()
    await store.saveSettings({ ...initial.settings, startup: { ...initial.settings.startup, serviceStartMode: 'manual' } })
    const { applicationSession } = await import('../dist-electron/main.js')
    await pause(400)
    ;({ window, runtime } = applicationSession())
    runtime.scope = `vhostra-services-action-${process.pid}`
    await runtime.pauseBackgroundWork()
    runtime.refresh = async () => runtime.set({ state: 'running', services: ['runtime'], message: 'Fixture runtime' })
    const rows = [
      { id: 'web', label: 'OpenLiteSpeed', enabled: true, state: 'running' },
      { id: 'mariadb', label: 'MariaDB', enabled: true, state: 'running' },
      { id: 'redis', label: 'Redis', enabled: false, state: 'disabled' },
      { id: 'memcached', label: 'Memcached', enabled: false, state: 'disabled' },
    ]
    let releaseAction, invoked
    ipcMain.removeHandler('vhostra:list-managed-services')
    ipcMain.handle('vhostra:list-managed-services', async () => structuredClone(rows))
    ipcMain.removeHandler('vhostra:control-managed-service')
    ipcMain.handle('vhostra:control-managed-service', async (_event, id, action) => {
      invoked = [id, action]
      await new Promise(resolve => { releaseAction = resolve })
      rows.find(row => row.id === id).state = action === 'stop' ? 'stopped' : 'running'
      return structuredClone(rows)
    })
    ipcMain.removeHandler('vhostra:set-optional-service')
    ipcMain.handle('vhostra:set-optional-service', async (_event, id, enabled) => {
      invoked = [id, enabled ? 'enable' : 'disable']
      await new Promise(resolve => { releaseAction = resolve })
      const row = rows.find(row => row.id === id); row.enabled = enabled; row.state = enabled ? 'running' : 'disabled'
      const state = await store.getState()
      await store.saveSettings({ ...state.settings, optionalServices: { ...state.settings.optionalServices, [id]: enabled } })
      return structuredClone(rows)
    })
    const evaluate = code => window.webContents.executeJavaScript(code)
    const waitFor = async code => { const until = Date.now() + 10000; while (!await evaluate(code)) { if (Date.now() > until) throw Error(`UI timeout: ${code}`); await pause(40) } }
    await waitFor('document.body.textContent.includes("Dashboard")')
    await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent==='Services')).click()`)
    await waitFor('document.getElementById("services-runtime-status") && [...document.querySelectorAll("article")].some(node=>node.textContent.includes("MariaDB"))')
    const card = id => `([...document.querySelectorAll('article')].find(node=>node.textContent.includes(${JSON.stringify(id)})))`
    const buttonText = id => evaluate(`[...${card(id)}.querySelectorAll('button')].map(node=>node.textContent.trim())`)
    const click = (id, label) => evaluate(`([...${card(id)}.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)})).click()`)
    const check = async (id, label, pending, intermediate, final) => {
      invoked = null; releaseAction = null
      await click(id, label)
      await waitFor(`${card(id)}.textContent.includes(${JSON.stringify(pending)})`)
      assert.deepEqual(invoked, [id === 'OpenLiteSpeed' ? 'web' : id.toLowerCase(), label.toLowerCase()])
      const row = rows.find(row => row.id === invoked[0]); row.state = intermediate
      runtime.set({ state: intermediate === 'stopping' ? 'stopping' : 'starting', message: 'Fixture technical phase', services: ['runtime'], serviceRevision: (runtime.current().serviceRevision ?? 0) + 1, serviceTransitions: { [row.id]: intermediate } })
      await pause(150)
      assert.deepEqual(await buttonText(id), [pending], `${id} ${label} button during ${intermediate}`)
      assert.match(await evaluate('document.getElementById("services-runtime-status").textContent'), new RegExp(pending.replace('…', '')))
      releaseAction()
      runtime.set({ state: 'running', message: 'Fixture runtime', services: ['runtime'], serviceRevision: (runtime.current().serviceRevision ?? 0) + 1, serviceTransitions: {} })
      await waitFor(`!${card(id)}.textContent.includes(${JSON.stringify(pending)})`)
      assert.ok((await buttonText(id)).includes(final), `${id} ${label} idle ${final}`)
    }
    await check('MariaDB', 'Stop', 'Stopping…', 'running', 'Start')
    await check('MariaDB', 'Start', 'Starting…', 'stopped', 'Stop')
    await check('OpenLiteSpeed', 'Restart', 'Restarting…', 'stopping', 'Restart')
    await check('Redis', 'Enable', 'Enabling…', 'disabled', 'Disable')
    await check('Redis', 'Disable', 'Disabling…', 'running', 'Enable')
    await check('Memcached', 'Enable', 'Enabling…', 'disabled', 'Disable')
    await check('Memcached', 'Disable', 'Disabling…', 'running', 'Enable')
    console.log('PASS native Services Start, Stop, Restart, Enable, Disable buttons and Runtime Status.')
    passed = true
  } catch (error) { console.error(error) }
  finally { clearTimeout(deadline); await runtime?.pauseBackgroundWork(); runtime?.dispose(); window?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); await pause(100); if (passed) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); else console.error('Retained fixture:', profile); app.exit(passed ? 0 : 1) }
})
