import type { ConfigurationExportRequest, ConfigurationImportReport, StorageLayout } from './storage'
import type { RuntimeSnapshot, Site, VhostraSettings, VhostraState } from './domain'

export interface SiteInput { name: string; documentRoot: string; url: string; framework?: string; aliases?: string[] }
export interface SiteUpdate extends SiteInput { id: string }
export interface HostsMappingResult { installed: string[]; alreadyMapped: string[]; conflicts: Array<{ hostname: string; address: string }>; message: string }

export interface VhostraDesktopApi {
  getState(): Promise<VhostraState>
  saveSettings(settings: VhostraSettings): Promise<VhostraSettings>
  addSite(input: SiteInput): Promise<{ state: VhostraState; mapping?: HostsMappingResult }>
  updateSite(input: SiteUpdate): Promise<{ state: VhostraState; mapping?: HostsMappingResult }>
  removeSite(id: string): Promise<VhostraState & { mappingNotice?: string }>
  setVirtualHostRewrite(id: string, enabled: boolean): Promise<VhostraState>
  chooseDocumentRoot(): Promise<string | null>
  chooseConfigurationLocation(): Promise<string | null>
  migrateConfigurationLocation(directory: string): Promise<{ root: string; message: string }>
  openSite(url: string): Promise<void>
  getStorageLayout(): Promise<StorageLayout>
  listPersistentLogs(): Promise<Array<{ path: string; size: number; modifiedAt: string }>>
  readLogTail(relative: string): Promise<{ path: string; text: string; truncated: boolean; size: number }>
  exportConfiguration(request: Omit<ConfigurationExportRequest, 'destinationDirectory'>): Promise<{ path: string } | null>
  previewConfigurationImport(): Promise<ConfigurationImportReport | null>
  importConfiguration(): Promise<{ imported: Array<{ name: string; hostname: string; aliases: string[] }>; backup: string; message: string; mapping: HostsMappingResult } | null>
  getRuntimeStatus(): Promise<RuntimeSnapshot>
  startServices(): Promise<void>
  stopServices(): Promise<void>
  restartServices(): Promise<void>
  quitApplication(mode: 'keep-services' | 'stop-services' | 'minimize-to-tray'): Promise<void>
  checkPort(port: number): Promise<{ port: number; available: boolean; owner: string | null }>
  findAvailablePort(port: number): Promise<number>
  reloadWebServer(): Promise<void>
  setOptionalService(id: 'redis' | 'memcached', enabled: boolean): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: string }>>
  listManagedServices(): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: 'running' | 'stopped' | 'starting' | 'failed' | 'disabled' | 'unavailable' }>>
  controlManagedService(id: 'web' | 'mariadb' | 'redis' | 'memcached', action: 'start' | 'stop' | 'restart'): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: string }>>
  listDatabases(): Promise<string[]>
  listPhpExtensions(): Promise<Array<{ id: string; label: string; required: boolean; enabled: boolean; installed: boolean; category: string; status: string }>>
  managePhpExtension(id: string, action: 'install' | 'enable' | 'disable' | 'remove'): Promise<Array<{ id: string; label: string; required: boolean; enabled: boolean; installed: boolean; category: string; status: string }>>
  getCwebpStatus(): Promise<{ enabled: boolean; installed: boolean; version?: string }>
  configureCwebp(enabled: boolean): Promise<{ enabled: boolean; installed: boolean; version?: string }>
  createDatabase(input: { name: string; charset: string; username: string; password: string }): Promise<{ name: string; username: string; host: string; port: number; charset: string }>
  openPhpMyAdmin(database?: string): Promise<void>
  importDatabase(database: string): Promise<{ database: string; message: string } | null>
  exportDatabase(database: string): Promise<{ database: string; message: string } | null>
  repairDatabase(database: string): Promise<{ database: string; message: string }>
  deleteDatabase(database: string): Promise<{ database: string; message: string }>
  syncAllHosts(): Promise<HostsMappingResult>
  syncHosts(id: string): Promise<HostsMappingResult>
  hostsStatus(id: string): Promise<Array<{ hostname: string; state: 'mapped' | 'required' | 'conflict'; address?: string; issue?: string }>>
  getAppInfo(): Promise<{ name: string; version: string }>
  checkForUpdates(): Promise<{ state: 'unconfigured' | 'up-to-date' | 'available' | 'error'; currentVersion: string; availableVersion?: string; notes?: string; url?: string; message: string }>
  onRuntimeStatus(listener: (status: RuntimeSnapshot) => void): () => void
}

declare global {
  interface Window { vhostra?: VhostraDesktopApi }
}

export {}
