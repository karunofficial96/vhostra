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
const deadline = setTimeout(() => app.exit(1), 60000)
app.whenReady().then(async () => {
  let window, runtime, passed = false
  try {
    const { VhostraStore } = await import('../dist-electron/store.js')
    const store = new VhostraStore(profile, path.resolve('dist-welcome'))
    await store.saveOnboarding({ ...await store.getOnboarding(), completed: true })
    const initial = await store.getState()
    await store.saveSettings({ ...initial.settings, startup: { ...initial.settings.startup, startServicesOnLaunch: false } })
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
    assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(item=>item.textContent.includes('Web server')).querySelector('img').alt`), 'Nginx logo')
    await waitFor(`document.body.textContent.includes('Injected candidate failure')`)
    assert.equal(await selected('Web server'), 'openlitespeed')
    fail = false
    await select('Web server', 'nginx'); await pause(40)
    assert.equal(await selected('Web server'), 'nginx')
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
    console.log('PASS Settings requested state, icon, pending labels, and rollback.')
    passed = true
  } catch (error) { console.error(error) }
  finally { clearTimeout(deadline); await runtime?.pauseBackgroundWork(); runtime?.dispose(); window?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); await pause(200); if (passed) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(error => console.error('Deferred fixture cleanup:', error)); else console.error('Retained Settings fixture:', profile); app.exit(passed ? 0 : 1) }
})
