import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

app.whenReady().then(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-terminal-'))
  const store = new VhostraStore(root, path.resolve('dist-welcome'))
  const runtime = new DockerRuntimeController(store.layout, () => store.getState())
  const window = new BrowserWindow({ width: 1000, height: 820, show: true, webPreferences: { preload: path.resolve('dist-electron/preload.cjs'), contextIsolation: true, sandbox: true } })
  const evaluate = code => window.webContents.executeJavaScript(code)
  const settle = () => new Promise(resolve => setTimeout(resolve, 80))
  let release
  try {
    ipcMain.handle('vhostra:get-onboarding', () => ({ preferences: { completed: true }, phpVersions: [] }))
    ipcMain.handle('vhostra:get-state', () => store.getState())
    ipcMain.handle('vhostra:get-runtime-status', () => runtime.current())
    runtime.subscribe(() => window.webContents.send('vhostra:runtime-status', runtime.current()))
    await window.loadFile(path.resolve('dist/index.html')); await settle()
    assert.equal(await evaluate("Boolean(document.querySelector('.runtime-expand'))"), false)
    const operation = runtime.runExclusive('starting', 'Checking Docker…', async () => {
      await runtime.requireDocker()
      await new Promise(resolve => { release = resolve })
      runtime.set({ state: 'running', message: 'Runtime ready.', services: ['runtime'] })
    })
    while (!release) await new Promise(resolve => setTimeout(resolve, 30))
    await settle()
    await evaluate("document.querySelector('.runtime-expand').click()"); await settle()
    assert.match(await evaluate("document.querySelector('.runtime-terminal').textContent"), /Docker runtime available/)
    // Fixture lines exercise the renderer's scroll behavior through the real backend subscription.
    for (let index = 0; index < 60; index++) runtime.appendProgress(`Terminal scrolling fixture ${index}`)
    await settle()
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.runtime-terminal')).fontFamily"), '"Roboto Mono", monospace')
    await evaluate("document.querySelector('.runtime-terminal').scrollTop=0"); await settle()
    runtime.appendProgress('password=fixture-secret'); await settle()
    assert.equal(await evaluate("document.querySelector('.runtime-terminal').scrollTop"), 0)
    assert.doesNotMatch(await evaluate("document.querySelector('.runtime-terminal').textContent"), /fixture-secret/)
    for (const theme of ['light', 'dark']) {
      for (let click = 0; click < 3; click++) { if (await evaluate(`document.querySelector('button[aria-label="Appearance: ${theme}"]') !== null`)) break; await evaluate("document.querySelector('button[aria-label^=\"Appearance: \"]').click()"); await settle() }
      await evaluate("document.querySelector('.runtime-terminal').scrollIntoView()")
      await settle()
      assert.ok(await evaluate("document.querySelector('.runtime-terminal').clientHeight <= 240"))
      await writeFile(`/private/tmp/vhostra-terminal-${theme}.png`, (await window.webContents.capturePage()).toPNG())
    }
    await evaluate("[...document.querySelectorAll('.runtime-expand')].find(b=>b.textContent.includes('Follow')).click()"); await settle()
    assert.ok(await evaluate("(()=>{const n=document.querySelector('.runtime-terminal');return n.scrollHeight-n.scrollTop-n.clientHeight<24})()"))
    window.setSize(860, 700); await settle()
    assert.equal(await evaluate("(()=>{const n=document.querySelector('main>section>div:last-child');return n.scrollWidth<=n.clientWidth})()"), true, 'Supported minimum window must not scroll horizontally')
    for (let click = 0; click < 3; click++) { if (await evaluate(`document.querySelector('button[aria-label="Appearance: system"]') !== null`)) break; await evaluate(`document.querySelector('button[aria-label^="Appearance: "]').click()`); await settle() }
    assert.equal(await evaluate("document.documentElement.dataset.theme"), await evaluate("matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'"))
    release(); await operation; await runtime.operation; await settle()
    assert.equal(await evaluate("Boolean(document.querySelector('.runtime-expand'))"), false)
    assert.equal(await evaluate("Boolean(document.querySelector('.runtime-terminal'))"), false)
    console.log('Production renderer: real Docker progress, active-only Expand, secret redaction, scroll-back/follow, bundled font, light/dark bounds passed.')
  } finally {
    release?.(); runtime.dispose(); window.destroy()
    ipcMain.removeHandler('vhostra:get-onboarding'); ipcMain.removeHandler('vhostra:get-state'); ipcMain.removeHandler('vhostra:get-runtime-status')
    await rm(root, { recursive: true, force: true }); app.quit()
  }
}).catch(error => { console.error(error); app.exit(1) })
