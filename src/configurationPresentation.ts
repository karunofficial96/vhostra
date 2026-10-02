import type { RuntimeSnapshot, VhostraSettings, VhostraState } from './types/domain'

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

type RuntimeConfiguration = Readonly<Pick<VhostraSettings, 'selectedWebServer' | 'selectedPhpVersion'> & { optionalServices: Readonly<VhostraSettings['optionalServices']> }>
export type ActiveConfigurationOperation = { readonly id: number; readonly intent: readonly Readonly<ConfigurationOperation>[]; readonly sourceConfiguration: RuntimeConfiguration; readonly targetConfiguration: RuntimeConfiguration }

const runtimeConfiguration = (settings: VhostraSettings): RuntimeConfiguration => Object.freeze({
  selectedWebServer: settings.selectedWebServer,
  selectedPhpVersion: settings.selectedPhpVersion,
  optionalServices: Object.freeze({ ...settings.optionalServices }),
})

/** Capture intent once, before the request can change a settings observation. */
export function beginConfigurationOperation(id: number, verified: VhostraSettings, requested: VhostraSettings): ActiveConfigurationOperation {
  return Object.freeze({ id, intent: Object.freeze(configurationOperations(verified, requested).map(operation => Object.freeze(operation))), sourceConfiguration: runtimeConfiguration(verified), targetConfiguration: runtimeConfiguration(requested) })
}

/** The secondary line describes the runtime side of the technical phase. */
export function runtimeSecondaryStatus(runtime: RuntimeSnapshot | null, operation: ActiveConfigurationOperation | null, shown: VhostraSettings): string {
  const phase = runtime?.replacementPhase === 'restoring' && operation ? 'restoring' : runtime?.state ?? 'Checking'
  const configuration = operation && (phase === 'stopping' || phase === 'restoring') ? operation.sourceConfiguration
    : operation && phase === 'starting' ? operation.targetConfiguration : shown
  const label = phase.charAt(0).toUpperCase() + phase.slice(1)
  return `${label} · ${serverName(configuration.selectedWebServer)} · PHP ${configuration.selectedPhpVersion}`
}

/** Lifecycle labels use the captured side of a replacement, never a live selector. */
export function configurationLifecycleMessage(operation: Readonly<ConfigurationOperation>, phase: 'stopping' | 'starting' | 'restoring'): string {
  if (operation.kind === 'cache') return phase === 'restoring' ? `Restoring previous ${operation.service} configuration…` : `${operation.direction === 'enable' ? 'Enabling' : 'Disabling'} ${operation.service}…`
  const identity = phase === 'starting' ? operation.target : operation.source
  const name = operation.kind === 'php-switch' ? `PHP ${identity}` : serverName(identity as VhostraSettings['selectedWebServer'])
  return `${phase === 'stopping' ? 'Stopping' : phase === 'starting' ? 'Starting' : 'Restoring'} ${name}…`
}

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

export function configurationOperationMessage(operations: readonly Readonly<ConfigurationOperation>[]): string | null {
  if (!operations.length) return null
  return operations.map(operation => operation.kind === 'php-switch'
    ? `Switching PHP from ${operation.source} to ${operation.target}`
    : operation.kind === 'server-switch'
      ? `Switching web server from ${serverName(operation.source)} to ${serverName(operation.target)}`
      : `${operation.direction === 'enable' ? 'Enabling' : 'Disabling'} ${operation.service}`).join(' · ') + '…'
}
