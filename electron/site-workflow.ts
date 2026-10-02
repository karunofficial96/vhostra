import { promises as fs } from 'node:fs'
import type { Site, VhostraStore } from './store.js'
import type { DockerRuntimeController } from './runtime.js'
import type { HostsFileManager } from './hosts.js'
export type SiteEdit = Pick<Site, 'id' | 'name' | 'documentRoot' | 'url' | 'framework'> & { aliases?: string[] }
/** Shared GUI/CLI edit transaction. Native validation precedes the single
 * protected Hosts mutation; cancellation restores canonical/runtime state. */
export async function updateManagedSite(store: VhostraStore, hosts: HostsFileManager, runtime: DockerRuntimeController, input: SiteEdit) {
  const before = await store.getState()
  const previous = before.sites.find(site => site.id === input.id)
  const previousHost = before.virtualHosts.find(host => host.id === previous?.vhostId)
  if (!previous || !previousHost) throw new Error('Site definition not found.')
  if (!(await fs.stat(input.documentRoot).catch(() => null))?.isDirectory()) throw new Error('Choose an existing host document-root directory.')
  const originalHosts = await hosts.inspect()
  const result = await store.updateSite(input)
  try {
    await runtime.applyConfiguration()
    const names = result.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases])
    const mapping = await hosts.reconcileMappings(names)
    if (mapping.conflicts.length) throw new Error(mapping.message)
    const changed = result.virtualHosts.find(host => host.id === previous.vhostId)!
    if (!(await hosts.mappingStatus([changed.hostname, ...changed.aliases])).every(item => item.state === 'mapped')) throw new Error('Hosts mapping validation failed.')
    return { state: result, mapping }
  } catch (error) {
    await store.restoreSiteDefinition(previous, previousHost)
    let recovery = ''
    try { await runtime.applyConfiguration() } catch (reason) { recovery += ` Runtime recovery requires Repair: ${String(reason)}` }
    try { if ((await hosts.inspect()).contents !== originalHosts.contents) await hosts.reconcileMappings(before.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases])) } catch (reason) { recovery += ` Owned Hosts cleanup requires Repair all mappings: ${String(reason)}` }
    throw new Error(`Site edit rolled back to its previous definition. ${String(error)}${recovery}`)
  }
}
