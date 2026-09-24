import { contextBridge, ipcRenderer } from 'electron'

/**
 * Intentionally narrow renderer bridge. Future backend capabilities belong here
 * rather than exposing Node or Electron APIs directly to the React UI.
 */
contextBridge.exposeInMainWorld('vhostra', Object.freeze({
  getState: () => ipcRenderer.invoke('vhostra:get-state'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('vhostra:save-settings', settings),
  addSite: (input: unknown) => ipcRenderer.invoke('vhostra:add-site', input),
  updateSite: (input: unknown) => ipcRenderer.invoke('vhostra:update-site', input),
  removeSite: (id: string) => ipcRenderer.invoke('vhostra:remove-site', id),
  chooseDocumentRoot: () => ipcRenderer.invoke('vhostra:choose-document-root'),
  openSite: (url: string) => ipcRenderer.invoke('vhostra:open-site', url),
  getStorageLayout: () => ipcRenderer.invoke('vhostra:get-storage-layout'),
  exportConfiguration: (request: unknown) => ipcRenderer.invoke('vhostra:export-configuration', request),
  previewConfigurationImport: () => ipcRenderer.invoke('vhostra:preview-configuration-import'),
}))
