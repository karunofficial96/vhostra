import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { executeProtectedTransaction } from './protected-transaction.js'
import { systemStoragePaths } from './storage-paths.js'

async function stagingRoots(root: string) {
  const parent = systemStoragePaths('darwin').configuration
  if (process.platform !== 'darwin' || path.dirname(root) !== parent || !/^\.Vhostra-permission-stage-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path.basename(root)))
    throw new Error('Protected Vhostra staging root is invalid.')
  for (const directory of ['/Library', '/Library/Application Support', parent, root, path.join(root, 'configuration')]) {
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o755)
      throw new Error('Protected Vhostra staging directory is unsafe.')
  }
  return { configuration: root, data: root, logs: path.join(root, 'logs') }
}

async function main() {
  if (process.argv.length !== 1 || !process.env.VHOSTRA_PROTECTED_REQUEST) throw new Error('Protected Vhostra request is missing.')
  const file = process.env.VHOSTRA_PROTECTED_REQUEST
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let input: string
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 2 * 1024 * 1024) throw new Error('Protected Vhostra request has an invalid size or file type.')
    input = await handle.readFile({ encoding: 'utf8' })
  } finally { await handle.close() }
  const request = JSON.parse(input) as unknown
  const stage = process.env.VHOSTRA_PROTECTED_STAGE_ROOT
  if (stage) {
    if (!request || typeof request !== 'object' || !Array.isArray((request as { operations?: unknown }).operations)
      || (request as { operations: Array<{ type?: unknown }> }).operations.some(operation => operation?.type !== 'generated-web-config'))
      throw new Error('Protected Vhostra staging accepts generated configuration only.')
  }
  const result = stage
    ? await executeProtectedTransaction(request, await stagingRoots(stage), path.join(stage, 'hosts'))
    : await executeProtectedTransaction(request)
  process.stdout.write(JSON.stringify(result))
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message.slice(0, 240) : 'Protected Vhostra transaction failed.'}\n`)
  process.exitCode = 1
})
