import { contextBridge, ipcRenderer } from 'electron'

const api = Object.freeze({
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
})

contextBridge.exposeInMainWorld('vhostra', api)

if (process.env.NODE_ENV === 'development') console.info('[Vhostra preload] Secure bridge exposed as window.vhostra')
