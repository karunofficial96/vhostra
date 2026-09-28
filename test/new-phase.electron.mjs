import assert from 'node:assert/strict'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-phase-ui-'))
app.setPath('userData', profile)
app.whenReady().then(async () => {
  const timeout = setTimeout(() => app.exit(1), 90000)
  let welcome; let runtime; let desktopWindow; let failed = false
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  try {
    const { applicationSession } = await import('../dist-electron/main.js')
    await pause(800)
    const window = applicationSession().window; desktopWindow = window; runtime = applicationSession().runtime; runtime.scope = `vhostra-phase-ui-${process.pid}`
    const evaluate = code => window.webContents.executeJavaScript(code)
    const waitFor = async expression => { const deadline = Date.now() + 15000; while (!await evaluate(expression)) { if (Date.now() > deadline) throw Error(`Timed out waiting for ${expression}`); await pause(100) } }
    const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes(${JSON.stringify(text)})).click()`)
    assert.match(await evaluate('document.body.textContent'), /Welcome to Vhostra/)
    const initial = await evaluate('window.vhostra.getOnboarding()')
    assert.equal(initial.preferences.completed, false); assert.equal(initial.preferences.php, initial.phpVersions.at(-1)); assert.equal(initial.preferences.server, 'openlitespeed'); assert.equal(initial.preferences.cache, 'none')
    await click('Set up as new'); await pause(100)
    await click('Dark'); await pause(150)
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark')
    await writeFile('/private/tmp/vhostra-onboarding-dark.png', (await window.webContents.capturePage()).toPNG())
    await click('Light'); await pause(100)
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light')
    await writeFile('/private/tmp/vhostra-onboarding-light.png', (await window.webContents.capturePage()).toPNG())
    await click('System'); nativeTheme.themeSource = 'dark'; await pause(150)
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark')
    nativeTheme.themeSource = 'light'; await pause(150)
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light')
    await click('Continue'); await pause(100); await click('Nginx'); await pause(100)
    await click('Continue'); await pause(100)
    assert.equal(await evaluate('document.querySelector("select").value'), initial.phpVersions.at(-1))
    await click('Continue'); await pause(100)
    for (const cache of ['Redis', 'Memcached', 'No cache service']) { await click(cache); await pause(100) }
    await click('Continue'); await pause(100)
    assert.match(await evaluate('document.body.textContent'), /Ready to set up/)
    const start = runtime.start
    runtime.start = async () => { throw Error('Injected setup failure: Docker unavailable') }
    await click('Set Up Vhostra'); await waitFor('document.body.textContent.includes("Injected setup failure")')
    assert.match(await evaluate('document.body.textContent'), /Injected setup failure/)
    assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed, false)
    // Completion gate contract fixture. Live runtime health is tested separately
    // by the sequential runtime suite; no protected Hosts file is modified here.
    runtime.start = async () => { runtime.set({ state: 'running', message: 'Setup contract fixture verified', services: ['runtime'] }) }
    await click('Set Up Vhostra'); await waitFor('document.body.textContent.includes("Thank you for setting up Vhostra")'); assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed, false); await click('Start using Vhostra'); await waitFor('document.body.textContent.includes("Dashboard")')
    assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed, true)
    assert.match(await evaluate('document.body.textContent'), /Dashboard/)
    runtime.start = start
    window.setSize(860, 700); await pause(100)
    let samples = 0; const resourceUsage = runtime.resourceUsage
    runtime.resourceUsage = async () => { samples++; return null }
    await click('Resources'); await waitFor('document.body.textContent.includes("summed process working sets")')
    assert.match(await evaluate('document.body.textContent'), /summed process working sets/)
    const resources = await evaluate('window.vhostra.getResources()')
    assert.ok(resources.application.ramBytes > 0); assert.ok(resources.application.processes >= 2)
    assert.ok(resources.storage.localTotalBytes > 0)
    const contentBounds = await evaluate('(()=>{const main=document.querySelector("main");return main.scrollWidth<=main.clientWidth})()')
    assert.equal(contentBounds, true)
    await writeFile('/private/tmp/vhostra-resources.png', (await window.webContents.capturePage()).toPNG())
    await pause(8500); assert.ok(samples >= 3)
    await click('Dashboard'); await pause(200); const before = samples; await pause(8500); assert.equal(samples, before)
    await click('Resources'); await pause(300); window.hide(); await pause(8500); assert.equal(samples, before + 1); window.show(); await pause(400)
    runtime.resourceUsage = resourceUsage
    await window.reload(); await pause(500)
    assert.doesNotMatch(await evaluate('document.body.textContent'), /Welcome to Vhostra/)
    welcome = new BrowserWindow({ width: 1000, height: 760, show: false })
    await welcome.loadFile(path.join(runtime.layout.sites, 'localhost', 'public', 'index.html'))
    for (const theme of ['light', 'dark', 'system']) {
      await welcome.webContents.executeJavaScript(`(()=>{for(let i=0;i<3 && document.querySelector('#theme-toggle').getAttribute('aria-label') !== 'Appearance: ${theme}';i++) document.querySelector('#theme-toggle').click();})()`)
      assert.equal(await welcome.webContents.executeJavaScript('document.querySelector("#theme-toggle").getAttribute("aria-label")'), `Appearance: ${theme}`)
      assert.equal(await welcome.webContents.executeJavaScript('localStorage.getItem("vhostra:welcome-appearance")'), theme)
    }
    nativeTheme.themeSource = 'dark'; await pause(150)
    assert.equal(await welcome.webContents.executeJavaScript('document.documentElement.dataset.theme'), 'dark')
    nativeTheme.themeSource = 'light'; await pause(150)
    assert.equal(await welcome.webContents.executeJavaScript('document.documentElement.dataset.theme'), 'light')
    console.log('Native production UI: genuine first run, backend versions/defaults, theme/icons/system changes, choices, failure/retry completion contract, no reappearance, actual application/storage metrics, minimum bounds, visible-only nonoverlapping resource samples and localhost three-way OS-following appearance passed.')
  } catch (error) { failed = true; console.error(error) } finally {
    clearTimeout(timeout); nativeTheme.themeSource = 'system'; welcome?.destroy(); await runtime?.pauseBackgroundWork(); runtime?.dispose(); desktopWindow?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); app.exit(failed ? 1 : 0)
  }
}).catch(error => { console.error(error); app.exit(1) })
