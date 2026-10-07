import path from 'node:path'
import type { StoreLayout } from './store.js'

export const cacheRuntimeMarker = '# Vhostra container cache configuration; owner=vhostra; schema=1\n'
export const cacheDefaultPorts = { redis: 6379, memcached: 11211 } as const

export function renderCacheRuntimeConfig(redisPort: number, memcachedPort: number) {
  for (const port of [redisPort, memcachedPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid cache service port.')
  }
  return {
    redis: `${cacheRuntimeMarker}bind 127.0.0.1\nprotected-mode yes\nappendonly no\nsave ""\nmaxmemory 64mb\nmaxmemory-policy allkeys-lru\nport ${redisPort}\n`,
    memcached: `${cacheRuntimeMarker}-u nobody\n-l 127.0.0.1\n-m 32\n-c 128\n-t 1\n-p ${memcachedPort}\n`,
  }
}

export function cacheRuntimePath(layout: StoreLayout, service: 'redis' | 'memcached') {
  return layout.dataRoot
    ? path.join(layout.dataRoot, 'runtime-config', 'cache', `${service}.conf`)
    : path.join(layout.runtime[service], `${service}.conf`)
}
