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
  onRuntimeStatus(listener: (status: RuntimeSnapshot) => void): () => void
}

declare global {
  interface Window { vhostra?: VhostraDesktopApi }
}

export {}
