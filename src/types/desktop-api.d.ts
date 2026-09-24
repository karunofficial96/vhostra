import type { ConfigurationExportRequest, ConfigurationImportReport, StorageLayout } from './storage'
import type { RuntimeSnapshot, Site, VhostraSettings, VhostraState } from './domain'

export interface SiteInput { name: string; documentRoot: string; url: string; framework?: string }
export interface SiteUpdate extends SiteInput { id: string }

export interface VhostraDesktopApi {
  getState(): Promise<VhostraState>
  saveSettings(settings: VhostraSettings): Promise<VhostraSettings>
  addSite(input: SiteInput): Promise<VhostraState>
  updateSite(input: SiteUpdate): Promise<VhostraState>
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
  createDatabase(input: { name: string; charset: string; username: string; password: string }): Promise<{ name: string; username: string; host: string; port: number; charset: string }>
  openPhpMyAdmin(database?: string): Promise<void>
  importDatabase(database: string): Promise<{ database: string; message: string } | null>
  exportDatabase(database: string): Promise<{ database: string; message: string } | null>
  repairDatabase(database: string): Promise<{ database: string; message: string }>
  deleteDatabase(database: string): Promise<{ database: string; message: string }>
  onRuntimeStatus(listener: (status: RuntimeSnapshot) => void): () => void
}

declare global {
  interface Window { vhostra?: VhostraDesktopApi }
}

export {}
