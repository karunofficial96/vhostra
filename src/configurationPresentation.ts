import type { VhostraSettings, VhostraState } from './types/domain'

/** Runtime observations can lag a configuration request; controls show the request until settlement. */
export function displayedConfiguration(verified: VhostraSettings, requested: VhostraSettings | null): VhostraSettings {
  return requested ?? verified
}

/** A successful backend acknowledgement commits the request in the same render that clears it. */
export function settledConfiguration(observed: VhostraState, requested: VhostraSettings, succeeded: boolean): VhostraState {
  return succeeded ? { ...observed, settings: requested } : observed
}

export type ConfigurationOperation =
  | { kind: 'php-switch'; source: string; target: string }
  | { kind: 'server-switch'; source: VhostraSettings['selectedWebServer']; target: VhostraSettings['selectedWebServer'] }
  | { kind: 'cache'; service: 'Redis' | 'Memcached'; direction: 'enable' | 'disable' }

const serverName = (server: VhostraSettings['selectedWebServer']) => ({ openlitespeed: 'OpenLiteSpeed', apache: 'Apache', nginx: 'Nginx' })[server]

/** The verified settings identify the source; the transient request identifies the target. */
export function configurationOperations(verified: VhostraSettings, requested: VhostraSettings | null): ConfigurationOperation[] {
  if (!requested) return []
  const operations: ConfigurationOperation[] = []
  if (verified.selectedPhpVersion !== requested.selectedPhpVersion) operations.push({ kind: 'php-switch', source: verified.selectedPhpVersion, target: requested.selectedPhpVersion })
  if (verified.selectedWebServer !== requested.selectedWebServer) operations.push({ kind: 'server-switch', source: verified.selectedWebServer, target: requested.selectedWebServer })
  for (const [id, service] of [['redis', 'Redis'], ['memcached', 'Memcached']] as const) {
    if (verified.optionalServices[id] !== requested.optionalServices[id]) operations.push({ kind: 'cache', service, direction: requested.optionalServices[id] ? 'enable' : 'disable' })
  }
  return operations
}

export function configurationOperationMessage(operations: ConfigurationOperation[]): string | null {
  if (!operations.length) return null
  return operations.map(operation => operation.kind === 'php-switch'
    ? `Switching PHP from ${operation.source} to ${operation.target}`
    : operation.kind === 'server-switch'
      ? `Switching web server from ${serverName(operation.source)} to ${serverName(operation.target)}`
      : `${operation.direction === 'enable' ? 'Enabling' : 'Disabling'} ${operation.service}`).join(' · ') + '…'
}
