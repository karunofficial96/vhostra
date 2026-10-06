import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateProtectedTransaction, type ProtectedTransaction } from './protected-transaction.js'
import { systemStoragePaths } from './storage-paths.js'

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const apple = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** One short-lived native authorization for one fully validated transaction. */
export async function authorizeProtectedTransaction(request: ProtectedTransaction, nativeStageRoot?: string): Promise<{ completed: number }> {
  if (nativeStageRoot !== undefined) {
    const parent = systemStoragePaths('darwin').configuration
    if (path.dirname(nativeStageRoot) !== parent || !/^\.Vhostra-permission-stage-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path.basename(nativeStageRoot)))
      throw new Error('Protected Vhostra staging root is invalid.')
    if (request.operations.some(operation => operation.type !== 'generated-web-config')) throw new Error('Protected Vhostra staging accepts generated configuration only.')
    validateProtectedTransaction(request, { configuration: nativeStageRoot, data: nativeStageRoot, logs: path.join(nativeStageRoot, 'logs') }, path.join(nativeStageRoot, 'hosts'))
  } else validateProtectedTransaction(request)
  if (process.platform !== 'darwin') throw new Error('Protected Vhostra transactions are not yet available on this operating system.')
  const file = path.join(os.tmpdir(), `vhostra-protected-${randomUUID()}.json`)
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'protected-worker.cjs')
  const source = await fs.readFile(worker)
  if (source.length > 256 * 1024) throw new Error('Protected Vhostra worker exceeds its size limit.')
  // Embed the exact bundled worker bytes in this authorization call. A temporary
  // worker path cannot be swapped between approval and privileged execution.
  const program = `eval(Buffer.from(${JSON.stringify(source.toString('base64'))},'base64').toString('utf8'))`
  const contents = JSON.stringify(request)
  if (Buffer.byteLength(contents) > 2 * 1024 * 1024) throw new Error('Protected Vhostra request exceeds 2 MiB.')
  await fs.writeFile(file, contents, { flag: 'wx', mode: 0o600 })
  try {
    const stage = nativeStageRoot === undefined ? '' : `VHOSTRA_PROTECTED_STAGE_ROOT=${quote(nativeStageRoot)} `
    const command = `VHOSTRA_PROTECTED_REQUEST=${quote(file)} ${stage}ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} -e ${quote(program)}`
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('osascript', ['-e', `do shell script ${apple(command)} with administrator privileges`], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''; let stderr = ''
      child.stdout.on('data', chunk => { stdout += String(chunk).slice(0, 1024); if (stdout.length > 1024) child.kill() })
      child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 1024); if (stderr.length > 1024) child.kill() })
      child.once('error', reject)
      child.once('close', code => {
        if (code === 0) return resolve(stdout)
        const detail = nativeStageRoot === undefined ? '' : ` Staging diagnostic: ${stderr.trim().replaceAll(nativeStageRoot, '<stage>').replace(/\/Users\/[^/\s]+/g, '/Users/<user>').slice(0, 220)}`
        reject(new Error(`Protected Vhostra transaction was not authorized or did not complete (status ${code ?? 'unknown'}).${detail}`))
      })
    })
    const result = JSON.parse(output) as { completed?: unknown }
    if (result.completed !== request.operations.length) throw new Error('Protected Vhostra transaction completion count did not match.')
    return { completed: result.completed }
  } finally { await fs.rm(file, { force: true }) }
}
