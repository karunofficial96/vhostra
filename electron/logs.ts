import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function listPersistentLogs(root: string, recursive = true) { const output: Array<{ path: string; size: number; modifiedAt: string }> = []
  const walk = async (directory: string, prefix = ''): Promise<void> => {
    if (output.length >= 100) return
    let entries: import('node:fs').Dirent[]
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (output.length >= 100) return
      const relative = path.join(prefix, entry.name); const file = path.join(directory, entry.name)
      if (entry.isDirectory() && recursive) await walk(file, relative)
      else if (entry.isFile()) { const details = await fs.stat(file); output.push({ path: relative, size: details.size, modifiedAt: details.mtime.toISOString() }) }
    }
  }
  await walk(root)
  return output.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

export async function readLogTail(logDirectory: string, relative: string) {
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) throw new Error('Invalid persistent log path.')
  const root = path.resolve(logDirectory); const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Invalid persistent log path.')
  const resolved = await fs.realpath(file); const realRoot = await fs.realpath(root)
  if (!resolved.startsWith(`${realRoot}${path.sep}`)) throw new Error('Log links must remain inside Vhostra’s persistent log directory.')
  const details = await fs.stat(resolved); if (!details.isFile()) throw new Error('Log file was not found.')
  const length = Math.min(details.size, 64 * 1024); const handle = await fs.open(resolved, 'r')
  try { const buffer = Buffer.alloc(length); await handle.read(buffer, 0, length, Math.max(0, details.size - length)); return { path: relative, text: buffer.toString('utf8'), truncated: details.size > length, size: details.size } } finally { await handle.close() }
}

let applicationWrite: Promise<void> = Promise.resolve()
export function recordApplicationLog(root: string, message: string) {
  applicationWrite = applicationWrite.then(async () => {
    await fs.mkdir(root, { recursive: true })
    const file = path.join(root, 'application.log')
    if ((await fs.stat(file).catch(() => null))?.size! > 1024 * 1024) {
      await fs.rm(`${file}.3`, { force: true })
      for (const [source, target] of [[`${file}.2`, `${file}.3`], [`${file}.1`, `${file}.2`], [file, `${file}.1`]]) await fs.rename(source, target).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    await fs.appendFile(file, `${new Date().toISOString()} ${message.slice(0, 2000)}\n`, { mode: 0o600 })
  }).catch(error => console.error('Local application log could not be written:', error.message))
  return applicationWrite
}
export function drainApplicationLogs() { return applicationWrite }
