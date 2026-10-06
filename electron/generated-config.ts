import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { StoreLayout, WebServer } from './store.js'
import { authorizeProtectedTransaction } from './protected-launcher.js'

export const generatedMarker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
const filenames: Record<WebServer, string> = { apache: 'apache-vhosts.conf', nginx: 'nginx-vhosts.conf', openlitespeed: 'openlitespeed-vhosts.conf' }

async function owned(file: string, selection = false) {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.nlink !== 1) return false
    const contents = await fs.readFile(file, 'utf8')
    if (selection) { try { return JSON.parse(contents).owner === 'vhostra' } catch { return false } }
    return contents.startsWith(generatedMarker)
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

async function removeOwned(file: string, selection = false) {
  if (await owned(file, selection)) await fs.unlink(file)
}

/** Deletes only exact owned active artifacts, after callers verify promotion. Never follows links. */
export async function cleanObsoleteGenerated(directory: string, selected: WebServer) {
  for (const [server, filename] of Object.entries(filenames)) {
    if (server !== selected) await removeOwned(path.join(directory, filename))
  }
}

export async function cleanObsoleteRuntime(layout: StoreLayout, selected: WebServer, siteIds: string[]) {
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

/** One owned-file cleanup transaction after the new runtime has passed health checks. */
export async function cleanObsoleteMachineConfiguration(layout: StoreLayout, selected: WebServer, siteIds: string[]) {
  if (!layout.userRoot) throw new Error('Machine cleanup requires a split machine layout.')
  const candidates: Array<{ key: string; file: string }> = []
  for (const [server, filename] of Object.entries(filenames)) if (server !== selected)
    candidates.push({ key: `generated/${filename}`, file: path.join(layout.configuration.generated, filename) })
  if (selected !== 'apache') candidates.push({ key: 'runtime/apache/vhostra.conf', file: path.join(layout.runtime.apache, 'vhostra.conf') })
  if (selected !== 'nginx') candidates.push({ key: 'runtime/nginx/default.conf', file: path.join(layout.runtime.nginx, 'default.conf') })
  if (selected !== 'openlitespeed') for (const filename of ['vhostra-maps.conf', 'vhostra-vhosts.conf'])
    candidates.push({ key: `runtime/openlitespeed/${filename}`, file: path.join(layout.runtime.openLiteSpeed, filename) })
  const sites = path.join(layout.runtime.openLiteSpeed, 'sites')
  for (const name of await fs.readdir(sites).catch(() => [] as string[])) {
    const id = name.slice(0, -5)
    if (/^[a-f0-9-]{36}\.conf$/i.test(name) && (selected !== 'openlitespeed' || !siteIds.includes(id)))
      candidates.push({ key: `runtime/openlitespeed/sites/${name}`, file: path.join(sites, name) })
  }
  const files: Array<{ key: string; contents: null }> = []
  for (const candidate of candidates) if (await owned(candidate.file)) files.push({ key: candidate.key, contents: null })
  if (files.length) await authorizeProtectedTransaction({ version: 1, operations: [{ type: 'generated-web-config', files }] })
}

export async function restoreGenerated(directory: string, backup: string, machine = false) {
  const saved = new Set(await fs.readdir(backup))
  if (machine) {
    const files: Array<{ key: string; contents: string | null }> = []
    for (const filename of [...Object.values(filenames), 'runtime-selection.json']) {
      const file = path.join(directory, filename)
      const selection = filename === 'runtime-selection.json'
      if (saved.has(filename)) {
        const source = path.join(backup, filename)
        if (!await owned(source, selection)) throw new Error('Generated configuration recovery source is not Vhostra-owned.')
        files.push({ key: `generated/${filename}`, contents: await fs.readFile(source, 'utf8') })
      } else if (await owned(file, selection)) files.push({ key: `generated/${filename}`, contents: null })
    }
    if (files.length) await authorizeProtectedTransaction({ version: 1, operations: [{ type: 'generated-web-config', files }] })
    return
  }
  for (const filename of Object.values(filenames)) {
    if (!saved.has(filename)) await removeOwned(path.join(directory, filename))
  }
  if (!saved.has('runtime-selection.json')) await removeOwned(path.join(directory, 'runtime-selection.json'), true)
  // Do not recursively delete the generated area: a newly added user file or
  // link must survive rollback. Restore the transaction's original copies.
  await fs.cp(backup, directory, { recursive: true, force: true, verbatimSymlinks: true })
}
