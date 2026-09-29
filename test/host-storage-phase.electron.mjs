// Native production renderer/IPC acceptance. Protected writes target a TEMP file.
// The POSIX native write plan executes unelevated only in this test harness.
import assert from 'node:assert/strict'
import { app, dialog, nativeTheme } from 'electron'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-host-ui-'))
app.setPath('userData', profile)
app.whenReady().then(async () => {
  let session; let project; let source; let failed = false
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const timeout = setTimeout(() => app.exit(1), 120000)
  try {
    const { VhostraStore } = await import('../dist-electron/store.js')
    project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-host-ui-project-')); await writeFile(path.join(project, 'index.php'), '<?php echo "preserved";')
    source = await mkdtemp(path.join(os.tmpdir(), 'vhostra-backup-source-')); const backupStore = new VhostraStore(source)
    const state = await backupStore.getState(); await backupStore.saveSettings({ ...state.settings, selectedWebServer: 'nginx', selectedPhpVersion: '8.3', optionalServices: { redis: false, memcached: false } }); await backupStore.saveOnboarding({ ...(await backupStore.getOnboarding()), theme: 'dark' })
    await backupStore.addSite({ name: 'Restored Site', documentRoot: project, url: 'http://restored.test' })
    const backup = path.join(source, 'backup.json'); await backupStore.exportBundle(backup)
    const portable = JSON.parse(await readFile(backup, 'utf8')); portable.configuration.sites.find(site => !site.builtIn).documentRoot = 'C:\\Users\\example\\Sites\\restored'; portable.configuration.virtualHosts.find(host => !host.builtIn).documentRoot = 'C:\\Users\\example\\Sites\\restored'; await writeFile(backup, JSON.stringify(portable))
    const { applicationSession } = await import('../dist-electron/main.js'); await pause(800); session = applicationSession()
    const window = session.window; const runtime = session.runtime; runtime.scope = `vhostra-host-ui-${process.pid}`; const evaluate = code => window.webContents.executeJavaScript(code)
    const waitFor = async expression => { const end = Date.now() + 20000; while (!await evaluate(expression)) { if (Date.now() > end) throw Error(`Timeout: ${expression}`); await pause(100) } }
    const click = label => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing button: '+${JSON.stringify(label)});button.click()})()`)
    const input = (label, value) => evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)}));const input=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    assert.equal(window.isMaximizable(), false); assert.equal(window.isFullScreenable(), false); assert.equal(window.isResizable(), true)
    assert.match(await evaluate('document.body.textContent'), /Set up as new/); assert.match(await evaluate('document.body.textContent'), /Import existing Vhostra backup/)
    const tempHosts = path.join(profile, 'test-hosts'); await writeFile(tempHosts, '127.0.0.1 localhost\n# unrelated preserved\n')
    Object.defineProperty(session.hosts, 'hostsPath', { value: tempHosts }); session.hosts.platform = 'linux'
    session.hosts.execute = async (_command, args) => promisify(execFile)('/bin/sh', args.slice(1))
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] })
    await click('Import existing Vhostra backup'); await waitFor('document.body.textContent.includes("Review backup")')
    assert.match(await evaluate('document.body.textContent'), /nginx/); assert.match(await evaluate('document.body.textContent'), /8\.3/)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); await click('Choose host document root'); await waitFor(`document.body.textContent.includes(${JSON.stringify(project)})`)
    const plannedBackupText = await evaluate('document.body.textContent'); assert.match(plannedBackupText, /Access Log/); assert.ok(plannedBackupText.includes(profile))
    await evaluate(`(()=>{const select=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Restore for web server')).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'apache');select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await click('Restore supported configuration'); await waitFor('document.body.textContent.includes("Ready to set up")')
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark'); assert.ok(plannedBackupText.includes((await evaluate('window.vhostra.getState()')).virtualHosts.find(host => host.hostname === 'restored.test').logs.paths.access))
    assert.doesNotMatch(await evaluate('document.body.textContent'), /Choose your web server/); assert.equal((await evaluate('window.vhostra.getState()')).settings.selectedWebServer, 'apache')
    const originalStart = runtime.start; runtime.start = async () => runtime.set({ state: 'running', services: ['runtime'], message: 'Native UI contract fixture' })
    await click('Set Up Vhostra'); await waitFor('document.body.textContent.includes("Thank you for setting up Vhostra")')
    assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed, false)
    await writeFile('/private/tmp/vhostra-host-thank-you.png', (await window.webContents.capturePage()).toPNG())
    await click('Start using Vhostra'); await waitFor('document.body.textContent.includes("Dashboard")'); runtime.start = originalStart
    await window.reload(); await waitFor('document.body.textContent.includes("Dashboard")'); assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark')
    // Keep actual host-file, store and generated configuration logic; avoid Docker
    // lifecycle changes in this renderer acceptance (covered by live suites).
    runtime.applyConfiguration = async () => { runtime.set({ state: 'not-created', services: [], message: 'No test runtime' }); await runtime.generate(await runtime.getState()) }
    await click('Sites'); await waitFor('document.body.textContent.includes("Repair all mappings")')
    assert.doesNotMatch(await evaluate('document.querySelector("nav").textContent'), /Virtual Hosts|Server/)
    await click('Add site'); await waitFor('document.body.textContent.includes("Access Log")')
    const plan = await evaluate('document.querySelector("form dl").textContent'); assert.ok(plan.includes(profile))
    await input('Site name', 'UI Site'); await input('Local URL', 'http://old.test'); await input('Document root', project); await input('Server aliases', 'www.old.test')
    await click('Save site'); await waitFor('!document.querySelector("form") && document.body.textContent.includes("UI Site")')
    const site = (await evaluate('window.vhostra.getState()')).sites.find(site => site.name === 'UI Site'); assert.ok(site)
    assert.match(await readFile(tempHosts, 'utf8'), /old.test www.old.test/)
    await evaluate('document.querySelector(\'[aria-label="Edit UI Site"]\').click()'); await pause(100)
    await input('Local URL', 'http://new.test'); await input('Server aliases', 'www.new.test'); await click('Save site'); await waitFor('!document.querySelector("form") && document.body.textContent.includes("http://new.test")')
    const renamed = await readFile(tempHosts, 'utf8'); assert.match(renamed, /new.test www.new.test/); assert.doesNotMatch(renamed, /old.test/); assert.match(renamed, /# unrelated preserved/)
    await writeFile('/private/tmp/vhostra-host-sites-dark.png', (await window.webContents.capturePage()).toPNG())
    await evaluate(`window.vhostra.setVirtualHostRewrite(${JSON.stringify(site.vhostId)}, false)`); assert.equal((await evaluate('window.vhostra.getState()')).virtualHosts.find(host => host.id === site.vhostId).rewriteEnabled, false); assert.equal((await evaluate('window.vhostra.getState()')).virtualHosts.find(host => host.builtIn).rewriteEnabled !== false, true); await evaluate(`window.vhostra.setVirtualHostRewrite(${JSON.stringify(site.vhostId)}, true)`)
    // Cancellation rolls back canonical Site and generated config.
    const executor = session.hosts.execute; session.hosts.execute = async () => { throw Error('Permission cancelled') }
    await assert.rejects(evaluate(`window.vhostra.updateSite(${JSON.stringify({ id: site.id, name: site.name, documentRoot: project, url: 'http://cancelled.test', aliases: [] })})`), /rolled back/)
    assert.equal((await evaluate('window.vhostra.getState()')).sites.find(item => item.id === site.id).url, 'http://new.test'); session.hosts.execute = executor
    const nativeSource = path.join(source, 'apache.conf'); const nativeText = '<VirtualHost *:80>\nServerName imported.test\nDocumentRoot "/old-computer/site"\nCustomLog "/old-computer/access.log" combined\nErrorLog "/old-computer/error.log"\n</VirtualHost>\n'; await writeFile(nativeSource, nativeText)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nativeSource] }); await click('Choose configuration and preview'); await waitFor('document.body.textContent.includes("imported.test")')
    assert.match(await evaluate('document.body.textContent'), /Access Log/); assert.ok((await evaluate('document.body.textContent')).includes(profile))
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); await click('Choose host document root'); await pause(150); await click('Accept findings and import Sites'); await waitFor('document.body.textContent.includes("Imported 1")')
    assert.equal((await evaluate('window.vhostra.getState()')).sites.find(site => site.url.includes('imported.test')).documentRoot, project); assert.equal(await readFile(nativeSource, 'utf8'), nativeText)
    await backupStore.addSite({ name: 'Missing backup Site', documentRoot: project, url: 'http://backup-added.test' }); await backupStore.exportBundle(backup)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] }); await click('Import Vhostra configuration'); await waitFor('document.body.textContent.includes("Review configuration backup")')
    const missingLogPlan = await evaluate('document.body.textContent'); assert.match(missingLogPlan, /backup-added.test/)
    await evaluate(`(()=>{for(const section of document.querySelectorAll('section')){const heading=section.querySelector('h3');if(heading?.textContent.includes('restored.test')&&section.querySelector('select')){const select=section.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'keep');select.dispatchEvent(new Event('change',{bubbles:true}))}}})()`);
    await click('Import Site definitions'); await waitFor('!document.body.textContent.includes("Review configuration backup")'); const addedHost = (await evaluate('window.vhostra.getState()')).virtualHosts.find(host => host.hostname === 'backup-added.test'); assert.ok(addedHost); assert.ok(missingLogPlan.includes(addedHost.logs.paths.access)); assert.equal((await evaluate('window.vhostra.getState()')).settings.selectedPhpVersion, '8.3')
    await click('Settings'); await waitFor('document.body.textContent.includes("Reset Vhostra")')
    await click('Inspect Hosts file'); await waitFor('document.querySelector("textarea") !== null')
    assert.equal(await evaluate('document.querySelector("textarea").readOnly'), true)
    const originalManual = await readFile(tempHosts, 'utf8'); let manualElevations = 0
    const manualExecutor = session.hosts.execute; session.hosts.execute = async (...args) => { manualElevations++; return manualExecutor(...args) }
    const setHostsDraft = value => evaluate(`(()=>{const input=document.querySelector('[aria-label="Hosts file contents"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    const manualDraft = text => text.replace('# unrelated preserved', '# manually changed comment').split('\n').filter(line => !(line.includes('new.test') && line.includes('# Vhostra'))).join('\n') + '192.0.2.5 www.new.test # manual conflict\n127.0.0.1 manual.test\n'
    await click('Edit complete Hosts file'); await setHostsDraft(manualDraft(originalManual)); await click('Review changes')
    await waitFor('document.querySelector("[role=dialog]")?.textContent.includes("Vhostra-managed mappings will change or be deleted")')
    assert.match(await evaluate(`document.querySelector('[aria-label="Hosts changes diff"]').textContent`), /manually changed comment/)
    assert.equal(manualElevations, 0); assert.equal(await readFile(tempHosts, 'utf8'), originalManual)
    await click('Back to Edit'); assert.equal(await readFile(tempHosts, 'utf8'), originalManual)
    await click('Review changes'); await waitFor('document.querySelector("[role=dialog]") !== null')
    const externalManual = originalManual + '# external update\n'; await writeFile(tempHosts, externalManual)
    await click('Save Changes'); await waitFor('document.body.textContent.includes("Hosts file changed externally")')
    assert.equal(manualElevations, 0); assert.equal(await readFile(tempHosts, 'utf8'), externalManual)
    await click('Reload current file and review'); await waitFor(`document.querySelector('[aria-label="Previous Hosts draft"]') !== null`)
    assert.ok((await evaluate(`document.querySelector('[aria-label="Hosts file contents"]').value`)).includes('# external update'))
    assert.ok((await evaluate(`document.querySelector('[aria-label="Previous Hosts draft"]').value`)).includes('# manually changed comment'))
    await click('Edit complete Hosts file'); await setHostsDraft(manualDraft(externalManual)); await click('Review changes'); await waitFor('document.querySelector("[role=dialog]") !== null'); await pause(150)
    await writeFile('/private/tmp/vhostra-hosts-full-file-review.png', (await window.webContents.capturePage()).toPNG())
    session.hosts.execute = async () => { throw Error('Authentication cancelled (-128)') }
    await click('Save Changes'); await waitFor('document.body.textContent.includes("Authentication cancelled")')
    assert.equal(await readFile(tempHosts, 'utf8'), externalManual)
    session.hosts.execute = async (...args) => { manualElevations++; return manualExecutor(...args) }
    await click('Review changes'); await waitFor('document.querySelector("[role=dialog]") !== null'); await click('Save Changes'); await waitFor('document.body.textContent.includes("Hosts file saved and verified")')
    assert.equal(manualElevations, 1); assert.equal(await readFile(tempHosts, 'utf8'), manualDraft(externalManual))
    assert.match(await evaluate('document.body.textContent'), /new.test — Missing/); assert.match(await evaluate('document.body.textContent'), /www.new.test — Conflict/)
    const manualStatus = await evaluate('window.vhostra.allHostsStatus()'); assert.equal(manualStatus.find(row => row.hostname === 'new.test').state, 'required'); assert.equal(manualStatus.find(row => row.hostname === 'www.new.test').state, 'conflict')
    await evaluate(`window.vhostra.repairSite(${JSON.stringify(site.vhostId)})`); assert.equal(await readFile(tempHosts, 'utf8'), manualDraft(externalManual), 'Repair must not overwrite the unrelated manual conflict')
    for (const label of ['Keep configurations', 'Remove configurations']) {
      const before = JSON.stringify(await evaluate('window.vhostra.getState()')); await click('Reset Vhostra…'); await click(label); await waitFor('document.querySelector("[role=dialog]").textContent.includes("Are you sure you want to reset?")'); await pause(150)
      await writeFile(`/private/tmp/vhostra-host-reset-${label.startsWith('Keep') ? 'keep' : 'remove'}.png`, (await window.webContents.capturePage()).toPNG())
      assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'), label.startsWith('Keep') ? /preserv/i : /removed/i)
      await click('No'); assert.equal(JSON.stringify(await evaluate('window.vhostra.getState()')), before)
    }
    // Actual backend file reset after final UI confirmation, no Docker resource.
    runtime.resetRuntime = async () => undefined; await click('Reset Vhostra…'); await click('Remove configurations'); await click('Yes, Reset Vhostra'); await waitFor('document.body.textContent.includes("Welcome to Vhostra")')
    assert.equal((await evaluate('window.vhostra.getState()')).sites.length, 1); assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /preserved/)
    console.log('Native UI/IPC: backup preview/restore skips restored settings, theme restart persistence, final setup gate, unified Site create/edit/aliases, protected-write cancellation rollback, full-file Hosts review/confirmation, owned-entry warning, race reload/draft preservation, authentication cancellation, missing/conflict recalculation without silent repair, both reset cancel paths and final removal/reset to onboarding, external-file preservation and native window flags passed.')
  } catch (error) { failed = true; console.error(error); if (session?.window) console.error(await session.window.webContents.executeJavaScript('document.body.textContent')) }
  finally {
    clearTimeout(timeout); nativeTheme.themeSource = 'system'; await session?.runtime.pauseBackgroundWork(); session?.runtime.dispose(); session?.window?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs()
    if (!failed) for (const directory of [profile, project, source].filter(Boolean)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
    else console.error(`Native failure profile retained: ${profile}`)
    app.exit(failed ? 1 : 0)
  }
})
