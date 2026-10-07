import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SystemStoragePaths } from './storage-paths.js'
import { emptyGenerationLedger, validateGenerationLedger, type AtomicGenerationStore, type GenerationLedgerState } from './machine-generation.js'

/** Synthetic fixed-root adapter only. Production has no way to select it. */
export class StagingGenerationFileStore implements AtomicGenerationStore {
  private readonly directory: string
  private readonly ledger: string
  constructor(roots: SystemStoragePaths, private readonly fault?: (point: 'after-temp-sync' | 'after-rename') => void) {
    this.directory = path.join(roots.configuration, 'generation-control')
    this.ledger = path.join(this.directory, 'ledger.json')
  }

  private async checkDirectory(): Promise<void> {
    for (const directory of [path.dirname(this.directory), this.directory]) {
      const info = await fs.lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Generation staging directory is unsafe.')
    }
  }

  private async syncDirectory(): Promise<void> {
    const handle = await fs.open(this.directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }

  private async replace(state: GenerationLedgerState): Promise<void> {
    const temporary = path.join(this.directory, `.ledger-${randomUUID()}.tmp`)
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(validateGenerationLedger(state)) + '\n')
      await handle.sync()
    } finally { await handle.close() }
    try {
      this.fault?.('after-temp-sync')
      await fs.rename(temporary, this.ledger)
      this.fault?.('after-rename')
      await this.syncDirectory()
    } finally { await fs.rm(temporary, { force: true }) }
  }

  async bootstrap(): Promise<void> {
    const parent = path.dirname(this.directory)
    const parentInfo = await fs.lstat(parent)
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Generation staging parent is unsafe.')
    const existing = await fs.lstat(this.directory).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
    if (existing) throw new Error('Generation staging already exists; missing or damaged ledger must not be recreated.')
    await fs.mkdir(this.directory, { mode: 0o700 })
    const parentHandle = await fs.open(parent, 'r')
    try { await parentHandle.sync() } finally { await parentHandle.close() }
    await this.syncDirectory()
    await this.replace(emptyGenerationLedger())
  }

  async read(): Promise<GenerationLedgerState> {
    await this.checkDirectory()
    const info = await fs.lstat(this.ledger)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 64 * 1024)
      throw new Error('Generation ledger has unsafe metadata.')
    let parsed: unknown
    try { parsed = JSON.parse(await fs.readFile(this.ledger, 'utf8')) } catch { throw new Error('Generation ledger is malformed or truncated.') }
    return validateGenerationLedger(parsed)
  }

  async compareAndSwap(expectedRevision: number, next: GenerationLedgerState): Promise<boolean> {
    await this.checkDirectory()
    const lock = path.join(this.directory, '.write-lock')
    await fs.mkdir(lock, { mode: 0o700 }) // Existing lock fails closed; no background retry or stale-lock takeover.
    try {
      const current = await this.read()
      if (current.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false
      await this.replace(next)
      return true
    } finally { await fs.rmdir(lock) }
  }
}
