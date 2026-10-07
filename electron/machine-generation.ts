import path from 'node:path'
import type { SystemStoragePaths } from './storage-paths.js'

export type GenerationPhase = 'preparing' | 'verified' | 'committed' | 'retired' | 'failed'
export interface GenerationRecord { id: string; phase: GenerationPhase; configurationDigest: string }
export interface GenerationLedgerState {
  format: 'vhostra/machine-generations/v1'
  revision: number
  committed: string | null
  rollback: string | null
  generations: GenerationRecord[]
}
/** Implemented only by the future signed coordinator's atomic protected store. */
export interface AtomicGenerationStore {
  read(): Promise<GenerationLedgerState>
  compareAndSwap(expectedRevision: number, next: GenerationLedgerState): Promise<boolean>
}

const idPattern = /^[a-f0-9]{32}$/
const digestPattern = /^[a-f0-9]{64}$/
const phases = new Set<GenerationPhase>(['preparing', 'verified', 'committed', 'retired', 'failed'])
const fail = (message: string): never => { throw new Error(`Machine generation: ${message}`) }
const clone = (state: GenerationLedgerState): GenerationLedgerState => ({ ...state, generations: state.generations.map(record => ({ ...record })) })

export function emptyGenerationLedger(): GenerationLedgerState {
  return { format: 'vhostra/machine-generations/v1', revision: 0, committed: null, rollback: null, generations: [] }
}

/** A verified pointer, never a caller path, chooses the built-in projection. */
export function committedBuiltInPublicPath(roots: SystemStoragePaths, ledger: unknown): string {
  const state = validateGenerationLedger(ledger)
  if (!state.committed) return fail('no committed generation')
  return path.join(roots.data, 'service-data', 'localhost', 'generations', state.committed, 'public')
}

export function validateGenerationLedger(value: unknown): GenerationLedgerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid ledger')
  const state = value as Record<string, unknown>
  if (Object.keys(state).sort().join(',') !== 'committed,format,generations,revision,rollback'
    || state.format !== 'vhostra/machine-generations/v1'
    || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0
    || state.committed !== null && (typeof state.committed !== 'string' || !idPattern.test(state.committed))
    || state.rollback !== null && (typeof state.rollback !== 'string' || !idPattern.test(state.rollback))
    || !Array.isArray(state.generations) || state.generations.length > 32) return fail('invalid ledger')
  const seen = new Set<string>()
  let committedCount = 0
  for (const entry of state.generations) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('invalid record')
    const record = entry as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'configurationDigest,id,phase'
      || typeof record.id !== 'string' || !idPattern.test(record.id) || seen.has(record.id)
      || typeof record.configurationDigest !== 'string' || !digestPattern.test(record.configurationDigest)
      || !phases.has(record.phase as GenerationPhase)) return fail('invalid record')
    seen.add(record.id)
    if (record.phase === 'committed') committedCount++
  }
  if (committedCount !== (state.committed === null ? 0 : 1)
    || state.committed !== null && !(state.generations as GenerationRecord[]).some(item => item.id === state.committed && item.phase === 'committed'))
    return fail('committed pointer is inconsistent')
  if (state.rollback !== null && (state.rollback === state.committed
    || !(state.generations as GenerationRecord[]).some(item => item.id === state.rollback && item.phase === 'retired')))
    return fail('rollback pointer is inconsistent')
  return clone(state as unknown as GenerationLedgerState)
}

export class MachineGenerationController {
  constructor(private readonly store: AtomicGenerationStore) {}

  async current(): Promise<GenerationRecord | null> {
    const state = validateGenerationLedger(await this.store.read())
    return state.generations.find(item => item.id === state.committed) ?? null
  }

  private async change(mutator: (state: GenerationLedgerState) => void): Promise<GenerationLedgerState> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = validateGenerationLedger(await this.store.read())
      const next = clone(state)
      mutator(next)
      next.revision++
      validateGenerationLedger(next)
      if (await this.store.compareAndSwap(state.revision, next)) return next
    }
    return fail('concurrent update did not settle')
  }

  async begin(id: string, configurationDigest: string): Promise<void> {
    if (!idPattern.test(id) || !digestPattern.test(configurationDigest)) return fail('invalid generation identity')
    await this.change(state => {
      if (state.generations.some(item => item.id === id)) return fail('generation already exists')
      if (state.generations.some(item => item.phase === 'preparing' || item.phase === 'verified')) return fail('another generation is pending')
      if (state.generations.length >= 32) return fail('cleanup required before another generation')
      state.generations.push({ id, configurationDigest, phase: 'preparing' })
    })
  }

  async verified(id: string): Promise<void> {
    await this.change(state => {
      const entry = state.generations.find(item => item.id === id)
      if (!entry || entry.phase !== 'preparing') return fail('generation is not preparing')
      entry.phase = 'verified'
    })
  }

  async commit(id: string): Promise<void> {
    await this.change(state => {
      const entry = state.generations.find(item => item.id === id)
      if (!entry || entry.phase !== 'verified') return fail('generation is not verified')
      const previous = state.generations.find(item => item.id === state.committed)
      if (previous) previous.phase = 'retired'
      state.rollback = previous?.id ?? null
      entry.phase = 'committed'
      state.committed = id
    })
  }

  async fail(id: string): Promise<void> {
    await this.change(state => {
      const entry = state.generations.find(item => item.id === id)
      if (!entry || !['preparing', 'verified'].includes(entry.phase)) return fail('only an incomplete generation can fail')
      entry.phase = 'failed'
    })
  }

  /** A fresh coordinator ignores incomplete work and retains the last commit. */
  async recover(): Promise<GenerationRecord | null> {
    const state = validateGenerationLedger(await this.store.read())
    return state.generations.find(item => item.id === state.committed) ?? null
  }

  async cleanup(): Promise<void> {
    await this.change(state => {
      state.generations = state.generations.filter(item => item.id === state.committed || item.id === state.rollback || item.phase === 'preparing' || item.phase === 'verified')
    })
  }
}
