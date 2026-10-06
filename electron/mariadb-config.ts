import { createHash } from 'node:crypto'

const marker = '# Vhostra generated configuration; owner=vhostra; schema=1\n'
const runtimeMarker = '# Vhostra container MariaDB configuration; owner=vhostra; schema=1\n'
const allowed = {
  'skip-name-resolve': null,
  innodb_buffer_pool_size: '64M',
  max_connections: '50',
  thread_cache_size: '4',
  table_open_cache: '400',
  tmp_table_size: '16M',
  max_heap_table_size: '16M',
  max_allowed_packet: '64M',
  performance_schema: 'OFF',
  log_error: '/var/log/vhostra/mariadb.log',
} as const

const entries = Object.entries(allowed)
export const mariaDbPolicyBody = `[mariadb]\n${entries.map(([key, value]) => value === null ? key : `${key}=${value}`).join('\n')}\n`

export const authoritativeMariaDbConfig = `${marker}${mariaDbPolicyBody}`

/** Reject every unsupported section, key, value, comment and include directive. */
export function parseAuthoritativeMariaDbConfig(source: string): string {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 4096 || !source.startsWith(marker))
    throw new Error('Protected MariaDB configuration is not Vhostra-owned.')
  const lines = source.slice(marker.length).split('\n')
  if (lines.at(-1) !== '') throw new Error('Protected MariaDB configuration has invalid line endings.')
  lines.pop()
  if (lines.shift() !== '[mariadb]' || lines.length !== entries.length)
    throw new Error('Protected MariaDB configuration has unsupported sections or keys.')
  const seen = new Set<string>()
  for (const line of lines) {
    const index = line.indexOf('=')
    const key = index < 0 ? line : line.slice(0, index)
    const value = index < 0 ? null : line.slice(index + 1)
    if (!Object.hasOwn(allowed, key) || seen.has(key) || allowed[key as keyof typeof allowed] !== value)
      throw new Error('Protected MariaDB configuration has an unsupported setting.')
    seen.add(key)
  }
  return mariaDbPolicyBody
}

/** The runtime file contains only approved MariaDB settings and a source hash. */
export function deriveMariaDbRuntimeConfig(source: string): string {
  const normalized = parseAuthoritativeMariaDbConfig(source)
  const sourceHash = createHash('sha256').update(source).digest('hex')
  return `${runtimeMarker}# authoritative-sha256=${sourceHash}\n${normalized}`
}
