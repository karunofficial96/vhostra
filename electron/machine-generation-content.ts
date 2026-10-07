import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { StoreLayout } from './store.js'
import type { SystemStoragePaths } from './storage-paths.js'
import { isManagedBuiltInName } from './builtin-publisher.js'
import { MachineGenerationController, validateGenerationLedger, type AtomicGenerationStore } from './machine-generation.js'

const issued = new WeakSet<object>()
const proof = Symbol('validated committed built-in generation')
const idPattern = /^[a-f0-9]{32}$/
const digestPattern = /^[a-f0-9]{64}$/
const required = ['index.html', 'vhostra-health.php', 'vhostra-extensions.php', 'vhostra-cache-health.php', 'vhostra-extension-state.php']
const fail = (message: string): never => { throw new Error(`Committed built-in generation: ${message}`) }
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')

/** Constructor token is module-private; Compose accepts only resolver-issued values. */
export class CommittedBuiltInGeneration {
  private readonly brand = true
  constructor(readonly id: string, readonly dataRoot: string, readonly publicRoot: string, token: symbol) {
    if (token !== proof) fail('validated resolver proof is required')
    issued.add(this); Object.freeze(this)
  }
}

export function committedBuiltInMount(layout: StoreLayout, value: CommittedBuiltInGeneration | undefined): string {
  if (!value || !issued.has(value) || !layout.userRoot || !layout.dataRoot
    || path.resolve(layout.dataRoot) !== value.dataRoot
    || value.publicRoot !== path.join(value.dataRoot, 'service-data', 'localhost', 'generations', value.id, 'public'))
    return fail('validated committed generation is required for machine Compose')
  return value.publicRoot
}

async function safeEntry(file: string, directory: boolean): Promise<void> {
  const info = await fs.lstat(file)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) fail('unsafe generation entry')
}

function generationDirectory(roots: SystemStoragePaths, id: string): string {
  if (!idPattern.test(id)) return fail('invalid generation ID')
  return path.join(roots.data, 'service-data', 'localhost', 'generations', id)
}

/** Only the validated ledger pointer can authorize a Compose built-in mount. */
export async function resolveCommittedBuiltInGeneration(roots: SystemStoragePaths, store: AtomicGenerationStore): Promise<CommittedBuiltInGeneration> {
  const ledger = validateGenerationLedger(await store.read())
  if (!ledger.committed) return fail('no committed generation')
  const directory = generationDirectory(roots, ledger.committed)
  const publicRoot = path.join(directory, 'public')
  for (const item of [roots.data, path.join(roots.data, 'service-data'), path.join(roots.data, 'service-data', 'localhost'),
    path.join(roots.data, 'service-data', 'localhost', 'generations'), directory, publicRoot]) await safeEntry(item, true)
  const manifestFile = path.join(publicRoot, '.vhostra-built-in.json')
  await safeEntry(manifestFile, false)
  const manifestInfo = await fs.stat(manifestFile)
  if (manifestInfo.size > 16 * 1024) fail('manifest exceeds limit')
  let manifest: Record<string, unknown>
  try { manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as Record<string, unknown> }
  catch { return fail('manifest is malformed') }
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'contentVersion,format,generationId,hashes'
    || manifest.format !== 'vhostra/built-in/v1' || manifest.generationId !== ledger.committed
    || typeof manifest.contentVersion !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(manifest.contentVersion)
    || !manifest.hashes || typeof manifest.hashes !== 'object' || Array.isArray(manifest.hashes)) fail('manifest is invalid')
  const hashes = manifest.hashes as Record<string, unknown>
  const names = Object.keys(hashes)
  if (names.length > 128 || required.some(name => !names.includes(name))) fail('manifest is incomplete')
  let bytes = 0
  for (const name of names) {
    if (!isManagedBuiltInName(name) || typeof hashes[name] !== 'string' || !digestPattern.test(hashes[name])) fail('manifest contains an unsafe file')
    const file = path.join(publicRoot, name)
    if (path.dirname(file) !== publicRoot) await safeEntry(path.dirname(file), true)
    await safeEntry(file, false)
    const info = await fs.stat(file)
    bytes += info.size
    if (info.size > 8 * 1024 * 1024 || bytes > 8 * 1024 * 1024) fail('content exceeds limit')
    if (digest(await fs.readFile(file)) !== hashes[name]) fail('content hash does not match manifest')
  }
  const observed = new Set<string>()
  const scan = async (directory: string, prefix = ''): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!['assets', 'services', 'fonts'].includes(name)) fail('content has an unexpected directory')
        await safeEntry(file, true)
        await scan(file, name)
      } else {
        await safeEntry(file, false)
        if (name !== '.vhostra-built-in.json' && !names.includes(name)) fail('content has an unmanifested file')
        observed.add(name)
      }
    }
  }
  await scan(publicRoot)
  if (names.some(name => !observed.has(name))) fail('content is incomplete')
  return new CommittedBuiltInGeneration(ledger.committed, path.resolve(roots.data), publicRoot, proof)
}

/** Synthetic-only cleanup: no caller path or generic recursive delete primitive. */
export async function cleanupStagingBuiltInGenerations(roots: SystemStoragePaths, store: AtomicGenerationStore): Promise<string[]> {
  const ledger = validateGenerationLedger(await store.read())
  const base = path.join(roots.data, 'service-data', 'localhost', 'generations')
  for (const directory of [roots.data, path.join(roots.data, 'service-data'),
    path.join(roots.data, 'service-data', 'localhost'), base]) await safeEntry(directory, true)
  const removed: string[] = []
  for (const entry of ledger.generations) {
    if (entry.id === ledger.committed || entry.id === ledger.rollback || entry.phase === 'preparing' || entry.phase === 'verified') continue
    const directory = generationDirectory(roots, entry.id)
    const info = await fs.lstat(directory).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
    if (!info) continue
    await safeEntry(directory, true)
    let count = 0, bytes = 0
    const visit = async (parent: string, depth: number): Promise<void> => {
      if (depth > 3) fail('cleanup tree is too deep')
      for (const child of await fs.readdir(parent, { withFileTypes: true })) {
        const file = path.join(parent, child.name)
        const relative = path.relative(directory, file).replaceAll(path.sep, '/')
        count++
        if (count > 256) fail('cleanup tree is too large')
        const stat = await fs.lstat(file)
        if (stat.isSymbolicLink()) fail('cleanup tree contains a link')
        if (stat.isDirectory()) {
          if (!['public', 'public/assets', 'public/services', 'public/fonts'].includes(relative)) fail('cleanup tree contains an unknown directory')
          await visit(file, depth + 1)
        } else {
          const name = relative.startsWith('public/') ? relative.slice('public/'.length) : ''
          if (!stat.isFile() || stat.nlink !== 1 || !(isManagedBuiltInName(name) || name === '.vhostra-built-in.json'
            || /^\.[a-zA-Z0-9_.-]+\.vhostra-[a-f0-9-]{36}\.tmp$/.test(name))) fail('cleanup tree contains an unknown file')
          bytes += stat.size
          if (bytes > 32 * 1024 * 1024) fail('cleanup tree exceeds limit')
        }
      }
    }
    await visit(directory, 0)
    await fs.rm(directory, { recursive: true, force: false })
    removed.push(entry.id)
  }
  await new MachineGenerationController(store).cleanup()
  return removed
}
