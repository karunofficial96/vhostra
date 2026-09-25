import type { ConfigurationExportRequest, ConfigurationImportReport, StorageLayout } from './storage'
import type { RuntimeSnapshot, Site, VhostraSettings, VhostraState } from './domain'

export interface SiteInput { name: string; documentRoot: string; url: string; framework?: string; aliases?: string[] }
export interface SiteUpdate extends SiteInput { id: string }

export interface VhostraDesktopApi {
  getState(): Promise<VhostraState>
  saveSettings(settings: VhostraSettings): Promise<VhostraSettings>
  addSite(input: SiteInput): Promise<{ state: VhostraState; mapping?: { message: string } }>
  updateSite(input: SiteUpdate): Promise<{ state: VhostraState; mapping?: { message: string } }>
  removeSite(id: string): Promise<VhostraState>
  setVirtualHostRewrite(id: string, enabled: boolean): Promise<VhostraState>
  chooseDocumentRoot(): Promise<string | null>
  openSite(url: string): Promise<void>
  getStorageLayout(): Promise<StorageLayout>
  exportConfiguration(request: Omit<ConfigurationExportRequest, 'destinationDirectory'>): Promise<{ path: string } | null>
  previewConfigurationImport(): Promise<ConfigurationImportReport | null>
  getRuntimeStatus(): Promise<RuntimeSnapshot>
  startServices(): Promise<void>
  stopServices(): Promise<void>
  restartServices(): Promise<void>
  checkPort(port: number): Promise<{ port: number; available: boolean; owner: string | null }>
  findAvailablePort(port: number): Promise<number>
  reloadWebServer(): Promise<void>
  listDatabases(): Promise<string[]>
  listPhpExtensions(): Promise<Array<{ id: string; label: string; required: boolean; enabled: boolean; installed: boolean; status: string }>>
  getCwebpStatus(): Promise<{ enabled: boolean; installed: boolean; version?: string }>
  createDatabase(input: { name: string; charset: string; username: string; password: string }): Promise<{ name: string; username: string; host: string; port: number; charset: string }>
  openPhpMyAdmin(database?: string): Promise<void>
  importDatabase(database: string): Promise<{ database: string; message: string } | null>
  exportDatabase(database: string): Promise<{ database: string; message: string } | null>
  repairDatabase(database: string): Promise<{ database: string; message: string }>
  deleteDatabase(database: string): Promise<{ database: string; message: string }>
  syncHosts(id: string): Promise<{ message: string }>
  getAppInfo(): Promise<{ name: string; version: string }>
  checkForUpdates(): Promise<{ state: 'unconfigured' | 'up-to-date' | 'available' | 'error'; currentVersion: string; availableVersion?: string; notes?: string; url?: string; message: string }>
  onRuntimeStatus(listener: (status: RuntimeSnapshot) => void): () => void
}

declare global {
  interface Window { vhostra?: VhostraDesktopApi }
}

export {}
