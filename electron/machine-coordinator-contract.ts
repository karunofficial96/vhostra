import { isIP } from 'node:net'

/** Requests carry intent and preconditions, never paths, file bytes or passwords. */
export type MachineCoordinatorRequest =
  | { type: 'ensure-database-credentials'; version: 1 }
  | { type: 'prepare-mariadb-storage'; version: 1; expectedSeries: '10.6' | '10.11' | '11.4' | '11.8' }
  | { type: 'prepare-mariadb-bootstrap'; version: 1 }
  | { type: 'provision-phpmyadmin'; version: 1 }
  | { type: 'prepare-web-secret-delivery'; version: 1; generationId: string }
  | { type: 'publish-built-in'; version: 1; contentVersion: string; generationId: string }
  | { type: 'publish-authoritative-generation'; version: 1; generationId: string; expectedRevision: number }
  | { type: 'publish-local-certificate'; version: 1; generationId: string; dnsNames: string[]; ipAddresses: string[] }

export interface MachineCoordinator {
  execute(request: MachineCoordinatorRequest): Promise<{ generationId: string; status: 'ready' | 'already-ready' }>
}

const generationId = /^[a-f0-9]{32}$/
const contentVersion = /^[a-z0-9][a-z0-9._-]{0,63}$/
const dnsName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const fail = (): never => { throw new Error('Machine coordinator request is not allowlisted.') }

export function validateMachineCoordinatorRequest(input: unknown): MachineCoordinatorRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
  const value = input as Record<string, unknown>
  const fields: Record<string, string[]> = {
    'ensure-database-credentials': ['type', 'version'],
    'prepare-mariadb-storage': ['type', 'version', 'expectedSeries'],
    'prepare-mariadb-bootstrap': ['type', 'version'],
    'provision-phpmyadmin': ['type', 'version'],
    'prepare-web-secret-delivery': ['type', 'version', 'generationId'],
    'publish-built-in': ['type', 'version', 'contentVersion', 'generationId'],
    'publish-authoritative-generation': ['type', 'version', 'generationId', 'expectedRevision'],
    'publish-local-certificate': ['type', 'version', 'generationId', 'dnsNames', 'ipAddresses'],
  }
  const allowed = fields[String(value.type)]
  if (!allowed || value.version !== 1 || Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) return fail()
  if (value.type === 'prepare-mariadb-storage' && !['10.6', '10.11', '11.4', '11.8'].includes(String(value.expectedSeries))) return fail()
  if ('generationId' in value && (typeof value.generationId !== 'string' || !generationId.test(value.generationId))) return fail()
  if (value.type === 'publish-built-in' && (typeof value.contentVersion !== 'string' || !contentVersion.test(value.contentVersion))) return fail()
  if (value.type === 'publish-authoritative-generation' && (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0)) return fail()
  if (value.type === 'publish-local-certificate') {
    if (!Array.isArray(value.dnsNames) || !Array.isArray(value.ipAddresses)
      || value.dnsNames.length < 1 || value.dnsNames.length > 64 || value.ipAddresses.length < 1 || value.ipAddresses.length > 8
      || !value.dnsNames.includes('localhost') || !value.ipAddresses.includes('127.0.0.1')
      || value.dnsNames.some(name => typeof name !== 'string' || !dnsName.test(name))
      || value.ipAddresses.some(ip => typeof ip !== 'string' || isIP(ip) === 0)
      || new Set(value.dnsNames.map(name => name.toLowerCase())).size !== value.dnsNames.length
      || new Set(value.ipAddresses).size !== value.ipAddresses.length) return fail()
  }
  return value as MachineCoordinatorRequest
}

/** No production implementation exists until signed peer verification is available. */
export function unavailableProductionMachineCoordinator(): MachineCoordinator {
  throw new Error('Signed machine coordinator service is unavailable; machine runtime remains blocked.')
}
