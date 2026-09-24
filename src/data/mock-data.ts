import type { ServiceConfiguration, Site, VirtualHost } from '../types/domain'
import { createStorageLayout, defaultBundleExclusions, type PortableBundleManifest } from '../types/storage'

export const mockServices: ServiceConfiguration[] = [
  { name: 'mariadb', enabled: true, required: true, status: 'running', port: 3306 },
  { name: 'phpmyadmin', enabled: true, required: true, status: 'running', port: 8081 },
  { name: 'redis', enabled: true, required: false, status: 'running', port: 6379 },
  { name: 'memcached', enabled: false, required: false, status: 'stopped', port: 11211 },
]

export const mockVirtualHosts: VirtualHost[] = [
  { id: 'vh-acme', hostname: 'acme.local', aliases: ['www.acme.local'], documentRoot: '~/Projects/acme/public', https: { enabled: true }, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true } },
  { id: 'vh-storefront', hostname: 'storefront.local', aliases: [], documentRoot: '~/Projects/storefront/public', https: { enabled: false }, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true } },
  { id: 'vh-api', hostname: 'api.workspace.local', aliases: ['api.local'], documentRoot: '~/Projects/workspace/api/public', https: { enabled: true }, redirects: [], rewrites: [], headers: [], logs: { access: true, error: true } },
]

export const mockSites: Site[] = [
  { id: 'site-acme', name: 'Acme', path: '~/Projects/acme', vhostId: 'vh-acme', framework: 'Laravel', status: 'running' },
  { id: 'site-storefront', name: 'Storefront', path: '~/Projects/storefront', vhostId: 'vh-storefront', framework: 'WordPress', status: 'running' },
  { id: 'site-api', name: 'Workspace API', path: '~/Projects/workspace/api', vhostId: 'vh-api', framework: 'Symfony', status: 'running' },
]

/** Presentation-only example; actual directories will be resolved by the Electron storage adapter. */
export const mockStorageLayout = createStorageLayout({ platform: 'darwin', appDataDirectory: '<application-data>' })

export const mockBundleManifest: PortableBundleManifest = {
  format: 'vhostra/config-bundle',
  schemaVersion: 1,
  bundleId: 'preview-configuration-bundle',
  createdAt: '2026-09-24T00:00:00.000Z',
  appVersion: '0.1.0',
  scopes: ['all'],
  excludedByDefault: defaultBundleExclusions,
  includesPrivateKeys: false,
  includesSecrets: false,
  entries: [
    { id: 'settings', type: 'settings', relativePath: 'settings.json', ownership: 'vhostra-source' },
    { id: 'vhosts', type: 'virtual-host', relativePath: 'virtual-hosts/', ownership: 'vhostra-source' },
    { id: 'nginx', type: 'server-config', relativePath: 'configuration/generated/nginx/', ownership: 'generated-runtime-reference' },
  ],
}
