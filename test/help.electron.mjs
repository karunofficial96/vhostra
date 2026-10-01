import assert from 'node:assert/strict'
import { app, clipboard, screen } from 'electron'
import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-help-ui-'))
app.setPath('userData', profile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = setTimeout(() => app.exit(1), 60000)
app.whenReady().then(async () => {
  let window, runtime, passed = false
  try {
    const { VhostraStore } = await import('../dist-electron/store.js')
    const store = new VhostraStore(profile, path.resolve('dist-welcome'))
    await store.saveOnboarding({ ...await store.getOnboarding(), completed: true, themeSaved: true, theme: 'light' })
    const { applicationSession } = await import('../dist-electron/main.js')
    await pause(600)
    ;({ window, runtime } = applicationSession())
    assert.equal(window.isResizable(), false)
    assert.equal(window.isMaximizable(), false)
    assert.equal(window.isFullScreenable(), false)
    const area = screen.getDisplayNearestPoint(window.getBounds()).workArea
    const bounds = window.getBounds()
    assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height)
    runtime.scope = `vhostra-help-ui-${process.pid}`
    runtime.set({ state: 'stopped', message: 'Fixture stopped.', services: [] })
    const evaluate = code => window.webContents.executeJavaScript(code)
    window.webContents.on('console-message', event => console.error('RENDERER', event.message))
    const waitFor = async code => { const until = Date.now() + 15000; while (!await evaluate(code)) { if (Date.now() > until) throw Error(`UI timeout: ${code}`); await pause(80) } }
    await waitFor('document.body.textContent.includes("Dashboard")')
    await evaluate(`document.querySelector('button[aria-label="Help and documentation"]').click()`)
    await waitFor(`document.querySelector("h1")?.textContent==="Help & Documentation"`)
    await evaluate(`document.querySelector('button[role="tab"][id="help-tab-8"]').click()`)
    const selectors = {title:'h1',description:'h1+p',heading:'section h2',subheading:'section h3',body:'section p.help-copyable',command:'pre.help-copyable',output:'pre.help-copyable:last-of-type',nav:'nav[aria-label="Help topics"] button',button:'button[aria-label="Copy command"]'}
    const selection = {}
    for (const [key, selector] of Object.entries(selectors)) selection[key] = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).userSelect`)
    for (const key of ['title','description','heading','subheading','nav','button']) assert.equal(selection[key], 'none', key)
    for (const key of ['body','command','output']) assert.equal(selection[key], 'text', key)
    const input = 'input[aria-label="Search local help"]'
    const search = async value => { await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(input)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`); await pause(80) }
    await evaluate('window.__helpRequests=0;window.fetch=new Proxy(window.fetch,{apply(target,thisArg,args){window.__helpRequests++;return Reflect.apply(target,thisArg,args)}});true')
    for (let index = 0; index < 11; index++) {
      await evaluate(`document.getElementById('help-tab-${index}').click()`)
      assert.equal(await evaluate(`document.querySelectorAll('section[role="tabpanel"]').length`), 1)
      assert.equal(await evaluate(`document.getElementById('help-tab-${index}').getAttribute('aria-selected')`), 'true')
    }
    assert.equal(await evaluate(`document.querySelectorAll('nav[aria-label="Help topics"] a').length`), 0)
    await evaluate(`document.getElementById('help-tab-0').focus()`)
    await evaluate(`document.getElementById('help-tab-0').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`)
    await waitFor(`document.getElementById('help-tab-1').getAttribute('aria-selected')==='true'`)
    await search('MariaDB')
    assert.equal(await evaluate(`document.querySelector('section[role="tabpanel"] h2').textContent`), 'Databases')
    assert.ok(await evaluate(`document.querySelectorAll('[aria-label="Help search results"] button').length>1`))
    for (const term of ['database','OpenLiteSpeed','CLI','Hosts','PHP','import','export','WordPress','MariaDB','Redis','Memcached','logs','reset','backup']) {
      await search(term)
      assert.ok(await evaluate(`document.querySelectorAll('section[role="tabpanel"]').length===1`), term)
    }
    await search('no-such-vhostra-help-topic')
    assert.equal(await evaluate('document.body.textContent.includes("No documentation found for this search.")'), true)
    await evaluate(`document.querySelector('input[aria-label="Search local help"]').focus()`)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await waitFor(`document.activeElement?.getAttribute('aria-label')==='Clear help search'`)
    await evaluate(`document.activeElement.click()`)
    await waitFor(`document.querySelectorAll('nav[aria-label="Help topics"] button').length===11`)
    await evaluate(`document.querySelector('button[role="tab"][id="help-tab-8"]').click()`)
    assert.equal(await evaluate('window.__helpRequests'), 0)
    assert.equal(await evaluate(`getComputedStyle([...document.querySelectorAll('pre.help-copyable')].find(pre=>pre.textContent.startsWith('Vhostra CLI'))).userSelect`), 'text')
    await evaluate(`document.querySelector('input[aria-label="Search local help"]').focus()`)
    assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Search local help')
    clipboard.clear()
    await evaluate(`document.querySelector('button[aria-label="Copy command"]').click()`)
    await waitFor(`document.querySelector('button[aria-label="Copied command"]')!==null`)
    assert.match(await clipboard.readText(), /^vhostra help/)
    await writeFile('/private/tmp/vhostra-help-light.png', (await window.webContents.capturePage()).toPNG())
    await evaluate(`document.documentElement.dataset.theme='dark'`)
    assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(24, 24, 24)')
    await writeFile('/private/tmp/vhostra-help-dark.png', (await window.webContents.capturePage()).toPNG())
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`), true)
    assert.equal(await evaluate(`(()=>{const nav=document.querySelector('nav[aria-label="Help topics"]');return nav.scrollWidth<=nav.clientWidth && new Set([...nav.querySelectorAll('[role="tab"]')].map(tab=>Math.round(tab.getBoundingClientRect().top))).size>1})()`), true)
    await writeFile('/private/tmp/vhostra-help-narrow.png', (await window.webContents.capturePage()).toPNG())
    app.getAppMetrics()
    await pause(4000)
    console.log('HELP_RESOURCE_SAMPLE', JSON.stringify(app.getAppMetrics().map(({type,cpu,memory})=>({type,cpu:cpu.percentCPUUsage,rssKiB:memory.workingSetSize}))))
    console.log('PASS Help selection, search, copy, local requests and light/dark rendering')
    passed = true
  } catch (error) { console.error(error) }
  finally { clearTimeout(deadline); await runtime?.pauseBackgroundWork(); runtime?.dispose(); window?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); if (passed) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); else console.error('Retained isolated Help UI fixture:', profile); app.exit(passed ? 0 : 1) }
})
