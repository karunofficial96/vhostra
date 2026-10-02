// Sequential live onboarding acceptance; never use the user's profile or Compose scope.
import assert from 'node:assert/strict'
import { app } from 'electron'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-onboarding-live-'))
app.setPath('userData', profile)
app.whenReady().then(async () => {
  let runtime; let failure = false
  const timeout = setTimeout(() => { console.error(`Timed out; diagnostics retained at ${profile}`); app.exit(1) }, 900000)
  try {
    const { applicationSession } = await import('../dist-electron/main.js')
    await new Promise(resolve => setTimeout(resolve, 700))
    const window = applicationSession().window; runtime = applicationSession().runtime
    runtime.scope = `vhostra-onboarding-live-${process.pid}`
    const evaluate = code => window.webContents.executeJavaScript(code)
    let total = 0; runtime.subscribe(() => { total = Math.max(total, runtime.current().progress?.total ?? 0) })
    assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed, false)
    await evaluate(`(async()=>{const state=await window.vhostra.getState(); await window.vhostra.saveSettings({...state.settings,ports:{http:29980,https:29943,phpMyAdmin:29981,mariadb:29906,redis:29979,memcached:29911}});const initial=await window.vhostra.getOnboarding();await window.vhostra.saveOnboarding({...initial.preferences,server:'openlitespeed',php:'8.3',cache:'none'});return window.vhostra.setupOnboarding()})()`)
    assert.equal(runtime.current().state, 'running'); assert.ok(total > 5); assert.equal(runtime.current().progress, undefined)
    const preferences = await evaluate('window.vhostra.getOnboarding()'); assert.equal(preferences.preferences.ready, true); assert.equal(preferences.preferences.completed, false); await evaluate('window.vhostra.finishOnboarding()'); assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed, true)
    const state = await evaluate('window.vhostra.getState()'); assert.equal(state.settings.selectedPhpVersion, '8.3'); assert.deepEqual(state.settings.optionalServices, { redis: false, memcached: false })
    const resources = await evaluate('window.vhostra.getResources()'); assert.ok(resources.runtime?.length); assert.ok(resources.dockerStorage.imageBytes > 0); assert.ok(resources.application.ramBytes > 0)
    const services = await runtime.listManagedServices(); assert.equal(services.find(service => service.id === 'redis').state, 'disabled'); assert.equal(services.find(service => service.id === 'memcached').state, 'disabled')
    console.log('Actual first-run backend setup passed: real OLS/PHP/MariaDB/phpMyAdmin health, active progress, disabled optional caches, completion only after success, and scoped Docker CPU/RAM/image storage.')
  } catch (error) { failure = true; console.error(error); console.error(`Diagnostics retained at ${profile}`) }
  finally {
    clearTimeout(timeout)
    let cleaned = !runtime
    if (runtime) { try { await runtime.resetRuntime(false); cleaned = true } catch (error) { failure = true; console.error('Exact onboarding fixture cleanup failed:', error) } finally { runtime.dispose() } }
    if (cleaned) await rm(profile, { recursive: true, force: true })
    app.exit(failure ? 1 : 0)
  }
}).catch(error => { console.error(error); app.exit(1) })
