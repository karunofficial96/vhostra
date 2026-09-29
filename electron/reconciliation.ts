import { createHash } from 'node:crypto'
import type { Site, VirtualHost } from './store.js'
export type RestoreChoice = 'keep' | 'replace' | 'skip'
export type RestoreChoices = Record<string, RestoreChoice>
export const stableJson = (value: unknown): string => JSON.stringify(normalize(value))
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]))
  return value
}
export const fingerprint = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex')
/** Runtime paths, timestamps and preview caches are derived; all portable behavior is compared. */
export function siteDefinition(site: Site, host: VirtualHost) {
  return { name: site.name, url: site.url, framework: site.framework ?? '', hostname: host.hostname.toLowerCase(), aliases: host.aliases.map(name => name.toLowerCase()).sort(), documentRoot: host.documentRoot, https: { enabled: host.https.enabled }, rewriteEnabled: host.rewriteEnabled !== false, redirects: host.redirects ?? [], rewrites: host.rewrites ?? [], headers: host.headers ?? [], indexFiles: host.indexFiles ?? ['index.php', 'index.html'], logs: { access: host.logs?.access !== false, error: host.logs?.error !== false }, preservedDirectives: host.preservedDirectives ?? [], source: host.source ? { server: host.source.server, status: host.source.status } : undefined }
}
export function differences(before: Record<string, unknown>, after: Record<string, unknown>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => stableJson(before[key]) !== stableJson(after[key]))
}
