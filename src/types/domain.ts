export type WebServer = 'apache' | 'nginx' | 'openlitespeed'
export type PhpVersion = '8.1' | '8.2' | '8.3' | '8.4' | '8.5'
export type ServiceName = 'mariadb' | 'phpmyadmin' | 'redis' | 'memcached'
export type RuntimeStatus = 'unavailable' | 'not-created' | 'running' | 'stopped' | 'starting' | 'stopping' | 'error'

export interface RuntimeSnapshot {
  state: RuntimeStatus
  message: string
  services: string[]
  progress?: { id: number; lines: string[] }
  updatedAt: string
}

export interface ServiceConfiguration {
  name: ServiceName
  enabled: boolean
  required: boolean
  status: RuntimeStatus
  port?: number
}

export interface RedirectRule { from: string; to: string; code: 301 | 302 | 307 | 308 }
export interface HeaderRule { name: string; value: string; operation: 'set' | 'add' | 'unset' }
export interface RewriteRule { pattern: string; replacement: string; flags: string[] }

/** Portable model: the single source of truth before rendering server-specific configs. */
export interface VirtualHost {
  id: string
  hostname: string
  aliases: string[]
  documentRoot: string
  https: { enabled: boolean; certificateRef?: string }
  rewriteEnabled?: boolean
  redirects: RedirectRule[]
  rewrites: RewriteRule[]
  headers: HeaderRule[]
  logs: { access: boolean; error: boolean }
  indexFiles?: string[]
  source?: { server: WebServer | 'litespeed-enterprise'; path: string; importedAt: string; raw?: string; status?: string; warnings?: string[] }
  /** Directives that could not be made portable remain visible for review. */
  preservedDirectives?: string[]
}

/** A cache reference only: screenshot bytes stay in Vhostra's host-side cache. */
export interface SiteScreenshot {
  cacheFile: string
  capturedAt: string
  source: 'automatic' | 'manual'
}

export interface Site {
  id: string
  name: string
  documentRoot: string
  url: string
  vhostId: string
  framework?: string
  screenshot?: SiteScreenshot
  builtIn?: 'localhost'
  createdAt: string
  updatedAt: string
}

export interface VhostraSettings {
  schemaVersion: 1
  selectedWebServer: WebServer
  selectedPhpVersion: PhpVersion
  optionalServices: { redis: boolean; memcached: boolean }
  php: { extensions: string[]; disabledExtensions: string[]; opcacheEnabled: boolean; cwebpEnabled: boolean }
  startup: { launchAtLogin: boolean; startServicesOnLaunch: boolean; closeBehavior: 'keep-services' | 'stop-services' | 'minimize-to-tray' }
  ports: { http: number; https: number; mariadb: number; redis: number; memcached: number; phpMyAdmin: number }
}

export const supportedPhpVersions = ['8.1', '8.2', '8.3', '8.4', '8.5'] as const
export const resolveLatestSupportedPhpVersion = () => supportedPhpVersions.at(-1)!

export interface VhostraState {
  settings: VhostraSettings
  sites: Site[]
  virtualHosts: VirtualHost[]
}

export interface VhostraEnvironment {
  projectName: 'vhostra'
  server: WebServer
  phpVersion: PhpVersion
  services: ServiceConfiguration[]
  sites: Site[]
  virtualHosts: VirtualHost[]
  persistence: { settingsDirectory: string; databaseDirectory: string; siteDirectories: 'host-bind-mounts' }
  isolation: { composeProject: string; labels: Record<string, string>; network: string }
}

export type ConversionSeverity = 'compatible' | 'warning' | 'unsupported'
export interface ConversionFinding { severity: ConversionSeverity; directive: string; message: string; sourceLocation?: string }
export interface VhostConversionPlan { source: WebServer; target: WebServer; virtualHost: VirtualHost; findings: ConversionFinding[] }

export interface ImportedDirective {
  raw: string
  sourceServer: WebServer
  sourceLocation?: string
  classification: ConversionSeverity
  note: string
}
