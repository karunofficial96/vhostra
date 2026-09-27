export type ShutdownMode = 'keep-services' | 'stop-services' | 'minimize-to-tray'

/** Shared, injectable policy. Never exit until a requested stop is verified. */
export function createShutdownManager(dependencies: {
  refresh: () => Promise<{ state: string }>
  stop: () => Promise<unknown>
  hide: () => void
  quit: () => void
}) {
  let pending: Promise<void> | null = null
  return function shutdown(mode: ShutdownMode): Promise<void> {
    if (!['keep-services', 'stop-services', 'minimize-to-tray'].includes(mode)) return Promise.reject(new Error('Unknown Vhostra shutdown mode.'))
    if (pending) return pending
    if (mode === 'minimize-to-tray') { dependencies.hide(); return Promise.resolve() }
    pending = (async () => {
      if (mode === 'stop-services') {
        const current = await dependencies.refresh()
        if (current.state === 'unavailable') throw new Error('Docker is unavailable. Vhostra cannot verify that services stopped. Choose Keep Services Running to exit without stopping them.')
        if (current.state !== 'stopped' && current.state !== 'not-created') await dependencies.stop()
        const final = await dependencies.refresh()
        if (final.state !== 'stopped' && final.state !== 'not-created') throw new Error('Vhostra could not verify that its runtime stopped. The application remains open.')
      }
      dependencies.quit()
    })().finally(() => { pending = null })
    return pending
  }
}
