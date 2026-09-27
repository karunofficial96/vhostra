import { access, rm, open, readFile } from 'node:fs/promises'
import os from 'node:os'
import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distElectron = path.join(root, 'dist-electron')
const port = Number(process.env.VHOSTRA_DEV_PORT ?? 9000)
const executable = name => process.platform === 'win32' ? `${path.join(root, 'node_modules', '.bin', name)}.cmd` : path.join(root, 'node_modules', '.bin', name)
const children = new Set()
const lockFile = path.join(os.tmpdir(), `vhostra-dev-${createHash('sha256').update(root).digest('hex').slice(0, 24)}.lock`)
let ownsLock = false
let stopping = false
let cleanupPromise
const signal = (child, force = false) => {
  // Each POSIX child owns a process group, including Electron helpers/esbuild.
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore' })
    else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) { if (error.code !== 'ESRCH') console.error('[Vhostra] Child cleanup failed:', error.message) }
}
const cleanup = (code = 0) => {
  if (cleanupPromise) return cleanupPromise
  stopping = true
  process.exitCode = code
  cleanupPromise = (async () => {
    const active = [...children]
    const exited = active.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))
    active.forEach(child => signal(child))
    let timeout
    await Promise.race([Promise.all(exited), new Promise(resolve => { timeout = setTimeout(resolve, 3000) })])
    clearTimeout(timeout)
    // Also reap descendants whose direct parent already exited.
    active.forEach(child => signal(child, true))
    if (ownsLock) { await rm(lockFile, { force: true }); ownsLock = false }
  })()
  return cleanupPromise
}
process.on('SIGINT', () => { void cleanup(0) })
process.on('SIGTERM', () => { void cleanup(0) })
const start = (command, args, options = {}) => {
  if (stopping) throw Error('Development startup cancelled.')
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32', ...options })
  children.add(child)
  child.once('error', error => { console.error(`[Vhostra] ${command}: ${error.message}`); void cleanup(1) })
  child.once('exit', (code, signal) => { if (!stopping) void cleanup(code ?? (signal ? 1 : 0)) })
  return child
}
const waitFor = async (condition, description) => {
  const deadline = Date.now() + 30_000
  while (!stopping && Date.now() < deadline) {
    if (await condition()) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw Error(stopping ? 'Development startup cancelled.' : `Timed out waiting for ${description}.`)
}
const fileExists = file => access(file).then(() => true).catch(() => false)
const portOpen = () => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port })
  const finish = value => { socket.destroy(); resolve(value) }
  socket.setTimeout(500, () => finish(false))
  socket.once('connect', () => finish(true))
  socket.once('error', () => finish(false))
})
try {
  try {
    const previous = Number(await readFile(lockFile, 'utf8'))
    try { process.kill(previous, 0); throw Error('A development session is already running for this checkout.') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
    await rm(lockFile)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (stopping) throw Error('Development startup cancelled.')
  const lock = await open(lockFile, 'wx'); ownsLock = true
  await lock.writeFile(String(process.pid)); await lock.close()
  // Refuse before removing shared output or starting watchers in a second session.
  if (await portOpen()) throw Error(`Development port ${port} is already in use. Close the existing dev session or set VHOSTRA_DEV_PORT.`)
  if (stopping) throw Error('Development startup cancelled.')
  await rm(distElectron, { recursive: true, force: true })
  start(executable('vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'])
  start(executable('tsc'), ['-p', 'electron/tsconfig.json', '--watch', '--preserveWatchOutput'])
  await waitFor(() => Promise.all([fileExists(path.join(distElectron, 'main.js')), fileExists(path.join(distElectron, 'preload.cjs'))]).then(result => result.every(Boolean)), 'compiled Electron main and preload output')
  await waitFor(portOpen, `Vite on http://127.0.0.1:${port}`)
  const environment = { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: `http://127.0.0.1:${port}` }
  delete environment.ELECTRON_RUN_AS_NODE
  start(executable('electron'), ['.'], { env: environment })
} catch (error) {
  if (!stopping) console.error(`[Vhostra] Development startup failed: ${error.message}`)
  await cleanup(stopping ? process.exitCode : 1)
} finally {
  if (stopping && ownsLock) { await rm(lockFile, { force: true }); ownsLock = false }
}
