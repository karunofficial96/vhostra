import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { StoreLayout, WebServer } from './store.js'
export const generatedMarker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
const filenames: Record<WebServer, string> = { apache: 'apache-vhosts.conf', nginx: 'nginx-vhosts.conf', openlitespeed: 'openlitespeed-vhosts.conf' }
/** Deletes only exact owned active artifacts, after callers verify promotion. Never follows links. */
export async function cleanObsoleteGenerated(directory: string, selected: WebServer) {
  for (const [server, filename] of Object.entries(filenames)) {
    if (server === selected) continue
    const file = path.join(directory, filename)
    try {
      const stat = await fs.lstat(file)
      if (stat.isFile() && (await fs.readFile(file, 'utf8')).startsWith(generatedMarker)) await fs.unlink(file)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}

export async function cleanObsoleteRuntime(layout: StoreLayout, selected: WebServer, siteIds: string[]) {
  const removeOwned = async (file: string) => {
    try { if ((await fs.lstat(file)).isFile() && (await fs.readFile(file, 'utf8')).startsWith(generatedMarker)) await fs.unlink(file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  if (selected !== 'apache') await removeOwned(path.join(layout.runtime.apache, 'vhostra.conf'))
  if (selected !== 'nginx') await removeOwned(path.join(layout.runtime.nginx, 'default.conf'))
  if (selected !== 'openlitespeed') {
    await removeOwned(path.join(layout.runtime.openLiteSpeed, 'vhostra-maps.conf'))
    await removeOwned(path.join(layout.runtime.openLiteSpeed, 'vhostra-vhosts.conf'))
  }
  const sites = path.join(layout.runtime.openLiteSpeed, 'sites')
  for (const name of await fs.readdir(sites).catch(() => [] as string[])) {
    if (/^[a-f0-9-]{36}\.conf$/i.test(name) && (selected !== 'openlitespeed' || !siteIds.includes(name.slice(0, -5)))) await removeOwned(path.join(sites, name))
  }
}

export async function restoreGenerated(directory: string, backup: string) {
  const saved = new Set(await fs.readdir(backup))
  for (const filename of Object.values(filenames)) {
    if (saved.has(filename)) continue
    const file = path.join(directory, filename)
    try { if ((await fs.lstat(file)).isFile() && (await fs.readFile(file, 'utf8')).startsWith(generatedMarker)) await fs.unlink(file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  if (!saved.has('runtime-selection.json')) {
    const selection = path.join(directory, 'runtime-selection.json')
    try { if ((await fs.lstat(selection)).isFile() && JSON.parse(await fs.readFile(selection, 'utf8')).owner === 'vhostra') await fs.unlink(selection) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  // Do not recursively delete the generated area: a newly added user file or
  // link must survive rollback. Restore the transaction's original copies.
  await fs.cp(backup, directory, { recursive: true, force: true, verbatimSymlinks: true })
}
