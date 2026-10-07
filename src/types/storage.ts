import type { PhpVersion, ServiceName, VirtualHost, WebServer } from './domain'

export type HostPlatform = 'darwin' | 'win32' | 'linux'
export type ConfigurationOwnership = 'vhostra-source' | 'user-custom' | 'generated-runtime' | 'imported'
export type ConfigExportScope = 'all' | 'site' | 'virtual-host' | 'server' | 'php' | 'mariadb' | 'optional-service'
export type SensitiveExportExclusion = 'website-content' | 'database-content' | 'passwords-and-secrets' | 'private-tls-keys'

export interface StorageRoot {
  /** Provided by a platform adapter, e.g. Electron's app.getPath('userData'). */
  appDataDirectory: string
  platform: HostPlatform
}

export interface StorageLayout {
  root: string
  settings: string
  sites: string
  virtualHosts: string
  sourceConfiguration: string
  customConfiguration: string
  importedConfiguration: string
  generatedConfiguration: string
  runtime: {
    apache: string
    nginx: string
    openLiteSpeed: string
    php: string
    mariaDb: string
    phpMyAdmin: string
    redis: string
    memcached: string
  }
  certificates: { directory: string; public: string; private: string }
  persistentData: { mariaDb: string }
  logs: string
  backups: string
  exports: string
}

export interface HostContainerMount {
  hostPath: string
  containerPath: string
  readOnly: boolean
  purpose: 'website-document-root' | 'runtime-config' | 'persistent-data' | 'certificate' | 'log'
}

export interface ManagedConfigurationFile {
  id: string
  path: string
  ownership: ConfigurationOwnership
  server?: WebServer
  service?: ServiceName
  generatedFrom?: string[]
  checksum?: string
  updatedAt?: string
}

export interface SnapshotRequest {
  reason: 'before-import' | 'before-replacement' | 'before-migration' | 'manual'
  include: string[]
}

export interface BackupSnapshot {
  id: string
  createdAt: string
  reason: SnapshotRequest['reason']
  directory: string
  entries: string[]
  restorable: true
}

/**
 * Future desktop filesystem boundary. Implementations must only write managed
 * paths and must snapshot before replacing source or generated configuration.
 */
export interface LocalStoragePort {
  ensureLayout(layout: StorageLayout): Promise<void>
  readText(path: string): Promise<string>
  writeManagedFile(file: ManagedConfigurationFile, contents: string): Promise<void>
  createSnapshot(request: SnapshotRequest): Promise<BackupSnapshot>
  listLogs(): Promise<ManagedConfigurationFile[]>
}

export interface PortableBundleManifest {
  format: 'vhostra/config-bundle'
  schemaVersion: 1
  bundleId: string
  createdAt: string
  appVersion: string
  scopes: ConfigExportScope[]
  excludedByDefault: SensitiveExportExclusion[]
  includesPrivateKeys: false
  includesSecrets: false
  entries: PortableBundleEntry[]
}

export interface PortableBundleEntry {
  id: string
  type: 'settings' | 'site' | 'virtual-host' | 'server-config' | 'php-config' | 'mariadb-config' | 'service-config' | 'custom-config'
  relativePath: string
  ownership: Exclude<ConfigurationOwnership, 'generated-runtime'> | 'generated-runtime-reference'
  checksum?: string
}

export interface ConfigurationExportRequest {
  scopes: ConfigExportScope[]
  siteIds?: string[]
  virtualHostIds?: string[]
  server?: WebServer
  phpVersion?: PhpVersion
  service?: Extract<ServiceName, 'redis' | 'memcached'>
  destinationDirectory: string
}

export interface ConfigurationImportReport {
  manifest: PortableBundleManifest
  sourcePlatform?: HostPlatform
  imported: string[]
  preserved: Array<{ path: string; reason: string }>
  warnings: string[]
  requiresSnapshotBeforeApply: true
}

const join = (platform: HostPlatform, ...parts: string[]) => parts.filter(Boolean).join(platform === 'win32' ? '\\' : '/')

/** Build a platform-aware layout from a host-provided app-data directory; no OS-specific path is hard-coded. */
export const createStorageLayout = ({ appDataDirectory, platform }: StorageRoot): StorageLayout => {
  const root = join(platform, appDataDirectory, 'Vhostra')
  const runtime = join(platform, root, 'runtime')
  return {
    root,
    settings: join(platform, root, 'settings.json'),
    sites: join(platform, root, 'sites'),
    virtualHosts: join(platform, root, 'virtual-hosts'),
    sourceConfiguration: join(platform, root, 'configuration', 'source'),
    customConfiguration: join(platform, root, 'configuration', 'custom'),
    importedConfiguration: join(platform, root, 'configuration', 'imported'),
    generatedConfiguration: join(platform, root, 'configuration', 'generated'),
    runtime: {
      apache: join(platform, runtime, 'apache'), nginx: join(platform, runtime, 'nginx'), openLiteSpeed: join(platform, runtime, 'openlitespeed'),
      php: join(platform, runtime, 'php'), mariaDb: join(platform, runtime, 'mariadb'), phpMyAdmin: join(platform, runtime, 'phpmyadmin'),
      redis: join(platform, runtime, 'redis'), memcached: join(platform, runtime, 'memcached'),
    },
    certificates: { directory: join(platform, root, 'certificates'), public: join(platform, root, 'certificates', 'public'), private: join(platform, root, 'certificates', 'private') },
    persistentData: { mariaDb: join(platform, root, 'data', 'mariadb') },
    logs: join(platform, root, 'logs'), backups: join(platform, root, 'backups'), exports: join(platform, root, 'exports'),
  }
}

export const defaultBundleExclusions: SensitiveExportExclusion[] = ['website-content', 'database-content', 'passwords-and-secrets', 'private-tls-keys']

export const canReplaceManagedFile = (file: ManagedConfigurationFile) => file.ownership === 'generated-runtime'

export type SafeWriteDisposition = 'create' | 'snapshot-then-replace' | 'preserve-user-file'

/** Pure guard used by future filesystem adapters before a managed write. */
export const planSafeConfigurationWrite = (file?: ManagedConfigurationFile): SafeWriteDisposition => {
  if (!file) return 'create'
  if (file.ownership === 'user-custom') return 'preserve-user-file'
  return 'snapshot-then-replace'
}

/** Reject paths that escape the application-managed storage root without using OS-specific APIs. */
export const isWithinStorageRoot = (layout: StorageLayout, candidate: string, platform: HostPlatform) => {
  const separator = platform === 'win32' ? '\\' : '/'
  const normalize = (value: string) => {
    const pieces = value.replace(/[\\/]+/g, separator).split(separator)
    const resolved: string[] = []
    for (const piece of pieces) {
      if (!piece || piece === '.') continue
      if (piece === '..') { resolved.pop(); continue }
      resolved.push(piece)
    }
    const prefix = platform === 'win32' && /^[a-z]:/i.test(value) ? `${value.slice(0, 2).toLowerCase()}${separator}` : value.startsWith(separator) ? separator : ''
    return `${prefix}${resolved.join(separator)}`.toLowerCase()
  }
  const root = normalize(layout.root).replace(new RegExp(`${separator}+$`), '')
  const path = normalize(candidate)
  return path === root || path.startsWith(`${root}${separator}`)
}

export interface StoredVhostDefinition { virtualHost: VirtualHost; ownership: 'vhostra-source'; path: string }
