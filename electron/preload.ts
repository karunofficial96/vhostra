import { contextBridge } from 'electron'

/**
 * Intentionally narrow renderer bridge. Future backend capabilities belong here
 * rather than exposing Node or Electron APIs directly to the React UI.
 */
contextBridge.exposeInMainWorld('vhostra', Object.freeze({ platform: process.platform }))
