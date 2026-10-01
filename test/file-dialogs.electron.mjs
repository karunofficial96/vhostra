import assert from 'node:assert/strict'
import { app, dialog } from 'electron'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

const profile = process.env.VHOSTRA_DIALOG_TEST_PROFILE
if (!profile || !path.isAbsolute(profile)) throw new Error('Use an isolated absolute VHOSTRA_DIALOG_TEST_PROFILE.')
app.setPath('userData', profile)
app.whenReady().then(async () => {
  try {
    const { openFileDialog, saveFileDialog } = await import('../dist-electron/file-dialogs.js')
    const directoryA = path.join(profile, 'A'), directoryB = path.join(profile, 'B')
    await mkdir(directoryA, { recursive: true }); await mkdir(directoryB, { recursive: true })
    if (process.env.VHOSTRA_DIALOG_PHASE === 'first') {
      let observed
      dialog.showOpenDialog = async options => { observed = options.defaultPath; return { canceled: false, filePaths: [path.join(directoryA, 'config.conf')] } }
      await openFileDialog({ properties: ['openFile'], filters: [{ name: 'Config', extensions: ['conf'] }] })
      assert.ok(path.isAbsolute(observed))
      dialog.showOpenDialog = async options => { assert.equal(options.defaultPath, directoryA); return { canceled: true, filePaths: [] } }
      await openFileDialog({ properties: ['openFile'] })
      dialog.showSaveDialog = async options => { assert.equal(options.defaultPath, path.join(directoryA, 'site.conf')); return { canceled: false, filePath: path.join(directoryB, 'site.conf') } }
      await saveFileDialog({ defaultPath: 'site.conf' })
      assert.equal(JSON.parse(await readFile(path.join(profile, 'file-dialog-location.json'))).lastFileDialogDirectory, directoryB)
    } else {
      dialog.showSaveDialog = async options => { assert.equal(options.defaultPath, path.join(directoryB, 'again.sql')); return { canceled: true } }
      await saveFileDialog({ defaultPath: 'again.sql' })
      await rm(directoryB, { recursive: true })
      dialog.showSaveDialog = async options => { assert.equal(options.defaultPath, path.join(app.getPath('documents'), 'again.sql')); return { canceled: true } }
      await saveFileDialog({ defaultPath: 'again.sql' })
      dialog.showOpenDialog = async options => { assert.equal(options.defaultPath, directoryA); return { canceled: true, filePaths: [] } }
      await openFileDialog({ defaultPath: directoryA, properties: ['openDirectory'] }, undefined, true)
    }
    console.log(`PASS file dialog ${process.env.VHOSTRA_DIALOG_PHASE}`)
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
