import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { StoreLayout } from './store.js'
export async function directoryBytes(root: string, maxEntries = 100000): Promise<{ bytes: number; partial: boolean }> {
  let bytes = 0; let entries = 0; let partial = false
  const visit = async (directory: string): Promise<void> => {
    try {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (++entries > maxEntries) { partial = true; return }
        const file = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) await visit(file)
        else if (entry.isFile()) bytes += (await fs.lstat(file)).size
        if (partial) return
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') partial = true }
  }
  try { const info = await fs.lstat(root); if (info.isFile()) bytes = info.size; else if (info.isDirectory()) await visit(root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') partial = true }
  return { bytes, partial }
}
export async function localStorageUsage(layout: StoreLayout, applicationPaths: string[]) {
  const categories = [
    ['Desktop application', applicationPaths], ['Settings', [layout.settings, path.join(layout.root, 'onboarding.json')]],
    ['Canonical JSON', [layout.virtualHosts]], ['Site records and managed site files', [layout.sites]],
    ['Generated native configuration', [layout.configuration.generated]], ['Runtime configuration and build context', Object.values(layout.runtime)],
    ['Logs', [layout.logs]], ['Recovery backups', [layout.backups]], ['MariaDB persistent data', [layout.persistentData.mariaDb]],
    ['Other managed configuration, certificates, cache and exports', [layout.configuration.source, layout.configuration.custom, layout.configuration.imported, layout.certificates.directory, layout.screenshots, layout.exports]],
  ] as Array<[string, string[]]>
  const rows = []
  for (const [label, roots] of categories) {
    let bytes = 0; let partial = false
    for (const root of roots) { const value = await directoryBytes(root); bytes += value.bytes; partial ||= value.partial }
    rows.push({ label, bytes, partial })
  }
  return { measuredAt: new Date().toISOString(), categories: rows, localTotalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), note: 'Logical file bytes, excluding symlinks and external user document roots. Application paths in development include only built app assets. Docker images below include shared layers and are not exclusive physical disk usage.' }
}
