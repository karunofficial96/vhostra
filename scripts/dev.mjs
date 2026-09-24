import { access, rm } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const distElectron = path.join(root, 'dist-electron')
const port = Number(process.env.VHOSTRA_DEV_PORT ?? 9000)
const executable = (name) => process.platform === 'win32' ? `${path.join(root, 'node_modules', '.bin', name)}.cmd` : path.join(root, 'node_modules', '.bin', name)
const children = []

const start = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
  children.push(child)
  return child
}
const cleanup = () => children.forEach(child => { if (!child.killed) child.kill('SIGTERM') })
const waitFor = async (condition, description) => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${description}.`)
}
const fileExists = async file => access(file).then(() => true).catch(() => false)
const portOpen = () => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port })
  socket.once('connect', () => { socket.end(); resolve(true) })
  socket.once('error', () => resolve(false))
})

try {
  await rm(distElectron, { recursive: true, force: true })
  const vite = start(executable('vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'])
  const main = start(executable('tsc'), ['-p', 'electron/tsconfig.json', '--watch', '--preserveWatchOutput'])
  const preload = start(executable('tsc'), ['-p', 'electron/tsconfig.preload.json', '--watch', '--preserveWatchOutput'])
  for (const child of [vite, main, preload]) child.once('exit', code => { if (code && !process.exitCode) { process.exitCode = code; cleanup() } })
  await waitFor(() => Promise.all([fileExists(path.join(distElectron, 'main.js')), fileExists(path.join(distElectron, 'preload.cjs'))]).then(result => result.every(Boolean)), 'compiled Electron main and preload output')
  await waitFor(portOpen, `Vite on http://127.0.0.1:${port}`)
  const environment = { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: `http://127.0.0.1:${port}` }; delete environment.ELECTRON_RUN_AS_NODE
  const electron = start(executable('electron'), ['.'], { env: environment })
  electron.once('exit', code => { cleanup(); process.exitCode = code ?? 0 })
} catch (error) {
  console.error(`[Vhostra] Development startup failed: ${error instanceof Error ? error.message : error}`)
  cleanup(); process.exitCode = 1
}

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
