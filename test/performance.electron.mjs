// Read-only resource acceptance harness; never uses the real desktop profile.
import { app } from 'electron'
import { rm } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-app-performance-'))
app.setPath('userData', profile)
app.whenReady().then(async () => {
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const timeout = setTimeout(() => app.exit(1), 60000)
try {
 const { applicationSession } = await import('../dist-electron/main.js')
 await app.whenReady(); await pause(3000)
 const window = applicationSession().window
 if (!window) throw Error('No application window')
 await pause(10000)
 const sample = label => console.log(JSON.stringify({ label, mode: app.isPackaged ? 'packaged application (ad hoc test bundle)' : process.env.VITE_DEV_SERVER_URL ? 'development-renderer' : 'production-bundle (unpackaged Electron)', processes: app.getAppMetrics().map(({pid,type,cpu,memory})=>({pid,type,cpu:cpu.percentCPUUsage,rssKiB:memory.workingSetSize})), main:process.memoryUsage() }))
 sample('visible'); await pause(10000); sample('visible-idle')
 window.hide(); await pause(10000); sample('hidden-idle'); await pause(10000); sample('hidden-settled')
 const assert = (await import('node:assert/strict')).default
 const runtime = applicationSession().runtime
 await window.webContents.executeJavaScript('window.resourceStatusEvents=0; window.vhostra.onRuntimeStatus(()=>window.resourceStatusEvents++); undefined')
 await runtime.runExclusive('starting', 'Hidden operation fixture', async () => {
  for(let index=0;index<100;index++) runtime.appendProgress(`Hidden output ${index}`)
 });
 await runtime.operation; await pause(100)
 assert.equal(await window.webContents.executeJavaScript('window.resourceStatusEvents'),0,'Hidden window receives no progress IPC')
 assert.equal(runtime.diagnostics().progressLines,0); assert.equal(runtime.progressNotification,undefined)
 window.show(); await pause(200)
 assert.ok(await window.webContents.executeJavaScript('window.resourceStatusEvents')>0,'Showing window publishes latest snapshot')
 console.log('Hidden progress suppression, show synchronization, and terminal buffer/timer dormancy passed.')
} finally { clearTimeout(timeout); await rm(profile,{recursive:true,force:true}); app.quit() }

}).catch(error => { console.error(error); app.exit(1) })
