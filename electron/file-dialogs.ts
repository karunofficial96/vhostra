import { app, dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// One local directory preference. No filenames or usage history are retained.
const preferenceFile = () => path.join(app.getPath('userData'), 'file-dialog-location.json')

async function available(directory: string) {
  if (!path.isAbsolute(directory)) return false
  try { const stat = await fs.stat(directory); await fs.access(directory); return stat.isDirectory() } catch { return false }
}

async function startingPath(defaultPath?: string, preserveDefault = false) {
  if (preserveDefault) return defaultPath
  let remembered = ''
  try { remembered = JSON.parse(await fs.readFile(preferenceFile(), 'utf8')).lastFileDialogDirectory } catch { /* first use */ }
  const directory = typeof remembered === 'string' && await available(remembered) ? remembered
    : defaultPath && await available(path.dirname(defaultPath)) ? path.dirname(defaultPath)
    : app.getPath('documents')
  return defaultPath && path.extname(defaultPath) ? path.join(directory, path.basename(defaultPath)) : directory
}

async function remember(directory: string) {
  if (!await available(directory)) return
  const file = preferenceFile(); const temporary = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  try { await fs.writeFile(temporary, JSON.stringify({ lastFileDialogDirectory: directory }), { mode: 0o600 }); await fs.rename(temporary, file) }
  finally { await fs.rm(temporary, { force: true }) }
}

export async function openFileDialog(options: OpenDialogOptions, window?: BrowserWindow, preserveDefault = false) {
  const value = { ...options, defaultPath: await startingPath(options.defaultPath, preserveDefault) }
  const result = window ? await dialog.showOpenDialog(window, value) : await dialog.showOpenDialog(value)
  if (!result.canceled && result.filePaths[0]) {
    const selected = result.filePaths[0]
    const folder = await fs.stat(selected).then(stat => stat.isDirectory(), () => false)
    await remember(folder ? selected : path.dirname(selected)).catch(() => undefined)
  }
  return result
}

export async function saveFileDialog(options: SaveDialogOptions, window?: BrowserWindow) {
  const value = { ...options, defaultPath: await startingPath(options.defaultPath) }
  const result = window ? await dialog.showSaveDialog(window, value) : await dialog.showSaveDialog(value)
  if (!result.canceled && result.filePath) await remember(path.dirname(result.filePath)).catch(() => undefined)
  return result
}
