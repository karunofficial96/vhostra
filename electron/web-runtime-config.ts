import { createHash } from 'node:crypto'

export type WebServerKind = 'openlitespeed' | 'apache' | 'nginx'
export interface WebRuntimeSite {
  id: string
  hostname: string
  aliases: string[]
  builtIn: boolean
  indexFiles: string[]
  rewriteEnabled: boolean
}
export interface WebRuntimeModel {
  server: WebServerKind
  phpVersion: string
  httpsEnabled: boolean
  sites: WebRuntimeSite[]
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const dnsName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const privateMarker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
const publicMarker = '# Vhostra container web configuration; owner=vhostra; schema=1\n'
const phpPolicy = 'expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\nmysqli.default_socket=/run/mysqld/mysqld.sock\npdo_mysql.default_socket=/run/mysqld/mysqld.sock\n'
const sitePath = (site: WebRuntimeSite) => site.builtIn ? '/var/www/html' : `/var/www/vhostra/${site.id}`
const bad = (): never => { throw new Error('Web runtime model contains an unsupported field or value.') }

/** The privileged worker accepts only semantic Vhostra Site fields, never config text or paths. */
export function validateWebRuntimeModel(input: unknown): WebRuntimeModel {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad()
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !['server', 'phpVersion', 'httpsEnabled', 'sites'].includes(key))
    || !['openlitespeed', 'apache', 'nginx'].includes(String(value.server))
    || !/^8\.[1-5]$/.test(String(value.phpVersion)) || typeof value.httpsEnabled !== 'boolean'
    || !Array.isArray(value.sites) || value.sites.length < 1 || value.sites.length > 128) return bad()
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  let localhost = 0
  const sites = value.sites.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return bad()
    const site = entry as Record<string, unknown>
    if (Object.keys(site).some(key => !['id', 'hostname', 'aliases', 'builtIn', 'indexFiles', 'rewriteEnabled'].includes(key))
      || typeof site.id !== 'string' || typeof site.hostname !== 'string'
      || typeof site.builtIn !== 'boolean' || typeof site.rewriteEnabled !== 'boolean'
      || !Array.isArray(site.aliases) || site.aliases.length > 32
      || !Array.isArray(site.indexFiles) || site.indexFiles.length < 1 || site.indexFiles.length > 16
      || site.indexFiles.some(name => typeof name !== 'string' || !/^[a-z0-9_.-]{1,80}$/i.test(name))
      || !dnsName.test(site.hostname) || site.aliases.some(name => typeof name !== 'string' || !dnsName.test(name))) return bad()
    if (site.builtIn) {
      if (site.id !== 'vhostra-localhost-vhost' || site.hostname !== 'localhost' || ++localhost !== 1) return bad()
    } else if (!uuid.test(site.id) || site.hostname === 'localhost') return bad()
    if (seenIds.has(site.id)) return bad()
    seenIds.add(site.id)
    for (const name of [site.hostname, ...site.aliases]) {
      const normalized = name.toLowerCase()
      if (seenNames.has(normalized)) return bad()
      seenNames.add(normalized)
    }
    return { id: site.id, hostname: site.hostname, aliases: site.aliases as string[], builtIn: site.builtIn,
      indexFiles: site.indexFiles as string[], rewriteEnabled: site.rewriteEnabled }
  })
  if (localhost !== 1) return bad()
  return { server: value.server as WebServerKind, phpVersion: value.phpVersion as string,
    httpsEnabled: value.httpsEnabled as boolean, sites }
}

function openLiteSpeedSite(site: WebRuntimeSite): string {
  const container = sitePath(site)
  return `phpIniOverride {\n  php_admin_flag log_errors on\n  php_admin_value error_log /var/log/vhostra/sites/${site.id}/error.log\n}\ndocRoot ${container}/\nerrorlog /var/log/vhostra/sites/${site.id}/error.log {\n  useServer 0\n  logLevel WARN\n  rollingSize 5M\n  keepDays 7\n  compressArchive 1\n}\naccesslog /var/log/vhostra/sites/${site.id}/access.log {\n  useServer 0\n  rollingSize 5M\n  keepDays 7\n  compressArchive 1\n}\nindex {\n  indexFiles ${(site.builtIn ? ['index.html'] : site.indexFiles).join(',')}\n}\nrewrite {\n  enable ${site.rewriteEnabled ? '1' : '0'}\n  autoLoadHtaccess ${site.rewriteEnabled ? '1' : '0'}\n}\ncontext / {\n  allowBrowse 1\n  location $DOC_ROOT/\n  extraHeaders set X-Vhostra-Site ${site.id}\n}\naccessControl {\n  deny\n  allow *\n}\n`
}
function apache(model: WebRuntimeModel): string {
  const blocks = [...model.sites].sort((a, b) => Number(b.builtIn) - Number(a.builtIn)).map(site => {
    const container = sitePath(site)
    return `<VirtualHost *:8088>\n  ServerName ${site.hostname}\n  Header always set X-Vhostra-Site "${site.id}"\n  ${site.aliases.map(alias => `ServerAlias ${alias}`).join('\n  ')}\n  DocumentRoot ${container}\n  DirectoryIndex ${site.builtIn ? 'index.html' : site.indexFiles.join(' ')}\n  <FilesMatch "\\.php$">\n    SetHandler "proxy:fcgi://127.0.0.1:8089"\n  </FilesMatch>\n  <Directory ${container}>\n    Options FollowSymLinks\n    AllowOverride ${site.rewriteEnabled ? 'FileInfo' : 'None'}\n    Require all granted\n  </Directory>\n  ErrorLog /var/log/vhostra/sites/${site.id}/error.log\n  CustomLog /var/log/vhostra/sites/${site.id}/access.log combined\n</VirtualHost>`
  })
  let config = `ErrorLog /var/log/vhostra/apache-error.log\nServerTokens Prod\nServerSignature Off\nTraceEnable Off\nProxyPreserveHost On\nRequestHeader set X-Forwarded-Proto http\nRequestHeader set X-Vhostra-Request-Line "expr=%{THE_REQUEST}"\nDirectoryIndex index.php index.html\n${blocks.join('\n\n')}\n`
  if (model.httpsEnabled) config += config.slice(config.indexOf('<VirtualHost')).replaceAll('<VirtualHost *:8088>', '<VirtualHost *:8443>\n  SSLEngine on\n  SSLCertificateFile /etc/vhostra/certificates/public/localhost.pem\n  SSLCertificateKeyFile /etc/vhostra/certificates/private/localhost.key\n  RequestHeader set X-Forwarded-Proto https')
  return config
}
function nginx(model: WebRuntimeModel): string {
  return model.sites.map(site => {
    const container = sitePath(site)
    return `server {\n  server_tokens off;\n  listen 8088${site.builtIn ? ' default_server' : ''};\n  ${model.httpsEnabled ? `listen 8443 ssl${site.builtIn ? ' default_server' : ''};\n  ssl_certificate /etc/vhostra/certificates/public/localhost.pem;\n  ssl_certificate_key /etc/vhostra/certificates/private/localhost.key;\n  ssl_protocols TLSv1.2 TLSv1.3;` : ''}\n  server_name ${[site.hostname, ...site.aliases].join(' ')};\n  client_max_body_size 65m;\n  add_header X-Vhostra-Site "${site.id}" always;\n  proxy_hide_header X-Vhostra-Site;\n  root ${container};\n  index ${site.indexFiles.join(' ')};\n  access_log /var/log/vhostra/sites/${site.id}/access.log;\n  error_log /var/log/vhostra/sites/${site.id}/error.log;\n  location ~ /\\. { deny all; }\n  # Vhostra managed WordPress-compatible front controller. Unsupported .htaccess directives remain reported in the neutral model.\n  location / { try_files $uri $uri/ ${site.rewriteEnabled ? '/index.php?$query_string' : '=404'}; }\n  location ~ \\.php(?:/|$) { fastcgi_split_path_info ^(.+?\\.php)(/.*)$; try_files $fastcgi_script_name =404; include fastcgi_params; fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name; fastcgi_param PATH_INFO $fastcgi_path_info; fastcgi_param HTTPS $https; fastcgi_param PHP_VALUE "error_log=/var/log/vhostra/sites/${site.id}/error.log"; fastcgi_pass 127.0.0.1:8089; }\n}\n`
  }).join('\n')
}

export function renderWebRuntimeFiles(model: WebRuntimeModel): Array<{ key: string; body: string }> {
  const managed = model.sites.filter(site => !site.builtIn)
  const maps = `${managed.flatMap(site => [`map ${site.id} ${site.hostname}`, ...site.aliases.map(alias => `map ${site.id} ${alias}`)]).join('\n')}\n`
  const vhosts = managed.map(site => `virtualHost ${site.id}{\n    vhRoot                   ${sitePath(site)}/\n    allowSymbolLink          1\n    enableScript             1\n    configFile               /usr/local/lsws/conf/vhostra-sites/${site.id}.conf\n}\n`).join('')
  const files = [
    { key: 'runtime/openlitespeed/localhost.conf', body: openLiteSpeedSite(model.sites.find(site => site.builtIn)!) },
    { key: 'runtime/openlitespeed/vhostra-maps.conf', body: maps },
    { key: 'runtime/openlitespeed/vhostra-vhosts.conf', body: vhosts },
    ...managed.map(site => ({ key: `runtime/openlitespeed/sites/${site.id}.conf`, body: openLiteSpeedSite(site) })),
    { key: 'runtime/apache/vhostra.conf', body: apache(model) },
    { key: 'runtime/nginx/default.conf', body: nginx(model) },
    { key: 'runtime/php/vhostra.ini', body: phpPolicy },
    { key: 'runtime/php/site-logrotate.conf', body: `${model.sites.flatMap(site => ['access', 'error'].map(kind => `/var/log/vhostra/sites/${site.id}/${kind}.log`)).join(' ')} {\n  size 5M\n  rotate 3\n  copytruncate\n  missingok\n  notifempty\n  su root root\n}\n` },
  ]
  return files.filter(file => file.key.startsWith('runtime/openlitespeed/') || file.key.startsWith('runtime/php/')
    || file.key.startsWith(`runtime/${model.server}/`))
}

export const authoritativeWebFile = (body: string) => `${privateMarker}${body}`
export const runtimeWebFile = (source: string) => `${publicMarker}# authoritative-sha256=${createHash('sha256').update(source).digest('hex')}\n${source.slice(privateMarker.length)}`
export const isOwnedWebRuntimeFile = (source: string) => source.startsWith(publicMarker)

export function renderWebPreviewFiles(model: WebRuntimeModel, files: Array<{ key: string; body: string }>) {
  const byKey = new Map(files.map(file => [file.key, file.body]))
  const key = model.server === 'apache' ? 'generated/apache-vhosts.conf'
    : model.server === 'nginx' ? 'generated/nginx-vhosts.conf' : 'generated/openlitespeed-vhosts.conf'
  const body = model.server === 'apache' ? byKey.get('runtime/apache/vhostra.conf')!
    : model.server === 'nginx' ? byKey.get('runtime/nginx/default.conf')!
      : `${byKey.get('runtime/openlitespeed/vhostra-maps.conf')!}\n${byKey.get('runtime/openlitespeed/vhostra-vhosts.conf')!}\n${model.sites.filter(site => !site.builtIn).map(site => `# ${site.hostname} (${site.id})\n${byKey.get(`runtime/openlitespeed/sites/${site.id}.conf`)}`).join('\n')}`
  return [
    { key, contents: authoritativeWebFile(body) },
    { key: 'generated/runtime-selection.json', contents: JSON.stringify({ owner: 'vhostra', schemaVersion: 1,
      server: model.server, phpVersion: model.phpVersion, generatedAt: new Date().toISOString() }, null, 2) },
  ]
}
