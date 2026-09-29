import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { rm } from 'node:fs/promises'

const root = process.argv.find(value => value.startsWith('--session-root='))?.slice('--session-root='.length)
if (!root) throw Error('An isolated session root is required')
app.setPath('userData', root)
console.log('Session harness importing main')
setTimeout(() => { console.error('Session harness timed out'); app.exit(1) }, 25000)
app.whenReady().then(async () => {
const { applicationSession } = await import('../dist-electron/main.js')
if (applicationSession().hasSingleInstanceLock) {
  try {
    await app.whenReady()
    console.log('Session ready')
    await new Promise(resolve => setTimeout(resolve, 500))
    const initial = applicationSession()
    const window = initial.window
    assert.ok(window && initial.tray)
    await window.webContents.executeJavaScript('document.readyState')
    for (const mode of ['hidden', 'minimized']) {
      if (mode === 'hidden') window.hide(); else window.minimize()
      const secondEvent = new Promise(resolve => app.once('second-instance', resolve))
      const child = spawn(process.execPath, [path.resolve('test/session.electron.mjs'), `--session-root=${root}`], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      let diagnostics = ''; child.stderr.on('data', value => diagnostics += value)
      const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(diagnostics))) })
      await Promise.race([Promise.all([secondEvent, exited]), new Promise((_, reject) => setTimeout(() => reject(Error('Second launch did not hand off')), 10000))])
      await new Promise(resolve => setTimeout(resolve, 400))
      assert.equal(applicationSession().window, window)
      assert.equal(applicationSession().tray, initial.tray)
      assert.equal(BrowserWindow.getAllWindows().length, 1)
      assert.equal(window.isVisible(), true)
      assert.equal(window.isMinimized(), false)
      assert.equal(window.isFocused(), true)
    }
    console.log('Actual Vhostra: second launches exit, retain one window/tray, restore and focus hidden/minimized owner.')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { app.releaseSingleInstanceLock(); await applicationSession().runtime.pauseBackgroundWork(); applicationSession().runtime.dispose(); applicationSession().window?.destroy(); await (await import('../dist-electron/logs.js')).drainApplicationLogs(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); app.exit(process.exitCode ?? 0) }
}

}).catch(error => { console.error(error); app.exit(1) })
