// Opt-in renderer transaction test with a delayed isolated backend handler.
import assert from 'node:assert/strict'
import { app, ipcMain } from 'electron'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-settings-requested-'))
app.setPath('userData', profile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = setTimeout(() => app.exit(1), 120000)
app.whenReady().then(async () => {
  let window, runtime, passed = false
  try {
    const { VhostraStore } = await import('../dist-electron/store.js')
    const store = new VhostraStore(profile, path.resolve('dist-welcome'))
    await store.saveOnboarding({ ...await store.getOnboarding(), completed: true })
    const initial = await store.getState()
    await store.saveSettings({ ...initial.settings, startup: { ...initial.settings.startup, serviceStartMode: 'manual' } })
    const { applicationSession } = await import('../dist-electron/main.js')
    await pause(500)
    ;({ window, runtime } = applicationSession())
    runtime.scope = `vhostra-settings-requested-${process.pid}`
    let fail = true
    ipcMain.removeHandler('vhostra:save-settings')
    ipcMain.handle('vhostra:save-settings', async (_event, next) => { await pause(450); if (fail) throw Error('Injected candidate failure'); return store.saveSettings(next) })
    const evaluate = code => window.webContents.executeJavaScript(code)
    const waitFor = async code => { const until = Date.now() + 10000; while (!await evaluate(code)) { if (Date.now() > until) throw Error(`UI timeout: ${code}`); await pause(50) } }
    await waitFor('document.body.textContent.includes("Dashboard")')
    await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent==='Settings')).click()`)
    await waitFor('document.body.textContent.includes("Shared environment")')
    const select = async (label, value) => evaluate(`(()=>{const control=[...document.querySelectorAll('label')].find(item=>item.textContent.includes(${JSON.stringify(label)})).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(control,${JSON.stringify(value)});control.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    const selected = label => evaluate(`[...document.querySelectorAll('label')].find(item=>item.textContent.includes(${JSON.stringify(label)})).querySelector('select').value`)
    const check = async (label, value) => evaluate(`(()=>{const control=[...document.querySelectorAll('label')].find(item=>item.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]');if(control.checked!==${value})control.click()})()`)
    const checked = label => evaluate(`[...document.querySelectorAll('label')].find(item=>item.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').checked`)
    await select('Web server', 'nginx'); await pause(40)
    assert.equal(await selected('Web server'), 'nginx')
    assert.equal(await evaluate(`document.body.textContent.includes('Nginx HTTP')`), true)
    assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(item=>item.textContent.includes('Web server')).querySelector('img').alt`), 'Nginx logo')
    await waitFor(`document.body.textContent.includes('Injected candidate failure')`)
    assert.equal(await selected('Web server'), 'openlitespeed')
    assert.equal(await evaluate(`document.body.textContent.includes('OpenLiteSpeed HTTP')`), true)
    fail = false
    await select('Web server', 'nginx'); await pause(40)
    assert.equal(await selected('Web server'), 'nginx')
    assert.equal(await evaluate(`document.body.textContent.includes('Nginx HTTP')`), true)
    await waitFor(`window.vhostra.getState().then(state=>state.settings.selectedWebServer==='nginx')`)
    await waitFor(`![...document.querySelectorAll('label')].find(item=>item.textContent.includes('PHP version')).querySelector('select').disabled`)
    assert.equal((await store.getState()).settings.selectedWebServer, 'nginx')
    fail = true
    await select('PHP version', '8.4'); await pause(40)
    assert.equal(await selected('PHP version'), '8.4')
    await waitFor(`document.body.textContent.includes('Injected candidate failure')`)
    assert.equal(await selected('PHP version'), '8.5')
    await check('Enable shared Redis', true); await pause(40)
    assert.equal(await checked('Enable shared Redis'), true)
    assert.match(await evaluate('document.body.textContent'), /Enabling Redis/)
    await waitFor(`document.body.textContent.includes('Injected candidate failure')`)
    assert.equal(await checked('Enable shared Redis'), false)
    await check('Enable shared Memcached', true); await pause(40)
    assert.equal(await checked('Enable shared Memcached'), true)
    assert.match(await evaluate('document.body.textContent'), /Enabling Memcached/)
    await waitFor(`document.body.textContent.includes('Injected candidate failure')`)
    assert.equal(await checked('Enable shared Memcached'), false)
    await pause(400)
    assert.equal(await evaluate(`(()=>{const target=document.getElementById('runtime-status').getBoundingClientRect(), pane=document.querySelector('main > section > div.overflow-auto').getBoundingClientRect();return target.top>=pane.top-1&&target.bottom<=pane.bottom+1})()`), true)
    fail = false
    assert.equal(await evaluate(`document.querySelectorAll('input[name="service-start-mode"]:checked').length`), 1)
    assert.equal(await evaluate(`document.querySelector('input[name="service-start-mode"]:checked').value`), 'on')
    await evaluate(`([...document.querySelectorAll('label')].find(label=>label.textContent.trim()==='After login').querySelector('input')).click()`)
    await waitFor(`window.vhostra.getState().then(state=>state.settings.startup.serviceStartMode==='after-login' && state.settings.startup.launchAtLogin)`)
    assert.equal(await evaluate(`document.querySelectorAll('input[name="service-start-mode"]:checked').length`), 1)
    await evaluate(`([...document.querySelectorAll('label')].find(label=>label.textContent.includes('Launch Vhostra on Login')).querySelector('input')).click()`)
    await waitFor(`window.vhostra.getState().then(state=>state.settings.startup.serviceStartMode==='manual' && !state.settings.startup.launchAtLogin)`)
    let serviceRows = [{ id: 'web', label: 'Nginx', enabled: true, state: 'stopped' }, { id: 'mariadb', label: 'MariaDB', enabled: true, state: 'running' }, { id: 'redis', label: 'Redis', enabled: false, state: 'disabled' }, { id: 'memcached', label: 'Memcached', enabled: false, state: 'disabled' }]
    ipcMain.removeHandler('vhostra:list-managed-services')
    ipcMain.handle('vhostra:list-managed-services', () => serviceRows)
    ipcMain.removeHandler('vhostra:control-managed-service')
    ipcMain.handle('vhostra:control-managed-service', async (_event, id, action) => { await pause(300); serviceRows = serviceRows.map(row => row.id === id ? { ...row, state: action === 'stop' ? 'stopped' : 'running' } : row); return serviceRows })
    await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent==='Services')).click()`)
    await waitFor(`document.getElementById('services-runtime-status')!==null`)
    await evaluate(`(()=>{const pane=document.getElementById('services-runtime-status').closest('.overflow-auto');pane.style.height='320px';pane.scrollTop=0;const card=[...document.querySelectorAll('article')].find(node=>node.textContent.includes('MariaDB'));card.querySelector('button').click()})()`)
    await waitFor(`document.getElementById('services-runtime-status').textContent.includes('stopped')`)
    await pause(500)
    assert.equal(await evaluate(`(()=>{const target=document.getElementById('services-runtime-status').getBoundingClientRect(),pane=document.getElementById('services-runtime-status').closest('.overflow-auto').getBoundingClientRect();return target.top>=pane.top-1&&target.bottom<=pane.bottom+1})()`), true)
    assert.equal(await evaluate(`document.body.textContent.includes('Ports & Services')`), false)
    await evaluate(`document.getElementById('services-runtime-status').closest('.overflow-auto').scrollTop=0`)
    runtime.set({ state: 'stopped', message: 'Background fixture status', services: [], serviceRevision: 123 })
    await pause(400)
    assert.equal(await evaluate(`document.getElementById('services-runtime-status').closest('.overflow-auto').scrollTop`), 0)
    const visibleScroll = await evaluate(`(()=>{const pane=document.getElementById('services-runtime-status').closest('.overflow-auto');pane.scrollTop=pane.scrollHeight-pane.clientHeight;return pane.scrollTop})()`)
    await evaluate(`([...document.querySelectorAll('article')].find(node=>node.textContent.includes('MariaDB')).querySelector('button')).click()`)
    await waitFor(`document.getElementById('services-runtime-status').textContent.includes('running')`)
    await pause(400)
    assert.ok(Math.abs((await evaluate(`document.getElementById('services-runtime-status').closest('.overflow-auto').scrollTop`)) - visibleScroll) <= 1)
    console.log('PASS Settings requested state, Ports value, rollback, startup radio, Services scroll and background no-scroll.')
    passed = true
  } catch (error) { console.error(error) }
  finally { clearTimeout(deadline); await runtime?.pauseBackgroundWork(); runtime?.dispose(); window?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); await pause(200); if (passed) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(error => console.error('Deferred fixture cleanup:', error)); else console.error('Retained Settings fixture:', profile); app.exit(passed ? 0 : 1) }
})
