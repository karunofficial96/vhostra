import type { ConfigurationExportRequest, StorageLayout } from './storage'
import type { RuntimeSnapshot, Site, VhostraSettings, VhostraState, WebServer } from './domain'

export interface SiteInput { vhostId?: string; name: string; documentRoot: string; url: string; framework?: string; database?: { name: string; importExpected: boolean }; aliases?: string[] }
export interface SiteUpdate extends SiteInput { id: string }
export interface HostsMappingResult { installed: string[]; alreadyMapped: string[]; conflicts: Array<{ hostname: string; address: string }>; message: string }

export interface OnboardingPreferences { themeSaved?: boolean; restoredServices?: { redis: boolean; memcached: boolean }; ready?: boolean; completed: boolean; theme: 'light' | 'dark' | 'system'; server: VhostraSettings['selectedWebServer']; php: VhostraSettings['selectedPhpVersion']; cache: 'none' | 'redis' | 'memcached' }
export interface NativeImportPreview { plannedLogs?: Record<string, { access: string; error: string }>; source: string; server: string; status: string; hosts: Array<{ hostname: string; aliases: string[]; documentRoot: string; https: { enabled: boolean }; rewriteEnabled: boolean; indexFiles: string[] }>; warnings: string[]; preservedDirectives: string[] }
export interface RuntimeStatusRow { id: string; label: string; enabled: boolean; state: string }
export interface DatabaseBackupItem { key: string; category: 'database' | 'account' | 'role' | 'settings' | 'configuration'; name: string; disposition: 'new' | 'equivalent' | 'conflict' | 'incompatible'; detail: string; local?: unknown; incoming?: unknown }
export interface BackupPreview { configurationItems?: DatabaseBackupItem[]; databaseItems?: DatabaseBackupItem[]; plannedLogs?: Record<string, { access: string; error: string }>; source: string; checksum: string; sites: Array<{ name: string; hostname: string; documentRoot: string; disposition: string; differences?: string[]; local?: Record<string, unknown>; incoming?: Record<string, unknown> }>; settings: { server?: string; php?: string; optionalServices?: { redis: boolean; memcached: boolean } } | null; missing: string[]; warnings: string[] }
export interface ResourceReport { statuses: RuntimeStatusRow[]; application: { cpuPercent: number; ramBytes: number; processes: number }; runtime: Array<{ Name?: string; CPUPerc: string; MemUsage: string }> | null; runtimeError: string | null; dockerStorage: { imageBytes: number; writableLayerBytes: number; note: string } | null; storage: { measuredAt: string; categories: Array<{ label: string; bytes: number; partial: boolean }>; localTotalBytes: number; note: string } }
export interface HostsFileSnapshot { path: string; contents: string; managedLines: Array<{ line: number; text: string; hostnames: string[] }> }
export interface HostsEditReview { id: string; contents: string; diff: string; removedLines: number; addedLines: number; truncated: boolean; managedChanges: string[]; mappingChanges: { added: number; removed: number; modified: number; manual: number }; commentsChanged: number }
export interface VhostraDesktopApi {
  previewPreviousHosts(expected: string): Promise<HostsEditReview>
  exportFullBackup(): Promise<{ path: string } | null>
  compareBackupDatabase(key: string): Promise<DatabaseBackupItem>
  onBackupProgress(listener: (message: string) => void): () => void
  inspectHosts(): Promise<HostsFileSnapshot>
  previewHostsEdit(contents: string, expected: string): Promise<HostsEditReview>
  editHosts(contents: string, expected: string, reviewId: string): Promise<HostsFileSnapshot>
  cancelBackupPreview(): Promise<void>
  previewBackup(): Promise<BackupPreview | null>
  restoreBackup(roots?: Record<string, string>, choices?: Record<string, 'keep' | 'replace' | 'skip'>, server?: WebServer): Promise<{ message: string; summary?: { imported: number; skipped: number; replaced: number; conflicted: number; failed: number }; missing: string[]; warnings: string[]; preferences: OnboardingPreferences }>
  resetApp(keepSites: boolean, confirmation: string): Promise<{ message: string }>
  newSitePlan(): Promise<{ id: string; logs: { access: string; error: string } }>
  repairSite(id: string): Promise<HostsMappingResult>
  siteDetails(id: string, includeNative?: boolean): Promise<{ host: VhostraState['virtualHosts'][number]; native: string; nativePath: string; logs: { access: string; error: string } }>
  exportSiteConfiguration(siteId: string, server: WebServer): Promise<{ path: string; requiresReview: boolean } | null>
  runtimeStatuses(): Promise<RuntimeStatusRow[]>
  getOnboarding(): Promise<{ preferences: OnboardingPreferences; phpVersions: VhostraSettings['selectedPhpVersion'][] }>
  saveOnboarding(preferences: OnboardingPreferences): Promise<OnboardingPreferences>
  finishOnboarding(): Promise<OnboardingPreferences>
  setupOnboarding(): Promise<VhostraState>
  previewNativeImport(server?: 'apache' | 'nginx' | 'openlitespeed' | 'litespeed-enterprise'): Promise<NativeImportPreview | null>
  applyNativeImport(roots?: Record<string, string>): Promise<{ message: string; mapping: HostsMappingResult }>
  getResources(refreshStorage?: boolean): Promise<ResourceReport>
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
  listPersistentLogs(filter?: string): Promise<Array<{ path: string; size: number; modifiedAt: string }>>
  readLogTail(relative: string): Promise<{ path: string; text: string; truncated: boolean; size: number }>
  exportConfiguration(request: Omit<ConfigurationExportRequest, 'destinationDirectory'>): Promise<{ path: string } | null>
  previewConfigurationImport(): Promise<BackupPreview | null>
  importConfiguration(roots?: Record<string, string>, choices?: Record<string, 'keep' | 'replace' | 'skip'>): Promise<{ imported: Array<{ name: string; hostname: string; aliases: string[] }>; backup: string; message: string; mapping: HostsMappingResult } | null>
  getRuntimeStatus(): Promise<RuntimeSnapshot>
  startServices(): Promise<void>
  stopServices(): Promise<void>
  restartServices(): Promise<void>
  quitApplication(mode: 'keep-services' | 'stop-services' | 'minimize-to-tray'): Promise<void>
  checkPort(port: number): Promise<{ port: number; available: boolean; owner: string | null }>
  findAvailablePort(port: number): Promise<number>
  reloadWebServer(): Promise<void>
  setOptionalService(id: 'redis' | 'memcached', enabled: boolean): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: string }>>
  listManagedServices(): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: 'running' | 'stopped' | 'starting' | 'stopping' | 'restarting' | 'failed' | 'unhealthy' | 'disabled' | 'unavailable' }>>
  controlManagedService(id: 'web' | 'mariadb' | 'redis' | 'memcached', action: 'start' | 'stop' | 'restart'): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: string }>>
  listDatabaseUsers(): Promise<Array<{ username: string; host: string; globalPrivileges: string[]; roles: string[]; access: Array<{ database: string; privilege: string }> }>>
  changeDatabaseUserPassword(input: { username: string; host: string; password: string }): Promise<{ message: string }>
  deleteDatabaseUser(input: { username: string; host: string }): Promise<{ message: string }>
  checkDatabaseAccess(input: { username: string; host: string; password: string; database?: string }): Promise<{message: string; identity: string}>
  updateDatabaseAccess(input: { database: string; username: string; host: string; password: string; resetPassword?: boolean }): Promise<{message: string}>
  listDatabases(): Promise<string[]>
  listPhpExtensions(): Promise<Array<{ id: string; label: string; required: boolean; enabled: boolean; installed: boolean; category: string; status: string }>>
  managePhpExtension(id: string, action: 'install' | 'enable' | 'disable' | 'remove'): Promise<Array<{ id: string; label: string; required: boolean; enabled: boolean; installed: boolean; category: string; status: string }>>
  getCwebpStatus(): Promise<{ enabled: boolean; installed: boolean; version?: string }>
  configureCwebp(enabled: boolean): Promise<{ enabled: boolean; installed: boolean; version?: string }>
  createDatabase(input: { name: string; charset: string; username: string; password: string; host?: string; existingUser?: boolean }): Promise<{ name: string; username: string; host: string; port: number; charset: string }>
  openPhpMyAdmin(database?: string): Promise<void>
  importDatabase(database: string): Promise<{ database: string; message: string } | null>
  exportDatabase(database: string): Promise<{ database: string; message: string } | null>
  exportProductionDatabase(database: string, productionUrl: string, productionRoot: string): Promise<{ database: string; message: string } | null>
  repairDatabase(database: string): Promise<{ database: string; message: string }>
  deleteDatabase(database: string): Promise<{ database: string; message: string }>
  syncAllHosts(): Promise<HostsMappingResult>
  syncHosts(id: string): Promise<HostsMappingResult>
  allHostsStatus(): ReturnType<VhostraDesktopApi['hostsStatus']>
  hostsStatus(id: string): Promise<Array<{ hostname: string; state: 'mapped' | 'required' | 'conflict'; address?: string; issue?: string }>>
  getAppInfo(): Promise<{ name: string; version: string }>
  checkForUpdates(): Promise<{ state: 'unconfigured' | 'up-to-date' | 'available' | 'error'; currentVersion: string; availableVersion?: string; notes?: string; url?: string; message: string }>
  onExplicitQuit(listener: () => void): () => void
  setPreviewActivity(visible: boolean): Promise<void>
  resolveSiteUrl(siteId: string): Promise<{ available: boolean; url?: string; message: string; details?: string; repair?: boolean }>
  capturePreview(siteId: string, force?: boolean): Promise<{ captured: boolean; message: string; details?: string; repair?: boolean; screenshot?: Site['screenshot'] }>
  onRuntimeStatus(listener: (status: RuntimeSnapshot) => void): () => void
  onDatabaseReady(listener: (result: { database: string; siteIds: string[] }) => void): () => void
}

declare global {
  interface Window { vhostra?: VhostraDesktopApi }
}

export {}
